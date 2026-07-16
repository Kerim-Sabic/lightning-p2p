//! Persistent application settings for packaged and development builds.

use crate::error::{LightningP2PError, Result};
use crate::transfer::TransferMode;
use iroh::RelayUrl;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;

const APP_IDENTIFIER: &str = "com.lightningp2p.app";
const DATA_DIR_ENV: &str = "LIGHTNING_P2P_DATA_DIR";
const DEPRECATED_DATA_DIR_ENV: &str = "FASTDROP_DATA_DIR";
const PROFILE_ENV: &str = "LIGHTNING_P2P_PROFILE";
const DEPRECATED_PROFILE_ENV: &str = "FASTDROP_PROFILE";
const SETTINGS_FILE_NAME: &str = "settings.json";
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const DOWNLOADS_FOLDER_NAME: &str = "Lightning P2P";

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
#[allow(clippy::struct_excessive_bools)]
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
    /// Whether nearby-share discovery is enabled on the local network.
    #[serde(default = "default_local_discovery_enabled")]
    pub local_discovery_enabled: bool,
    /// Whether Bluetooth proximity discovery is allowed once the native bridge is available.
    #[serde(default = "default_bluetooth_discovery_enabled")]
    pub bluetooth_discovery_enabled: bool,
    /// Session transfer mode. Determines QUIC transport tuning, import
    /// parallelism, idle timeouts, and progress emit cadence.
    #[serde(default = "default_transfer_mode")]
    pub transfer_mode: TransferMode,
    /// Experimental swarm receive: fetch collection children concurrently
    /// over parallel direct connections. Off by default; falls back to the
    /// standard sequential path on any non-cancel failure.
    #[serde(default)]
    pub experimental_swarm_receive: bool,
}

impl AppSettings {
    fn defaults(data_dir: &Path) -> Self {
        Self {
            download_dir: default_download_dir(data_dir),
            auto_update_enabled: false,
            first_run_complete: false,
            relay_mode: RelayModeSetting::Public,
            custom_relay_url: None,
            local_discovery_enabled: default_local_discovery_enabled(),
            bluetooth_discovery_enabled: default_bluetooth_discovery_enabled(),
            transfer_mode: default_transfer_mode(),
            experimental_swarm_receive: false,
        }
    }

    /// Resolves the configured relay URL, if custom relay mode is enabled.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if custom relay mode is enabled without a valid URL.
    pub fn resolved_custom_relay_url(&self) -> Result<Option<RelayUrl>> {
        match self.relay_mode {
            RelayModeSetting::Public => Ok(None),
            RelayModeSetting::Custom => {
                let Some(url) = self.custom_relay_url.as_deref() else {
                    return Err(LightningP2PError::Other(
                        "Custom relay mode requires a relay URL".into(),
                    ));
                };
                RelayUrl::from_str(url)
                    .map(Some)
                    .map_err(|err| LightningP2PError::Other(format!("Invalid relay URL: {err}")))
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
    /// Returns `LightningP2PError` if the app data directory cannot be prepared.
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

    /// Creates a non-persisted settings state from defaults.
    ///
    /// This is a last-resort launch fallback for mobile builds: the UI should
    /// still open and expose diagnostics even if the settings file cannot be
    /// created on disk.
    #[must_use]
    pub fn in_memory_defaults(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join(SETTINGS_FILE_NAME),
            current: Arc::new(RwLock::new(AppSettings::defaults(data_dir))),
        }
    }

    /// Returns the current in-memory settings snapshot.
    pub async fn snapshot(&self) -> AppSettings {
        self.current.read().await.clone()
    }

    /// Updates the download directory, creating it if necessary.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if the path is invalid or persistence fails.
    pub async fn set_download_dir(&self, path: PathBuf) -> Result<AppSettings> {
        let normalized = normalize_download_dir(&path)?;
        self.update_settings(|settings| {
            settings.download_dir = normalized;
            Ok(())
        })
        .await
    }

    /// Enables or disables startup update checks.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if the updated settings cannot be written.
    pub async fn set_auto_update_enabled(&self, enabled: bool) -> Result<AppSettings> {
        self.update_settings(|settings| {
            settings.auto_update_enabled = enabled;
            Ok(())
        })
        .await
    }

    /// Marks first-run setup as completed.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if the updated settings cannot be written.
    pub async fn mark_first_run_complete(&self) -> Result<AppSettings> {
        self.update_settings(|settings| {
            settings.first_run_complete = true;
            Ok(())
        })
        .await
    }

    /// Updates the relay mode.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if custom mode is selected without a valid custom URL.
    pub async fn set_relay_mode(&self, relay_mode: RelayModeSetting) -> Result<AppSettings> {
        self.update_settings(|settings| {
            settings.relay_mode = relay_mode;
            validate_relay_settings(settings)
        })
        .await
    }

    /// Updates the custom relay URL used when custom relay mode is enabled.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if the URL is invalid or missing while custom mode is enabled.
    pub async fn set_custom_relay_url(&self, relay_url: Option<String>) -> Result<AppSettings> {
        self.update_settings(|settings| {
            settings.custom_relay_url = normalize_custom_relay_url(relay_url)?;
            validate_relay_settings(settings)
        })
        .await
    }

    /// Enables or disables nearby-share discovery on the local network.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if the updated settings cannot be written.
    pub async fn set_local_discovery_enabled(&self, enabled: bool) -> Result<AppSettings> {
        self.update_settings(|settings| {
            settings.local_discovery_enabled = enabled;
            Ok(())
        })
        .await
    }

    /// Enables or disables Bluetooth proximity discovery.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if the updated settings cannot be written.
    pub async fn set_bluetooth_discovery_enabled(&self, enabled: bool) -> Result<AppSettings> {
        self.update_settings(|settings| {
            settings.bluetooth_discovery_enabled = enabled;
            Ok(())
        })
        .await
    }

    /// Updates the session transfer mode. The caller is responsible for
    /// triggering a node restart (via the Supervisor) so the new QUIC
    /// transport config takes effect for subsequent transfers.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if the updated settings cannot be written.
    pub async fn set_transfer_mode(&self, mode: TransferMode) -> Result<AppSettings> {
        self.update_settings(|settings| {
            settings.transfer_mode = mode;
            Ok(())
        })
        .await
    }

    /// Toggles the experimental swarm-receive path.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if the updated settings cannot be written.
    pub async fn set_experimental_swarm_receive(&self, enabled: bool) -> Result<AppSettings> {
        self.update_settings(|settings| {
            settings.experimental_swarm_receive = enabled;
            Ok(())
        })
        .await
    }

    async fn update_settings(
        &self,
        update: impl FnOnce(&mut AppSettings) -> Result<()>,
    ) -> Result<AppSettings> {
        let mut guard = self.current.write().await;
        let mut next = guard.clone();
        update(&mut next)?;
        write_settings_file(&self.path, &next)?;
        *guard = next.clone();
        Ok(next)
    }
}

/// Resolves the application data directory used by `Lightning P2P`.
///
/// # Errors
///
/// Returns `LightningP2PError` if the current working directory cannot be used as a
/// fallback when the OS-specific directory is unavailable.
pub fn resolve_app_data_dir() -> Result<PathBuf> {
    if let Some(path) = env_var(DATA_DIR_ENV).or_else(|| env_var(DEPRECATED_DATA_DIR_ENV)) {
        return Ok(PathBuf::from(path));
    }

    let mut dir = dirs::data_local_dir()
        .unwrap_or(std::env::current_dir()?)
        .join(APP_IDENTIFIER);
    if let Some(profile) = env_var(PROFILE_ENV).or_else(|| env_var(DEPRECATED_PROFILE_ENV)) {
        dir = dir.join(profile);
    }
    Ok(dir)
}

/// Returns the default download directory for this machine and profile.
#[must_use]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn default_download_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("downloads")
}

/// Returns the default download directory for this machine and profile.
#[must_use]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
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
            .map_err(LightningP2PError::from)
            .or_else(|err| {
                tracing::warn!("settings file invalid, preserving corrupt copy: {err}");
                preserve_corrupt_settings(path)?;
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
    let tmp_path = path.with_extension("json.tmp");
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&tmp_path)?;
    file.write_all(&serialized)?;
    file.sync_all()?;
    drop(file);
    replace_file(&tmp_path, path)?;
    Ok(())
}

#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> Result<()> {
    let backup = to.with_extension("json.replace-bak");
    if backup.exists() {
        std::fs::remove_file(&backup)?;
    }
    if to.exists() {
        std::fs::rename(to, &backup)?;
    }
    if let Err(error) = std::fs::rename(from, to) {
        if backup.exists() {
            let _ = std::fs::rename(&backup, to);
        }
        return Err(error.into());
    }
    if backup.exists() {
        std::fs::remove_file(backup)?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> Result<()> {
    std::fs::rename(from, to)?;
    Ok(())
}

fn preserve_corrupt_settings(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs());
    let backup = path.with_file_name(format!("{SETTINGS_FILE_NAME}.corrupt-{timestamp}"));
    std::fs::copy(path, backup)?;
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
        .map_err(|err| LightningP2PError::Other(format!("Invalid relay URL: {err}")))?;
    Ok(Some(parsed.to_string()))
}

fn validate_relay_settings(settings: &AppSettings) -> Result<()> {
    if settings.relay_mode == RelayModeSetting::Custom {
        let Some(url) = settings.custom_relay_url.as_deref() else {
            return Err(LightningP2PError::Other(
                "Custom relay mode requires a relay URL".into(),
            ));
        };
        RelayUrl::from_str(url)
            .map_err(|err| LightningP2PError::Other(format!("Invalid relay URL: {err}")))?;
    }
    Ok(())
}

fn normalize_download_dir(path: &Path) -> Result<PathBuf> {
    if path.as_os_str().is_empty() {
        return Err(LightningP2PError::Other(
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
        return Err(LightningP2PError::Other(
            "Download directory must point to a folder".into(),
        ));
    }

    Ok(normalized)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn preferred_download_path(base_dir: &Path) -> PathBuf {
    let preferred = base_dir.join(DOWNLOADS_FOLDER_NAME);
    if std::fs::create_dir_all(&preferred).is_ok() {
        preferred
    } else {
        base_dir.to_path_buf()
    }
}

fn env_var(name: &str) -> Option<std::ffi::OsString> {
    std::env::var_os(name).filter(|value| !value.is_empty())
}

fn default_local_discovery_enabled() -> bool {
    true
}

fn default_bluetooth_discovery_enabled() -> bool {
    false
}

fn default_transfer_mode() -> TransferMode {
    TransferMode::platform_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    fn temp_settings_state() -> (SettingsState, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir should be created");
        let state = SettingsState::load_or_create(dir.path()).expect("settings should load");
        (state, dir)
    }

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
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
            Some("https://relay.example.com/".into())
        );
        assert!(snapshot.local_discovery_enabled);
        assert!(!snapshot.bluetooth_discovery_enabled);
    }

    #[tokio::test]
    async fn custom_relay_requires_url() {
        let (state, _dir) = temp_settings_state();
        let err = state
            .set_relay_mode(RelayModeSetting::Custom)
            .await
            .expect_err("custom relay mode without url should fail");
        assert!(err.to_string().contains("requires a relay URL"));
        assert_eq!(state.snapshot().await.relay_mode, RelayModeSetting::Public);
    }

    #[tokio::test]
    async fn failed_custom_relay_url_update_leaves_snapshot_unchanged() {
        let (state, _dir) = temp_settings_state();
        state
            .set_custom_relay_url(Some("https://relay.example.com".into()))
            .await
            .expect("initial relay url");
        state
            .set_relay_mode(RelayModeSetting::Custom)
            .await
            .expect("custom relay mode");
        let before = state.snapshot().await;

        let err = state
            .set_custom_relay_url(None)
            .await
            .expect_err("custom mode requires url");

        assert!(err.to_string().contains("requires a relay URL"));
        assert_eq!(state.snapshot().await, before);
    }

    #[tokio::test]
    async fn concurrent_settings_updates_preserve_both_changes() {
        let (state, _dir) = temp_settings_state();
        let first = state.clone();
        let second = state.clone();

        let (auto_update, first_run) = tokio::join!(
            first.set_auto_update_enabled(true),
            second.mark_first_run_complete()
        );

        auto_update.expect("auto update update");
        first_run.expect("first run update");
        let snapshot = state.snapshot().await;
        assert!(snapshot.auto_update_enabled);
        assert!(snapshot.first_run_complete);
    }

    #[test]
    fn invalid_settings_json_is_preserved_before_defaults_are_written() {
        let dir = tempfile::tempdir().expect("tempdir");
        let settings_path = dir.path().join(SETTINGS_FILE_NAME);
        std::fs::write(&settings_path, "{ not valid json").expect("write corrupt settings");

        let state = SettingsState::load_or_create(dir.path()).expect("settings recover");
        let backup_count = std::fs::read_dir(dir.path())
            .expect("read settings dir")
            .filter_map(std::result::Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("settings.json.corrupt-")
            })
            .count();

        let saved = std::fs::read_to_string(&settings_path).expect("settings rewritten");
        let recovered: AppSettings = serde_json::from_str(&saved).expect("valid settings json");

        assert_eq!(backup_count, 1);
        assert_eq!(state.path, settings_path);
        assert!(recovered.local_discovery_enabled);
        assert!(!recovered.bluetooth_discovery_enabled);
    }

    #[tokio::test]
    async fn local_discovery_setting_persists() {
        let (state, dir) = temp_settings_state();
        state
            .set_local_discovery_enabled(false)
            .await
            .expect("local discovery should persist");

        let reloaded = SettingsState::load_or_create(dir.path()).expect("settings reload");
        let snapshot = reloaded.snapshot().await;
        assert!(!snapshot.local_discovery_enabled);
    }

    #[tokio::test]
    async fn bluetooth_discovery_setting_defaults_off_and_persists() {
        let (state, dir) = temp_settings_state();
        assert!(!state.snapshot().await.bluetooth_discovery_enabled);

        state
            .set_bluetooth_discovery_enabled(true)
            .await
            .expect("bluetooth discovery should persist");

        let reloaded = SettingsState::load_or_create(dir.path()).expect("settings reload");
        let snapshot = reloaded.snapshot().await;
        assert!(snapshot.bluetooth_discovery_enabled);
    }

    #[tokio::test]
    async fn transfer_mode_defaults_to_platform_default_and_persists() {
        let (state, dir) = temp_settings_state();
        assert_eq!(
            state.snapshot().await.transfer_mode,
            TransferMode::platform_default()
        );

        state
            .set_transfer_mode(TransferMode::Extreme)
            .await
            .expect("transfer mode should persist");

        let reloaded = SettingsState::load_or_create(dir.path()).expect("settings reload");
        let snapshot = reloaded.snapshot().await;
        assert_eq!(snapshot.transfer_mode, TransferMode::Extreme);
    }

    #[tokio::test]
    async fn missing_transfer_mode_field_uses_platform_default() {
        let dir = tempfile::tempdir().expect("tempdir");
        let settings_path = dir.path().join(SETTINGS_FILE_NAME);
        // settings.json that predates the transfer_mode field
        std::fs::write(
            &settings_path,
            r#"{
                "download_dir": "C:/tmp",
                "auto_update_enabled": false,
                "first_run_complete": true,
                "relay_mode": "public",
                "custom_relay_url": null
            }"#,
        )
        .expect("write legacy settings");

        let state = SettingsState::load_or_create(dir.path()).expect("settings load");
        let snapshot = state.snapshot().await;
        assert_eq!(snapshot.transfer_mode, TransferMode::platform_default());
    }

    #[test]
    fn resolve_app_data_dir_prefers_lightning_p2p_env() {
        let _guard = env_lock().lock().expect("env lock");
        let new_dir = tempfile::tempdir().expect("new dir");
        let old_dir = tempfile::tempdir().expect("old dir");
        std::env::set_var(DATA_DIR_ENV, new_dir.path());
        std::env::set_var(DEPRECATED_DATA_DIR_ENV, old_dir.path());
        std::env::remove_var(PROFILE_ENV);
        std::env::remove_var(DEPRECATED_PROFILE_ENV);

        let resolved = resolve_app_data_dir().expect("data dir");

        std::env::remove_var(DATA_DIR_ENV);
        std::env::remove_var(DEPRECATED_DATA_DIR_ENV);
        assert_eq!(resolved, new_dir.path());
    }

    #[test]
    fn resolve_app_data_dir_accepts_deprecated_fastdrop_env() {
        let _guard = env_lock().lock().expect("env lock");
        let old_dir = tempfile::tempdir().expect("old dir");
        std::env::remove_var(DATA_DIR_ENV);
        std::env::set_var(DEPRECATED_DATA_DIR_ENV, old_dir.path());
        std::env::remove_var(PROFILE_ENV);
        std::env::remove_var(DEPRECATED_PROFILE_ENV);

        let resolved = resolve_app_data_dir().expect("data dir");

        std::env::remove_var(DEPRECATED_DATA_DIR_ENV);
        assert_eq!(resolved, old_dir.path());
    }
}
