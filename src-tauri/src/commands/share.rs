//! Commands for sharing files and regenerating tickets.

use crate::commands::{command_error, CommandResult};
use crate::node::ActiveShare;
use crate::storage::history;
use crate::transfer::ticket::encode_fd2_ticket;
use crate::AppState;
use iroh_blobs::ticket::BlobTicket;
use iroh_blobs::{BlobFormat, Hash};
use qrcode::render::svg;
use qrcode::QrCode;
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::str::FromStr;
use tauri::State;

/// Shareable metadata for a selected local path.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SharePathInfo {
    /// Absolute path on disk.
    pub path: String,
    /// Display name for the path.
    pub name: String,
    /// Total byte size, recursive for directories.
    pub size: u64,
    /// Whether the path is a directory.
    pub is_dir: bool,
}

/// Adds files to the iroh-blobs store and returns a Lightning P2P share ticket.
///
/// # Errors
///
/// Returns an error string if the share cannot be created.
#[tauri::command]
pub async fn create_share(
    window: tauri::Window,
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> CommandResult<String> {
    let node = state.get_node().await.map_err(command_error)?;
    let paths = paths.into_iter().map(PathBuf::from).collect::<Vec<_>>();
    let outcome = crate::transfer::sender::send_files(node.as_ref(), window, paths)
        .await
        .map_err(command_error)?;
    let ticket = encode_fd2_ticket(&outcome.ticket, &outcome.label, outcome.total_size)
        .map_err(command_error)?;
    state
        .nearby_shares
        .publish_share(ActiveShare::new(
            outcome.label,
            outcome.hash,
            BlobFormat::HashSeq,
            outcome.total_size,
        ))
        .await;
    Ok(ticket)
}

/// Returns display metadata for local files or directories before sharing.
///
/// # Errors
///
/// Returns an error string if any path cannot be read.
#[tauri::command]
pub fn describe_share_paths(paths: Vec<String>) -> CommandResult<Vec<SharePathInfo>> {
    paths
        .into_iter()
        .map(|path| describe_path(PathBuf::from(path)).map_err(command_error))
        .collect()
}

/// Regenerates a ticket string for locally stored content.
///
/// # Errors
///
/// Returns an error string if the content is unavailable or the ticket cannot
/// be created.
#[tauri::command]
pub async fn get_ticket(state: State<'_, AppState>, hash: String) -> CommandResult<String> {
    let node = state.get_node().await.map_err(command_error)?;
    let hash = Hash::from_str(&hash).map_err(|err| command_error(err.to_string()))?;
    let exists = node
        .blobs_client()
        .has(hash)
        .await
        .map_err(|err| command_error(err.to_string()))?;
    if !exists {
        return Err(command_error(
            "Shared content is no longer available locally",
        ));
    }

    let node_addr = node.ticket_addr().await.map_err(command_error)?;
    let record =
        history::latest_send_by_hash(node.db(), &hash.to_string()).map_err(command_error)?;
    let ticket = BlobTicket::new(node_addr, hash, BlobFormat::HashSeq)
        .map_err(|err| command_error(err.to_string()))?;
    let label = record
        .as_ref()
        .map_or_else(|| hash.to_string(), |record| record.filename.clone());
    let total_size = record.as_ref().map_or(0, |record| record.size);
    state
        .nearby_shares
        .publish_share(ActiveShare::new(
            label.clone(),
            hash,
            BlobFormat::HashSeq,
            total_size,
        ))
        .await;
    encode_fd2_ticket(&ticket, &label, total_size).map_err(command_error)
}

/// Renders a ticket string as an SVG QR code.
///
/// # Errors
///
/// Returns an error string if the QR code cannot be encoded.
#[tauri::command]
pub fn render_ticket_qr(ticket: String) -> CommandResult<String> {
    let code = QrCode::new(ticket.into_bytes()).map_err(|err| command_error(err.to_string()))?;
    Ok(code
        .render::<svg::Color<'_>>()
        .min_dimensions(256, 256)
        .dark_color(svg::Color("#0F172A"))
        .light_color(svg::Color("#FFFFFF"))
        .build())
}

/// Clears the currently advertised nearby share.
///
/// # Errors
///
/// Returns an error string if the app state cannot be accessed.
#[tauri::command]
pub async fn clear_active_share(state: State<'_, AppState>) -> Result<(), String> {
    state.nearby_shares.clear_active_share().await;
    Ok(())
}

fn describe_path(path: PathBuf) -> crate::error::Result<SharePathInfo> {
    let absolute = fs::canonicalize(path)?;
    let metadata = fs::metadata(&absolute)?;
    Ok(SharePathInfo {
        path: absolute.to_string_lossy().to_string(),
        name: display_name(&absolute),
        size: path_size(&absolute)?,
        is_dir: metadata.is_dir(),
    })
}

fn display_name(path: &Path) -> String {
    path.file_name().map_or_else(
        || path.to_string_lossy().to_string(),
        |name| name.to_string_lossy().to_string(),
    )
}

fn path_size(path: &Path) -> crate::error::Result<u64> {
    let metadata = fs::metadata(path)?;
    if metadata.is_file() {
        return Ok(metadata.len());
    }

    let mut total = 0u64;
    for entry in fs::read_dir(path)? {
        total += path_size(&entry?.path())?;
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qr_svg_contains_svg_tag() {
        let svg = render_ticket_qr("blobexample".into()).expect("qr svg should render");
        assert!(svg.contains("<svg"));
    }

    #[test]
    fn qr_svg_uses_high_contrast_non_transparent_colors() {
        let svg = render_ticket_qr("blobexample".into()).expect("qr svg should render");
        assert!(svg.contains("#0F172A"));
        assert!(svg.contains("#FFFFFF"));
        assert!(!svg.contains("transparent"));
    }

    #[test]
    fn directory_size_counts_nested_files() {
        let temp_dir = tempfile::tempdir().expect("temp dir should exist");
        let nested = temp_dir.path().join("nested");
        fs::create_dir_all(&nested).expect("nested dir should exist");
        fs::write(temp_dir.path().join("a.bin"), [1_u8; 3]).expect("file should write");
        fs::write(nested.join("b.bin"), [2_u8; 5]).expect("file should write");
        let info = describe_path(temp_dir.path().to_path_buf()).expect("path should describe");
        assert_eq!(info.size, 8);
        assert!(info.is_dir);
    }
}
