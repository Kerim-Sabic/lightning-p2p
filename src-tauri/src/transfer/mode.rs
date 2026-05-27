//! Transfer modes and the profile values that drive them.
//!
//! Modes are session-level: changing the mode rebuilds the iroh endpoint via the
//! Supervisor because QUIC transport config is baked at bind time. Per-transfer
//! mode override is out of scope for v0.5.1 — see ROADMAP.
//!
//! ### Honesty note
//!
//! On the v0.5.1 audit machine (same-machine loopback, AMD Zen 5, Windows 11)
//! the differences between Standard, Fast, Extreme, and LAN Beast are within
//! sample noise (the B4 parallelism sweep showed <10% spread across p ∈ {4..200}
//! for many-small, see AUDIT.md). Mode profiles encode **design intent** —
//! larger QUIC windows, more streams, more permissive timeouts — that will
//! actually show throughput delta only when validated against LAN/WAN
//! conditions. That LAN validation is a v0.6 deliverable. Until then the modes
//! ship with values chosen for clear hierarchy (Standard < Fast < Extreme <
//! `LanBeast` in resource use), not bench-validated speed gain.

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// User-selectable transfer mode. The active mode lives in `AppSettings` and
/// applies to every transfer started in the session until changed.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TransferMode {
    /// Safe default. Moderate parallelism and conservative QUIC windows.
    #[default]
    Standard,
    /// Full parallelism, same windows as Standard. Aimed at typical LAN.
    Fast,
    /// Larger windows and more streams, slower UI emit to reserve CPU for the
    /// transport. Aimed at fast LAN to multi-GbE.
    Extreme,
    /// Maximally permissive timeouts plus the largest windows. Aimed at
    /// sustained large-file transfers on local networks.
    LanBeast,
    /// Mobile-friendly profile: small parallelism, slow UI emit, fast-fail
    /// idle timeout. Reduces RAM and CPU pressure on Android.
    BatterySafe,
}

/// Concrete numeric parameters derived from a [`TransferMode`].
///
/// Returned by [`TransferMode::profile`]. Treat as plain data: every consumer
/// (sender, receiver, progress sampler, endpoint) reads the relevant fields
/// directly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TransferProfile {
    /// The mode this profile was derived from.
    pub mode: TransferMode,
    /// Cap on the number of concurrent file imports on the sender side. Used
    /// by `sender::import_parallelism` when no env override is present.
    pub import_parallelism: usize,
    /// Minimum interval between progress events emitted to the frontend.
    pub progress_interval: Duration,
    /// How long a receiver waits for any download progress before failing.
    pub idle_timeout: Duration,
    /// QUIC connection-level send window (bytes).
    pub quic_send_window_bytes: u64,
    /// QUIC connection-level receive window (bytes).
    pub quic_recv_window_bytes: u32,
    /// QUIC per-stream receive window (bytes).
    pub quic_stream_recv_window_bytes: u32,
    /// Maximum number of concurrent bidi + uni streams per connection.
    pub max_concurrent_streams: u32,
    /// QUIC keepalive interval. Longer values reduce wakeups on mobile.
    pub keep_alive_interval: Duration,
}

impl TransferMode {
    /// Returns the canonical wire-format name of this mode. Matches the
    /// serde representation so the JSON form and rust enum stay 1:1.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Fast => "fast",
            Self::Extreme => "extreme",
            Self::LanBeast => "lan_beast",
            Self::BatterySafe => "battery_safe",
        }
    }

    /// Parses a mode from its canonical name. Unknown names return `None`.
    #[must_use]
    pub fn from_wire(name: &str) -> Option<Self> {
        Some(match name {
            "standard" => Self::Standard,
            "fast" => Self::Fast,
            "extreme" => Self::Extreme,
            "lan_beast" => Self::LanBeast,
            "battery_safe" => Self::BatterySafe,
            _ => return None,
        })
    }

    /// Returns the [`TransferProfile`] for this mode. Values are deliberately
    /// expressed inline so reviewers can see every tier in one place.
    #[must_use]
    pub const fn profile(self) -> TransferProfile {
        const MB: u32 = 1024 * 1024;
        match self {
            Self::Standard => TransferProfile {
                mode: self,
                import_parallelism: 64,
                progress_interval: Duration::from_millis(100),
                idle_timeout: Duration::from_secs(60),
                quic_send_window_bytes: 256 * MB as u64,
                quic_recv_window_bytes: 256 * MB,
                quic_stream_recv_window_bytes: 64 * MB,
                max_concurrent_streams: 1024,
                keep_alive_interval: Duration::from_secs(5),
            },
            Self::Fast => TransferProfile {
                mode: self,
                import_parallelism: 128,
                progress_interval: Duration::from_millis(100),
                idle_timeout: Duration::from_secs(60),
                quic_send_window_bytes: 256 * MB as u64,
                quic_recv_window_bytes: 256 * MB,
                quic_stream_recv_window_bytes: 64 * MB,
                max_concurrent_streams: 1024,
                keep_alive_interval: Duration::from_secs(5),
            },
            Self::Extreme => TransferProfile {
                mode: self,
                import_parallelism: 128,
                progress_interval: Duration::from_millis(200),
                idle_timeout: Duration::from_secs(90),
                quic_send_window_bytes: 512 * MB as u64,
                quic_recv_window_bytes: 512 * MB,
                quic_stream_recv_window_bytes: 128 * MB,
                max_concurrent_streams: 2048,
                keep_alive_interval: Duration::from_secs(5),
            },
            Self::LanBeast => TransferProfile {
                mode: self,
                import_parallelism: 128,
                progress_interval: Duration::from_millis(200),
                idle_timeout: Duration::from_secs(120),
                quic_send_window_bytes: 1024 * MB as u64,
                quic_recv_window_bytes: 1024 * MB,
                quic_stream_recv_window_bytes: 256 * MB,
                max_concurrent_streams: 4096,
                keep_alive_interval: Duration::from_secs(15),
            },
            Self::BatterySafe => TransferProfile {
                mode: self,
                import_parallelism: 8,
                progress_interval: Duration::from_millis(250),
                idle_timeout: Duration::from_secs(30),
                quic_send_window_bytes: 64 * MB as u64,
                quic_recv_window_bytes: 64 * MB,
                quic_stream_recv_window_bytes: 16 * MB,
                max_concurrent_streams: 256,
                keep_alive_interval: Duration::from_secs(30),
            },
        }
    }

    /// Mode that ships as the platform default. Android defaults to
    /// `BatterySafe` so first-launch transfers stay friendly to thermals and
    /// RAM; desktops default to `Standard`.
    #[must_use]
    pub const fn platform_default() -> Self {
        if cfg!(target_os = "android") {
            Self::BatterySafe
        } else {
            Self::Standard
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_names_round_trip() {
        for mode in [
            TransferMode::Standard,
            TransferMode::Fast,
            TransferMode::Extreme,
            TransferMode::LanBeast,
            TransferMode::BatterySafe,
        ] {
            assert_eq!(TransferMode::from_wire(mode.as_str()), Some(mode));
        }
    }

    #[test]
    fn unknown_wire_name_is_rejected() {
        assert_eq!(TransferMode::from_wire("yolo"), None);
        assert_eq!(TransferMode::from_wire(""), None);
    }

    #[test]
    fn serde_uses_snake_case_wire_names() {
        let json = serde_json::to_string(&TransferMode::LanBeast).expect("serialize");
        assert_eq!(json, "\"lan_beast\"");
        let parsed: TransferMode =
            serde_json::from_str("\"battery_safe\"").expect("deserialize battery_safe");
        assert_eq!(parsed, TransferMode::BatterySafe);
    }

    #[test]
    fn profile_carries_its_mode_tag() {
        for mode in [
            TransferMode::Standard,
            TransferMode::Fast,
            TransferMode::Extreme,
            TransferMode::LanBeast,
            TransferMode::BatterySafe,
        ] {
            assert_eq!(mode.profile().mode, mode);
        }
    }

    #[test]
    fn profile_resource_hierarchy_increases_through_lan_beast() {
        // BatterySafe < Standard < Fast <= Extreme <= LanBeast for windows + streams.
        let modes = [
            TransferMode::BatterySafe,
            TransferMode::Standard,
            TransferMode::Fast,
            TransferMode::Extreme,
            TransferMode::LanBeast,
        ];
        for pair in modes.windows(2) {
            let a = pair[0].profile();
            let b = pair[1].profile();
            assert!(
                a.quic_send_window_bytes <= b.quic_send_window_bytes,
                "send window hierarchy violated between {:?} and {:?}",
                pair[0],
                pair[1]
            );
            assert!(
                a.max_concurrent_streams <= b.max_concurrent_streams,
                "stream cap hierarchy violated between {:?} and {:?}",
                pair[0],
                pair[1]
            );
        }
    }

    #[test]
    fn battery_safe_keeps_low_resource_floor() {
        let bs = TransferMode::BatterySafe.profile();
        assert!(bs.import_parallelism <= 16);
        assert!(bs.progress_interval >= Duration::from_millis(200));
        assert!(bs.idle_timeout <= Duration::from_secs(60));
    }

    #[test]
    fn standard_is_the_default_mode_value() {
        let default: TransferMode = TransferMode::default();
        assert_eq!(default, TransferMode::Standard);
    }

    #[test]
    fn platform_default_matches_target() {
        let expected = if cfg!(target_os = "android") {
            TransferMode::BatterySafe
        } else {
            TransferMode::Standard
        };
        assert_eq!(TransferMode::platform_default(), expected);
    }
}
