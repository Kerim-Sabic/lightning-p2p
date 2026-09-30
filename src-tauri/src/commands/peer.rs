//! Commands for querying node/peer information.

use crate::node::nearby_protocol::local_device_name;
use crate::node::{NodeRuntimeStatus, NodeSupervisorStatus};
use crate::storage::paired_devices::{comparison_code, PairedDevice};
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
    /// First `SHORT_NODE_ID_LEN` characters of the iroh `EndpointId`, for at-a-glance
    /// confirmation that this matches what peers see.
    pub short_node_id: String,
    /// Full hex `EndpointId`.
    pub node_id: String,
}

/// Returns this node's `EndpointId` as a string.
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

/// Returns the current node supervisor lifecycle state.
///
/// # Errors
///
/// Returns an error string if application state access fails.
#[tauri::command]
pub async fn get_node_supervisor_status(
    state: State<'_, AppState>,
) -> Result<NodeSupervisorStatus, String> {
    Ok(state.node_supervisor.status().await)
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

/// Returns the short, symmetric comparison code for the local and remote public identities.
///
/// # Errors
///
/// Returns an error if the node is unavailable or the remote identity is invalid.
#[tauri::command]
pub async fn get_device_pairing_code(
    state: State<'_, AppState>,
    remote_node_id: String,
) -> Result<String, String> {
    let node = state.get_node().await.map_err(String::from)?;
    comparison_code(&node.node_id().to_string(), &remote_node_id).map_err(String::from)
}

/// Lists device identities explicitly verified and saved on this device.
///
/// # Errors
///
/// Returns an error if application state cannot be read.
#[tauri::command]
pub async fn list_paired_devices(state: State<'_, AppState>) -> Result<Vec<PairedDevice>, String> {
    Ok(state.paired_devices.list().await)
}

/// Saves a public peer identity after the user confirmed its code in person.
///
/// # Errors
///
/// Returns an error if either identity is invalid or the updated device list cannot be saved.
#[tauri::command]
pub async fn pair_verified_device(
    state: State<'_, AppState>,
    node_id: String,
    name: String,
) -> Result<Vec<PairedDevice>, String> {
    let local_id = state
        .get_node()
        .await
        .map_err(String::from)?
        .node_id()
        .to_string();
    comparison_code(&local_id, &node_id).map_err(String::from)?;
    state
        .paired_devices
        .pair(&node_id, &name)
        .await
        .map_err(String::from)
}

/// Changes only the local display name of a saved device.
///
/// # Errors
///
/// Returns an error if the device is not saved or the updated list cannot be saved.
#[tauri::command]
pub async fn rename_paired_device(
    state: State<'_, AppState>,
    node_id: String,
    name: String,
) -> Result<Vec<PairedDevice>, String> {
    state
        .paired_devices
        .rename(&node_id, &name)
        .await
        .map_err(String::from)
}

/// Removes a saved peer identity from this device.
///
/// # Errors
///
/// Returns an error if the updated list cannot be saved.
#[tauri::command]
pub async fn remove_paired_device(
    state: State<'_, AppState>,
    node_id: String,
) -> Result<Vec<PairedDevice>, String> {
    state
        .paired_devices
        .remove(&node_id)
        .await
        .map_err(String::from)
}
