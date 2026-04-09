//! Transfer event payloads and throttled event emission helpers.

use crate::error::{FastDropError, Result};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Window};

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
    started_at: Instant,
    last_progress_emit: Option<Instant>,
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
            started_at: Instant::now(),
            last_progress_emit: None,
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

    /// Returns a throttled progress update sample when it should be emitted.
    pub fn progress_update(&mut self, bytes: u64, total: u64) -> Option<ProgressUpdate> {
        let now = Instant::now();
        if !should_emit_progress(self.last_progress_emit, now, bytes, total) {
            return None;
        }
        self.last_progress_emit = Some(now);
        Some(ProgressUpdate {
            bytes,
            total,
            speed_bps: calculate_speed(bytes, now.saturating_duration_since(self.started_at)),
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

fn should_emit_progress(last_emit: Option<Instant>, now: Instant, bytes: u64, total: u64) -> bool {
    if total != 0 && bytes >= total {
        return true;
    }
    match last_emit {
        Some(previous) => now.saturating_duration_since(previous) >= MAX_PROGRESS_INTERVAL,
        None => true,
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
    fn progress_emission_is_throttled() {
        let now = Instant::now();
        let previous = now
            .checked_sub(Duration::from_millis(50))
            .expect("subtraction should succeed");
        assert!(!should_emit_progress(Some(previous), now, 10, 100));
        assert!(should_emit_progress(Some(previous), now, 100, 100));
    }
}
