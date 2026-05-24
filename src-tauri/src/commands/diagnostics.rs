//! Commands for privacy-safe runtime diagnostics.

use crate::commands::platform::PlatformProfile;
use crate::node::{NodeOnlineState, NodeSupervisorStatus};
use crate::storage::settings::RelayModeSetting;
use crate::telemetry;
use crate::transfer::metrics::RouteKind;
use crate::transfer::progress::{TransferInfo, TransferPhase};
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
    /// Current supervised node lifecycle state.
    pub node_supervisor: NodeSupervisorStatus,
    /// Bluetooth LE discovery status for the current runtime.
    pub ble_status: BleDiscoveryStatus,
}

/// A local-only diagnostic bundle users can paste into support reports.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DiagnosticBundle {
    /// Unix timestamp when the bundle was generated.
    pub generated_at_unix: u64,
    /// Redacted plain-text report.
    pub report: String,
}

/// Bluetooth LE runtime permission state.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BlePermissionState {
    /// This runtime does not support Bluetooth LE discovery.
    Unsupported,
    /// Runtime permission has not been requested by this build.
    NotRequested,
    /// Runtime permission is granted.
    Granted,
    /// Runtime permission is denied.
    Denied,
    /// Runtime permission state cannot be inspected from this layer.
    Unknown,
}

/// Bluetooth adapter state visible to the Rust diagnostics layer.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BleAdapterState {
    /// This runtime does not support Bluetooth LE discovery.
    Unsupported,
    /// Adapter state cannot be inspected from this layer.
    Unknown,
    /// Bluetooth adapter is unavailable.
    Unavailable,
    /// Bluetooth adapter is available.
    Available,
}

/// Current experimental Bluetooth LE discovery status.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[allow(clippy::struct_excessive_bools)]
pub struct BleDiscoveryStatus {
    /// Whether this compiled runtime can support Bluetooth LE plumbing.
    pub supported: bool,
    /// Whether the user-enabled setting is on.
    pub enabled: bool,
    /// Runtime permission state.
    pub permission_state: BlePermissionState,
    /// Bluetooth adapter state.
    pub adapter_state: BleAdapterState,
    /// Whether BLE scanning is currently running.
    pub scanning: bool,
    /// Whether BLE advertising is currently running.
    pub advertising: bool,
    /// Last user-actionable BLE error, if any.
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
struct TransferDiagnostic {
    transfer_id: String,
    found: bool,
    direction: Option<String>,
    name: Option<String>,
    peer: Option<String>,
    bytes: u64,
    total: u64,
    route_kind: RouteKind,
    phase: TransferPhase,
    failure_category: Option<String>,
    connect_ms: u64,
    download_ms: u64,
    export_ms: u64,
    note: Option<String>,
}

struct DiagnosticReportParts<'a> {
    generated_at_unix: u64,
    diagnostics: &'a NetworkDiagnostics,
    platform: PlatformProfile,
    transfer_context: String,
    rust_log: String,
    android_log: String,
    frontend_log: String,
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

/// Returns experimental Bluetooth LE discovery status.
///
/// # Errors
///
/// Returns an error string if application state cannot be read.
#[tauri::command]
pub async fn get_ble_discovery_status(
    state: State<'_, AppState>,
) -> Result<BleDiscoveryStatus, String> {
    Ok(build_ble_status(&state).await)
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
    transfer_id: Option<String>,
) -> Result<DiagnosticBundle, String> {
    let diagnostics = build_network_diagnostics(&state).await;
    let platform = crate::commands::platform::current_platform_profile();
    let settings = state.settings.snapshot().await;
    let diagnostics_dir = telemetry::diagnostics_dir(&state.data_dir);
    let generated_at_unix = unix_timestamp();
    let transfer = build_transfer_diagnostic(&state, transfer_id.as_deref()).await;
    let report_parts = DiagnosticReportParts {
        generated_at_unix,
        diagnostics: &diagnostics,
        platform,
        transfer_context: format_transfer_diagnostic(&transfer),
        rust_log: read_recent_log(&telemetry::rust_log_path(&state.data_dir), RECENT_LOG_LINES),
        android_log: read_recent_log(
            &diagnostics_dir.join(ANDROID_LOG_FILE_NAME),
            RECENT_LOG_LINES,
        ),
        frontend_log: read_recent_log(
            &diagnostics_dir.join(FRONTEND_LOG_FILE_NAME),
            RECENT_LOG_LINES,
        ),
    };
    let mut report = format_diagnostic_report(&report_parts);

    report = redact_known_path(report, &state.data_dir, "[app-data]");
    report = redact_known_path(report, &settings.download_dir, "[download-dir]");
    report = redact_home_path(report);
    report = redact_for_diagnostics(&report);

    Ok(DiagnosticBundle {
        generated_at_unix,
        report,
    })
}

fn format_diagnostic_report(parts: &DiagnosticReportParts<'_>) -> String {
    let diagnostics = parts.diagnostics;
    let platform = parts.platform;
    format!(
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
BLE supported: {ble_supported}
BLE permission: {ble_permission:?}
BLE adapter: {ble_adapter:?}
BLE scanning: {ble_scanning}
BLE advertising: {ble_advertising}
BLE last error: {ble_last_error}
Node supervisor phase: {node_supervisor_phase:?}
Node supervisor reason: {node_supervisor_reason}
Node supervisor error: {node_supervisor_error}
Download folder status: {download_status}
Download folder writable: {download_writable}
Latest route kind: {latest_route_kind:?}

== Transfer context ==
{transfer_context}

== Rust log tail ==
{rust_log}

== Android log tail ==
{android_log}

== Frontend log tail ==
{frontend_log}
",
        generated_at_unix = parts.generated_at_unix,
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
        ble_supported = bool_label(diagnostics.ble_status.supported),
        ble_permission = diagnostics.ble_status.permission_state,
        ble_adapter = diagnostics.ble_status.adapter_state,
        ble_scanning = bool_label(diagnostics.ble_status.scanning),
        ble_advertising = bool_label(diagnostics.ble_status.advertising),
        ble_last_error = diagnostics
            .ble_status
            .last_error
            .as_deref()
            .unwrap_or("none"),
        node_supervisor_phase = diagnostics.node_supervisor.phase,
        node_supervisor_reason = diagnostics
            .node_supervisor
            .last_reason
            .as_deref()
            .unwrap_or("none"),
        node_supervisor_error = diagnostics
            .node_supervisor
            .last_error
            .as_deref()
            .unwrap_or("none"),
        download_status = diagnostics.download_dir_status.status,
        download_writable = bool_label(diagnostics.download_dir_status.writable),
        latest_route_kind = diagnostics.latest_route_kind,
        transfer_context = parts.transfer_context,
        rust_log = parts.rust_log,
        android_log = parts.android_log,
        frontend_log = parts.frontend_log,
    )
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
        node_supervisor: state.node_supervisor.status().await,
        ble_status: build_ble_status(state).await,
    }
}

async fn build_ble_status(state: &AppState) -> BleDiscoveryStatus {
    let enabled = state.settings.snapshot().await.bluetooth_discovery_enabled;
    let supported = cfg!(target_os = "android");
    let last_error = if supported && enabled {
        Some(
            "BLE scanner/advertiser is experimental and currently limited to no-crash status plumbing in this build."
                .into(),
        )
    } else if supported {
        None
    } else {
        Some("BLE discovery is supported only by the Android runtime plan.".into())
    };

    BleDiscoveryStatus {
        supported,
        enabled,
        permission_state: if supported {
            BlePermissionState::Unknown
        } else {
            BlePermissionState::Unsupported
        },
        adapter_state: if supported {
            BleAdapterState::Unknown
        } else {
            BleAdapterState::Unsupported
        },
        scanning: false,
        advertising: false,
        last_error,
    }
}

async fn build_transfer_diagnostic(
    state: &AppState,
    transfer_id: Option<&str>,
) -> TransferDiagnostic {
    if let Some(transfer_id) = transfer_id {
        return state.transfers.get(transfer_id).await.map_or_else(
            || TransferDiagnostic {
                transfer_id: transfer_id.to_string(),
                found: false,
                direction: None,
                name: None,
                peer: None,
                bytes: 0,
                total: 0,
                route_kind: RouteKind::Unknown,
                phase: TransferPhase::Failed,
                failure_category: None,
                connect_ms: 0,
                download_ms: 0,
                export_ms: 0,
                note: Some(
                    "Transfer is not active in the in-memory queue. Check persisted history and log tail."
                        .into(),
                ),
            },
            |transfer| transfer_diagnostic_from_info(transfer, Some("active transfer".into())),
        );
    }

    let active = state.transfers.list().await;
    if let Some(transfer) = active.last().cloned() {
        return transfer_diagnostic_from_info(transfer, Some("latest active transfer".into()));
    }

    TransferDiagnostic {
        transfer_id: "none".into(),
        found: false,
        direction: None,
        name: None,
        peer: None,
        bytes: 0,
        total: 0,
        route_kind: RouteKind::Unknown,
        phase: TransferPhase::Completed,
        failure_category: None,
        connect_ms: 0,
        download_ms: 0,
        export_ms: 0,
        note: Some("No active transfer at collection time.".into()),
    }
}

fn transfer_diagnostic_from_info(
    transfer: TransferInfo,
    note: Option<String>,
) -> TransferDiagnostic {
    TransferDiagnostic {
        transfer_id: transfer.transfer_id,
        found: true,
        direction: Some(format!("{:?}", transfer.direction)),
        name: Some(transfer.name),
        peer: transfer.peer,
        bytes: transfer.bytes,
        total: transfer.total,
        route_kind: transfer.route_kind,
        phase: transfer.phase,
        failure_category: transfer
            .failure_category
            .map(|category| format!("{category:?}")),
        connect_ms: transfer.connect_ms,
        download_ms: transfer.download_ms,
        export_ms: transfer.export_ms,
        note,
    }
}

fn format_transfer_diagnostic(transfer: &TransferDiagnostic) -> String {
    format!(
        "\
Transfer ID: {transfer_id}
Found active: {found}
Direction: {direction}
Name: {name}
Peer: {peer}
Bytes: {bytes}
Total: {total}
Route: {route_kind:?}
Phase: {phase:?}
Failure category: {failure_category}
Connect ms: {connect_ms}
Download ms: {download_ms}
Export ms: {export_ms}
Note: {note}
",
        transfer_id = transfer.transfer_id,
        found = bool_label(transfer.found),
        direction = transfer.direction.as_deref().unwrap_or("n/a"),
        name = transfer.name.as_deref().unwrap_or("n/a"),
        peer = transfer.peer.as_deref().unwrap_or("n/a"),
        bytes = transfer.bytes,
        total = transfer.total,
        route_kind = transfer.route_kind,
        phase = transfer.phase,
        failure_category = transfer.failure_category.as_deref().unwrap_or("none"),
        connect_ms = transfer.connect_ms,
        download_ms = transfer.download_ms,
        export_ms = transfer.export_ms,
        note = transfer.note.as_deref().unwrap_or("none"),
    )
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

pub(crate) fn redact_for_diagnostics(input: &str) -> String {
    redact_sensitive_text(input)
}

fn sanitize_frontend_message(message: &str) -> String {
    let sanitized = redact_sensitive_text(&message.replace('\0', ""));
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
            redact_sensitive_text(&lines[start..].join("\n"))
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

fn redact_home_path(report: String) -> String {
    if let Some(home) = dirs::home_dir() {
        redact_known_path(report, &home, "[home]")
    } else {
        report
    }
}

fn redact_sensitive_text(input: &str) -> String {
    input
        .split_inclusive(char::is_whitespace)
        .map(redact_sensitive_segment)
        .collect()
}

fn redact_sensitive_segment(segment: &str) -> String {
    let token = segment
        .trim_matches(char::is_whitespace)
        .trim_matches(|character: char| {
            character.is_ascii_punctuation()
                && character != ':'
                && character != '_'
                && character != '-'
        });
    if token.is_empty() || !is_ticket_like(token) {
        if should_redact_receive_link(token) {
            return segment.replacen(token, "[redacted-receive-link]", 1);
        }
        return segment.to_string();
    }
    segment.replacen(token, "[redacted-ticket]", 1)
}

fn should_redact_receive_link(token: &str) -> bool {
    let normalized = token.to_ascii_lowercase();
    if normalized.starts_with("lightning-p2p://receive") {
        return true;
    }
    if normalized.contains("/receive#t=")
        || normalized.contains("/receive?t=")
        || normalized.contains("/receive&ticket=")
        || normalized.contains("?ticket=")
        || normalized.contains("&ticket=")
    {
        return true;
    }
    (normalized.contains("?t=") || normalized.contains("&t="))
        && (normalized.starts_with("http://")
            || normalized.starts_with("https://")
            || normalized.contains("fd2:")
            || normalized.contains("blob"))
}

fn is_ticket_like(token: &str) -> bool {
    if let Some(payload) = token.strip_prefix("fd2:") {
        return payload.len() >= 24
            && payload.chars().all(|character| {
                character.is_ascii_alphanumeric() || character == '-' || character == '_'
            });
    }

    token.len() > 24
        && token.starts_with("blob")
        && token
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
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

    #[test]
    fn frontend_diagnostics_redact_ticket_like_tokens() {
        let message = "receive failed for fd2:abcdefghijklmnopqrstuvwxyzABCDEF and blobabc123abc123abc123abc123abc";
        let sanitized = sanitize_frontend_message(message);
        assert!(!sanitized.contains("fd2:abcdefghijklmnopqrstuvwxyzABCDEF"));
        assert!(!sanitized.contains("blobabc123abc123abc123abc123abc"));
        assert_eq!(sanitized.matches("[redacted-ticket]").count(), 2);
    }

    #[test]
    fn receive_links_are_redacted_from_diagnostics() {
        let message = "open https://lightning-p2p.netlify.app/receive#t=fd2:abcdefghijklmnopqrstuvwxyzABCDEF now";
        let sanitized = redact_for_diagnostics(message);
        assert!(!sanitized.contains("fd2:abcdefghijklmnopqrstuvwxyzABCDEF"));
        assert!(sanitized.contains("[redacted-receive-link]"));
    }

    #[test]
    fn deep_receive_links_are_redacted_from_diagnostics() {
        let message = "deep lightning-p2p://receive?t=blobabc123abc123abc123abc123abc";
        let sanitized = redact_for_diagnostics(message);
        assert!(!sanitized.contains("blobabc123abc123abc123abc123abc"));
        assert!(sanitized.contains("[redacted-receive-link]"));
    }

    #[test]
    fn query_ticket_params_are_redacted_from_diagnostics() {
        let message = concat!(
            "links ",
            "https://lightning-p2p.netlify.app/receive?t=fd2:abcdefghijklmnopqrstuvwxyzABCDEF ",
            "https://lightning-p2p.netlify.app/receive?ticket=blobabc123abc123abc123abc123abc ",
            "https://example.test/path?ticket=fd2:ZYXWVUTSRQPONMLKJIHGFEDCBA"
        );
        let sanitized = redact_for_diagnostics(message);

        assert!(!sanitized.contains("fd2:abcdefghijklmnopqrstuvwxyzABCDEF"));
        assert!(!sanitized.contains("blobabc123abc123abc123abc123abc"));
        assert!(!sanitized.contains("fd2:ZYXWVUTSRQPONMLKJIHGFEDCBA"));
        assert_eq!(sanitized.matches("[redacted-receive-link]").count(), 3);
    }

    #[test]
    fn redaction_preserves_non_ticket_words() {
        let message = "route blob is still warming and fd2:short is not a ticket";
        assert_eq!(redact_sensitive_text(message), message);
    }

    #[test]
    fn known_paths_are_redacted_from_report() {
        let dir = tempfile::tempdir().expect("tempdir");
        let nested = dir.path().join("Downloads").join("Lightning P2P");
        let report = format!("Download folder: {}", nested.display());
        let redacted = redact_known_path(report, dir.path(), "[app-data]");
        assert!(!redacted.contains(&dir.path().to_string_lossy().to_string()));
        assert!(redacted.contains("[app-data]"));
    }

    #[test]
    fn known_paths_and_tickets_are_redacted_together() {
        let dir = tempfile::tempdir().expect("tempdir");
        let download_dir = dir.path().join("Downloads");
        let ticket = "fd2:abcdefghijklmnopqrstuvwxyzABCDEF";
        let report = format!(
            "Download folder: {} failed for {ticket}",
            download_dir.display()
        );
        let redacted =
            redact_for_diagnostics(&redact_known_path(report, &download_dir, "[download-dir]"));

        assert!(!redacted.contains(&download_dir.to_string_lossy().to_string()));
        assert!(!redacted.contains(ticket));
        assert!(redacted.contains("[download-dir]"));
        assert!(redacted.contains("[redacted-ticket]"));
    }

    #[test]
    fn windows_style_private_paths_are_redacted() {
        let private_root = Path::new("C:\\Users\\Kerim");
        let report = "Path: C:\\Users\\Kerim\\Downloads\\payload.bin".to_string();
        let redacted = redact_known_path(report, private_root, "[home]");
        assert!(!redacted.contains("C:\\Users\\Kerim"));
        assert!(redacted.contains("[home]"));
    }

    #[test]
    fn unicode_whitespace_separators_still_split_segments() {
        let nbsp = '\u{00A0}';
        let message = format!(
            "first fd2:abcdefghijklmnopqrstuvwxyzABCDEF{nbsp}second blobabc123abc123abc123abc123abc"
        );
        let sanitized = redact_for_diagnostics(&message);

        assert!(!sanitized.contains("fd2:abcdefghijklmnopqrstuvwxyzABCDEF"));
        assert!(!sanitized.contains("blobabc123abc123abc123abc123abc"));
        assert_eq!(sanitized.matches("[redacted-ticket]").count(), 2);
    }

    #[test]
    fn tickets_surrounded_by_punctuation_are_redacted() {
        let ticket = "fd2:abcdefghijklmnopqrstuvwxyzABCDEF";
        let message = format!("see ({ticket}) then {ticket}. and {ticket}! plus {ticket},");

        let sanitized = redact_for_diagnostics(&message);

        assert!(!sanitized.contains(ticket));
        assert_eq!(sanitized.matches("[redacted-ticket]").count(), 4);
    }

    #[test]
    fn mixed_legacy_and_fd2_tickets_in_one_line_both_redact() {
        let fd2 = "fd2:abcdefghijklmnopqrstuvwxyzABCDEF";
        let legacy = "blobabc123abc123abc123abc123abc";
        let message = format!("share emitted {fd2} then {legacy} during retry");

        let sanitized = redact_for_diagnostics(&message);

        assert!(!sanitized.contains(fd2));
        assert!(!sanitized.contains(legacy));
        assert_eq!(sanitized.matches("[redacted-ticket]").count(), 2);
    }

    #[test]
    fn deep_link_fragment_form_is_redacted_from_diagnostics() {
        let ticket = "fd2:abcdefghijklmnopqrstuvwxyzABCDEF";
        let message = format!("share opened lightning-p2p://receive#t={ticket}");

        let sanitized = redact_for_diagnostics(&message);

        assert!(!sanitized.contains(ticket));
        assert!(sanitized.contains("[redacted-receive-link]"));
    }
}
