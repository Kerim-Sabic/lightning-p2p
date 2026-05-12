//! Commands for querying node/peer information.

use crate::node::nearby_protocol::local_device_name;
use crate::node::NodeRuntimeStatus;
use crate::AppState;
use serde::Serialize;
use tauri::State;

const SHORT_NODE_ID_LEN: usize = 12;

/// Frontend-facing identity for the *local* device — surfaced in the Devices
/// view header so users can confirm they are visible (and as which name) to
/// other peers.
#[derive(Debug, Clone, Serialize)]
pub struct LocalDeviceIdentity {
    /// Human-readable device name reported to peers via the nearby Hello probe.
    pub device_name: String,
    /// First `SHORT_NODE_ID_LEN` characters of the iroh `NodeId`, for at-a-glance
    /// confirmation that this matches what peers see.
    pub short_node_id: String,
    /// Full hex `NodeId`.
    pub node_id: String,
}

/// Returns this node's `NodeId` as a string.
///
/// # Errors
///
/// Returns an error string if the local node has not finished initializing.
#[tauri::command]
pub async fn get_node_id(state: State<'_, AppState>) -> Result<String, String> {
    let node = state.get_node().await.map_err(String::from)?;
    Ok(node.node_id().to_string())
}

/// Returns the current node status.
///
/// # Errors
///
/// Returns an error string if application state access fails.
#[tauri::command]
pub async fn get_node_status(state: State<'_, AppState>) -> Result<NodeRuntimeStatus, String> {
    let guard = state.node.read().await;
    match guard.as_ref() {
        Some(node) => Ok(node.runtime_status()),
        None => Ok(state.node_runtime.read().await.clone()),
    }
}

/// Returns the local device's discovery identity for use in the Devices view.
///
/// # Errors
///
/// Returns an error string if the local node has not finished initializing.
#[tauri::command]
pub async fn get_local_device_identity(
    state: State<'_, AppState>,
) -> Result<LocalDeviceIdentity, String> {
    let node = state.get_node().await.map_err(String::from)?;
    let node_id = node.node_id().to_string();
    let short_node_id = node_id.chars().take(SHORT_NODE_ID_LEN).collect::<String>();
    Ok(LocalDeviceIdentity {
        device_name: local_device_name(),
        short_node_id,
        node_id,
    })
}
