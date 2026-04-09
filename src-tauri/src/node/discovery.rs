//! Discovery helpers for finding peers.
//!
//! iroh's built-in discovery (DNS + relay) handles the heavy lifting.
//! This module provides optional local network discovery utilities.

use iroh::NodeId;
use serde::{Deserialize, Serialize};
use std::time::SystemTime;

/// A discovered peer with metadata.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredPeer {
    /// The peer's iroh `NodeId`.
    pub node_id: String,
    /// Human-readable display name (if known).
    pub display_name: Option<String>,
    /// When the peer was last seen.
    pub last_seen: SystemTime,
}

#[allow(dead_code)]
impl DiscoveredPeer {
    /// Creates a new discovered peer entry.
    #[must_use]
    pub fn new(node_id: &NodeId, display_name: Option<String>) -> Self {
        Self {
            node_id: node_id.to_string(),
            display_name,
            last_seen: SystemTime::now(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovered_peer_serializes() {
        let peer = DiscoveredPeer {
            node_id: "test-node-id".to_string(),
            display_name: Some("Alice".to_string()),
            last_seen: SystemTime::now(),
        };
        let json = serde_json::to_string(&peer).unwrap();
        assert!(json.contains("test-node-id"));
        assert!(json.contains("Alice"));
    }
}
