//! Reachability and connectivity status types for the local node.

use serde::{Deserialize, Serialize};

/// Coarse online state derived from the current relay and direct-address status.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeOnlineState {
    /// Node startup is still in progress.
    Starting,
    /// Node has at least one direct address ready.
    DirectReady,
    /// Node has a relay connection but no direct address yet.
    RelayReady,
    /// Node is running but has no relay or direct address yet.
    Degraded,
    /// Node startup failed or the node is unavailable.
    Offline,
}

/// Serializable status snapshot shown in the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NodeRuntimeStatus {
    /// Whether the iroh node is running.
    pub online: bool,
    /// The node id, if the node is available.
    pub node_id: Option<String>,
    /// Whether the endpoint is currently connected to a relay.
    pub relay_connected: bool,
    /// The home relay url, if connected.
    pub relay_url: Option<String>,
    /// Number of known direct addresses for this endpoint.
    pub direct_address_count: usize,
    /// Coarse online state for the UI.
    pub online_state: NodeOnlineState,
}

impl Default for NodeRuntimeStatus {
    fn default() -> Self {
        Self::starting()
    }
}

impl NodeRuntimeStatus {
    /// Creates the default startup status before the node is initialized.
    #[must_use]
    pub fn starting() -> Self {
        Self {
            online: false,
            node_id: None,
            relay_connected: false,
            relay_url: None,
            direct_address_count: 0,
            online_state: NodeOnlineState::Starting,
        }
    }

    /// Creates an offline status when startup fails or the node is unavailable.
    #[must_use]
    pub fn offline() -> Self {
        Self {
            online: false,
            node_id: None,
            relay_connected: false,
            relay_url: None,
            direct_address_count: 0,
            online_state: NodeOnlineState::Offline,
        }
    }

    /// Creates a live status snapshot from current reachability facts.
    #[must_use]
    pub fn from_network(
        node_id: String,
        relay_url: Option<String>,
        direct_address_count: usize,
    ) -> Self {
        let relay_connected = relay_url.is_some();
        let online_state = if direct_address_count > 0 {
            NodeOnlineState::DirectReady
        } else if relay_connected {
            NodeOnlineState::RelayReady
        } else {
            NodeOnlineState::Degraded
        };

        Self {
            online: true,
            node_id: Some(node_id),
            relay_connected,
            relay_url,
            direct_address_count,
            online_state,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_addresses_take_priority_for_online_state() {
        let status =
            NodeRuntimeStatus::from_network("node-1".into(), Some("https://relay".into()), 2);
        assert_eq!(status.online_state, NodeOnlineState::DirectReady);
        assert!(status.online);
    }

    #[test]
    fn relay_ready_without_direct_addresses() {
        let status =
            NodeRuntimeStatus::from_network("node-1".into(), Some("https://relay".into()), 0);
        assert_eq!(status.online_state, NodeOnlineState::RelayReady);
        assert!(status.relay_connected);
    }

    #[test]
    fn missing_routes_is_degraded() {
        let status = NodeRuntimeStatus::from_network("node-1".into(), None, 0);
        assert_eq!(status.online_state, NodeOnlineState::Degraded);
        assert!(status.online);
    }
}
