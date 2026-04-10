//! Receiver: downloads shared content from peers using blob tickets.

use crate::error::{FastDropError, Result};
use crate::node::FastDropNode;
use crate::storage::history::{self, TransferRecord};
use crate::storage::peers::{self, PeerRecord};
use crate::transfer::export;
use crate::transfer::progress::{
    EventReporter, ProgressHandle, ProgressSampler, QueueProgressTarget, TransferDirection,
};
use crate::transfer::queue::TransferQueue;
use futures_util::StreamExt;
use iroh_blobs::get::db::DownloadProgress;
use iroh_blobs::get::progress::{BlobProgress, BlobState, TransferState};
use iroh_blobs::rpc::client::blobs::{
    DownloadMode, DownloadOptions, DownloadProgress as ClientDownloadProgress,
};
use iroh_blobs::ticket::BlobTicket;
use iroh_blobs::util::SetTagOption;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Window;
use tokio::sync::watch;

const DOWNLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(60);

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
    let reporter = EventReporter::new(
        window,
        transfer_id.clone(),
        TransferDirection::Receive,
        ticket.hash().to_string(),
        Some(peer.clone()),
    );
    reporter.emit_started(0)?;

    let sampler = ProgressSampler::spawn(
        reporter.clone(),
        Some(QueueProgressTarget::new(queue.clone(), transfer_id.clone())),
    );
    let progress = sampler.handle();
    let result = receive_core(node, &ticket, destination, &mut cancel_rx, Some(&progress)).await;

    match result {
        Ok(summary) => {
            queue.remove(&transfer_id).await;
            progress.set(summary.size, summary.size);
            sampler.finish().await?;
            save_peer(node, &summary.peer)?;
            save_receive_record(node, &summary)?;
            reporter.emit_completed(summary.hash, summary.size)?;
            Ok(())
        }
        Err(error) => {
            queue.remove(&transfer_id).await;
            let _ = sampler.finish().await;
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
    let summary = receive_core(node, &ticket, destination, &mut cancel_rx, None).await?;
    Ok(ReceiveOutcome {
        hash: summary.hash,
        label: summary.label,
        size: summary.size,
        peer: summary.peer,
    })
}

async fn receive_core(
    node: &FastDropNode,
    ticket: &BlobTicket,
    destination: PathBuf,
    cancel_rx: &mut watch::Receiver<bool>,
    progress: Option<&ProgressHandle>,
) -> Result<ReceiveSummary> {
    let _state = download_to_store(node, ticket, cancel_rx, progress).await?;
    let size = export::export_ticket(node.blobs_client(), ticket, &destination).await?;
    Ok(ReceiveSummary {
        hash: ticket.hash().to_string(),
        label: export::resolve_label(node.blobs_client(), ticket).await?,
        size,
        peer: ticket.node_addr().node_id.to_string(),
    })
}

async fn download_to_store(
    node: &FastDropNode,
    ticket: &BlobTicket,
    cancel_rx: &mut watch::Receiver<bool>,
    progress: Option<&ProgressHandle>,
) -> Result<TransferState> {
    let mut stream = start_download(node, ticket).await?;
    let mut state = TransferState::new(ticket.hash());
    let mut lifecycle = DownloadLifecycle::default();

    loop {
        let event = next_event(&mut stream, cancel_rx, lifecycle.contacted_peer).await?;
        let Some(event) = event else {
            return stream_end_error();
        };
        let done = handle_download_event(ticket, &mut state, &mut lifecycle, event)?;
        update_progress(progress, ticket, &state);
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
    node.blobs_client()
        .download_with_opts(
            ticket.hash(),
            DownloadOptions {
                format: ticket.format(),
                nodes: vec![ticket.node_addr().clone()],
                tag: SetTagOption::Auto,
                mode: DownloadMode::Direct,
            },
        )
        .await
        .map_err(|error| blob_error(&error))
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
        DownloadProgress::Abort(error) => {
            return Err(download_abort_error(error.to_string(), *lifecycle));
        }
        DownloadProgress::AllDone(_) => return Ok(true),
        DownloadProgress::InitialState(_) | DownloadProgress::FoundLocal { .. } => {}
    }

    state.on_progress(event);
    if transferred_bytes(ticket, state) > 0 {
        lifecycle.contacted_peer = true;
    }
    Ok(false)
}

fn update_progress(progress: Option<&ProgressHandle>, ticket: &BlobTicket, state: &TransferState) {
    if let Some(progress) = progress {
        progress.set(transferred_bytes(ticket, state), total_bytes(ticket, state));
    }
}

async fn drain_download_stream(stream: &mut ClientDownloadProgress) -> Result<()> {
    while let Some(event) = stream.next().await {
        let _event = event.map_err(|error| blob_error(&error))?;
    }
    Ok(())
}

fn timeout_error(contacted_peer: bool) -> FastDropError {
    if contacted_peer {
        FastDropError::Other("Transfer interrupted".into())
    } else {
        FastDropError::Other("Peer not reachable".into())
    }
}

fn stream_end_error() -> Result<TransferState> {
    Err(FastDropError::Blob(
        "Download stream closed unexpectedly".into(),
    ))
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
    fn timeout_error_is_user_friendly() {
        assert_eq!(timeout_error(false).to_string(), "Peer not reachable");
        assert_eq!(timeout_error(true).to_string(), "Transfer interrupted");
    }
}
