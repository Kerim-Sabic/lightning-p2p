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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::State;

const MAX_SHARE_SCAN_ID_BYTES: usize = 128;
const MAX_ACTIVE_SHARE_PATH_SCANS: usize = 4;
static SHARE_PATH_SCANS: OnceLock<Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>> =
    OnceLock::new();

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
    let _activity = state.node_supervisor.begin_transfer_activity().await;
    let node = state.get_node().await.map_err(command_error)?;
    let profile = state.settings.snapshot().await.transfer_mode.profile();
    let paths = paths.into_iter().map(PathBuf::from).collect::<Vec<_>>();
    let outcome = crate::transfer::sender::send_files(
        node.as_ref(),
        window,
        paths,
        profile,
        state.transfers.clone(),
    )
    .await
    .map_err(command_error)?;
    node.authorize_public_share(outcome.hash)
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
pub async fn describe_share_paths(
    paths: Vec<String>,
    request_id: String,
) -> CommandResult<Vec<SharePathInfo>> {
    if request_id.is_empty() || request_id.len() > MAX_SHARE_SCAN_ID_BYTES {
        return Err(command_error("Invalid share scan request."));
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    let scans = SHARE_PATH_SCANS.get_or_init(|| Mutex::new(std::collections::HashMap::new()));
    {
        let mut scans = scans
            .lock()
            .map_err(|_| command_error("Share scan state is unavailable."))?;
        if let Some(previous) = scans.get(&request_id) {
            previous.store(true, Ordering::Relaxed);
        } else if scans.len() >= MAX_ACTIVE_SHARE_PATH_SCANS {
            return Err(command_error("Too many share scans are already active."));
        }
        scans.insert(request_id.clone(), cancelled.clone());
    }

    let scan_token = cancelled.clone();
    let task_result = tokio::task::spawn_blocking(move || {
        let mut file_count = 0;
        let mut scanned_entry_count = 0;
        paths
            .into_iter()
            .map(|path| {
                describe_path_with_counts(
                    PathBuf::from(path),
                    &mut file_count,
                    &mut scanned_entry_count,
                    &scan_token,
                )
            })
            .collect::<crate::error::Result<Vec<_>>>()
    })
    .await;
    if let Ok(mut scans) = scans.lock() {
        if scans
            .get(&request_id)
            .is_some_and(|current| Arc::ptr_eq(current, &cancelled))
        {
            scans.remove(&request_id);
        }
    }
    task_result
        .map_err(|error| command_error(error.to_string()))?
        .map_err(command_error)
}

/// Cancels a running share selection scan, if its request is still active.
///
/// # Errors
///
/// Returns an error if the local cancellation registry is unavailable.
#[allow(clippy::needless_pass_by_value)] // Tauri command arguments are owned values.
#[tauri::command]
pub fn cancel_share_path_scan(request_id: String) -> CommandResult<bool> {
    let Some(scans) = SHARE_PATH_SCANS.get() else {
        return Ok(false);
    };
    let scans = scans
        .lock()
        .map_err(|_| command_error("Share scan state is unavailable."))?;
    if let Some(cancelled) = scans.get(&request_id) {
        cancelled.store(true, Ordering::Relaxed);
        Ok(true)
    } else {
        Ok(false)
    }
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

    node.authorize_public_share(hash)
        .await
        .map_err(command_error)?;

    let node_addr = node.ticket_addr().await.map_err(command_error)?;
    let record =
        history::latest_send_by_hash(node.db(), &hash.to_string()).map_err(command_error)?;
    let ticket = BlobTicket::new(node_addr, hash, BlobFormat::HashSeq);
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

#[cfg(test)]
fn describe_path(path: PathBuf) -> crate::error::Result<SharePathInfo> {
    let mut file_count = 0;
    let mut scanned_entry_count = 0;
    describe_path_with_counts(
        path,
        &mut file_count,
        &mut scanned_entry_count,
        &AtomicBool::new(false),
    )
}

fn describe_path_with_counts(
    path: PathBuf,
    file_count: &mut usize,
    scanned_entry_count: &mut usize,
    cancelled: &AtomicBool,
) -> crate::error::Result<SharePathInfo> {
    ensure_share_scan_active(cancelled)?;
    let metadata = fs::symlink_metadata(&path)?;
    if is_reparse_point(&metadata) || !(metadata.is_file() || metadata.is_dir()) {
        return Err(crate::error::LightningP2PError::Other(
            "Selected files cannot be symbolic links or reparse points.".into(),
        ));
    }
    let absolute = fs::canonicalize(path)?;
    let metadata = fs::metadata(&absolute)?;
    Ok(SharePathInfo {
        path: absolute.to_string_lossy().to_string(),
        name: display_name(&absolute),
        size: path_size(&absolute, file_count, scanned_entry_count, cancelled)?,
        is_dir: metadata.is_dir(),
    })
}

fn display_name(path: &Path) -> String {
    path.file_name().map_or_else(
        || path.to_string_lossy().to_string(),
        |name| name.to_string_lossy().to_string(),
    )
}

fn path_size(
    path: &Path,
    file_count: &mut usize,
    scanned_entry_count: &mut usize,
    cancelled: &AtomicBool,
) -> crate::error::Result<u64> {
    ensure_share_scan_active(cancelled)?;
    let metadata = fs::symlink_metadata(path)?;
    if is_reparse_point(&metadata) {
        return Err(crate::error::LightningP2PError::Other(
            "Selected folders cannot contain symbolic links or reparse points.".into(),
        ));
    }
    if metadata.is_file() {
        if *file_count >= crate::transfer::sender::MAX_SHARE_FILES {
            return Err(crate::error::LightningP2PError::Other(format!(
                "A share can contain at most {} files.",
                crate::transfer::sender::MAX_SHARE_FILES
            )));
        }
        *file_count += 1;
        return Ok(metadata.len());
    }

    if !metadata.is_dir() {
        return Err(crate::error::LightningP2PError::Other(
            "Only regular files and folders can be shared.".into(),
        ));
    }

    let mut total = 0u64;
    for entry in fs::read_dir(path)? {
        ensure_share_scan_active(cancelled)?;
        crate::transfer::sender::record_share_scan_entry(scanned_entry_count)?;
        total = total
            .checked_add(path_size(
                &entry?.path(),
                file_count,
                scanned_entry_count,
                cancelled,
            )?)
            .ok_or_else(|| {
                crate::error::LightningP2PError::Other("Selected folder is too large.".into())
            })?;
    }
    Ok(total)
}

fn ensure_share_scan_active(cancelled: &AtomicBool) -> crate::error::Result<()> {
    if cancelled.load(Ordering::Relaxed) {
        Err(crate::error::LightningP2PError::Other(
            "Transfer cancelled".into(),
        ))
    } else {
        Ok(())
    }
}

fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        false
    }
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
    fn cancellation_command_marks_an_active_share_scan() {
        let request_id = format!("test-{}", uuid::Uuid::new_v4());
        let cancelled = Arc::new(AtomicBool::new(false));
        let scans = SHARE_PATH_SCANS.get_or_init(|| Mutex::new(std::collections::HashMap::new()));
        scans
            .lock()
            .expect("scan registry lock")
            .insert(request_id.clone(), cancelled.clone());

        assert!(cancel_share_path_scan(request_id.clone()).expect("cancel command"));
        assert!(cancelled.load(Ordering::Relaxed));
        scans
            .lock()
            .expect("scan registry lock")
            .remove(&request_id);
    }

    #[test]
    fn cancelled_share_scan_stops_before_inspecting_path() {
        let temp_dir = tempfile::tempdir().expect("temp dir should exist");
        let cancelled = AtomicBool::new(true);
        let mut file_count = 0;
        let mut scanned_entry_count = 0;

        let error = describe_path_with_counts(
            temp_dir.path().to_path_buf(),
            &mut file_count,
            &mut scanned_entry_count,
            &cancelled,
        )
        .expect_err("cancelled scan should stop");
        assert_eq!(error.to_string(), "Transfer cancelled");
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

    #[cfg(unix)]
    #[test]
    fn directory_size_rejects_nested_symlinks_without_following_them() {
        use std::os::unix::fs::symlink;

        let temp_dir = tempfile::tempdir().expect("temp dir should exist");
        let root = temp_dir.path().join("root");
        let outside = temp_dir.path().join("outside.bin");
        fs::create_dir(&root).expect("root should be created");
        fs::write(&outside, [1_u8; 7]).expect("file should write");
        symlink(&outside, root.join("linked.bin")).expect("symlink should be created");

        let error = describe_path(root).expect_err("nested symlink must be rejected");
        assert!(error.to_string().contains("symbolic links"));
    }

    #[cfg(unix)]
    #[test]
    fn selected_root_symlink_is_rejected_before_canonicalization() {
        use std::os::unix::fs::symlink;

        let temp_dir = tempfile::tempdir().expect("temp dir should exist");
        let target = temp_dir.path().join("target.bin");
        let link = temp_dir.path().join("link.bin");
        fs::write(&target, [1_u8; 7]).expect("file should write");
        symlink(&target, &link).expect("symlink should be created");

        let error = describe_path(link).expect_err("selected symlink must be rejected");
        assert!(error.to_string().contains("symbolic links"));
    }
}
