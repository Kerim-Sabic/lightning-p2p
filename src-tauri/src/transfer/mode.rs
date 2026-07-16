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
//! `LanBeast` < Warp in resource use), not bench-validated speed gain.
//!
//! One exception is **evidence-based, not design intent**: the congestion
//! controller. quinn defaults to loss-based CUBIC, and upstream iroh
//! measured CUBIC dramatically underperforming BBR on real network paths
//! (n0-computer/iroh#4286 reports CUBIC ~30x slower than BBR on the same
//! LAN path, and single-stream throughput capping well below link capacity).
//! Fast and above therefore run BBR. Standard keeps CUBIC so the default
//! matches historical behavior; Battery Safe keeps CUBIC because BBR's
//! pacing model costs more CPU wakeups than a phone needs to spend.

use serde::{Deserialize, Serialize};
use std::time::Duration;

const MB: u32 = 1024 * 1024;
/// RFC 9002 default initial congestion window (quinn's CUBIC default).
const DEFAULT_INITIAL_CWND: u64 = 14_720;
/// quinn's default MTU-discovery ceiling: 1500-byte Ethernet minus
/// IPv6 + UDP headers. Safe everywhere.
const ETHERNET_MTU_CEILING: u16 = 1452;
/// 9000-byte jumbo frames minus IPv6 + UDP headers. MTUD probes up to
/// this and black-hole detection recovers when the path can't carry it.
const JUMBO_MTU_CEILING: u16 = 8952;

/// User-selectable transfer mode. The active mode lives in `AppSettings` and
/// applies to every transfer started in the session until changed.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TransferMode {
    /// Platform-aware default. Uses the conservative desktop profile on
    /// desktop and the battery-safe profile on Android while keeping a stable
    /// user-facing setting that can gain measured heuristics over time.
    #[default]
    SmartAuto,
    /// Safe default. Moderate parallelism and conservative QUIC windows.
    Standard,
    /// Full parallelism, same windows as Standard. Aimed at typical LAN.
    Fast,
    /// Larger windows and more streams, slower UI emit to reserve CPU for the
    /// transport. Aimed at fast LAN to multi-GbE.
    Extreme,
    /// Maximally permissive timeouts plus the largest windows. Aimed at
    /// sustained large-file transfers on local networks.
    LanBeast,
    /// Everything maxed: BBR congestion control with a giant initial window,
    /// jumbo-frame MTU probing, and the largest flow-control windows. The
    /// no-compromises tier for saturating whatever link you have.
    Warp,
    /// Mobile-friendly profile: small parallelism, slow UI emit, fast-fail
    /// idle timeout. Reduces RAM and CPU pressure on Android.
    BatterySafe,
}

/// Congestion control algorithm applied to the session's QUIC connections.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CongestionAlgorithm {
    /// quinn's default. Loss-based; halves the window on packet loss, which
    /// collapses throughput on lossy Wi-Fi and high-bandwidth-delay paths.
    Cubic,
    /// Model-based bandwidth estimation (Bottleneck Bandwidth and RTT).
    /// Keeps the pipe full through stray loss; see the module honesty note
    /// for the upstream evidence.
    Bbr,
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
    /// Congestion control algorithm baked into the endpoint at bind time.
    pub congestion: CongestionAlgorithm,
    /// Initial congestion window (bytes). Larger values skip most of
    /// slow-start, which dominates total time for short transfers.
    pub initial_congestion_window: u64,
    /// Upper bound for QUIC MTU discovery (bytes). quinn binary-searches up
    /// to this bound and falls back on black-hole detection, so probing for
    /// jumbo frames is safe on networks that cannot carry them.
    pub mtu_upper_bound: u16,
    /// Whether swarm receive (parallel child-blob fetches for collections)
    /// is on by default in this mode. The Settings toggle forces it on for
    /// every mode; swarm always auto-falls-back to the sequential path.
    pub swarm_receive_default: bool,
    /// Concurrent child fetches when the swarm path runs. Each fetch is its
    /// own direct connection to the sender, so this also bounds sender load.
    pub swarm_parallelism: usize,
}

impl TransferMode {
    /// Returns the canonical wire-format name of this mode. Matches the
    /// serde representation so the JSON form and rust enum stay 1:1.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SmartAuto => "smart_auto",
            Self::Standard => "standard",
            Self::Fast => "fast",
            Self::Extreme => "extreme",
            Self::LanBeast => "lan_beast",
            Self::Warp => "warp",
            Self::BatterySafe => "battery_safe",
        }
    }

    /// Parses a mode from its canonical name. Unknown names return `None`.
    #[must_use]
    pub fn from_wire(name: &str) -> Option<Self> {
        Some(match name {
            "smart_auto" => Self::SmartAuto,
            "standard" => Self::Standard,
            "fast" => Self::Fast,
            "extreme" => Self::Extreme,
            "lan_beast" => Self::LanBeast,
            "warp" => Self::Warp,
            "battery_safe" => Self::BatterySafe,
            _ => return None,
        })
    }

    /// Returns the [`TransferProfile`] for this mode. Values live in one
    /// per-mode constructor each so reviewers can read a tier at a glance.
    #[must_use]
    pub const fn profile(self) -> TransferProfile {
        match self {
            Self::SmartAuto => Self::smart_auto_profile(),
            Self::Standard => Self::standard_profile(),
            Self::Fast => Self::fast_profile(),
            Self::Extreme => Self::extreme_profile(),
            Self::LanBeast => Self::lan_beast_profile(),
            Self::Warp => Self::warp_profile(),
            Self::BatterySafe => Self::battery_safe_profile(),
        }
    }

    const fn smart_auto_profile() -> TransferProfile {
        let mut profile = if cfg!(target_os = "android") {
            Self::battery_safe_profile()
        } else {
            Self::standard_profile()
        };
        profile.mode = Self::SmartAuto;
        profile
    }

    const fn standard_profile() -> TransferProfile {
        TransferProfile {
            mode: Self::Standard,
            import_parallelism: 64,
            progress_interval: Duration::from_millis(100),
            idle_timeout: Duration::from_secs(60),
            quic_send_window_bytes: 256 * MB as u64,
            quic_recv_window_bytes: 256 * MB,
            quic_stream_recv_window_bytes: 64 * MB,
            max_concurrent_streams: 1024,
            keep_alive_interval: Duration::from_secs(5),
            congestion: CongestionAlgorithm::Cubic,
            initial_congestion_window: DEFAULT_INITIAL_CWND,
            mtu_upper_bound: ETHERNET_MTU_CEILING,
            swarm_receive_default: false,
            swarm_parallelism: 4,
        }
    }

    const fn fast_profile() -> TransferProfile {
        TransferProfile {
            mode: Self::Fast,
            import_parallelism: 128,
            progress_interval: Duration::from_millis(100),
            idle_timeout: Duration::from_secs(60),
            quic_send_window_bytes: 256 * MB as u64,
            quic_recv_window_bytes: 256 * MB,
            quic_stream_recv_window_bytes: 64 * MB,
            max_concurrent_streams: 1024,
            keep_alive_interval: Duration::from_secs(5),
            congestion: CongestionAlgorithm::Bbr,
            initial_congestion_window: 256 * 1024,
            mtu_upper_bound: ETHERNET_MTU_CEILING,
            swarm_receive_default: false,
            swarm_parallelism: 6,
        }
    }

    const fn extreme_profile() -> TransferProfile {
        TransferProfile {
            mode: Self::Extreme,
            import_parallelism: 128,
            progress_interval: Duration::from_millis(200),
            idle_timeout: Duration::from_secs(90),
            quic_send_window_bytes: 512 * MB as u64,
            quic_recv_window_bytes: 512 * MB,
            quic_stream_recv_window_bytes: 128 * MB,
            max_concurrent_streams: 2048,
            keep_alive_interval: Duration::from_secs(5),
            congestion: CongestionAlgorithm::Bbr,
            initial_congestion_window: MB as u64,
            mtu_upper_bound: JUMBO_MTU_CEILING,
            swarm_receive_default: true,
            swarm_parallelism: 8,
        }
    }

    const fn lan_beast_profile() -> TransferProfile {
        TransferProfile {
            mode: Self::LanBeast,
            import_parallelism: 128,
            progress_interval: Duration::from_millis(200),
            idle_timeout: Duration::from_secs(120),
            quic_send_window_bytes: 1024 * MB as u64,
            quic_recv_window_bytes: 1024 * MB,
            quic_stream_recv_window_bytes: 256 * MB,
            max_concurrent_streams: 4096,
            keep_alive_interval: Duration::from_secs(15),
            congestion: CongestionAlgorithm::Bbr,
            initial_congestion_window: 4 * MB as u64,
            mtu_upper_bound: JUMBO_MTU_CEILING,
            swarm_receive_default: true,
            swarm_parallelism: 12,
        }
    }

    const fn warp_profile() -> TransferProfile {
        TransferProfile {
            mode: Self::Warp,
            import_parallelism: 128,
            progress_interval: Duration::from_millis(200),
            idle_timeout: Duration::from_secs(120),
            quic_send_window_bytes: 2048 * MB as u64,
            quic_recv_window_bytes: 2048 * MB,
            quic_stream_recv_window_bytes: 512 * MB,
            max_concurrent_streams: 8192,
            keep_alive_interval: Duration::from_secs(15),
            congestion: CongestionAlgorithm::Bbr,
            initial_congestion_window: 8 * MB as u64,
            mtu_upper_bound: JUMBO_MTU_CEILING,
            swarm_receive_default: true,
            swarm_parallelism: 16,
        }
    }

    const fn battery_safe_profile() -> TransferProfile {
        TransferProfile {
            mode: Self::BatterySafe,
            import_parallelism: 8,
            progress_interval: Duration::from_millis(250),
            idle_timeout: Duration::from_secs(30),
            quic_send_window_bytes: 64 * MB as u64,
            quic_recv_window_bytes: 64 * MB,
            quic_stream_recv_window_bytes: 16 * MB,
            max_concurrent_streams: 256,
            keep_alive_interval: Duration::from_secs(30),
            congestion: CongestionAlgorithm::Cubic,
            initial_congestion_window: DEFAULT_INITIAL_CWND,
            mtu_upper_bound: ETHERNET_MTU_CEILING,
            swarm_receive_default: false,
            swarm_parallelism: 2,
        }
    }

    /// Mode that ships as the platform default. Smart Auto resolves to
    /// battery-safe transport values on Android and Standard values on
    /// desktop without changing the on-disk preference.
    #[must_use]
    pub const fn platform_default() -> Self {
        Self::SmartAuto
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_MODES: [TransferMode; 7] = [
        TransferMode::SmartAuto,
        TransferMode::Standard,
        TransferMode::Fast,
        TransferMode::Extreme,
        TransferMode::LanBeast,
        TransferMode::Warp,
        TransferMode::BatterySafe,
    ];

    #[test]
    fn wire_names_round_trip() {
        for mode in ALL_MODES {
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
        for mode in ALL_MODES {
            assert_eq!(mode.profile().mode, mode);
        }
    }

    #[test]
    fn smart_auto_uses_platform_safe_profile() {
        let auto = TransferMode::SmartAuto.profile();
        let expected = if cfg!(target_os = "android") {
            TransferMode::BatterySafe.profile()
        } else {
            TransferMode::Standard.profile()
        };
        assert_eq!(auto.quic_send_window_bytes, expected.quic_send_window_bytes);
        assert_eq!(auto.import_parallelism, expected.import_parallelism);
        assert_eq!(auto.mode, TransferMode::SmartAuto);
    }

    #[test]
    fn profile_resource_hierarchy_increases_through_warp() {
        // BatterySafe < Standard < Fast <= Extreme <= LanBeast <= Warp
        // for windows + streams.
        let modes = [
            TransferMode::BatterySafe,
            TransferMode::Standard,
            TransferMode::Fast,
            TransferMode::Extreme,
            TransferMode::LanBeast,
            TransferMode::Warp,
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
    fn congestion_algorithm_matches_mode_tier() {
        // Standard keeps quinn's CUBIC default so historical deployments see
        // no transport behavior change; BatterySafe keeps CUBIC for CPU.
        // Fast and above run BBR (see module honesty note for the evidence).
        assert_eq!(
            TransferMode::Standard.profile().congestion,
            CongestionAlgorithm::Cubic
        );
        assert_eq!(
            TransferMode::BatterySafe.profile().congestion,
            CongestionAlgorithm::Cubic
        );
        for mode in [
            TransferMode::Fast,
            TransferMode::Extreme,
            TransferMode::LanBeast,
            TransferMode::Warp,
        ] {
            assert_eq!(mode.profile().congestion, CongestionAlgorithm::Bbr);
        }
    }

    #[test]
    fn initial_window_and_mtu_scale_with_tier() {
        let mut previous = 0u64;
        for mode in [
            TransferMode::Standard,
            TransferMode::Fast,
            TransferMode::Extreme,
            TransferMode::LanBeast,
            TransferMode::Warp,
        ] {
            let profile = mode.profile();
            assert!(
                profile.initial_congestion_window >= previous,
                "initial cwnd hierarchy violated at {mode:?}"
            );
            previous = profile.initial_congestion_window;
            assert!(profile.mtu_upper_bound >= 1452);
        }
        // Jumbo probing is reserved for the explicitly LAN-oriented tiers.
        assert_eq!(TransferMode::Standard.profile().mtu_upper_bound, 1452);
        assert_eq!(TransferMode::Warp.profile().mtu_upper_bound, 8952);
    }

    #[test]
    fn swarm_defaults_match_performance_tiers() {
        // Swarm receive ships on by default only where users explicitly chose
        // a performance tier; the conservative and mobile tiers stay opt-in.
        for mode in [
            TransferMode::Standard,
            TransferMode::Fast,
            TransferMode::BatterySafe,
        ] {
            assert!(!mode.profile().swarm_receive_default, "{mode:?}");
        }
        for mode in [
            TransferMode::Extreme,
            TransferMode::LanBeast,
            TransferMode::Warp,
        ] {
            assert!(mode.profile().swarm_receive_default, "{mode:?}");
        }
        // Fan-out width grows with the tier.
        assert!(
            TransferMode::Warp.profile().swarm_parallelism
                >= TransferMode::LanBeast.profile().swarm_parallelism
        );
        assert!(
            TransferMode::LanBeast.profile().swarm_parallelism
                >= TransferMode::Extreme.profile().swarm_parallelism
        );
    }

    #[test]
    fn battery_safe_keeps_low_resource_floor() {
        let bs = TransferMode::BatterySafe.profile();
        assert!(bs.import_parallelism <= 16);
        assert!(bs.progress_interval >= Duration::from_millis(200));
        assert!(bs.idle_timeout <= Duration::from_secs(60));
    }

    #[test]
    fn smart_auto_is_the_default_mode_value() {
        let default: TransferMode = TransferMode::default();
        assert_eq!(default, TransferMode::SmartAuto);
    }

    #[test]
    fn platform_default_matches_target() {
        assert_eq!(TransferMode::platform_default(), TransferMode::SmartAuto);
    }
}
