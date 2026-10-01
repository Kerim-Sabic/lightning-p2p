//! Receiver: downloads shared content from peers using blob tickets.

use crate::error::{AppErrorPayload, LightningP2PError, Result};
use crate::node::LightningP2PNode;
use crate::storage::history::{self, TransferRecord, TransferRecordStatus};
use crate::storage::peers::{self, PeerRecord};
use crate::storage::resumable_receives::{ReceiveFinalization, ResumableReceiveStore};
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
use serde::{Deserialize, Serialize};
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

/// Optional guards applied to incoming data before it can be exported.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReceiveLimits {
    /// Maximum cumulative downloaded bytes.
    pub max_total_bytes: Option<u64>,
    /// Maximum number of files in a received collection.
    pub max_file_count: Option<usize>,
    /// Reject file names whose extensions are not on the safe receive list.
    pub reject_risky_file_names: bool,
}

impl ReceiveLimits {
    /// Bounded receive policy for the automatic single-file handoff.
    #[must_use]
    pub const fn ready_to_catch() -> Self {
        Self {
            max_total_bytes: Some(100 * 1024 * 1024),
            max_file_count: Some(1),
            reject_risky_file_names: true,
        }
    }
}

#[derive(Debug, Clone)]
struct ReceiveOptions {
    transfer_id: Option<String>,
    profile: TransferProfile,
    swarm_enabled: bool,
    limits: ReceiveLimits,
    fallback_file_name: Option<String>,
    resume_store: Option<ResumableReceiveStore>,
}

#[derive(Debug, Clone)]
struct ReceiveSummary {
    transfer_id: Option<String>,
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
    /// Optional transfer guards; regular user-accepted receives are unlimited.
    pub limits: ReceiveLimits,
    /// Sender-provided filename for non-collection offer tickets.
    pub fallback_file_name: Option<String>,
    /// Durable metadata used to recover a file published just before a crash.
    pub resume_store: ResumableReceiveStore,
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
        limits,
        fallback_file_name,
        resume_store,
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
    let recovered = recover_finalized_receive(
        &resume_store,
        &transfer_id,
        &ticket,
        &destination,
        &peer,
        initial_metrics,
        &progress,
    )
    .await;
    let result = match recovered {
        Some(summary) => Ok(summary),
        None => {
            receive_core(
                node,
                &ticket,
                destination,
                &mut cancel_rx,
                Some(&progress),
                ReceiveOptions {
                    transfer_id: Some(transfer_id.clone()),
                    profile,
                    swarm_enabled,
                    limits,
                    fallback_file_name,
                    resume_store: Some(resume_store),
                },
            )
            .await
        }
    };

    finish_receive_result(
        result,
        node,
        queue,
        transfer_id,
        progress,
        sampler,
        reporter,
    )
    .await
}

async fn finish_receive_result(
    result: Result<ReceiveSummary>,
    node: &LightningP2PNode,
    queue: TransferQueue,
    transfer_id: String,
    progress: ProgressHandle,
    sampler: ProgressSampler,
    reporter: EventReporter,
) -> Result<()> {
    match result {
        Ok(summary) => {
            if let Err(_error) = save_peer_no_flush(node, &summary.peer) {
                tracing::warn!("could not update received peer history");
            }
            if let Err(_error) = save_receive_record_no_flush(node, &summary) {
                tracing::warn!("could not save receive history record");
            }
            if let Err(_error) = node.db().flush() {
                tracing::warn!("could not flush receive history");
            }
            queue.remove(&transfer_id).await;
            progress.set(summary.size, summary.size);
            progress.set_metrics(summary.metrics);
            progress.set_phase(TransferPhase::Completed);
            if let Err(_error) = sampler.finish().await {
                tracing::warn!("could not emit final receive progress");
            }
            if let Err(_error) = reporter.emit_completed(
                summary.hash.clone(),
                summary.size,
                summary.metrics,
                Some(summary.output_path.to_string_lossy().to_string()),
            ) {
                tracing::warn!("could not emit completed receive event");
            }
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

async fn recover_finalized_receive(
    store: &ResumableReceiveStore,
    transfer_id: &str,
    ticket: &ShareTicket,
    destination: &std::path::Path,
    peer: &str,
    metrics: TransferMetrics,
    progress: &ProgressHandle,
) -> Option<ReceiveSummary> {
    let finalization = store.get(transfer_id)?.finalization?;
    if finalization.hash != ticket.primary().hash().to_string() {
        return None;
    }
    let output_path = export::recover_published_blob(destination, &finalization).await?;
    progress.set_phase(TransferPhase::Saving);
    Some(ReceiveSummary {
        transfer_id: Some(transfer_id.to_owned()),
        hash: finalization.hash,
        label: finalization.file_name,
        size: finalization.size,
        peer: peer.to_owned(),
        metrics,
        output_path,
    })
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
        ReceiveOptions {
            transfer_id: None,
            profile,
            swarm_enabled: false,
            limits: ReceiveLimits::default(),
            fallback_file_name: None,
            resume_store: None,
        },
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
    options: ReceiveOptions,
) -> Result<ReceiveSummary> {
    let ReceiveOptions {
        transfer_id,
        profile,
        swarm_enabled,
        limits,
        fallback_file_name,
        resume_store,
    } = options;
    // Fail before network activity if the selected save location is invalid.
    // Export repeats this check immediately before publishing to cover changes
    // made while the transfer is in flight.
    export::preflight_destination(&destination)?;
    let download_started_at = Instant::now();
    let download = download_with_retry(
        node,
        ticket,
        cancel_rx,
        progress,
        profile,
        swarm_enabled,
        limits,
    )
    .await?;
    let download_ms = elapsed_ms(download_started_at.elapsed());

    // A late cancel can arrive after the final downloader event. Check before
    // metadata verification and destination staging so it cannot be reported
    // as a completed receive.
    if *cancel_rx.borrow() {
        return Err(LightningP2PError::Other("Cancelled".into()));
    }

    // The ticket's size is only a sender-provided estimate. Recompute from
    // the fully verified local blobs before disk preflight and final progress.
    if let Some(progress) = progress {
        progress.set_phase(TransferPhase::Verifying);
    }
    let verified_size = export::ticket_size(node.blobs_client(), ticket.primary()).await?;
    let verified_file_names =
        export::ticket_file_names(node.blobs_client(), ticket.primary()).await?;
    let verified_file_count = if ticket.primary().recursive() {
        verified_file_names.len()
    } else {
        1
    };
    validate_received_limits(
        verified_size,
        verified_file_count,
        &verified_file_names,
        fallback_file_name.as_deref(),
        limits,
    )?;
    if let Some(progress) = progress {
        progress.set(verified_size, verified_size);
        progress.set_phase(TransferPhase::Saving);
    }
    persist_receive_finalization(
        ticket,
        verified_size,
        transfer_id.as_deref(),
        resume_store.as_ref(),
        fallback_file_name.as_deref(),
    )?;
    let export_started_at = Instant::now();
    let primary = ticket.primary();
    let export_summary = export::export_ticket(
        node.blobs_client(),
        primary,
        &destination,
        Some(verified_size),
        fallback_file_name.as_deref(),
        cancel_rx,
    )
    .await?;
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
        transfer_id,
        hash: primary.hash().to_string(),
        label: export_summary.label,
        size: export_summary.size,
        peer: primary.addr().id.to_string(),
        metrics,
        output_path: export_summary.output_path,
    })
}

fn persist_receive_finalization(
    ticket: &ShareTicket,
    size: u64,
    transfer_id: Option<&str>,
    store: Option<&ResumableReceiveStore>,
    fallback_file_name: Option<&str>,
) -> Result<()> {
    let (Some(transfer_id), Some(store)) = (transfer_id, store) else {
        return Ok(());
    };
    if ticket.primary().recursive() {
        return Ok(());
    }
    let Some(mut record) = store.get(transfer_id) else {
        return Ok(());
    };
    let file_name = fallback_file_name.map_or_else(
        || ticket.primary().hash().to_string(),
        export::safe_suggested_file_name,
    );
    record.finalization = Some(ReceiveFinalization {
        hash: ticket.primary().hash().to_string(),
        size,
        file_name,
    });
    store.save(record)
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
    limits: ReceiveLimits,
) -> Result<DownloadSummary> {
    // The sequential downloader exposes one cumulative progress counter. The
    // experimental swarm path reports concurrent child progress and cannot
    // enforce a reliable aggregate limit while data is arriving.
    let mut use_swarm = limits.max_total_bytes.is_none()
        && swarm_enabled
        && crate::transfer::swarm::eligible(ticket);
    let mut backoff = INITIAL_RETRY_BACKOFF;
    let mut attempt = 0u32;
    loop {
        let result = if use_swarm {
            swarm_download(node, ticket, cancel_rx, progress, profile).await
        } else {
            download_to_store(node, ticket, cancel_rx, progress, profile, limits).await
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
            tracing::warn!("swarm receive failed; falling back to the standard sequential path");
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
            attempt,
            backoff_ms = u64::try_from(backoff.as_millis()).unwrap_or(u64::MAX),
            "transient receive failure; retrying after backoff"
        );
        if let Some(progress) = progress {
            progress.set_phase(TransferPhase::Retrying);
        }
        tokio::select! {
            () = tokio::time::sleep(backoff) => {}
            changed = cancel_rx.changed() => {
                if changed.is_ok() && *cancel_rx.borrow() {
                    return Err(LightningP2PError::Other("Cancelled".into()));
                }
            }
        }
        if let Some(progress) = progress {
            progress.set_phase(TransferPhase::Connecting);
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
    limits: ReceiveLimits,
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
    // The ticket size is unauthenticated metadata; leave total unknown until
    // the downloaded blob has been verified and measured locally.
    let total = 0;
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
                validate_download_progress(offset, limits)?;
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
    if matches!(phase, TransferPhase::Verifying | TransferPhase::Saving)
        || message.contains("export")
    {
        return FailureCategory::Export;
    }
    if matches!(error, LightningP2PError::Blob(_)) {
        return FailureCategory::Interrupted;
    }
    FailureCategory::Unknown
}

fn receive_error_payload(error: &LightningP2PError, phase: TransferPhase) -> AppErrorPayload {
    let mut payload = if matches!(phase, TransferPhase::Verifying | TransferPhase::Saving) {
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
            transfer_id: summary.transfer_id.clone(),
            hash: summary.hash.clone(),
            filename: summary.label.clone(),
            size: summary.size,
            peer: Some(summary.peer.clone()),
            timestamp: unix_timestamp(),
            direction: TransferDirection::Receive,
            status: Some(TransferRecordStatus::Completed),
        },
    )
}

fn blob_error(err: &impl ToString) -> LightningP2PError {
    LightningP2PError::Blob(err.to_string())
}

fn validate_received_limits(
    size: u64,
    file_count: usize,
    file_names: &[String],
    fallback_file_name: Option<&str>,
    limits: ReceiveLimits,
) -> Result<()> {
    if limits.max_total_bytes.is_some_and(|limit| size > limit) {
        return Err(LightningP2PError::Other(receive_limit_error(limits)));
    }
    if limits
        .max_file_count
        .is_some_and(|limit| file_count > limit)
    {
        return Err(LightningP2PError::Other(
            "Automatic receive included more files than allowed.".into(),
        ));
    }
    if limits.max_file_count.is_some() && file_count == 0 {
        return Err(LightningP2PError::Other(
            "Automatic receive did not contain a supported file.".into(),
        ));
    }
    let has_risky_file_name = if file_names.is_empty() {
        fallback_file_name.is_some_and(crate::node::nearby_offer::is_risky_executable_label)
    } else {
        file_names
            .iter()
            .any(|name| crate::node::nearby_offer::is_risky_executable_label(name))
    };
    if limits.reject_risky_file_names && has_risky_file_name {
        return Err(LightningP2PError::Other(
            "Ready to Catch cannot receive executable or unrecognized file types.".into(),
        ));
    }
    Ok(())
}

fn validate_download_progress(offset: u64, limits: ReceiveLimits) -> Result<()> {
    if limits.max_total_bytes.is_some_and(|limit| offset > limit) {
        return Err(LightningP2PError::Other(receive_limit_error(limits)));
    }
    Ok(())
}

fn receive_limit_error(limits: ReceiveLimits) -> String {
    if limits.max_total_bytes == ReceiveLimits::ready_to_catch().max_total_bytes {
        "Automatic receive exceeded its 100 MiB limit.".into()
    } else {
        "Received content exceeded the configured size limit.".into()
    }
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
    fn ready_to_catch_receive_limits_enforce_actual_size_and_file_count() {
        let limits = ReceiveLimits::ready_to_catch();
        assert!(validate_received_limits(100 * 1024 * 1024, 1, &[], None, limits).is_ok());
        assert!(validate_received_limits(100 * 1024 * 1024 + 1, 1, &[], None, limits).is_err());
        assert!(validate_received_limits(1, 2, &[], None, limits).is_err());
        assert!(validate_download_progress(100 * 1024 * 1024, limits).is_ok());
        assert!(validate_download_progress(100 * 1024 * 1024 + 1, limits).is_err());
        assert!(validate_received_limits(
            u64::MAX,
            usize::MAX,
            &[],
            None,
            ReceiveLimits::default()
        )
        .is_ok());
        assert!(
            validate_received_limits(10, 1, &["folder/payload.EXE".into()], None, limits).is_err()
        );
        assert!(validate_received_limits(10, 1, &[], Some("payload.EXE"), limits).is_err());
        assert!(validate_received_limits(10, 1, &[], Some("notes.txt"), limits).is_ok());
    }

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
    fn save_failure_is_retryable_and_never_maps_to_completion() {
        let error = LightningP2PError::Other(
            "Export failed: Android could not save the verified transfer to public storage.".into(),
        );
        let payload = receive_error_payload(&error, TransferPhase::Saving);

        assert_eq!(payload.code, crate::error::AppErrorCode::ExportFailed);
        assert!(payload.retryable);
        assert_eq!(
            categorize_receive_error(&error, TransferPhase::Saving),
            FailureCategory::Export
        );
    }

    #[test]
    fn route_is_inferred_from_relay_only_ticket() {
        let relay_url = "https://relay.example.com"
            .parse()
            .expect("relay url should parse");
        let node_id =
            PublicKey::from_str("ae58ff8833241ac82d6ff7611046ed67b5072d142c588d0063e942d9a75502b6")
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
