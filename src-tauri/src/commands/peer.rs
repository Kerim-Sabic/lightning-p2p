//! Commands for querying node/peer information.

use crate::AppState;
use serde::Serialize;
use tauri::State;

/// Status information about the local iroh node.
#[derive(Debug, Serialize)]
pub struct NodeStatus {
    /// Whether the node is fully initialized.
    pub online: bool,
    /// The node's unique Ed25519 `NodeId`, if available.
    pub node_id: Option<String>,
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
pub async fn get_node_status(state: State<'_, AppState>) -> Result<NodeStatus, String> {
    let guard = state.node.read().await;
    match guard.as_ref() {
        Some(node) => Ok(NodeStatus {
            online: true,
            node_id: Some(node.node_id().to_string()),
        }),
        None => Ok(NodeStatus {
            online: false,
            node_id: None,
        }),
    }
}
