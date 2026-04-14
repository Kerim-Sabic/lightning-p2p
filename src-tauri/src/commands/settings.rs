//! Commands for persisted application settings and packaged-app actions.

use crate::storage::settings::{AppSettings, RelayModeSetting};
use crate::AppState;
use serde::Serialize;
use std::path::Path;
use tauri::State;

/// Serializable snapshot of user-configurable application settings.
#[derive(Debug, Clone, Serialize)]
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
}

impl From<AppSettings> for SettingsPayload {
    fn from(settings: AppSettings) -> Self {
        Self {
            download_dir: settings.download_dir.to_string_lossy().to_string(),
            auto_update_enabled: settings.auto_update_enabled,
            first_run_complete: settings.first_run_complete,
            relay_mode: settings.relay_mode,
            custom_relay_url: settings.custom_relay_url,
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
) -> Result<SettingsPayload, String> {
    state
        .settings
        .set_download_dir(path.into())
        .await
        .map(SettingsPayload::from)
        .map_err(String::from)
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
    state: State<'_, AppState>,
    relay_mode: RelayModeSetting,
) -> Result<SettingsPayload, String> {
    state
        .settings
        .set_relay_mode(relay_mode)
        .await
        .map(SettingsPayload::from)
        .map_err(String::from)
}

/// Updates the custom relay URL used when custom relay mode is enabled.
///
/// # Errors
///
/// Returns an error string if the URL is invalid.
#[tauri::command]
pub async fn set_custom_relay_url(
    state: State<'_, AppState>,
    relay_url: Option<String>,
) -> Result<SettingsPayload, String> {
    state
        .settings
        .set_custom_relay_url(relay_url)
        .await
        .map(SettingsPayload::from)
        .map_err(String::from)
}

/// Opens the current download directory in the operating system's file explorer.
///
/// # Errors
///
/// Returns an error string if the configured download directory cannot be
/// opened.
#[tauri::command]
pub async fn open_download_dir(state: State<'_, AppState>) -> Result<(), String> {
    let download_dir = state.settings.snapshot().await.download_dir;
    open_path(&download_dir).map_err(String::from)
}

fn open_path(path: &Path) -> crate::error::Result<()> {
    let status = open_command(path)?.status()?;
    if status.success() {
        Ok(())
    } else {
        Err(crate::error::FastDropError::Other(
            "Failed to open the download directory".into(),
        ))
    }
}

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
        return Err(crate::error::FastDropError::Other(
            "Download directory cannot be empty".into(),
        ));
    }

    Ok(command)
}
