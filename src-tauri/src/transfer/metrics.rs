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
}

impl RouteKind {
    /// Converts an atomic-friendly integer into a route kind.
    #[must_use]
    pub fn from_repr(value: u8) -> Self {
        match value {
            1 => Self::Direct,
            2 => Self::Relay,
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
}
