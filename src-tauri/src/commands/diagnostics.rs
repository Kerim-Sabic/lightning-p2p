//! Commands for privacy-safe runtime diagnostics.

use crate::node::NodeOnlineState;
use crate::storage::settings::RelayModeSetting;
use crate::transfer::metrics::RouteKind;
use crate::AppState;
use serde::Serialize;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

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
    /// Download directory health without the path.
    pub download_dir_status: DownloadDirectoryDiagnostics,
    /// Latest active transfer route kind, if known.
    pub latest_route_kind: RouteKind,
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

    Ok(NetworkDiagnostics {
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
        download_dir_status: inspect_download_dir(&settings.download_dir),
        latest_route_kind,
    })
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
