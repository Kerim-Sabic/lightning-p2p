//! Receiver: downloads shared content from peers using blob tickets.

use crate::error::{AppErrorPayload, LightningP2PError, Result};
use crate::node::LightningP2PNode;
use crate::storage::history::{self, TransferRecord};
use crate::storage::peers::{self, PeerRecord};
use crate::transfer::export;
use crate::transfer::metrics::{RouteKind, TransferMetrics, TransferStrategy};
use crate::transfer::mode::TransferProfile;
use crate::transfer::progress::{
    EventReporter, FailureCategory, ProgressHandle, ProgressSampler, QueueProgressTarget,
    TransferDirection, TransferPhase,
};
use crate::transfer::queue::TransferQueue;
use crate::transfer::ticket::ShareTicket;
use futures_util::{Stream, StreamExt};
use iroh_blobs::api::downloader::DownloadProgressItem;
#[cfg(test)]
use iroh_blobs::ticket::BlobTicket;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Window;
use tokio::sync::watch;

/// Floor on the receiver idle timeout. The per-transfer [`TransferProfile`]
/// chooses a value at least this large so we never get stuck waiting forever
/// on a dead peer.
const MIN_DOWNLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(10);

/// Maximum number of download attempts (initial + retries) for transient
/// failures. Non-transient failures (cancelled, disk-full, invalid ticket,
/// etc.) never retry — see [`is_transient_download_failure`].
const MAX_DOWNLOAD_ATTEMPTS: u32 = 3;

/// Initial backoff between transient-failure retries. Doubles each attempt.
const INITIAL_RETRY_BACKOFF: Duration = Duration::from_secs(1);

#[derive(Debug, Clone)]
struct ReceiveSummary {
    hash: String,
    label: String,
    size: u64,
    peer: String,
    metrics: TransferMetrics,
    output_path: PathBuf,
}

#[derive(Debug, Clone, Copy, Default)]
struct DownloadLifecycle {
    contacted_peer: bool,
    route_kind: RouteKind,
    connect_ms: u64,
    first_byte_ms: u64,
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
    /// Time from receive start to the first verified byte landing in the store.
    pub first_byte_ms: u64,
    /// Time spent downloading data into the local blob store.
    pub download_ms: u64,
    /// Time spent exporting verified data to disk.
    pub export_ms: u64,
    /// Final output path written by the export stage.
    pub output_path: PathBuf,
}

/// Downloads the content addressed by a ticket and exports it to disk.
///
/// Progress events are emitted through Tauri and mirrored into the in-memory
/// transfer queue.
///
/// # Errors
///
/// Returns `LightningP2PError` if the download fails, the ticket is cancelled, or
/// the exported files cannot be written.
/// In-flight receive coordination: queue handle, UI window, transfer id, and
/// the cancel-signal receiver. Bundled so [`receive_blob`] stays under the
/// clippy too-many-arguments threshold.
pub struct ReceiveContext {
    /// Shared in-memory queue this transfer participates in.
    pub queue: TransferQueue,
    /// Tauri window used to emit progress events.
    pub window: Window,
    /// Stable identifier of this transfer.
    pub transfer_id: String,
    /// Cancel signal — flip the watched bool to abort.
    pub cancel_rx: watch::Receiver<bool>,
    /// Opt-in experimental swarm receive: collection children fetched
    /// concurrently over parallel direct connections. Falls back to the
    /// standard sequential path on any non-cancel failure.
    pub swarm_enabled: bool,
}

/// Downloads the content addressed by a ticket using the supplied profile and
/// exports it to disk. Progress events are emitted through Tauri and mirrored
/// into the in-memory transfer queue.
///
/// # Errors
///
/// Returns `LightningP2PError` if the download fails, the ticket is cancelled,
/// or the exported files cannot be written.
pub async fn receive_blob(
    node: &LightningP2PNode,
    ctx: ReceiveContext,
    ticket: ShareTicket,
    destination: PathBuf,
    profile: TransferProfile,
) -> Result<()> {
    let ReceiveContext {
        queue,
        window,
        transfer_id,
        mut cancel_rx,
        swarm_enabled,
    } = ctx;
    let peer = ticket.primary().addr().id.to_string();
    let initial_metrics = metrics_for_ticket(&ticket);
    let reporter = EventReporter::new(
        window,
        transfer_id.clone(),
        TransferDirection::Receive,
        ticket
            .label()
            .map_or_else(|| ticket.primary().hash().to_string(), str::to_string),
        Some(peer.clone()),
    );
    reporter.emit_started(0, initial_metrics, TransferPhase::Connecting)?;

    let sampler = ProgressSampler::spawn_with_interval(
        reporter.clone(),
        Some(QueueProgressTarget::new(queue.clone(), transfer_id.clone())),
        profile.progress_interval,
    );
    let progress = sampler.handle();
    progress.set_metrics(initial_metrics);
    progress.set_phase(TransferPhase::Connecting);
    let result = receive_core(
        node,
        &ticket,
        destination,
        &mut cancel_rx,
        Some(&progress),
        profile,
        swarm_enabled,
    )
    .await;

    match result {
        Ok(summary) => {
            queue.remove(&transfer_id).await;
            progress.set(summary.size, summary.size);
            progress.set_metrics(summary.metrics);
            progress.set_phase(TransferPhase::Completed);
            sampler.finish().await?;
            save_peer_no_flush(node, &summary.peer)?;
            save_receive_record_no_flush(node, &summary)?;
            node.db().flush()?;
            reporter.emit_completed(
                summary.hash,
                summary.size,
                summary.metrics,
                Some(summary.output_path.to_string_lossy().to_string()),
            )?;
            Ok(())
        }
        Err(error) => {
            queue.remove(&transfer_id).await;
            let phase = progress.phase_snapshot();
            let error_payload = receive_error_payload(&error, phase);
            let failure_category = failure_category_from_payload(&error_payload, phase, &error);
            progress.set_phase(match failure_category {
                FailureCategory::Cancelled => TransferPhase::Cancelled,
                _ => TransferPhase::Failed,
            });
            let route_kind = progress.metrics_snapshot().route_kind;
            let _ = sampler.finish().await;
            let error_message = error_payload.message.clone();
            let _ = reporter.emit_failed_with_payload(
                &error_message,
                route_kind,
                Some(failure_category),
                Some(error_payload),
            );
            Err(error)
        }
    }
}

/// Downloads the content addressed by a ticket without any UI side effects.
///
/// Uses the platform-default [`TransferProfile`]. Production code paths should
/// call [`receive_blob`] which threads the user-selected profile through.
///
/// # Errors
///
/// Returns `LightningP2PError` if the download or final export fails.
pub async fn receive_ticket(
    node: &LightningP2PNode,
    ticket: ShareTicket,
    destination: PathBuf,
) -> Result<ReceiveOutcome> {
    let (_cancel_tx, mut cancel_rx) = watch::channel(false);
    let profile = crate::transfer::TransferMode::platform_default().profile();
    let summary = receive_core(
        node,
        &ticket,
        destination,
        &mut cancel_rx,
        None,
        profile,
        false,
    )
    .await?;
    Ok(ReceiveOutcome {
        hash: summary.hash,
        label: summary.label,
        size: summary.size,
        peer: summary.peer,
        route_kind: summary.metrics.route_kind,
        connect_ms: summary.metrics.connect_ms,
        first_byte_ms: summary.metrics.first_byte_ms,
        download_ms: summary.metrics.download_ms,
        export_ms: summary.metrics.export_ms,
        output_path: summary.output_path,
    })
}

async fn receive_core(
    node: &LightningP2PNode,
    ticket: &ShareTicket,
    destination: PathBuf,
    cancel_rx: &mut watch::Receiver<bool>,
    progress: Option<&ProgressHandle>,
    profile: TransferProfile,
    swarm_enabled: bool,
) -> Result<ReceiveSummary> {
    let download_started_at = Instant::now();
    let download =
        download_with_retry(node, ticket, cancel_rx, progress, profile, swarm_enabled).await?;
    let download_ms = elapsed_ms(download_started_at.elapsed());

    // The download just completed but the user may have flipped the cancel
    // signal during the brief window between the last `next_event` check and
    // now. iroh-blobs' `export()` does not take a cancel channel, so once we
    // start it the export runs to completion regardless. Check here so a
    // late-cancel doesn't end up as a Completed event with a delivered file.
    if *cancel_rx.borrow() {
        return Err(LightningP2PError::Other("Cancelled".into()));
    }

    let tracked_total = progress.map(|p| p.snapshot().1);
    if let Some(progress) = progress {
        progress.set_phase(TransferPhase::Verifying);
    }
    let export_started_at = Instant::now();
    let primary = ticket.primary();
    let export_summary =
        export::export_ticket(node.blobs_client(), primary, &destination, tracked_total).await?;
    let export_ms = elapsed_ms(export_started_at.elapsed());
    let effective_mbps = effective_mbps(export_summary.size, download_ms);
    let metrics = TransferMetrics {
        route_kind: download.metrics.route_kind,
        connect_ms: download.metrics.connect_ms,
        download_ms,
        export_ms,
        provider_count: download.metrics.provider_count,
        direct_provider_count: download.metrics.direct_provider_count,
        relay_provider_count: download.metrics.relay_provider_count,
        strategy: download.metrics.strategy,
        first_byte_ms: download.metrics.first_byte_ms,
        effective_mbps,
    };
    if let Some(progress) = progress {
        progress.set_metrics(metrics);
    }
    Ok(ReceiveSummary {
        hash: primary.hash().to_string(),
        label: export_summary.label,
        size: export_summary.size,
        peer: primary.addr().id.to_string(),
        metrics,
        output_path: export_summary.output_path,
    })
}

/// Wraps the download with bounded retries + exponential backoff for
/// transient failures (`Unreachable`, `Interrupted`). Non-transient failures
/// (`Cancelled`, `DiskSpace`, `Destination`, `Export`, `InvalidTicket`,
/// `Unknown`) bubble up on the first attempt. The retry sleep is also
/// cancel-aware so a user cancel during backoff aborts immediately instead of
/// waiting out the timer.
///
/// When `swarm_enabled` is set and the ticket is a collection, the first
/// attempt uses the experimental swarm path (parallel child fetches). A swarm
/// failure other than cancellation falls back to the standard sequential path
/// without consuming the retry budget, so opting in is never worse than the
/// default.
///
/// iroh-blobs keeps any already-verified chunks in the persistent store, so a
/// retry resumes from where the previous attempt failed — only the missing
/// bytes are re-fetched.
async fn download_with_retry(
    node: &LightningP2PNode,
    ticket: &ShareTicket,
    cancel_rx: &mut watch::Receiver<bool>,
    progress: Option<&ProgressHandle>,
    profile: TransferProfile,
    swarm_enabled: bool,
) -> Result<DownloadSummary> {
    let mut use_swarm = swarm_enabled && crate::transfer::swarm::eligible(ticket);
    let mut backoff = INITIAL_RETRY_BACKOFF;
    let mut attempt = 0u32;
    loop {
        let result = if use_swarm {
            swarm_download(node, ticket, cancel_rx, progress, profile).await
        } else {
            download_to_store(node, ticket, cancel_rx, progress, profile).await
        };
        let error = match result {
            Ok(summary) => return Ok(summary),
            Err(error) => error,
        };
        let category = categorize_receive_error(&error, TransferPhase::Downloading);
        if category == FailureCategory::Cancelled {
            return Err(error);
        }
        if use_swarm {
            tracing::warn!(
                %error,
                "swarm receive failed; falling back to the standard sequential path"
            );
            use_swarm = false;
            if let Some(progress) = progress {
                progress.set_phase(TransferPhase::Connecting);
            }
            continue;
        }
        attempt += 1;
        if !is_transient_download_failure(category) || attempt >= MAX_DOWNLOAD_ATTEMPTS {
            return Err(error);
        }
        tracing::warn!(
            %error,
            attempt,
            backoff_ms = u64::try_from(backoff.as_millis()).unwrap_or(u64::MAX),
            "transient receive failure; retrying after backoff"
        );
        if let Some(progress) = progress {
            progress.set_phase(TransferPhase::Connecting);
        }
        tokio::select! {
            () = tokio::time::sleep(backoff) => {}
            changed = cancel_rx.changed() => {
                if changed.is_ok() && *cancel_rx.borrow() {
                    return Err(LightningP2PError::Other("Cancelled".into()));
                }
            }
        }
        backoff = backoff.saturating_mul(2);
    }
}

/// Runs the experimental swarm path and shapes its observations into the
/// standard [`DownloadSummary`] metrics row.
async fn swarm_download(
    node: &LightningP2PNode,
    ticket: &ShareTicket,
    cancel_rx: &mut watch::Receiver<bool>,
    progress: Option<&ProgressHandle>,
    profile: TransferProfile,
) -> Result<DownloadSummary> {
    let observations =
        crate::transfer::swarm::download_collection(node, ticket, cancel_rx, progress, profile)
            .await?;
    let route_kind = infer_route_kind(ticket);
    if let Some(progress) = progress {
        progress.set_route_kind(route_kind);
    }
    Ok(DownloadSummary {
        metrics: TransferMetrics {
            route_kind,
            connect_ms: observations.connect_ms,
            first_byte_ms: observations.first_byte_ms,
            strategy: TransferStrategy::SwarmParallel,
            ..metrics_for_ticket(ticket)
        },
    })
}

/// Returns true for download failure categories that are worth retrying.
/// Cancellation, disk-space, destination, export, and invalid-ticket failures
/// are user-visible end states; retrying them would only burn time.
fn is_transient_download_failure(category: FailureCategory) -> bool {
    matches!(
        category,
        FailureCategory::Unreachable | FailureCategory::Interrupted
    )
}

async fn download_to_store(
    node: &LightningP2PNode,
    ticket: &ShareTicket,
    cancel_rx: &mut watch::Receiver<bool>,
    progress: Option<&ProgressHandle>,
    profile: TransferProfile,
) -> Result<DownloadSummary> {
    // Teach the endpoint how to reach the sender, then dial via the downloader.
    node.register_ticket_addrs(ticket.provider_node_addrs());
    let providers: Vec<iroh::EndpointId> = ticket
        .provider_node_addrs()
        .iter()
        .map(|addr| addr.id)
        .collect();
    let downloader = node.blobs_client().downloader(node.endpoint());
    let mut stream = downloader
        .download(ticket.primary().hash_and_format(), providers)
        .stream()
        .await
        .map_err(|error| blob_error(&error))?;

    let route_kind = infer_route_kind(ticket);
    let total = ticket.size().unwrap_or(0);
    let started_at = Instant::now();
    let idle_timeout = profile.idle_timeout.max(MIN_DOWNLOAD_IDLE_TIMEOUT);
    let mut lifecycle = DownloadLifecycle {
        route_kind,
        ..DownloadLifecycle::default()
    };

    loop {
        let Some(item) = next_event(
            &mut stream,
            cancel_rx,
            lifecycle.contacted_peer,
            idle_timeout,
        )
        .await?
        else {
            // The stream ending cleanly means the download completed.
            publish_progress(progress, total, total, &lifecycle);
            return Ok(DownloadSummary {
                metrics: TransferMetrics {
                    route_kind: lifecycle.route_kind,
                    connect_ms: lifecycle.connect_ms,
                    first_byte_ms: lifecycle.first_byte_ms,
                    ..metrics_for_ticket(ticket)
                },
            });
        };
        match item {
            DownloadProgressItem::TryProvider { .. } => {
                mark_contacted(&mut lifecycle, started_at);
                publish_progress(progress, 0, total, &lifecycle);
            }
            DownloadProgressItem::Progress(offset) => {
                mark_contacted(&mut lifecycle, started_at);
                if offset > 0 {
                    mark_first_byte(&mut lifecycle, started_at);
                }
                publish_progress(progress, offset, total, &lifecycle);
            }
            DownloadProgressItem::ProviderFailed { .. }
            | DownloadProgressItem::PartComplete { .. } => {}
            DownloadProgressItem::Error(error) => {
                return Err(download_error(&error.to_string(), lifecycle))
            }
            DownloadProgressItem::DownloadError => {
                return Err(download_error("download failed", lifecycle))
            }
        }
    }
}

async fn next_event(
    stream: &mut (impl Stream<Item = DownloadProgressItem> + Unpin),
    cancel_rx: &mut watch::Receiver<bool>,
    contacted_peer: bool,
    idle_timeout: Duration,
) -> Result<Option<DownloadProgressItem>> {
    loop {
        tokio::select! {
            changed = cancel_rx.changed() => {
                if changed.is_ok() && *cancel_rx.borrow() {
                    return Err(LightningP2PError::Other("Cancelled".into()));
                }
            }
            item = tokio::time::timeout(idle_timeout, stream.next()) => {
                return match item {
                    Ok(event) => Ok(event),
                    Err(_) => Err(timeout_error(contacted_peer)),
                };
            }
        }
    }
}

fn publish_progress(
    progress: Option<&ProgressHandle>,
    bytes: u64,
    total: u64,
    lifecycle: &DownloadLifecycle,
) {
    if let Some(progress) = progress {
        progress.set(bytes, total);
        progress.set_route_kind(lifecycle.route_kind);
        progress.set_connect_ms(lifecycle.connect_ms);
        progress.set_first_byte_ms(lifecycle.first_byte_ms);
        progress.set_phase(if lifecycle.contacted_peer {
            TransferPhase::Downloading
        } else {
            TransferPhase::Connecting
        });
    }
}

fn mark_contacted(lifecycle: &mut DownloadLifecycle, started_at: Instant) {
    lifecycle.contacted_peer = true;
    if lifecycle.connect_ms == 0 {
        lifecycle.connect_ms = elapsed_ms(started_at.elapsed());
    }
}

fn mark_first_byte(lifecycle: &mut DownloadLifecycle, started_at: Instant) {
    if lifecycle.first_byte_ms == 0 {
        lifecycle.first_byte_ms = elapsed_ms(started_at.elapsed());
    }
}

fn download_error(message: &str, lifecycle: DownloadLifecycle) -> LightningP2PError {
    if lifecycle.contacted_peer {
        LightningP2PError::Blob(message.to_string())
    } else {
        LightningP2PError::Other("Peer not reachable".into())
    }
}

fn infer_route_kind(ticket: &ShareTicket) -> RouteKind {
    let topology = ticket.topology();
    match (
        topology.direct_provider_count > 0,
        topology.relay_provider_count > 0,
    ) {
        (true, true) => RouteKind::Mixed,
        (true, false) => RouteKind::Direct,
        (false, true) => RouteKind::Relay,
        (false, false) => RouteKind::Unknown,
    }
}

#[cfg(test)]
fn legacy_ticket_route_kind(ticket: &BlobTicket) -> RouteKind {
    let addr = ticket.addr();
    let has_direct = addr.addrs.iter().any(iroh::TransportAddr::is_ip);
    let has_relay = addr.addrs.iter().any(iroh::TransportAddr::is_relay);
    match (has_direct, has_relay) {
        (true, false) => RouteKind::Direct,
        (false, true) => RouteKind::Relay,
        _ => RouteKind::Unknown,
    }
}

fn metrics_for_ticket(ticket: &ShareTicket) -> TransferMetrics {
    let topology = ticket.topology();
    TransferMetrics {
        route_kind: infer_route_kind(ticket),
        provider_count: topology.provider_count,
        direct_provider_count: topology.direct_provider_count,
        relay_provider_count: topology.relay_provider_count,
        strategy: if topology.provider_count > 1 {
            TransferStrategy::QueuedMultiProvider
        } else {
            TransferStrategy::QueuedSingleProvider
        },
        ..TransferMetrics::default()
    }
}

fn effective_mbps(bytes: u64, duration_ms: u64) -> u64 {
    if duration_ms == 0 {
        return 0;
    }
    let megabits_per_second = u128::from(bytes).saturating_mul(8) / u128::from(duration_ms) / 1000;
    u64::try_from(megabits_per_second).unwrap_or(u64::MAX)
}

fn timeout_error(contacted_peer: bool) -> LightningP2PError {
    if contacted_peer {
        LightningP2PError::Other("Transfer interrupted".into())
    } else {
        LightningP2PError::Other("Peer not reachable".into())
    }
}

fn categorize_receive_error(error: &LightningP2PError, phase: TransferPhase) -> FailureCategory {
    let message = error.to_string().to_lowercase();
    if message.contains("cancelled") {
        return FailureCategory::Cancelled;
    }
    if message.contains("peer not reachable") {
        return FailureCategory::Unreachable;
    }
    if message.contains("transfer interrupted") {
        return FailureCategory::Interrupted;
    }
    if message.contains("not enough free disk space") {
        return FailureCategory::DiskSpace;
    }
    if message.contains("download folder")
        || message.contains("download destination")
        || message.contains("not writable")
    {
        return FailureCategory::Destination;
    }
    if phase == TransferPhase::Verifying || message.contains("export") {
        return FailureCategory::Export;
    }
    if matches!(error, LightningP2PError::Blob(_)) {
        return FailureCategory::Interrupted;
    }
    FailureCategory::Unknown
}

fn receive_error_payload(error: &LightningP2PError, phase: TransferPhase) -> AppErrorPayload {
    let mut payload = if phase == TransferPhase::Verifying {
        AppErrorPayload::export_failed(error.to_string())
    } else {
        error.to_payload()
    };
    let category = payload.category;
    payload = payload.with_redacted_diagnostics(format!("phase={phase:?} category={category:?}"));
    payload
}

fn failure_category_from_payload(
    payload: &AppErrorPayload,
    phase: TransferPhase,
    legacy_error: &LightningP2PError,
) -> FailureCategory {
    match payload.code {
        crate::error::AppErrorCode::TransferCancelled => FailureCategory::Cancelled,
        crate::error::AppErrorCode::SenderOffline => FailureCategory::Unreachable,
        crate::error::AppErrorCode::ConnectionTimeout => FailureCategory::Interrupted,
        crate::error::AppErrorCode::DiskFull => FailureCategory::DiskSpace,
        crate::error::AppErrorCode::DestinationUnavailable
        | crate::error::AppErrorCode::PermissionDenied => FailureCategory::Destination,
        crate::error::AppErrorCode::ExportFailed => FailureCategory::Export,
        crate::error::AppErrorCode::InvalidTicket => FailureCategory::InvalidTicket,
        _ => categorize_receive_error(legacy_error, phase),
    }
}

fn save_peer_no_flush(node: &LightningP2PNode, peer: &str) -> Result<()> {
    peers::save_peer_no_flush(
        node.db(),
        &PeerRecord {
            node_id: peer.to_string(),
            nickname: None,
            last_seen: unix_timestamp(),
        },
    )
}

fn save_receive_record_no_flush(node: &LightningP2PNode, summary: &ReceiveSummary) -> Result<()> {
    history::save_record_no_flush(
        node.db(),
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

fn blob_error(err: &impl ToString) -> LightningP2PError {
    LightningP2PError::Blob(err.to_string())
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
    use iroh::{EndpointAddr, PublicKey, TransportAddr};
    use iroh_blobs::BlobFormat;
    use std::str::FromStr;

    #[test]
    fn timeout_error_is_user_friendly() {
        assert_eq!(timeout_error(false).to_string(), "Peer not reachable");
        assert_eq!(timeout_error(true).to_string(), "Transfer interrupted");
    }

    #[test]
    fn receive_errors_are_categorized_for_ui() {
        assert_eq!(
            categorize_receive_error(
                &LightningP2PError::Other("Cancelled".into()),
                TransferPhase::Downloading
            ),
            FailureCategory::Cancelled
        );
        assert_eq!(
            categorize_receive_error(
                &LightningP2PError::Other("Peer not reachable".into()),
                TransferPhase::Connecting
            ),
            FailureCategory::Unreachable
        );
        assert_eq!(
            categorize_receive_error(
                &LightningP2PError::Blob("disk write failed".into()),
                TransferPhase::Verifying
            ),
            FailureCategory::Export
        );
    }

    #[test]
    fn route_is_inferred_from_relay_only_ticket() {
        let relay_url = "https://relay.example.com"
            .parse()
            .expect("relay url should parse");
        let node_id = PublicKey::from_str(
            "ae58ff8833241ac82d6ff7611046ed67b5072d142c588d0063e942d9a75502b6",
        )
        .expect("public key should parse");
        let ticket = BlobTicket::new(
            EndpointAddr::from_parts(node_id, [TransportAddr::Relay(relay_url)]),
            iroh_blobs::Hash::new(b"hello"),
            BlobFormat::Raw,
        );

        assert_eq!(legacy_ticket_route_kind(&ticket), RouteKind::Relay);
    }

    #[test]
    fn effective_mbps_uses_payload_and_download_time() {
        assert_eq!(effective_mbps(125_000_000, 1_000), 1000);
        assert_eq!(effective_mbps(125_000_000, 0), 0);
    }

    #[test]
    fn only_unreachable_and_interrupted_are_retried() {
        assert!(is_transient_download_failure(FailureCategory::Unreachable));
        assert!(is_transient_download_failure(FailureCategory::Interrupted));
        assert!(!is_transient_download_failure(FailureCategory::Cancelled));
        assert!(!is_transient_download_failure(FailureCategory::DiskSpace));
        assert!(!is_transient_download_failure(FailureCategory::Destination));
        assert!(!is_transient_download_failure(FailureCategory::Export));
        assert!(!is_transient_download_failure(
            FailureCategory::InvalidTicket
        ));
        assert!(!is_transient_download_failure(FailureCategory::Unknown));
    }
}
