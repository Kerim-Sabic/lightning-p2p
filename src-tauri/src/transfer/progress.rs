//! Transfer event payloads and throttled event emission helpers.

use crate::error::{FastDropError, Result};
use crate::transfer::queue::TransferQueue;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
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
    },
    /// Transfer failed.
    Failed {
        /// Stable identifier of the transfer.
        transfer_id: String,
        /// User-visible failure message.
        error: String,
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
    /// Returns `FastDropError` if the Tauri event cannot be emitted.
    pub fn emit_started(&self, total: u64) -> Result<()> {
        self.emit(TransferEvent::Started {
            transfer_id: self.transfer_id.clone(),
            direction: self.direction,
            name: self.name.clone(),
            peer: self.peer.clone(),
            total,
        })
    }

    /// Emits a `Progress` event.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError` if the Tauri event cannot be emitted.
    pub fn emit_progress(&self, update: ProgressUpdate) -> Result<()> {
        self.emit(TransferEvent::Progress {
            transfer_id: self.transfer_id.clone(),
            bytes: update.bytes,
            total: update.total,
            speed_bps: update.speed_bps,
        })
    }

    /// Emits a `Completed` event.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError` if the Tauri event cannot be emitted.
    pub fn emit_completed(&self, hash: String, size: u64) -> Result<()> {
        self.emit(TransferEvent::Completed {
            transfer_id: self.transfer_id.clone(),
            direction: self.direction,
            hash,
            name: self.name.clone(),
            size,
            peer: self.peer.clone(),
            timestamp: unix_timestamp(),
        })
    }

    /// Emits a `Failed` event.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError` if the Tauri event cannot be emitted.
    pub fn emit_failed(&self, error: &str) -> Result<()> {
        self.emit(TransferEvent::Failed {
            transfer_id: self.transfer_id.clone(),
            error: error.to_string(),
        })
    }

    fn emit(&self, event: TransferEvent) -> Result<()> {
        self.window
            .emit("transfer-progress", event)
            .map_err(|err| FastDropError::Other(err.to_string()))
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
            )
            .await;
    }
}

/// Atomic progress counters updated from hot transfer paths.
#[derive(Debug, Clone, Default)]
pub struct ProgressHandle {
    bytes: Arc<AtomicU64>,
    total: Arc<AtomicU64>,
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

    fn snapshot(&self) -> (u64, u64) {
        (
            self.bytes.load(Ordering::Relaxed),
            self.total.load(Ordering::Relaxed),
        )
    }
}

/// Background sampler that emits progress at most 10 times per second.
#[derive(Debug)]
pub struct ProgressSampler {
    handle: ProgressHandle,
    stop_tx: Option<oneshot::Sender<()>>,
    task: tauri::async_runtime::JoinHandle<Result<()>>,
}

impl ProgressSampler {
    /// Spawns a progress sampler for the provided transfer reporter.
    #[must_use]
    pub fn spawn(reporter: EventReporter, queue_target: Option<QueueProgressTarget>) -> Self {
        let handle = ProgressHandle::default();
        let sampler_handle = handle.clone();
        let (stop_tx, stop_rx) = oneshot::channel();
        let task = tauri::async_runtime::spawn(async move {
            run_progress_sampler(reporter, sampler_handle, queue_target, stop_rx).await
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
    /// Returns `FastDropError` if the sampler task fails.
    pub async fn finish(mut self) -> Result<()> {
        if let Some(stop_tx) = self.stop_tx.take() {
            let _ = stop_tx.send(());
        }
        self.task
            .await
            .map_err(|error| FastDropError::Other(error.to_string()))?
    }
}

async fn run_progress_sampler(
    reporter: EventReporter,
    handle: ProgressHandle,
    queue_target: Option<QueueProgressTarget>,
    mut stop_rx: oneshot::Receiver<()>,
) -> Result<()> {
    let mut interval = tokio::time::interval(MAX_PROGRESS_INTERVAL);
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut last_bytes = 0;
    let mut last_sample_at = Instant::now();

    loop {
        let stopping = tokio::select! {
            _ = interval.tick() => false,
            _ = &mut stop_rx => true,
        };
        let now = Instant::now();
        let update = sample_progress(&handle, last_bytes, last_sample_at, now);
        last_bytes = update.bytes;
        last_sample_at = now;

        if update.bytes > 0 || update.total > 0 || stopping {
            emit_sample(&reporter, queue_target.as_ref(), update).await?;
        }

        if stopping {
            return Ok(());
        }
    }
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
    let bytes_delta = bytes.saturating_sub(last_bytes);
    ProgressUpdate {
        bytes,
        total,
        speed_bps: calculate_speed(bytes_delta, now.saturating_duration_since(last_sample_at)),
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
    fn progress_event_serializes() {
        let event = TransferEvent::Progress {
            transfer_id: "recv-1".into(),
            bytes: 128,
            total: 256,
            speed_bps: 64,
        };
        let json = serde_json::to_string(&event).expect("progress event should serialize");
        assert!(json.contains("\"type\":\"progress\""));
        assert!(json.contains("\"bytes\":128"));
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
    }
}
