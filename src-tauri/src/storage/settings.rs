//! Persistent application settings for packaged and development builds.

use crate::error::{FastDropError, Result};
use iroh::RelayUrl;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::RwLock;

const APP_IDENTIFIER: &str = "com.fastdrop.app";
const DATA_DIR_ENV: &str = "FASTDROP_DATA_DIR";
const PROFILE_ENV: &str = "FASTDROP_PROFILE";
const SETTINGS_FILE_NAME: &str = "settings.json";
const DOWNLOADS_FOLDER_NAME: &str = "FastDrop";

/// Relay configuration mode used for WAN connectivity.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RelayModeSetting {
    /// Use the default public relay configuration.
    Public,
    /// Use a user-provided relay URL.
    Custom,
}

/// Persisted application settings shared by the frontend and backend.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppSettings {
    /// Default directory for verified receives.
    pub download_dir: PathBuf,
    /// Whether automatic update checks run on startup.
    pub auto_update_enabled: bool,
    /// Whether the first-run setup surface has been completed.
    pub first_run_complete: bool,
    /// How relay connectivity should be configured for this install.
    pub relay_mode: RelayModeSetting,
    /// Custom relay URL used when `relay_mode` is set to `custom`.
    pub custom_relay_url: Option<String>,
}

impl AppSettings {
    fn defaults(data_dir: &Path) -> Self {
        Self {
            download_dir: default_download_dir(data_dir),
            auto_update_enabled: false,
            first_run_complete: false,
            relay_mode: RelayModeSetting::Public,
            custom_relay_url: None,
        }
    }

    /// Resolves the configured relay URL, if custom relay mode is enabled.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError` if custom relay mode is enabled without a valid URL.
    pub fn resolved_custom_relay_url(&self) -> Result<Option<RelayUrl>> {
        match self.relay_mode {
            RelayModeSetting::Public => Ok(None),
            RelayModeSetting::Custom => {
                let Some(url) = self.custom_relay_url.as_deref() else {
                    return Err(FastDropError::Other(
                        "Custom relay mode requires a relay URL".into(),
                    ));
                };
                RelayUrl::from_str(url)
                    .map(Some)
                    .map_err(|err| FastDropError::Other(format!("Invalid relay URL: {err}")))
            }
        }
    }
}

/// Persistent settings state backed by a JSON file in the app data directory.
#[derive(Clone)]
pub struct SettingsState {
    path: PathBuf,
    current: Arc<RwLock<AppSettings>>,
}

impl SettingsState {
    /// Loads settings from disk or creates defaults when no settings exist.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError` if the app data directory cannot be prepared.
    pub fn load_or_create(data_dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(data_dir)?;
        let path = data_dir.join(SETTINGS_FILE_NAME);
        let settings = load_settings_file(&path, data_dir)?;
        write_settings_file(&path, &settings)?;
        let state = Self {
            path,
            current: Arc::new(RwLock::new(settings)),
        };
        Ok(state)
    }

    /// Returns the current in-memory settings snapshot.
    pub async fn snapshot(&self) -> AppSettings {
        self.current.read().await.clone()
    }

    /// Updates the download directory, creating it if necessary.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError` if the path is invalid or persistence fails.
    pub async fn set_download_dir(&self, path: PathBuf) -> Result<AppSettings> {
        let normalized = normalize_download_dir(&path)?;
        {
            let mut guard = self.current.write().await;
            guard.download_dir = normalized;
        }
        self.persist().await
    }

    /// Enables or disables startup update checks.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError` if the updated settings cannot be written.
    pub async fn set_auto_update_enabled(&self, enabled: bool) -> Result<AppSettings> {
        {
            let mut guard = self.current.write().await;
            guard.auto_update_enabled = enabled;
        }
        self.persist().await
    }

    /// Marks first-run setup as completed.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError` if the updated settings cannot be written.
    pub async fn mark_first_run_complete(&self) -> Result<AppSettings> {
        {
            let mut guard = self.current.write().await;
            guard.first_run_complete = true;
        }
        self.persist().await
    }

    /// Updates the relay mode.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError` if custom mode is selected without a valid custom URL.
    pub async fn set_relay_mode(&self, relay_mode: RelayModeSetting) -> Result<AppSettings> {
        {
            let mut guard = self.current.write().await;
            guard.relay_mode = relay_mode;
            validate_relay_settings(&guard)?;
        }
        self.persist().await
    }

    /// Updates the custom relay URL used when custom relay mode is enabled.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError` if the URL is invalid or missing while custom mode is enabled.
    pub async fn set_custom_relay_url(&self, relay_url: Option<String>) -> Result<AppSettings> {
        {
            let mut guard = self.current.write().await;
            guard.custom_relay_url = normalize_custom_relay_url(relay_url)?;
            validate_relay_settings(&guard)?;
        }
        self.persist().await
    }

    async fn persist(&self) -> Result<AppSettings> {
        let snapshot = self.snapshot().await;
        write_settings_file(&self.path, &snapshot)?;
        Ok(snapshot)
    }
}

/// Resolves the application data directory used by `FastDrop`.
///
/// # Errors
///
/// Returns `FastDropError` if the current working directory cannot be used as a
/// fallback when the OS-specific directory is unavailable.
pub fn resolve_app_data_dir() -> Result<PathBuf> {
    if let Some(path) = std::env::var_os(DATA_DIR_ENV) {
        return Ok(PathBuf::from(path));
    }

    let mut dir = dirs::data_local_dir()
        .unwrap_or(std::env::current_dir()?)
        .join(APP_IDENTIFIER);
    if let Some(profile) = std::env::var_os(PROFILE_ENV) {
        if !profile.is_empty() {
            dir = dir.join(profile);
        }
    }
    Ok(dir)
}

/// Returns the default download directory for this machine and profile.
#[must_use]
pub fn default_download_dir(data_dir: &Path) -> PathBuf {
    match dirs::download_dir() {
        Some(base_dir) => preferred_download_path(&base_dir),
        None => data_dir.join("downloads"),
    }
}

fn load_settings_file(path: &Path, data_dir: &Path) -> Result<AppSettings> {
    if !path.exists() {
        return Ok(AppSettings::defaults(data_dir));
    }

    match std::fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map_err(FastDropError::from)
            .or_else(|err| {
                tracing::warn!("settings file invalid, regenerating defaults: {err}");
                Ok(AppSettings::defaults(data_dir))
            }),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            Ok(AppSettings::defaults(data_dir))
        }
        Err(err) => Err(err.into()),
    }
}

fn write_settings_file(path: &Path, settings: &AppSettings) -> Result<()> {
    let serialized = serde_json::to_vec_pretty(settings)?;
    std::fs::write(path, serialized)?;
    Ok(())
}

fn normalize_custom_relay_url(relay_url: Option<String>) -> Result<Option<String>> {
    let Some(url) = relay_url else {
        return Ok(None);
    };

    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let parsed = RelayUrl::from_str(trimmed)
        .map_err(|err| FastDropError::Other(format!("Invalid relay URL: {err}")))?;
    Ok(Some(parsed.to_string()))
}

fn validate_relay_settings(settings: &AppSettings) -> Result<()> {
    if settings.relay_mode == RelayModeSetting::Custom {
        let Some(url) = settings.custom_relay_url.as_deref() else {
            return Err(FastDropError::Other(
                "Custom relay mode requires a relay URL".into(),
            ));
        };
        RelayUrl::from_str(url)
            .map_err(|err| FastDropError::Other(format!("Invalid relay URL: {err}")))?;
    }
    Ok(())
}

fn normalize_download_dir(path: &Path) -> Result<PathBuf> {
    if path.as_os_str().is_empty() {
        return Err(FastDropError::Other(
            "Download directory cannot be empty".into(),
        ));
    }

    let normalized = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };

    std::fs::create_dir_all(&normalized)?;
    if !normalized.is_dir() {
        return Err(FastDropError::Other(
            "Download directory must point to a folder".into(),
        ));
    }

    Ok(normalized)
}

fn preferred_download_path(base_dir: &Path) -> PathBuf {
    let preferred = base_dir.join(DOWNLOADS_FOLDER_NAME);
    if std::fs::create_dir_all(&preferred).is_ok() {
        preferred
    } else {
        base_dir.to_path_buf()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_settings_state() -> (SettingsState, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir should be created");
        let state = SettingsState::load_or_create(dir.path()).expect("settings should load");
        (state, dir)
    }

    #[tokio::test]
    async fn settings_are_persisted() {
        let (state, dir) = temp_settings_state();
        let download_dir = dir.path().join("custom-downloads");
        let updated = state
            .set_download_dir(download_dir.clone())
            .await
            .expect("download dir should persist");

        assert_eq!(updated.download_dir, download_dir);

        let reloaded = SettingsState::load_or_create(dir.path()).expect("settings reload");
        let snapshot = reloaded.snapshot().await;
        assert_eq!(snapshot.download_dir, download_dir);
    }

    #[tokio::test]
    async fn first_run_flag_persists() {
        let (state, dir) = temp_settings_state();
        state
            .mark_first_run_complete()
            .await
            .expect("first run should persist");

        let reloaded = SettingsState::load_or_create(dir.path()).expect("settings reload");
        let snapshot = reloaded.snapshot().await;
        assert!(snapshot.first_run_complete);
    }

    #[tokio::test]
    async fn relay_settings_persist() {
        let (state, dir) = temp_settings_state();
        state
            .set_custom_relay_url(Some("https://relay.example.com".into()))
            .await
            .expect("relay url should persist");
        state
            .set_relay_mode(RelayModeSetting::Custom)
            .await
            .expect("relay mode should persist");

        let reloaded = SettingsState::load_or_create(dir.path()).expect("settings reload");
        let snapshot = reloaded.snapshot().await;
        assert_eq!(snapshot.relay_mode, RelayModeSetting::Custom);
        assert_eq!(
            snapshot.custom_relay_url,
            Some("https://relay.example.com./".into())
        );
    }

    #[tokio::test]
    async fn custom_relay_requires_url() {
        let (state, _dir) = temp_settings_state();
        let err = state
            .set_relay_mode(RelayModeSetting::Custom)
            .await
            .expect_err("custom relay mode without url should fail");
        assert!(err.to_string().contains("requires a relay URL"));
    }
}
