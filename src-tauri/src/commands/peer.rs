//! Commands for querying node/peer information.

use crate::node::NodeRuntimeStatus;
use crate::AppState;
use tauri::State;

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
