//! Commands for privacy-safe runtime diagnostics.

use crate::node::NodeOnlineState;
use crate::storage::settings::RelayModeSetting;
use crate::telemetry;
use crate::transfer::metrics::RouteKind;
use crate::AppState;
use serde::Serialize;
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

const ANDROID_LOG_FILE_NAME: &str = "android-diagnostics.log";
const FRONTEND_LOG_FILE_NAME: &str = "frontend.log";
const RECENT_LOG_LINES: usize = 220;
const MAX_FRONTEND_MESSAGE_BYTES: usize = 4096;

/// Download directory health without exposing the local path.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DownloadDirectoryDiagnostics {
    /// Whether the configured directory currently exists.
    pub exists: bool,
    /// Whether the configured path is a directory.
    pub is_dir: bool,
    /// Whether a temporary write probe succeeded.
    pub writable: bool,
    /// User-visible status summary.
    pub status: String,
}

/// Privacy-safe network and runtime diagnostics for support/debugging.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[allow(clippy::struct_excessive_bools)]
pub struct NetworkDiagnostics {
    /// Application version from Cargo metadata.
    pub app_version: String,
    /// Local iroh node id, if the node is available.
    pub node_id: Option<String>,
    /// Whether the local node is online.
    pub online: bool,
    /// Coarse online state.
    pub online_state: NodeOnlineState,
    /// Configured relay mode.
    pub relay_mode: RelayModeSetting,
    /// Whether a relay is currently connected.
    pub relay_connected: bool,
    /// Current relay URL, if connected.
    pub relay_url: Option<String>,
    /// Number of direct addresses known for this node.
    pub direct_address_count: usize,
    /// Whether LAN discovery is currently active.
    pub lan_discovery_active: bool,
    /// Whether LAN discovery is enabled in settings.
    pub local_discovery_enabled: bool,
    /// Whether Bluetooth proximity discovery is enabled in settings.
    pub bluetooth_discovery_enabled: bool,
    /// Download directory health without the path.
    pub download_dir_status: DownloadDirectoryDiagnostics,
    /// Latest active transfer route kind, if known.
    pub latest_route_kind: RouteKind,
}

/// A local-only diagnostic bundle users can paste into support reports.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DiagnosticBundle {
    /// Unix timestamp when the bundle was generated.
    pub generated_at_unix: u64,
    /// Redacted plain-text report.
    pub report: String,
}

/// Returns privacy-safe network diagnostics for copying into bug reports.
///
/// # Errors
///
/// Returns an error string if application state cannot be read.
#[tauri::command]
pub async fn get_network_diagnostics(
    state: State<'_, AppState>,
) -> Result<NetworkDiagnostics, String> {
    Ok(build_network_diagnostics(&state).await)
}

/// Records a frontend diagnostic line in the local app-private diagnostics log.
///
/// # Errors
///
/// Returns an error string if the diagnostic log cannot be written.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn record_frontend_diagnostic(
    state: State<'_, AppState>,
    message: String,
) -> Result<(), String> {
    let path = telemetry::diagnostics_dir(&state.data_dir).join(FRONTEND_LOG_FILE_NAME);
    append_diagnostic_line(&path, &sanitize_frontend_message(&message))
        .map_err(|error| error.to_string())
}

/// Collects redacted local diagnostics for Android and desktop support reports.
///
/// # Errors
///
/// Returns an error string if application state cannot be read.
#[tauri::command]
pub async fn collect_diagnostic_bundle(
    state: State<'_, AppState>,
) -> Result<DiagnosticBundle, String> {
    let diagnostics = build_network_diagnostics(&state).await;
    let platform = crate::commands::platform::current_platform_profile();
    let settings = state.settings.snapshot().await;
    let diagnostics_dir = telemetry::diagnostics_dir(&state.data_dir);
    let generated_at_unix = unix_timestamp();

    let mut report = format!(
        "\
Lightning P2P diagnostic bundle
Generated: {generated_at_unix}
App version: {app_version}
Platform: {platform_kind:?}
Runtime family: {runtime_family:?}
Target OS: {target_os}
Release support: {release_support:?}
Transfer engine: {transfer_engine}
Online handoff model: {online_handoff_model}
Storage model: {storage_model:?}
Background transfer: {background_transfer}
Browser transfer: {browser_transfer}
Node ID: {node_id}
Online state: {online_state:?}
Relay mode: {relay_mode:?}
Relay connected: {relay_connected}
Relay URL: {relay_url}
Direct address count: {direct_address_count}
LAN discovery enabled: {local_discovery_enabled}
LAN discovery active: {lan_discovery_active}
Bluetooth discovery enabled: {bluetooth_discovery_enabled}
Download folder status: {download_status}
Download folder writable: {download_writable}
Latest route kind: {latest_route_kind:?}

== Rust log tail ==
{rust_log}

== Android log tail ==
{android_log}

== Frontend log tail ==
{frontend_log}
",
        app_version = diagnostics.app_version,
        platform_kind = platform.platform_kind,
        runtime_family = platform.runtime_family,
        target_os = platform.target_os,
        release_support = platform.release_support,
        transfer_engine = platform.transfer_engine,
        online_handoff_model = platform.online_handoff_model,
        storage_model = platform.storage_model,
        background_transfer = bool_label(platform.capabilities.background_transfer),
        browser_transfer = bool_label(platform.capabilities.browser_transfer),
        node_id = diagnostics.node_id.as_deref().unwrap_or("not ready"),
        online_state = diagnostics.online_state,
        relay_mode = diagnostics.relay_mode,
        relay_connected = bool_label(diagnostics.relay_connected),
        relay_url = diagnostics.relay_url.as_deref().unwrap_or("none"),
        direct_address_count = diagnostics.direct_address_count,
        local_discovery_enabled = bool_label(diagnostics.local_discovery_enabled),
        lan_discovery_active = bool_label(diagnostics.lan_discovery_active),
        bluetooth_discovery_enabled = bool_label(diagnostics.bluetooth_discovery_enabled),
        download_status = diagnostics.download_dir_status.status,
        download_writable = bool_label(diagnostics.download_dir_status.writable),
        latest_route_kind = diagnostics.latest_route_kind,
        rust_log = read_recent_log(&telemetry::rust_log_path(&state.data_dir), RECENT_LOG_LINES),
        android_log = read_recent_log(
            &diagnostics_dir.join(ANDROID_LOG_FILE_NAME),
            RECENT_LOG_LINES,
        ),
        frontend_log = read_recent_log(
            &diagnostics_dir.join(FRONTEND_LOG_FILE_NAME),
            RECENT_LOG_LINES,
        ),
    );

    report = redact_known_path(report, &state.data_dir, "[app-data]");
    report = redact_known_path(report, &settings.download_dir, "[download-dir]");

    Ok(DiagnosticBundle {
        generated_at_unix,
        report,
    })
}

async fn build_network_diagnostics(state: &AppState) -> NetworkDiagnostics {
    let settings = state.settings.snapshot().await;
    let status = match state.node.read().await.as_ref() {
        Some(node) => node.runtime_status(),
        None => state.node_runtime.read().await.clone(),
    };
    let latest_route_kind = state
        .transfers
        .list()
        .await
        .into_iter()
        .rev()
        .find(|transfer| transfer.route_kind != RouteKind::Unknown)
        .map_or(RouteKind::Unknown, |transfer| transfer.route_kind);

    NetworkDiagnostics {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        node_id: status.node_id,
        online: status.online,
        online_state: status.online_state,
        relay_mode: settings.relay_mode,
        relay_connected: status.relay_connected,
        relay_url: status.relay_url,
        direct_address_count: status.direct_address_count,
        lan_discovery_active: status.lan_discovery_active,
        local_discovery_enabled: settings.local_discovery_enabled,
        bluetooth_discovery_enabled: settings.bluetooth_discovery_enabled,
        download_dir_status: inspect_download_dir(&settings.download_dir),
        latest_route_kind,
    }
}

fn inspect_download_dir(path: &Path) -> DownloadDirectoryDiagnostics {
    let exists = path.exists();
    let is_dir = path.is_dir();
    if !exists {
        return DownloadDirectoryDiagnostics {
            exists,
            is_dir,
            writable: false,
            status: "missing".into(),
        };
    }
    if !is_dir {
        return DownloadDirectoryDiagnostics {
            exists,
            is_dir,
            writable: false,
            status: "not_a_folder".into(),
        };
    }

    match write_probe(path) {
        Ok(()) => DownloadDirectoryDiagnostics {
            exists,
            is_dir,
            writable: true,
            status: "ready".into(),
        },
        Err(message) => DownloadDirectoryDiagnostics {
            exists,
            is_dir,
            writable: false,
            status: message,
        },
    }
}

fn write_probe(path: &Path) -> Result<(), String> {
    let probe_path = path.join(format!(".lightning-p2p-diagnostics-{}", unix_timestamp()));
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe_path)
        .map_err(|error| format!("not_writable: {error}"))?;
    drop(file);
    let _ = std::fs::remove_file(probe_path);
    Ok(())
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

fn append_diagnostic_line(path: &Path, message: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(file, "{} {message}", unix_timestamp())?;
    Ok(())
}

fn sanitize_frontend_message(message: &str) -> String {
    let sanitized = message.replace('\0', "");
    if sanitized.len() <= MAX_FRONTEND_MESSAGE_BYTES {
        return sanitized;
    }

    let mut end = 0;
    for (index, _) in sanitized.char_indices() {
        if index > MAX_FRONTEND_MESSAGE_BYTES {
            break;
        }
        end = index;
    }
    format!("{}...[truncated]", &sanitized[..end])
}

fn read_recent_log(path: &Path, max_lines: usize) -> String {
    match std::fs::read_to_string(path) {
        Ok(contents) => {
            let lines = contents.lines().collect::<Vec<_>>();
            let start = lines.len().saturating_sub(max_lines);
            lines[start..].join("\n")
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => "[not found]".into(),
        Err(error) => format!("[unreadable: {error}]"),
    }
}

fn redact_known_path(report: String, path: &Path, replacement: &str) -> String {
    let path_text = path.to_string_lossy();
    if path_text.is_empty() {
        report
    } else {
        report.replace(path_text.as_ref(), replacement)
    }
}

fn bool_label(value: bool) -> &'static str {
    if value {
        "yes"
    } else {
        "no"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_download_dir_is_reported_without_path() {
        let dir = tempfile::tempdir().expect("tempdir");
        let missing = dir.path().join("missing");
        let status = inspect_download_dir(&missing);
        assert_eq!(status.status, "missing");
        assert!(!status.writable);
    }

    #[test]
    fn writable_download_dir_is_ready() {
        let dir = tempfile::tempdir().expect("tempdir");
        let status = inspect_download_dir(dir.path());
        assert_eq!(status.status, "ready");
        assert!(status.writable);
    }
}
