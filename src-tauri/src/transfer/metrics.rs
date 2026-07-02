//! Shared transfer metrics and route classification types.

use serde::{Deserialize, Serialize};

/// Coarse route kind shown in the frontend.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RouteKind {
    /// Transfer path is not known yet.
    #[default]
    Unknown,
    /// Transfer is using a direct peer path.
    Direct,
    /// Transfer is using a relay path.
    Relay,
    /// Transfer is using both direct and relay paths.
    Mixed,
}

impl RouteKind {
    /// Converts an atomic-friendly integer into a route kind.
    #[must_use]
    pub fn from_repr(value: u8) -> Self {
        match value {
            1 => Self::Direct,
            2 => Self::Relay,
            3 => Self::Mixed,
            _ => Self::Unknown,
        }
    }

    /// Converts the route kind into an atomic-friendly integer.
    #[must_use]
    pub const fn as_repr(self) -> u8 {
        match self {
            Self::Unknown => 0,
            Self::Direct => 1,
            Self::Relay => 2,
            Self::Mixed => 3,
        }
    }
}

/// Transfer provider selection strategy.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TransferStrategy {
    /// No strategy is known yet.
    #[default]
    Unknown,
    /// A single provider is used through the iroh-blobs queued downloader.
    QueuedSingleProvider,
    /// Multiple providers are available to the iroh-blobs queued downloader.
    QueuedMultiProvider,
    /// Experimental swarm receive: collection children fetched concurrently
    /// over parallel direct connections.
    SwarmParallel,
}

impl TransferStrategy {
    /// Converts an atomic-friendly integer into a transfer strategy.
    #[must_use]
    pub fn from_repr(value: u8) -> Self {
        match value {
            1 => Self::QueuedSingleProvider,
            2 => Self::QueuedMultiProvider,
            3 => Self::SwarmParallel,
            _ => Self::Unknown,
        }
    }

    /// Converts the strategy into an atomic-friendly integer.
    #[must_use]
    pub const fn as_repr(self) -> u8 {
        match self {
            Self::Unknown => 0,
            Self::QueuedSingleProvider => 1,
            Self::QueuedMultiProvider => 2,
            Self::SwarmParallel => 3,
        }
    }
}

/// Timing and route metadata attached to transfer events and queue snapshots.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransferMetrics {
    /// Best-known route for the transfer.
    pub route_kind: RouteKind,
    /// Time to first successful peer contact or sender preparation completion.
    pub connect_ms: u64,
    /// Time spent downloading content into the local blob store.
    pub download_ms: u64,
    /// Time spent exporting verified data to disk.
    pub export_ms: u64,
    /// Number of provider tickets available for this transfer.
    pub provider_count: u64,
    /// Providers with direct addresses in their tickets.
    pub direct_provider_count: u64,
    /// Providers with relay URLs in their tickets.
    pub relay_provider_count: u64,
    /// Provider selection strategy.
    pub strategy: TransferStrategy,
    /// Time to first payload byte.
    pub first_byte_ms: u64,
    /// Effective transfer throughput in megabits per second, rounded down.
    pub effective_mbps: u64,
}
