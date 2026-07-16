//! Transfer event payloads and throttled event emission helpers.

use crate::error::{AppErrorPayload, LightningP2PError, Result};
use crate::transfer::metrics::{RouteKind, TransferMetrics, TransferStrategy};
use crate::transfer::queue::TransferQueue;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Window};
use tokio::sync::oneshot;
use tokio::time::MissedTickBehavior;

const MAX_PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// Direction of a transfer.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TransferDirection {
    /// Local node is sending content.
    Send,
    /// Local node is receiving content.
    Receive,
}

/// Current user-visible phase of a transfer.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TransferPhase {
    /// The transfer is preparing local state before network traffic starts.
    #[default]
    Preparing,
    /// The receiver is trying to contact the sender.
    Connecting,
    /// A transient failure occurred and the receiver is waiting to retry.
    Retrying,
    /// File bytes are moving into the local blob store.
    Downloading,
    /// Verified blobs are being exported to the destination folder.
    Verifying,
    /// The transfer completed successfully.
    Completed,
    /// The transfer failed.
    Failed,
    /// The user cancelled the transfer.
    Cancelled,
}

impl TransferPhase {
    /// Converts an atomic-friendly integer into a transfer phase.
    #[must_use]
    pub fn from_repr(value: u8) -> Self {
        match value {
            1 => Self::Connecting,
            2 => Self::Retrying,
            3 => Self::Downloading,
            4 => Self::Verifying,
            5 => Self::Completed,
            6 => Self::Failed,
            7 => Self::Cancelled,
            _ => Self::Preparing,
        }
    }

    /// Converts the transfer phase into an atomic-friendly integer.
    #[must_use]
    pub const fn as_repr(self) -> u8 {
        match self {
            Self::Preparing => 0,
            Self::Connecting => 1,
            Self::Retrying => 2,
            Self::Downloading => 3,
            Self::Verifying => 4,
            Self::Completed => 5,
            Self::Failed => 6,
            Self::Cancelled => 7,
        }
    }
}

/// Coarse failure bucket used by the frontend for actionable copy.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FailureCategory {
    /// The ticket could not be parsed or used.
    InvalidTicket,
    /// The output folder is missing, invalid, or unwritable.
    Destination,
    /// The sender could not be reached.
    Unreachable,
    /// The sender was reached, then the transfer stopped.
    Interrupted,
    /// The user cancelled the transfer.
    Cancelled,
    /// The destination volume does not have enough available space.
    DiskSpace,
    /// Verified content could not be exported to disk.
    Export,
    /// The backend could not classify the failure more precisely.
    Unknown,
}

/// Live transfer snapshot stored in memory and mirrored to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransferInfo {
    /// Stable identifier of the transfer.
    pub transfer_id: String,
    /// Transfer direction.
    pub direction: TransferDirection,
    /// Human-readable label for the transfer.
    pub name: String,
    /// Remote peer identifier when available.
    pub peer: Option<String>,
    /// Bytes processed so far.
    pub bytes: u64,
    /// Total bytes expected if known.
    pub total: u64,
    /// Current average transfer rate.
    pub speed_bps: u64,
    /// Best-known route used for this transfer.
    pub route_kind: RouteKind,
    /// Current user-visible transfer phase.
    pub phase: TransferPhase,
    /// Failure category when the transfer has failed.
    pub failure_category: Option<FailureCategory>,
    /// Final output path when a receive completed.
    pub output_path: Option<String>,
    /// Time to first peer contact or sender preparation completion.
    pub connect_ms: u64,
    /// Time spent downloading data into the local blob store.
    pub download_ms: u64,
    /// Time spent exporting data to disk.
    pub export_ms: u64,
    /// Number of provider tickets available for this transfer.
    pub provider_count: u64,
    /// Providers with direct addresses.
    pub direct_provider_count: u64,
    /// Providers with relay URLs.
    pub relay_provider_count: u64,
    /// Provider selection strategy.
    pub strategy: TransferStrategy,
    /// Time to first payload byte.
    pub first_byte_ms: u64,
    /// Effective transfer throughput in megabits per second.
    pub effective_mbps: u64,
}

/// Event emitted to the frontend over Tauri IPC.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TransferEvent {
    /// Transfer is starting.
    Started {
        /// Stable identifier of the transfer.
        transfer_id: String,
        /// Transfer direction.
        direction: TransferDirection,
        /// User-visible label for the transfer.
        name: String,
        /// Remote peer identifier when available.
        peer: Option<String>,
        /// Total bytes expected if known.
        total: u64,
        /// Best-known route used for this transfer.
        route_kind: RouteKind,
        /// Current user-visible transfer phase.
        phase: TransferPhase,
        /// Time to first peer contact or sender preparation completion.
        connect_ms: u64,
        /// Time spent downloading data into the local blob store.
        download_ms: u64,
        /// Time spent exporting data to disk.
        export_ms: u64,
        /// Number of provider tickets available for this transfer.
        provider_count: u64,
        /// Providers with direct addresses.
        direct_provider_count: u64,
        /// Providers with relay URLs.
        relay_provider_count: u64,
        /// Provider selection strategy.
        strategy: TransferStrategy,
        /// Time to first payload byte.
        first_byte_ms: u64,
        /// Effective transfer throughput in megabits per second.
        effective_mbps: u64,
    },
    /// Transfer progress update.
    Progress {
        /// Stable identifier of the transfer.
        transfer_id: String,
        /// Bytes processed so far.
        bytes: u64,
        /// Total bytes expected if known.
        total: u64,
        /// Current average transfer rate.
        speed_bps: u64,
        /// Best-known route used for this transfer.
        route_kind: RouteKind,
        /// Current user-visible transfer phase.
        phase: TransferPhase,
        /// Time to first peer contact or sender preparation completion.
        connect_ms: u64,
        /// Time spent downloading data into the local blob store.
        download_ms: u64,
        /// Time spent exporting data to disk.
        export_ms: u64,
        /// Number of provider tickets available for this transfer.
        provider_count: u64,
        /// Providers with direct addresses.
        direct_provider_count: u64,
        /// Providers with relay URLs.
        relay_provider_count: u64,
        /// Provider selection strategy.
        strategy: TransferStrategy,
        /// Time to first payload byte.
        first_byte_ms: u64,
        /// Effective transfer throughput in megabits per second.
        effective_mbps: u64,
    },
    /// Transfer completed successfully.
    Completed {
        /// Stable identifier of the transfer.
        transfer_id: String,
        /// Transfer direction.
        direction: TransferDirection,
        /// Root content hash.
        hash: String,
        /// User-visible label for the transfer.
        name: String,
        /// Total bytes transferred.
        size: u64,
        /// Remote peer identifier when available.
        peer: Option<String>,
        /// Completion timestamp in unix seconds.
        timestamp: u64,
        /// Best-known route used for this transfer.
        route_kind: RouteKind,
        /// Current user-visible transfer phase.
        phase: TransferPhase,
        /// Final output path for receive transfers.
        output_path: Option<String>,
        /// Time to first peer contact or sender preparation completion.
        connect_ms: u64,
        /// Time spent downloading data into the local blob store.
        download_ms: u64,
        /// Time spent exporting data to disk.
        export_ms: u64,
        /// Number of provider tickets available for this transfer.
        provider_count: u64,
        /// Providers with direct addresses.
        direct_provider_count: u64,
        /// Providers with relay URLs.
        relay_provider_count: u64,
        /// Provider selection strategy.
        strategy: TransferStrategy,
        /// Time to first payload byte.
        first_byte_ms: u64,
        /// Effective transfer throughput in megabits per second.
        effective_mbps: u64,
    },
    /// Transfer failed.
    Failed {
        /// Stable identifier of the transfer.
        transfer_id: String,
        /// User-visible failure message.
        error: String,
        /// Best-known route used for this transfer.
        route_kind: RouteKind,
        /// Current user-visible transfer phase.
        phase: TransferPhase,
        /// Coarse failure bucket for actionable frontend copy.
        failure_category: Option<FailureCategory>,
        /// Structured failure payload for actionable recovery UI.
        error_payload: Option<AppErrorPayload>,
    },
}

/// Derived progress information for a transfer sample.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProgressUpdate {
    /// Bytes processed so far.
    pub bytes: u64,
    /// Total bytes expected.
    pub total: u64,
    /// Current average transfer rate.
    pub speed_bps: u64,
    /// Best-known route used for this transfer.
    pub route_kind: RouteKind,
    /// Current transfer phase.
    pub phase: TransferPhase,
    /// Time to first peer contact or sender preparation completion.
    pub connect_ms: u64,
    /// Time spent downloading data into the local blob store.
    pub download_ms: u64,
    /// Time spent exporting data to disk.
    pub export_ms: u64,
    /// Number of provider tickets available for this transfer.
    pub provider_count: u64,
    /// Providers with direct addresses.
    pub direct_provider_count: u64,
    /// Providers with relay URLs.
    pub relay_provider_count: u64,
    /// Provider selection strategy.
    pub strategy: TransferStrategy,
    /// Time to first payload byte.
    pub first_byte_ms: u64,
    /// Effective transfer throughput in megabits per second.
    pub effective_mbps: u64,
}

/// Emits transfer events while throttling progress to avoid IPC flooding.
#[derive(Debug, Clone)]
pub struct EventReporter {
    window: Window,
    transfer_id: String,
    direction: TransferDirection,
    name: String,
    peer: Option<String>,
}

impl EventReporter {
    /// Creates a new reporter for a transfer.
    #[must_use]
    pub fn new(
        window: Window,
        transfer_id: String,
        direction: TransferDirection,
        name: String,
        peer: Option<String>,
    ) -> Self {
        Self {
            window,
            transfer_id,
            direction,
            name,
            peer,
        }
    }

    /// Emits a `Started` event.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if the Tauri event cannot be emitted.
    pub fn emit_started(
        &self,
        total: u64,
        metrics: TransferMetrics,
        phase: TransferPhase,
    ) -> Result<()> {
        self.emit(TransferEvent::Started {
            transfer_id: self.transfer_id.clone(),
            direction: self.direction,
            name: self.name.clone(),
            peer: self.peer.clone(),
            total,
            route_kind: metrics.route_kind,
            phase,
            connect_ms: metrics.connect_ms,
            download_ms: metrics.download_ms,
            export_ms: metrics.export_ms,
            provider_count: metrics.provider_count,
            direct_provider_count: metrics.direct_provider_count,
            relay_provider_count: metrics.relay_provider_count,
            strategy: metrics.strategy,
            first_byte_ms: metrics.first_byte_ms,
            effective_mbps: metrics.effective_mbps,
        })
    }

    /// Emits a `Progress` event.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if the Tauri event cannot be emitted.
    pub fn emit_progress(&self, update: ProgressUpdate) -> Result<()> {
        self.emit(TransferEvent::Progress {
            transfer_id: self.transfer_id.clone(),
            bytes: update.bytes,
            total: update.total,
            speed_bps: update.speed_bps,
            route_kind: update.route_kind,
            phase: update.phase,
            connect_ms: update.connect_ms,
            download_ms: update.download_ms,
            export_ms: update.export_ms,
            provider_count: update.provider_count,
            direct_provider_count: update.direct_provider_count,
            relay_provider_count: update.relay_provider_count,
            strategy: update.strategy,
            first_byte_ms: update.first_byte_ms,
            effective_mbps: update.effective_mbps,
        })
    }

    /// Emits a `Completed` event.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if the Tauri event cannot be emitted.
    pub fn emit_completed(
        &self,
        hash: String,
        size: u64,
        metrics: TransferMetrics,
        output_path: Option<String>,
    ) -> Result<()> {
        self.emit(TransferEvent::Completed {
            transfer_id: self.transfer_id.clone(),
            direction: self.direction,
            hash,
            name: self.name.clone(),
            size,
            peer: self.peer.clone(),
            timestamp: unix_timestamp(),
            route_kind: metrics.route_kind,
            phase: TransferPhase::Completed,
            output_path,
            connect_ms: metrics.connect_ms,
            download_ms: metrics.download_ms,
            export_ms: metrics.export_ms,
            provider_count: metrics.provider_count,
            direct_provider_count: metrics.direct_provider_count,
            relay_provider_count: metrics.relay_provider_count,
            strategy: metrics.strategy,
            first_byte_ms: metrics.first_byte_ms,
            effective_mbps: metrics.effective_mbps,
        })
    }

    /// Emits a `Failed` event.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if the Tauri event cannot be emitted.
    pub fn emit_failed(
        &self,
        error: &str,
        route_kind: RouteKind,
        failure_category: Option<FailureCategory>,
    ) -> Result<()> {
        self.emit_failed_with_payload(error, route_kind, failure_category, None)
    }

    /// Emits a `Failed` event with an optional structured payload.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if the Tauri event cannot be emitted.
    pub fn emit_failed_with_payload(
        &self,
        error: &str,
        route_kind: RouteKind,
        failure_category: Option<FailureCategory>,
        error_payload: Option<AppErrorPayload>,
    ) -> Result<()> {
        let phase = if failure_category == Some(FailureCategory::Cancelled) {
            TransferPhase::Cancelled
        } else {
            TransferPhase::Failed
        };
        let error_payload =
            error_payload.or_else(|| Some(AppErrorPayload::from_legacy_message(error)));
        self.emit(TransferEvent::Failed {
            transfer_id: self.transfer_id.clone(),
            error: error.to_string(),
            route_kind,
            phase,
            failure_category,
            error_payload,
        })
    }

    fn emit(&self, event: TransferEvent) -> Result<()> {
        self.window
            .emit("transfer-progress", event)
            .map_err(|err| LightningP2PError::Other(err.to_string()))
    }
}

/// Mirrored transfer queue target for live progress samples.
#[derive(Debug, Clone)]
pub struct QueueProgressTarget {
    queue: TransferQueue,
    transfer_id: String,
}

impl QueueProgressTarget {
    /// Creates a queue sink for a transfer sampler.
    #[must_use]
    pub fn new(queue: TransferQueue, transfer_id: String) -> Self {
        Self { queue, transfer_id }
    }

    async fn update(&self, update: ProgressUpdate) {
        self.queue
            .update_progress(
                &self.transfer_id,
                update.bytes,
                update.total,
                update.speed_bps,
                TransferMetrics {
                    route_kind: update.route_kind,
                    connect_ms: update.connect_ms,
                    download_ms: update.download_ms,
                    export_ms: update.export_ms,
                    provider_count: update.provider_count,
                    direct_provider_count: update.direct_provider_count,
                    relay_provider_count: update.relay_provider_count,
                    strategy: update.strategy,
                    first_byte_ms: update.first_byte_ms,
                    effective_mbps: update.effective_mbps,
                },
                update.phase,
            )
            .await;
    }
}

/// Atomic progress counters updated from hot transfer paths.
#[derive(Debug, Clone, Default)]
pub struct ProgressHandle {
    bytes: Arc<AtomicU64>,
    total: Arc<AtomicU64>,
    route_kind: Arc<AtomicU8>,
    phase: Arc<AtomicU8>,
    connect_ms: Arc<AtomicU64>,
    download_ms: Arc<AtomicU64>,
    export_ms: Arc<AtomicU64>,
    provider_count: Arc<AtomicU64>,
    direct_provider_count: Arc<AtomicU64>,
    relay_provider_count: Arc<AtomicU64>,
    strategy: Arc<AtomicU8>,
    first_byte_ms: Arc<AtomicU64>,
    effective_mbps: Arc<AtomicU64>,
}

impl ProgressHandle {
    /// Stores the latest transfer position.
    pub fn set(&self, bytes: u64, total: u64) {
        self.bytes.store(bytes, Ordering::Relaxed);
        self.total.store(total, Ordering::Relaxed);
    }

    /// Adds bytes to the current transfer position and updates the total.
    pub fn advance(&self, bytes_delta: u64, total: u64) {
        self.bytes.fetch_add(bytes_delta, Ordering::Relaxed);
        self.total.store(total, Ordering::Relaxed);
    }

    /// Returns a snapshot of (bytes, total) using relaxed atomic loads.
    #[must_use]
    pub fn snapshot(&self) -> (u64, u64) {
        (
            self.bytes.load(Ordering::Relaxed),
            self.total.load(Ordering::Relaxed),
        )
    }

    /// Returns the latest route and timing metrics.
    #[must_use]
    pub fn metrics_snapshot(&self) -> TransferMetrics {
        TransferMetrics {
            route_kind: RouteKind::from_repr(self.route_kind.load(Ordering::Relaxed)),
            connect_ms: self.connect_ms.load(Ordering::Relaxed),
            download_ms: self.download_ms.load(Ordering::Relaxed),
            export_ms: self.export_ms.load(Ordering::Relaxed),
            provider_count: self.provider_count.load(Ordering::Relaxed),
            direct_provider_count: self.direct_provider_count.load(Ordering::Relaxed),
            relay_provider_count: self.relay_provider_count.load(Ordering::Relaxed),
            strategy: TransferStrategy::from_repr(self.strategy.load(Ordering::Relaxed)),
            first_byte_ms: self.first_byte_ms.load(Ordering::Relaxed),
            effective_mbps: self.effective_mbps.load(Ordering::Relaxed),
        }
    }

    /// Returns the current transfer phase.
    #[must_use]
    pub fn phase_snapshot(&self) -> TransferPhase {
        TransferPhase::from_repr(self.phase.load(Ordering::Relaxed))
    }

    /// Stores route and timing metrics.
    pub fn set_metrics(&self, metrics: TransferMetrics) {
        self.route_kind
            .store(metrics.route_kind.as_repr(), Ordering::Relaxed);
        self.connect_ms.store(metrics.connect_ms, Ordering::Relaxed);
        self.download_ms
            .store(metrics.download_ms, Ordering::Relaxed);
        self.export_ms.store(metrics.export_ms, Ordering::Relaxed);
        self.provider_count
            .store(metrics.provider_count, Ordering::Relaxed);
        self.direct_provider_count
            .store(metrics.direct_provider_count, Ordering::Relaxed);
        self.relay_provider_count
            .store(metrics.relay_provider_count, Ordering::Relaxed);
        self.strategy
            .store(metrics.strategy.as_repr(), Ordering::Relaxed);
        self.first_byte_ms
            .store(metrics.first_byte_ms, Ordering::Relaxed);
        self.effective_mbps
            .store(metrics.effective_mbps, Ordering::Relaxed);
    }

    /// Updates the current transfer phase.
    pub fn set_phase(&self, phase: TransferPhase) {
        self.phase.store(phase.as_repr(), Ordering::Relaxed);
    }

    /// Updates the route kind for the transfer.
    pub fn set_route_kind(&self, route_kind: RouteKind) {
        self.route_kind
            .store(route_kind.as_repr(), Ordering::Relaxed);
    }

    /// Updates the connection timing metric.
    pub fn set_connect_ms(&self, connect_ms: u64) {
        self.connect_ms.store(connect_ms, Ordering::Relaxed);
    }

    /// Updates the download timing metric.
    pub fn set_download_ms(&self, download_ms: u64) {
        self.download_ms.store(download_ms, Ordering::Relaxed);
    }

    /// Updates the export timing metric.
    pub fn set_export_ms(&self, export_ms: u64) {
        self.export_ms.store(export_ms, Ordering::Relaxed);
    }

    /// Updates the time to first payload byte.
    pub fn set_first_byte_ms(&self, first_byte_ms: u64) {
        self.first_byte_ms.store(first_byte_ms, Ordering::Relaxed);
    }
}

/// Background sampler that emits progress at most 5 times per second.
#[derive(Debug)]
pub struct ProgressSampler {
    handle: ProgressHandle,
    stop_tx: Option<oneshot::Sender<()>>,
    task: tauri::async_runtime::JoinHandle<Result<()>>,
}

impl ProgressSampler {
    /// Spawns a progress sampler at the default cadence (`MAX_PROGRESS_INTERVAL`).
    #[must_use]
    pub fn spawn(reporter: EventReporter, queue_target: Option<QueueProgressTarget>) -> Self {
        Self::spawn_with_interval(reporter, queue_target, MAX_PROGRESS_INTERVAL)
    }

    /// Spawns a progress sampler with an explicit cadence. The per-transfer
    /// `TransferProfile` uses this so each mode (Standard, `BatterySafe`, ...)
    /// can throttle UI emit at its own rate without rebuilding the sampler API.
    /// Intervals below the global floor (`MAX_PROGRESS_INTERVAL`) are clamped
    /// up; we never emit faster than 10 Hz.
    #[must_use]
    pub fn spawn_with_interval(
        reporter: EventReporter,
        queue_target: Option<QueueProgressTarget>,
        interval: Duration,
    ) -> Self {
        let interval = interval.max(MAX_PROGRESS_INTERVAL);
        let handle = ProgressHandle::default();
        let sampler_handle = handle.clone();
        let (stop_tx, stop_rx) = oneshot::channel();
        let task = tauri::async_runtime::spawn(async move {
            run_progress_sampler(reporter, sampler_handle, queue_target, interval, stop_rx).await
        });
        Self {
            handle,
            stop_tx: Some(stop_tx),
            task,
        }
    }

    /// Returns the atomic progress handle used by the transfer task.
    #[must_use]
    pub fn handle(&self) -> ProgressHandle {
        self.handle.clone()
    }

    /// Stops the sampler and waits for the last progress sample to be emitted.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if the sampler task fails.
    pub async fn finish(mut self) -> Result<()> {
        if let Some(stop_tx) = self.stop_tx.take() {
            let _ = stop_tx.send(());
        }
        self.task
            .await
            .map_err(|error| LightningP2PError::Other(error.to_string()))?
    }
}

/// Integer weighting for exponential moving average speed calculation.
/// Lower update weight = smoother but slower to react.
const SPEED_EMA_UPDATE_WEIGHT: u64 = 3;
const SPEED_EMA_TOTAL_WEIGHT: u64 = 10;

async fn run_progress_sampler(
    reporter: EventReporter,
    handle: ProgressHandle,
    queue_target: Option<QueueProgressTarget>,
    sample_interval: Duration,
    mut stop_rx: oneshot::Receiver<()>,
) -> Result<()> {
    let mut interval = tokio::time::interval(sample_interval);
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut last_bytes = 0;
    let mut last_sample_at = Instant::now();
    let mut last_emitted_update: Option<ProgressUpdate> = None;
    let mut smoothed_speed = 0_u64;

    loop {
        let stopping = tokio::select! {
            _ = interval.tick() => false,
            _ = &mut stop_rx => true,
        };
        let now = Instant::now();
        let mut update = sample_progress(&handle, last_bytes, last_sample_at, now);
        last_bytes = update.bytes;
        last_sample_at = now;

        // Apply exponential moving average to smooth speed readings
        if smoothed_speed == 0 {
            smoothed_speed = update.speed_bps;
        } else {
            smoothed_speed = smooth_speed(smoothed_speed, update.speed_bps);
        }
        update.speed_bps = smoothed_speed;

        if should_emit_progress(last_emitted_update, update, stopping) {
            emit_sample(&reporter, queue_target.as_ref(), update).await?;
            last_emitted_update = Some(update);
        }

        if stopping {
            return Ok(());
        }
    }
}

fn should_emit_progress(
    previous: Option<ProgressUpdate>,
    next: ProgressUpdate,
    stopping: bool,
) -> bool {
    if stopping {
        return true;
    }

    (next.bytes > 0 || next.total > 0) && previous != Some(next)
}

fn smooth_speed(previous: u64, instant: u64) -> u64 {
    let retained_weight = u128::from(SPEED_EMA_TOTAL_WEIGHT - SPEED_EMA_UPDATE_WEIGHT);
    let update_weight = u128::from(SPEED_EMA_UPDATE_WEIGHT);
    let numerator = u128::from(previous) * retained_weight + u128::from(instant) * update_weight;
    let denominator = u128::from(SPEED_EMA_TOTAL_WEIGHT);
    let rounded = (numerator + denominator / 2) / denominator;
    u64::try_from(rounded).unwrap_or(u64::MAX)
}

async fn emit_sample(
    reporter: &EventReporter,
    queue_target: Option<&QueueProgressTarget>,
    update: ProgressUpdate,
) -> Result<()> {
    if let Some(queue_target) = queue_target {
        queue_target.update(update).await;
    }
    reporter.emit_progress(update)
}

fn sample_progress(
    handle: &ProgressHandle,
    last_bytes: u64,
    last_sample_at: Instant,
    now: Instant,
) -> ProgressUpdate {
    let (bytes, total) = handle.snapshot();
    let metrics = handle.metrics_snapshot();
    let phase = handle.phase_snapshot();
    let bytes_delta = bytes.saturating_sub(last_bytes);
    ProgressUpdate {
        bytes,
        total,
        speed_bps: calculate_speed(bytes_delta, now.saturating_duration_since(last_sample_at)),
        route_kind: metrics.route_kind,
        phase,
        connect_ms: metrics.connect_ms,
        download_ms: metrics.download_ms,
        export_ms: metrics.export_ms,
        provider_count: metrics.provider_count,
        direct_provider_count: metrics.direct_provider_count,
        relay_provider_count: metrics.relay_provider_count,
        strategy: metrics.strategy,
        first_byte_ms: metrics.first_byte_ms,
        effective_mbps: metrics.effective_mbps,
    }
}

fn calculate_speed(bytes: u64, elapsed: Duration) -> u64 {
    let nanos = elapsed.as_nanos();
    if nanos == 0 {
        return 0;
    }

    let bytes = u128::from(bytes);
    let speed = bytes.saturating_mul(1_000_000_000) / nanos;
    u64::try_from(speed).unwrap_or(u64::MAX)
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
    fn retrying_phase_round_trips_through_atomic_representation() {
        let repr = TransferPhase::Retrying.as_repr();
        assert_eq!(TransferPhase::from_repr(repr), TransferPhase::Retrying);
    }

    #[test]
    fn progress_event_serializes() {
        let event = TransferEvent::Progress {
            transfer_id: "recv-1".into(),
            bytes: 128,
            total: 256,
            speed_bps: 64,
            route_kind: RouteKind::Direct,
            phase: TransferPhase::Downloading,
            connect_ms: 12,
            download_ms: 24,
            export_ms: 0,
            provider_count: 1,
            direct_provider_count: 0,
            relay_provider_count: 0,
            strategy: TransferStrategy::QueuedSingleProvider,
            first_byte_ms: 16,
            effective_mbps: 0,
        };
        let json = serde_json::to_string(&event).expect("progress event should serialize");
        assert!(json.contains("\"type\":\"progress\""));
        assert!(json.contains("\"bytes\":128"));
        assert!(json.contains("\"route_kind\":\"direct\""));
        assert!(json.contains("\"phase\":\"downloading\""));
    }

    #[test]
    fn failed_event_serializes_structured_error_payload() {
        let event = TransferEvent::Failed {
            transfer_id: "recv-1".into(),
            error: "Peer not reachable".into(),
            route_kind: RouteKind::Relay,
            phase: TransferPhase::Failed,
            failure_category: Some(FailureCategory::Unreachable),
            error_payload: Some(AppErrorPayload::sender_offline()),
        };
        let json = serde_json::to_string(&event).expect("failed event should serialize");
        assert!(json.contains("\"type\":\"failed\""));
        assert!(json.contains("\"error_payload\""));
        assert!(json.contains("\"code\":\"sender_offline\""));
    }

    #[test]
    fn speed_calculation_handles_zero_elapsed() {
        assert_eq!(calculate_speed(1024, Duration::ZERO), 0);
    }

    #[test]
    fn progress_handle_tracks_updates() {
        let handle = ProgressHandle::default();
        handle.advance(64, 128);
        handle.advance(32, 128);
        assert_eq!(handle.snapshot(), (96, 128));
        handle.set(128, 128);
        assert_eq!(handle.snapshot(), (128, 128));
        handle.set_metrics(TransferMetrics {
            route_kind: RouteKind::Relay,
            connect_ms: 10,
            download_ms: 20,
            export_ms: 30,
            provider_count: 1,
            direct_provider_count: 0,
            relay_provider_count: 1,
            strategy: TransferStrategy::QueuedSingleProvider,
            first_byte_ms: 15,
            effective_mbps: 4,
        });
        assert_eq!(
            handle.metrics_snapshot(),
            TransferMetrics {
                route_kind: RouteKind::Relay,
                connect_ms: 10,
                download_ms: 20,
                export_ms: 30,
                provider_count: 1,
                direct_provider_count: 0,
                relay_provider_count: 1,
                strategy: TransferStrategy::QueuedSingleProvider,
                first_byte_ms: 15,
                effective_mbps: 4,
            }
        );
        handle.set_phase(TransferPhase::Verifying);
        assert_eq!(handle.phase_snapshot(), TransferPhase::Verifying);
    }

    #[test]
    fn sample_progress_uses_delta_bytes() {
        let handle = ProgressHandle::default();
        handle.set(512, 1024);
        let update = sample_progress(
            &handle,
            256,
            Instant::now()
                .checked_sub(Duration::from_millis(100))
                .expect("subtraction should succeed"),
            Instant::now(),
        );
        assert_eq!(update.bytes, 512);
        assert_eq!(update.total, 1024);
        assert!(update.speed_bps >= 2_000);
        assert_eq!(update.route_kind, RouteKind::Unknown);
        assert_eq!(update.phase, TransferPhase::Preparing);
    }

    #[test]
    fn identical_progress_samples_are_not_emitted_mid_transfer() {
        let update = ProgressUpdate {
            bytes: 512,
            total: 1024,
            speed_bps: 2048,
            route_kind: RouteKind::Direct,
            phase: TransferPhase::Downloading,
            connect_ms: 10,
            download_ms: 20,
            export_ms: 30,
            provider_count: 1,
            direct_provider_count: 1,
            relay_provider_count: 0,
            strategy: TransferStrategy::QueuedSingleProvider,
            first_byte_ms: 12,
            effective_mbps: 8,
        };

        assert!(should_emit_progress(None, update, false));
        assert!(!should_emit_progress(Some(update), update, false));
        assert!(should_emit_progress(Some(update), update, true));
    }
}
