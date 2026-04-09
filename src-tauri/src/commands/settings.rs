//! Commands for user-configurable settings.

use crate::AppState;
use tauri::State;

/// Returns the current download directory path.
///
/// # Errors
///
/// Returns an error string if the node has not finished initializing.
#[tauri::command]
pub async fn get_download_dir(state: State<'_, AppState>) -> Result<String, String> {
    let node = state.get_node().await.map_err(String::from)?;
    Ok(node.download_dir.to_string_lossy().to_string())
}

/// Updates the download directory path.
///
/// # Errors
///
/// Returns an error string if settings persistence fails.
#[tauri::command]
pub async fn set_download_dir(_state: State<'_, AppState>, _path: String) -> Result<(), String> {
    // TODO: validate path exists, update node config, persist to sled
    tracing::info!("set_download_dir not yet implemented");
    Ok(())
}
