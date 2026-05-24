//! Commands for persisted application settings and packaged-app actions.

use crate::commands::{command_error, CommandResult};
use crate::storage::settings::{AppSettings, RelayModeSetting};
use crate::AppState;
use serde::Serialize;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::path::Path;
use tauri::{AppHandle, Emitter, State};

/// Serializable snapshot of user-configurable application settings.
#[derive(Debug, Clone, Serialize)]
#[allow(clippy::struct_excessive_bools)]
pub struct SettingsPayload {
    /// Default directory where received files are exported.
    pub download_dir: String,
    /// Whether automatic update checks run during app startup.
    pub auto_update_enabled: bool,
    /// Whether the first-run setup experience has been completed.
    pub first_run_complete: bool,
    /// Relay configuration mode.
    pub relay_mode: RelayModeSetting,
    /// Custom relay URL used when relay mode is set to `custom`.
    pub custom_relay_url: Option<String>,
    /// Whether nearby-share discovery is enabled on the local network.
    pub local_discovery_enabled: bool,
    /// Whether Bluetooth proximity discovery is enabled once supported by this build.
    pub bluetooth_discovery_enabled: bool,
}

impl From<AppSettings> for SettingsPayload {
    fn from(settings: AppSettings) -> Self {
        Self {
            download_dir: settings.download_dir.to_string_lossy().to_string(),
            auto_update_enabled: settings.auto_update_enabled,
            first_run_complete: settings.first_run_complete,
            relay_mode: settings.relay_mode,
            custom_relay_url: settings.custom_relay_url,
            local_discovery_enabled: settings.local_discovery_enabled,
            bluetooth_discovery_enabled: settings.bluetooth_discovery_enabled,
        }
    }
}

/// Returns the full persisted application settings payload.
///
/// # Errors
///
/// Returns an error string if persisted settings cannot be read.
#[tauri::command]
pub async fn get_app_settings(state: State<'_, AppState>) -> Result<SettingsPayload, String> {
    Ok(state.settings.snapshot().await.into())
}

/// Returns the current download directory path.
///
/// # Errors
///
/// Returns an error string if persisted settings cannot be read.
#[tauri::command]
pub async fn get_download_dir(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state
        .settings
        .snapshot()
        .await
        .download_dir
        .to_string_lossy()
        .to_string())
}

/// Updates the download directory path and persists it to disk.
///
/// # Errors
///
/// Returns an error string if the provided path is invalid or persistence
/// fails.
#[tauri::command]
pub async fn set_download_dir(
    state: State<'_, AppState>,
    path: String,
) -> CommandResult<SettingsPayload> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (state, path);
        return Err(command_error("Changing the download folder is not available in the mobile alpha. Receives stay in app-private storage."));
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    state
        .settings
        .set_download_dir(path.into())
        .await
        .map(SettingsPayload::from)
        .map_err(command_error)
}

/// Updates whether automatic update checks should run on startup.
///
/// # Errors
///
/// Returns an error string if the updated settings cannot be persisted.
#[tauri::command]
pub async fn set_auto_update_enabled(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<SettingsPayload, String> {
    state
        .settings
        .set_auto_update_enabled(enabled)
        .await
        .map(SettingsPayload::from)
        .map_err(String::from)
}

/// Marks first-run setup as completed and persists that state.
///
/// # Errors
///
/// Returns an error string if the updated settings cannot be persisted.
#[tauri::command]
pub async fn complete_first_run(state: State<'_, AppState>) -> Result<SettingsPayload, String> {
    state
        .settings
        .mark_first_run_complete()
        .await
        .map(SettingsPayload::from)
        .map_err(String::from)
}

/// Updates the relay mode used for WAN connectivity.
///
/// # Errors
///
/// Returns an error string if custom relay mode is selected without a valid URL.
#[tauri::command]
pub async fn set_relay_mode(
    app: AppHandle,
    state: State<'_, AppState>,
    relay_mode: RelayModeSetting,
) -> CommandResult<SettingsPayload> {
    let settings = state
        .settings
        .set_relay_mode(relay_mode)
        .await
        .map_err(command_error)?;
    Box::pin(restart_node_after_endpoint_setting(
        app,
        &state,
        settings.clone(),
        "relay_mode_changed",
    ))
    .await?;
    Ok(SettingsPayload::from(settings))
}

/// Updates the custom relay URL used when custom relay mode is enabled.
///
/// # Errors
///
/// Returns an error string if the URL is invalid.
#[tauri::command]
pub async fn set_custom_relay_url(
    app: AppHandle,
    state: State<'_, AppState>,
    relay_url: Option<String>,
) -> CommandResult<SettingsPayload> {
    let settings = state
        .settings
        .set_custom_relay_url(relay_url)
        .await
        .map_err(command_error)?;
    Box::pin(restart_node_after_endpoint_setting(
        app,
        &state,
        settings.clone(),
        "custom_relay_url_changed",
    ))
    .await?;
    Ok(SettingsPayload::from(settings))
}

/// Updates whether nearby-share discovery is enabled on the local network.
///
/// # Errors
///
/// Returns an error string if persistence or event emission fails.
#[tauri::command]
pub async fn set_local_discovery_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> CommandResult<SettingsPayload> {
    let settings = state
        .settings
        .set_local_discovery_enabled(enabled)
        .await
        .map_err(command_error)?;
    state
        .nearby_shares
        .set_local_discovery_enabled(enabled)
        .await;
    if !enabled {
        let shares = state.nearby_shares.clear_discovered_shares().await;
        if let Some(shares) = shares {
            app.emit("discovered-shares-updated", shares)
                .map_err(|error| command_error(error.to_string()))?;
        }
    }
    Box::pin(restart_node_after_endpoint_setting(
        app,
        &state,
        settings.clone(),
        "local_discovery_changed",
    ))
    .await?;
    Ok(SettingsPayload::from(settings))
}

/// Updates whether Bluetooth proximity discovery is enabled.
///
/// # Errors
///
/// Returns an error string if persistence or event emission fails.
#[tauri::command]
pub async fn set_bluetooth_discovery_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<SettingsPayload, String> {
    let settings = state
        .settings
        .set_bluetooth_discovery_enabled(enabled)
        .await
        .map_err(String::from)?;
    state
        .nearby_shares
        .set_bluetooth_discovery_enabled(enabled)
        .await;
    if !enabled {
        let devices = state.nearby_shares.clear_ble_discovered_devices().await;
        if let Some(devices) = devices {
            app.emit("nearby-devices-updated", devices)
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(SettingsPayload::from(settings))
}

async fn restart_node_after_endpoint_setting(
    app: AppHandle,
    state: &State<'_, AppState>,
    settings: AppSettings,
    reason: &'static str,
) -> CommandResult<()> {
    state
        .node_supervisor
        .restart_if_idle(
            app,
            settings,
            &state.transfers,
            state.nearby_shares.clone(),
            state.offer_inbox.clone(),
            reason,
        )
        .await
        .map(|_| ())
        .map_err(command_error)
}

/// Opens the current download directory in the operating system's file explorer.
///
/// # Errors
///
/// Returns an error string if the configured download directory cannot be
/// opened.
#[tauri::command]
pub async fn open_download_dir(state: State<'_, AppState>) -> CommandResult<()> {
    #[cfg(target_os = "android")]
    {
        let _ = state;
        // Android routes receives into MediaStore Downloads under a
        // "Lightning P2P" subfolder; jump there in the system file UI.
        return crate::commands::mobile::android::open_system_folder("Downloads")
            .map_err(command_error);
    }
    #[cfg(target_os = "ios")]
    {
        let _ = state;
        return Err(command_error("Opening the download folder is not available in the mobile alpha. Receives stay in app-private storage."));
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let download_dir = state.settings.snapshot().await.download_dir;
        open_path(&download_dir).map_err(command_error)
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn open_path(path: &Path) -> crate::error::Result<()> {
    let status = open_command(path)?.status()?;
    if status.success() {
        Ok(())
    } else {
        Err(crate::error::LightningP2PError::Other(
            "Failed to open the download directory".into(),
        ))
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn open_command(path: &Path) -> crate::error::Result<std::process::Command> {
    #[cfg(target_os = "windows")]
    let command = {
        let mut cmd = std::process::Command::new("explorer");
        cmd.arg(path);
        cmd
    };

    #[cfg(target_os = "macos")]
    let command = {
        let mut cmd = std::process::Command::new("open");
        cmd.arg(path);
        cmd
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let command = {
        let mut cmd = std::process::Command::new("xdg-open");
        cmd.arg(path);
        cmd
    };

    if path.as_os_str().is_empty() {
        return Err(crate::error::LightningP2PError::Other(
            "Download directory cannot be empty".into(),
        ));
    }

    Ok(command)
}
