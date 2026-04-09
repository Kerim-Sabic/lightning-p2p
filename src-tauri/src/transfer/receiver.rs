//! Receiver: downloads shared content from peers using blob tickets.

use crate::error::{FastDropError, Result};
use crate::node::FastDropNode;
use crate::storage::history::{self, TransferRecord};
use crate::storage::peers::{self, PeerRecord};
use crate::transfer::progress::{EventReporter, TransferDirection};
use crate::transfer::queue::TransferQueue;
use futures_util::StreamExt;
use iroh_blobs::get::db::DownloadProgress;
use iroh_blobs::get::progress::{BlobProgress, BlobState, TransferState};
use iroh_blobs::rpc::client::blobs::DownloadProgress as ClientDownloadProgress;
use iroh_blobs::store::{ExportFormat, ExportMode};
use iroh_blobs::ticket::BlobTicket;
use iroh_blobs::{BlobFormat, Hash};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Window;
use tokio::sync::watch;

const DOWNLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
const TEMP_SUFFIX: &str = ".fastdrop.part";

#[derive(Debug, Clone)]
struct ReceiveSummary {
    hash: String,
    label: String,
    size: u64,
    peer: String,
}

#[derive(Debug, Clone, Copy, Default)]
struct DownloadLifecycle {
    contacted_peer: bool,
}

/// Outcome of a completed receive flow.
#[derive(Debug, Clone)]
pub struct ReceiveOutcome {
    /// Root content hash.
    pub hash: String,
    /// User-visible filename or collection label.
    pub label: String,
    /// Total bytes received.
    pub size: u64,
    /// Remote peer node id.
    pub peer: String,
}

/// Downloads the content addressed by a ticket and exports it to disk.
///
/// Progress events are emitted through Tauri and mirrored into the in-memory
/// transfer queue.
///
/// # Errors
///
/// Returns `FastDropError` if the download fails, the ticket is cancelled, or
/// the exported files cannot be written.
pub async fn receive_blob(
    node: &FastDropNode,
    queue: TransferQueue,
    window: Window,
    transfer_id: String,
    ticket: BlobTicket,
    destination: PathBuf,
    mut cancel_rx: watch::Receiver<bool>,
) -> Result<()> {
    let peer = ticket.node_addr().node_id.to_string();
    let mut reporter = EventReporter::new(
        window,
        transfer_id.clone(),
        TransferDirection::Receive,
        ticket.hash().to_string(),
        Some(peer.clone()),
    );
    reporter.emit_started(0)?;

    let result = receive_with_events(
        node,
        &queue,
        &mut reporter,
        &transfer_id,
        ticket,
        destination,
        &mut cancel_rx,
    )
    .await;

    match result {
        Ok(summary) => {
            queue.remove(&transfer_id).await;
            save_peer(node, &summary.peer)?;
            save_receive_record(node, &summary)?;
            reporter.emit_completed(summary.hash, summary.size)?;
            Ok(())
        }
        Err(error) => {
            queue.remove(&transfer_id).await;
            let _ = reporter.emit_failed(&error.to_string());
            Err(error)
        }
    }
}

/// Downloads the content addressed by a ticket without any UI side effects.
///
/// # Errors
///
/// Returns `FastDropError` if the download or final export fails.
pub async fn receive_ticket(
    node: &FastDropNode,
    ticket: BlobTicket,
    destination: PathBuf,
) -> Result<ReceiveOutcome> {
    let (_cancel_tx, mut cancel_rx) = watch::channel(false);
    let summary = receive_core(node, &ticket, destination, &mut cancel_rx, &mut |_, _| Ok(())).await?;
    Ok(ReceiveOutcome {
        hash: summary.hash,
        label: summary.label,
        size: summary.size,
        peer: summary.peer,
    })
}

async fn receive_with_events(
    node: &FastDropNode,
    queue: &TransferQueue,
    reporter: &mut EventReporter,
    transfer_id: &str,
    ticket: BlobTicket,
    destination: PathBuf,
    cancel_rx: &mut watch::Receiver<bool>,
) -> Result<ReceiveSummary> {
    receive_core(node, &ticket, destination, cancel_rx, &mut |bytes, total| {
        if let Some(update) = reporter.progress_update(bytes, total) {
            let queue = queue.clone();
            let transfer_id = transfer_id.to_string();
            tauri::async_runtime::spawn(async move {
                queue
                    .update_progress(&transfer_id, update.bytes, update.total, update.speed_bps)
                    .await;
            });
            reporter.emit_progress(update)?;
        }
        Ok(())
    })
    .await
}

async fn receive_core<F>(
    node: &FastDropNode,
    ticket: &BlobTicket,
    destination: PathBuf,
    cancel_rx: &mut watch::Receiver<bool>,
    on_progress: &mut F,
) -> Result<ReceiveSummary>
where
    F: FnMut(u64, u64) -> Result<()>,
{
    let _state = download_to_store(node, ticket, cancel_rx, on_progress).await?;
    export_download(node, ticket, &destination).await?;
    let size = exported_size(node, ticket, &destination).await?;
    Ok(ReceiveSummary {
        hash: ticket.hash().to_string(),
        label: resolve_label(node, ticket).await?,
        size,
        peer: ticket.node_addr().node_id.to_string(),
    })
}

async fn download_to_store<F>(
    node: &FastDropNode,
    ticket: &BlobTicket,
    cancel_rx: &mut watch::Receiver<bool>,
    on_progress: &mut F,
) -> Result<TransferState>
where
    F: FnMut(u64, u64) -> Result<()>,
{
    let mut stream = start_download(node, ticket).await?;
    let mut state = TransferState::new(ticket.hash());
    let mut lifecycle = DownloadLifecycle::default();

    loop {
        let event = next_event(&mut stream, cancel_rx, lifecycle.contacted_peer).await?;
        let Some(event) = event else {
            return stream_end_error(lifecycle);
        };
        let done = handle_download_event(ticket, &mut state, &mut lifecycle, event)?;
        on_progress(transferred_bytes(ticket, &state), total_bytes(ticket, &state))?;
        if done {
            drain_download_stream(&mut stream).await?;
            return Ok(state);
        }
    }
}

async fn start_download(
    node: &FastDropNode,
    ticket: &BlobTicket,
) -> Result<ClientDownloadProgress> {
    match ticket.format() {
        BlobFormat::HashSeq => node
            .blobs_client()
            .download_hash_seq(ticket.hash(), ticket.node_addr().clone())
            .await
            .map_err(|error| blob_error(&error)),
        BlobFormat::Raw => node
            .blobs_client()
            .download(ticket.hash(), ticket.node_addr().clone())
            .await
            .map_err(|error| blob_error(&error)),
    }
}

async fn next_event(
    stream: &mut ClientDownloadProgress,
    cancel_rx: &mut watch::Receiver<bool>,
    contacted_peer: bool,
) -> Result<Option<DownloadProgress>> {
    loop {
        tokio::select! {
            changed = cancel_rx.changed() => {
                if changed.is_ok() && *cancel_rx.borrow() {
                    return Err(FastDropError::Other("Cancelled".into()));
                }
            }
            item = tokio::time::timeout(DOWNLOAD_IDLE_TIMEOUT, stream.next()) => {
                return match item {
                    Ok(Some(event)) => event.map(Some).map_err(|error| blob_error(&error)),
                    Ok(None) => Ok(None),
                    Err(_) => Err(timeout_error(contacted_peer)),
                };
            }
        }
    }
}

fn handle_download_event(
    ticket: &BlobTicket,
    state: &mut TransferState,
    lifecycle: &mut DownloadLifecycle,
    event: DownloadProgress,
) -> Result<bool> {
    match &event {
        DownloadProgress::Connected
        | DownloadProgress::Found { .. }
        | DownloadProgress::FoundHashSeq { .. }
        | DownloadProgress::Progress { .. }
        | DownloadProgress::Done { .. } => lifecycle.contacted_peer = true,
        DownloadProgress::Abort(error) => return Err(download_abort_error(error.to_string(), *lifecycle)),
        DownloadProgress::AllDone(_) => return Ok(true),
        DownloadProgress::InitialState(_) | DownloadProgress::FoundLocal { .. } => {}
    }

    state.on_progress(event);
    if transferred_bytes(ticket, state) > 0 {
        lifecycle.contacted_peer = true;
    }
    Ok(false)
}

fn timeout_error(contacted_peer: bool) -> FastDropError {
    if contacted_peer {
        FastDropError::Other("Transfer interrupted".into())
    } else {
        FastDropError::Other("Peer not reachable".into())
    }
}

fn stream_end_error(lifecycle: DownloadLifecycle) -> Result<TransferState> {
    let _ = lifecycle;
    Err(FastDropError::Blob("Download stream closed unexpectedly".into()))
}

fn download_abort_error(message: String, lifecycle: DownloadLifecycle) -> FastDropError {
    if lifecycle.contacted_peer {
        FastDropError::Blob(message)
    } else {
        FastDropError::Other("Peer not reachable".into())
    }
}

fn transferred_bytes(ticket: &BlobTicket, state: &TransferState) -> u64 {
    if ticket.recursive() {
        state.children.values().map(blob_progress_bytes).sum()
    } else {
        blob_progress_bytes(state.root())
    }
}

fn total_bytes(ticket: &BlobTicket, state: &TransferState) -> u64 {
    if ticket.recursive() {
        state.children.values().map(blob_total_bytes).sum()
    } else {
        blob_total_bytes(state.root())
    }
}

fn blob_total_bytes(blob: &BlobState) -> u64 {
    blob.size.map_or(0, |size| size.value())
}

fn blob_progress_bytes(blob: &BlobState) -> u64 {
    let size = blob_total_bytes(blob);
    match blob.progress {
        BlobProgress::Pending => 0,
        BlobProgress::Progressing(offset) => {
            if size == 0 {
                offset
            } else {
                offset.min(size)
            }
        }
        BlobProgress::Done => size,
    }
}

async fn export_download(node: &FastDropNode, ticket: &BlobTicket, destination: &Path) -> Result<()> {
    tokio::fs::create_dir_all(destination).await?;
    if ticket.recursive() {
        export_collection_to_destination(node, ticket.hash(), destination).await
    } else {
        export_blob_to_destination(node, ticket.hash(), destination).await
    }
}

async fn drain_download_stream(stream: &mut ClientDownloadProgress) -> Result<()> {
    while let Some(event) = stream.next().await {
        let _event = event.map_err(|error| blob_error(&error))?;
    }
    Ok(())
}

async fn export_blob_to_destination(node: &FastDropNode, hash: Hash, destination: &Path) -> Result<()> {
    let final_path = destination.join(hash.to_string());
    let temp_path = destination.join(temp_name(&hash.to_string()));
    export_path(node, hash, temp_path.clone(), ExportFormat::Blob).await?;
    tokio::fs::rename(temp_path, final_path).await?;
    Ok(())
}

async fn export_collection_to_destination(
    node: &FastDropNode,
    hash: Hash,
    destination: &Path,
) -> Result<()> {
    let temp_dir = destination.join(temp_name(&hash.to_string()));
    let roots = collection_roots(node, hash).await?;
    export_path(node, hash, temp_dir.clone(), ExportFormat::Collection).await?;
    move_collection_roots(&temp_dir, destination, &roots).await?;
    tokio::fs::remove_dir_all(temp_dir).await?;
    Ok(())
}

async fn export_path(
    node: &FastDropNode,
    hash: Hash,
    path: PathBuf,
    format: ExportFormat,
) -> Result<()> {
    let export = node
        .blobs_client()
        .export(hash, path, format, ExportMode::Copy)
        .await
        .map_err(|error| blob_error(&error))?;
    let _outcome = export.await.map_err(|error| blob_error(&error))?;
    Ok(())
}

async fn collection_roots(node: &FastDropNode, hash: Hash) -> Result<Vec<String>> {
    let collection = node
        .blobs_client()
        .get_collection(hash)
        .await
        .map_err(|error| blob_error(&error))?;
    let mut roots = collection
        .iter()
        .filter_map(|(name, _hash)| name.split('/').next())
        .map(str::to_string)
        .collect::<Vec<_>>();
    roots.sort();
    roots.dedup();
    Ok(roots)
}

async fn move_collection_roots(temp_dir: &Path, destination: &Path, roots: &[String]) -> Result<()> {
    for root in roots {
        let source = temp_dir.join(root);
        let target = destination.join(root);
        if tokio::fs::try_exists(&target).await? {
            return Err(FastDropError::Other(format!(
                "Destination already contains {root}"
            )));
        }
        tokio::fs::rename(source, target).await?;
    }
    Ok(())
}

fn temp_name(name: &str) -> String {
    format!("{name}{TEMP_SUFFIX}")
}

async fn resolve_label(node: &FastDropNode, ticket: &BlobTicket) -> Result<String> {
    if !ticket.recursive() {
        return Ok(ticket.hash().to_string());
    }
    let collection = node
        .blobs_client()
        .get_collection(ticket.hash())
        .await
        .map_err(|error| blob_error(&error))?;
    Ok(summarize_names(collection.iter().map(|(name, _hash)| name.as_str())))
}

async fn exported_size(node: &FastDropNode, ticket: &BlobTicket, destination: &Path) -> Result<u64> {
    if ticket.recursive() {
        let roots = collection_roots(node, ticket.hash()).await?;
        roots.iter().try_fold(0, |total, root| Ok(total + path_size(&destination.join(root))?))
    } else {
        path_size(&destination.join(ticket.hash().to_string()))
    }
}

fn summarize_names<'a>(names: impl Iterator<Item = &'a str>) -> String {
    let mut roots = names
        .filter_map(|name| name.split('/').next())
        .map(str::to_string)
        .collect::<Vec<_>>();
    roots.sort();
    roots.dedup();
    match roots.as_slice() {
        [single] => single.clone(),
        [] => "download".into(),
        _ => format!("{} items", roots.len()),
    }
}

fn path_size(path: &Path) -> Result<u64> {
    let metadata = fs::metadata(path)?;
    if metadata.is_file() {
        return Ok(metadata.len());
    }

    let mut total = 0u64;
    for entry in fs::read_dir(path)? {
        total += path_size(&entry?.path())?;
    }
    Ok(total)
}

fn save_peer(node: &FastDropNode, peer: &str) -> Result<()> {
    peers::save_peer(
        &node.db,
        &PeerRecord {
            node_id: peer.to_string(),
            nickname: None,
            last_seen: unix_timestamp(),
        },
    )
}

fn save_receive_record(node: &FastDropNode, summary: &ReceiveSummary) -> Result<()> {
    history::save_record(
        &node.db,
        &TransferRecord {
            hash: summary.hash.clone(),
            filename: summary.label.clone(),
            size: summary.size,
            peer: Some(summary.peer.clone()),
            timestamp: unix_timestamp(),
            direction: TransferDirection::Receive,
        },
    )
}

fn blob_error(err: &impl ToString) -> FastDropError {
    FastDropError::Blob(err.to_string())
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarize_single_root_name() {
        let label = summarize_names(["folder/a.txt", "folder/b.txt"].into_iter());
        assert_eq!(label, "folder");
    }

    #[test]
    fn summarize_multiple_root_names() {
        let label = summarize_names(["one/a.txt", "two/b.txt"].into_iter());
        assert_eq!(label, "2 items");
    }

    #[test]
    fn timeout_error_is_user_friendly() {
        assert_eq!(timeout_error(false).to_string(), "Peer not reachable");
        assert_eq!(timeout_error(true).to_string(), "Transfer interrupted");
    }
}
