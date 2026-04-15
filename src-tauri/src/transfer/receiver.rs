//! Receiver: downloads shared content from peers using blob tickets.

use crate::error::{FastDropError, Result};
use crate::node::FastDropNode;
use crate::storage::history::{self, TransferRecord};
use crate::storage::peers::{self, PeerRecord};
use crate::transfer::export;
use crate::transfer::metrics::{RouteKind, TransferMetrics};
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
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Window;
use tokio::sync::watch;

const DOWNLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone)]
struct ReceiveSummary {
    hash: String,
    label: String,
    size: u64,
    peer: String,
    metrics: TransferMetrics,
}

#[derive(Debug, Clone, Copy, Default)]
struct DownloadLifecycle {
    contacted_peer: bool,
    route_kind: RouteKind,
    connect_ms: u64,
}

#[derive(Debug)]
struct DownloadSummary {
    metrics: TransferMetrics,
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
    /// Best-known route used for the transfer.
    pub route_kind: RouteKind,
    /// Time to first successful peer contact.
    pub connect_ms: u64,
    /// Time spent downloading data into the local blob store.
    pub download_ms: u64,
    /// Time spent exporting verified data to disk.
    pub export_ms: u64,
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
    reporter.emit_started(0, TransferMetrics::default())?;

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
            progress.set_metrics(summary.metrics);
            sampler.finish().await?;
            save_peer_no_flush(node, &summary.peer)?;
            save_receive_record_no_flush(node, &summary)?;
            node.db.flush()?;
            reporter.emit_completed(summary.hash, summary.size, summary.metrics)?;
            Ok(())
        }
        Err(error) => {
            queue.remove(&transfer_id).await;
            let route_kind = progress.metrics_snapshot().route_kind;
            let _ = sampler.finish().await;
            let _ = reporter.emit_failed(&error.to_string(), route_kind);
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
        route_kind: summary.metrics.route_kind,
        connect_ms: summary.metrics.connect_ms,
        download_ms: summary.metrics.download_ms,
        export_ms: summary.metrics.export_ms,
    })
}

async fn receive_core(
    node: &FastDropNode,
    ticket: &BlobTicket,
    destination: PathBuf,
    cancel_rx: &mut watch::Receiver<bool>,
    progress: Option<&ProgressHandle>,
) -> Result<ReceiveSummary> {
    let download_started_at = Instant::now();
    let download = download_to_store(node, ticket, cancel_rx, progress).await?;
    let download_ms = elapsed_ms(download_started_at.elapsed());
    let tracked_total = progress.map(|p| p.snapshot().1);
    let export_started_at = Instant::now();
    let size =
        export::export_ticket(node.blobs_client(), ticket, &destination, tracked_total).await?;
    let export_ms = elapsed_ms(export_started_at.elapsed());
    let metrics = TransferMetrics {
        route_kind: download.metrics.route_kind,
        connect_ms: download.metrics.connect_ms,
        download_ms,
        export_ms,
    };
    if let Some(progress) = progress {
        progress.set_metrics(metrics);
    }
    Ok(ReceiveSummary {
        hash: ticket.hash().to_string(),
        label: export::resolve_label(node.blobs_client(), ticket).await?,
        size,
        peer: ticket.node_addr().node_id.to_string(),
        metrics,
    })
}

async fn download_to_store(
    node: &FastDropNode,
    ticket: &BlobTicket,
    cancel_rx: &mut watch::Receiver<bool>,
    progress: Option<&ProgressHandle>,
) -> Result<DownloadSummary> {
    let mut stream = start_download(node, ticket).await?;
    let mut state = TransferState::new(ticket.hash());
    let mut lifecycle = DownloadLifecycle::default();
    let started_at = Instant::now();

    loop {
        let event = next_event(&mut stream, cancel_rx, lifecycle.contacted_peer).await?;
        let Some(event) = event else {
            return stream_end_error();
        };
        let done =
            handle_download_event(node, ticket, &mut state, &mut lifecycle, event, started_at)?;
        update_progress(progress, ticket, &state, lifecycle);
        if done {
            drain_download_stream(&mut stream).await?;
            return Ok(DownloadSummary {
                metrics: TransferMetrics {
                    route_kind: lifecycle.route_kind,
                    connect_ms: lifecycle.connect_ms,
                    download_ms: 0,
                    export_ms: 0,
                },
            });
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
    node: &FastDropNode,
    ticket: &BlobTicket,
    state: &mut TransferState,
    lifecycle: &mut DownloadLifecycle,
    event: DownloadProgress,
    started_at: Instant,
) -> Result<bool> {
    match &event {
        DownloadProgress::Connected
        | DownloadProgress::Found { .. }
        | DownloadProgress::FoundHashSeq { .. }
        | DownloadProgress::Progress { .. }
        | DownloadProgress::Done { .. } => mark_contacted(node, ticket, lifecycle, started_at),
        DownloadProgress::Abort(error) => {
            return Err(download_abort_error(error.to_string(), *lifecycle));
        }
        DownloadProgress::AllDone(_) => return Ok(true),
        DownloadProgress::InitialState(_) | DownloadProgress::FoundLocal { .. } => {}
    }

    state.on_progress(event);
    if transferred_bytes(ticket, state) > 0 {
        mark_contacted(node, ticket, lifecycle, started_at);
    }
    Ok(false)
}

fn update_progress(
    progress: Option<&ProgressHandle>,
    ticket: &BlobTicket,
    state: &TransferState,
    lifecycle: DownloadLifecycle,
) {
    if let Some(progress) = progress {
        progress.set(transferred_bytes(ticket, state), total_bytes(ticket, state));
        progress.set_route_kind(lifecycle.route_kind);
        progress.set_connect_ms(lifecycle.connect_ms);
    }
}

fn mark_contacted(
    node: &FastDropNode,
    ticket: &BlobTicket,
    lifecycle: &mut DownloadLifecycle,
    started_at: Instant,
) {
    lifecycle.contacted_peer = true;
    if lifecycle.connect_ms == 0 {
        lifecycle.connect_ms = elapsed_ms(started_at.elapsed());
    }

    let route_kind = node.route_kind(ticket.node_addr().node_id);
    lifecycle.route_kind = if route_kind == RouteKind::Unknown {
        infer_route_kind(ticket)
    } else {
        route_kind
    };
}

fn infer_route_kind(ticket: &BlobTicket) -> RouteKind {
    let node_addr = ticket.node_addr();
    match (
        node_addr.direct_addresses.is_empty(),
        node_addr.relay_url().is_some(),
    ) {
        (false, false) => RouteKind::Direct,
        (true, true) => RouteKind::Relay,
        _ => RouteKind::Unknown,
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

fn stream_end_error() -> Result<DownloadSummary> {
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

fn save_peer_no_flush(node: &FastDropNode, peer: &str) -> Result<()> {
    peers::save_peer_no_flush(
        &node.db,
        &PeerRecord {
            node_id: peer.to_string(),
            nickname: None,
            last_seen: unix_timestamp(),
        },
    )
}

fn save_receive_record_no_flush(node: &FastDropNode, summary: &ReceiveSummary) -> Result<()> {
    history::save_record_no_flush(
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

fn elapsed_ms(duration: std::time::Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;
    use iroh::{NodeAddr, PublicKey};
    use iroh_blobs::BlobFormat;
    use std::str::FromStr;

    #[test]
    fn timeout_error_is_user_friendly() {
        assert_eq!(timeout_error(false).to_string(), "Peer not reachable");
        assert_eq!(timeout_error(true).to_string(), "Transfer interrupted");
    }

    #[test]
    fn route_is_inferred_from_relay_only_ticket() {
        let relay_url = "https://relay.example.com"
            .parse()
            .expect("relay url should parse");
        let ticket = BlobTicket::new(
            NodeAddr::from_parts(
                PublicKey::from_str(
                    "ae58ff8833241ac82d6ff7611046ed67b5072d142c588d0063e942d9a75502b6",
                )
                .expect("public key should parse"),
                Some(relay_url),
                [],
            ),
            iroh_blobs::Hash::new(b"hello"),
            BlobFormat::Raw,
        )
        .expect("ticket should build");

        assert_eq!(infer_route_kind(&ticket), RouteKind::Relay);
    }
}
