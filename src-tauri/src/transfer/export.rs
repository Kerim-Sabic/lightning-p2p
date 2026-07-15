//! Export helpers for downloaded blobs and collections.

pub(crate) use super::destination::preflight_destination;
use super::destination::{
    ensure_enough_space, next_available_path, safe_collection_label, staging_dir_name,
};
use crate::error::{LightningP2PError, Result};
use iroh_blobs::rpc::client::blobs::{BlobStatus, MemClient};
use iroh_blobs::store::{ExportFormat, ExportMode};
use iroh_blobs::ticket::BlobTicket;
use iroh_blobs::Hash;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

#[cfg(target_os = "android")]
use super::mime::bucket_for;
#[cfg(target_os = "android")]
use crate::commands::mobile::android as android_bridge;

/// Result of exporting verified downloaded content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportSummary {
    /// User-visible label for the exported content.
    pub label: String,
    /// Total exported bytes.
    pub size: u64,
    /// Final output path written by the export stage.
    pub output_path: PathBuf,
}

/// Exports a downloaded ticket to the destination directory.
///
/// When `known_size` is provided the expensive per-blob size query is skipped.
/// Existing files are never overwritten; conflicting outputs receive a safe
/// numeric suffix.
///
/// # Errors
///
/// Returns `LightningP2PError` if the ticket cannot be exported to disk.
pub async fn export_ticket(
    client: &MemClient,
    ticket: &BlobTicket,
    destination: &Path,
    known_size: Option<u64>,
) -> Result<ExportSummary> {
    preflight_destination(destination)?;
    let label = resolve_label(client, ticket).await?;
    let size = match known_size {
        Some(size) if size > 0 => size,
        _ => ticket_size(client, ticket).await?,
    };
    ensure_enough_space(destination, size)?;
    let output_path = if ticket.recursive() {
        export_collection(client, ticket, destination, &label).await?
    } else {
        export_blob(client, ticket, destination).await?
    };

    let output_path = publish_to_public_storage(output_path, ticket.recursive()).await;

    Ok(ExportSummary {
        label,
        size,
        output_path,
    })
}

/// On Android, move a single-file export from app-private staging into the
/// public `MediaStore` collection that matches its MIME bucket. The original
/// staged file is deleted on successful publish. Returns a synthetic
/// `Pictures/Lightning P2P/foo.jpg` descriptor path for UI display.
///
/// Folder transfers stay in app-private staging in v0.4.6; per-file publish
/// for folders lands in a follow-up release.
///
/// On non-Android targets this is an identity pass-through.
#[cfg(target_os = "android")]
async fn publish_to_public_storage(staged_path: PathBuf, recursive: bool) -> PathBuf {
    if recursive {
        tracing::info!(
            path = %staged_path.display(),
            "folder transfer kept in app-private staging; per-file publish lands in v0.4.7"
        );
        return staged_path;
    }

    let file_name = match staged_path.file_name().and_then(|n| n.to_str()) {
        Some(name) if !name.is_empty() => name.to_string(),
        _ => {
            tracing::warn!(
                path = %staged_path.display(),
                "received file has no usable name; keeping app-private"
            );
            return staged_path;
        }
    };

    let bucket = bucket_for(&file_name);
    let mime_str = mime_guess::from_path(&file_name)
        .first_or_octet_stream()
        .to_string();
    let bucket_id = bucket.as_kotlin_id();
    let staged_path_str = staged_path.to_string_lossy().into_owned();

    let publish_result = {
        let filename_owned = file_name.clone();
        let mime_owned = mime_str.clone();
        tokio::task::spawn_blocking(move || {
            android_bridge::publish_to_mediastore(
                &staged_path_str,
                &filename_owned,
                &mime_owned,
                bucket_id,
            )
        })
        .await
    };

    match publish_result {
        Ok(Ok(_uri)) => {
            if let Err(error) = tokio::fs::remove_file(&staged_path).await {
                tracing::warn!(%error, path = %staged_path.display(), "could not remove staged file after MediaStore publish");
            }
            PathBuf::from(format!("{bucket_id}/Lightning P2P/{file_name}"))
        }
        Ok(Err(error)) => {
            tracing::warn!(%error, "MediaStore publish failed");
            staged_path
        }
        Err(join_error) => {
            tracing::warn!(%join_error, "MediaStore publish failed");
            staged_path
        }
    }
}

#[cfg(not(target_os = "android"))]
#[allow(clippy::unused_async)] // mirrors the Android-side async signature
async fn publish_to_public_storage(staged_path: PathBuf, _recursive: bool) -> PathBuf {
    staged_path
}

/// Resolves the user-visible label for a downloaded ticket.
///
/// # Errors
///
/// Returns `LightningP2PError` if collection metadata cannot be read.
pub async fn resolve_label(client: &MemClient, ticket: &BlobTicket) -> Result<String> {
    if !ticket.recursive() {
        return Ok(ticket.hash().to_string());
    }

    let collection = client
        .get_collection(ticket.hash())
        .await
        .map_err(|error| blob_error(&error))?;
    Ok(summarize_names(
        collection.iter().map(|(name, _hash)| name.as_str()),
    ))
}

async fn export_blob(
    client: &MemClient,
    ticket: &BlobTicket,
    destination: &Path,
) -> Result<PathBuf> {
    // Write to a `.part` sibling first, then rename onto the final name. A
    // crash mid-write leaves a clearly partial `.part` file in the destination
    // and never a half-written file at the final name. The `.part` is created
    // in the same directory as the final file so the rename is intra-filesystem
    // and remains atomic. `next_available_path` runs against the FINAL name so
    // we don't collide with an existing user file.
    let output_path = next_available_path(&destination.join(ticket.hash().to_string()));
    let temp_path = part_path_for(&output_path);

    let export_result = async {
        client
            .export(
                ticket.hash(),
                temp_path.clone(),
                ExportFormat::Blob,
                ExportMode::TryReference,
            )
            .await
            .map_err(|error| blob_error(&error))?
            .finish()
            .await
            .map_err(|error| blob_error(&error))
    }
    .await;

    if let Err(error) = export_result {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(error);
    }

    if let Err(error) = tokio::fs::rename(&temp_path, &output_path).await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(LightningP2PError::from(error));
    }
    Ok(output_path)
}

/// Returns a sibling `.part` path next to `final_path`. Used as the temp name
/// for atomic-write semantics on single-blob exports.
fn part_path_for(final_path: &Path) -> PathBuf {
    let mut name = final_path
        .file_name()
        .map(std::ffi::OsStr::to_os_string)
        .unwrap_or_default();
    name.push(".part");
    final_path.with_file_name(name)
}

async fn export_collection(
    client: &MemClient,
    ticket: &BlobTicket,
    destination: &Path,
    label: &str,
) -> Result<PathBuf> {
    let staging_dir = next_available_path(&destination.join(staging_dir_name(ticket.hash())));
    tokio::fs::create_dir_all(&staging_dir).await?;

    let export_result = async {
        client
            .export(
                ticket.hash(),
                staging_dir.clone(),
                ExportFormat::Collection,
                ExportMode::TryReference,
            )
            .await
            .map_err(|error| blob_error(&error))?
            .finish()
            .await
            .map_err(|error| blob_error(&error))
    }
    .await;

    if let Err(error) = export_result {
        let _ = tokio::fs::remove_dir_all(&staging_dir).await;
        return Err(error);
    }

    move_staged_collection(&staging_dir, destination, label).await
}

fn summarize_names<'a>(names: impl Iterator<Item = &'a str>) -> String {
    let mut roots = names
        .filter_map(|name| name.split('/').next())
        .map(str::to_string)
        .collect::<Vec<_>>();
    roots.sort();
    roots.dedup();
    match roots.as_slice() {
        [single] => single.clone(),
        [] => "download".into(),
        _ => format!("{} items", roots.len()),
    }
}

async fn ticket_size(client: &MemClient, ticket: &BlobTicket) -> Result<u64> {
    if !ticket.recursive() {
        return blob_size(client, ticket.hash()).await;
    }

    let collection = client
        .get_collection(ticket.hash())
        .await
        .map_err(|error| blob_error(&error))?;
    let mut total = 0u64;
    for (_name, hash) in collection.iter() {
        total += blob_size(client, *hash).await?;
    }
    Ok(total)
}

async fn move_staged_collection(
    staging_dir: &Path,
    destination: &Path,
    label: &str,
) -> Result<PathBuf> {
    let entries = read_dir_entries(staging_dir).await?;
    if entries.len() == 1 {
        let source = entries
            .into_iter()
            .next()
            .ok_or_else(|| LightningP2PError::Other("Export staging directory is empty".into()))?;
        let file_name = source
            .file_name()
            .map(OsString::from)
            .ok_or_else(|| LightningP2PError::Other("Export output has no filename".into()))?;
        let target = next_available_path(&destination.join(file_name));
        tokio::fs::rename(&source, &target).await?;
        let _ = tokio::fs::remove_dir(staging_dir).await;
        return Ok(target);
    }

    let target = next_available_path(&destination.join(safe_collection_label(label)));
    tokio::fs::rename(staging_dir, &target).await?;
    Ok(target)
}

async fn read_dir_entries(path: &Path) -> Result<Vec<PathBuf>> {
    let mut entries = Vec::new();
    let mut read_dir = tokio::fs::read_dir(path).await?;
    while let Some(entry) = read_dir.next_entry().await? {
        entries.push(entry.path());
    }
    entries.sort();
    Ok(entries)
}

async fn blob_size(client: &MemClient, hash: Hash) -> Result<u64> {
    match client
        .status(hash)
        .await
        .map_err(|error| blob_error(&error))?
    {
        BlobStatus::Complete { size } => Ok(size),
        BlobStatus::Partial { size } => Ok(size.value()),
        BlobStatus::NotFound => Err(LightningP2PError::Blob(format!("Missing blob {hash}"))),
    }
}

fn blob_error(err: &impl ToString) -> LightningP2PError {
    LightningP2PError::Blob(err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarize_names_uses_common_root() {
        let label = summarize_names(["folder/a.txt", "folder/b.txt"].into_iter());
        assert_eq!(label, "folder");
    }

    #[test]
    fn summarize_names_handles_empty_collection() {
        let label = summarize_names([].into_iter());
        assert_eq!(label, "download");
    }

    #[test]
    fn part_path_appends_part_suffix_in_same_directory() {
        let final_path = PathBuf::from("/tmp/downloads/report.pdf");
        let temp = part_path_for(&final_path);
        assert_eq!(temp.parent(), final_path.parent());
        assert_eq!(temp.file_name().unwrap(), "report.pdf.part");
    }

    #[test]
    fn part_path_handles_extensionless_names() {
        let final_path = PathBuf::from("/tmp/downloads/raw_hash_value");
        let temp = part_path_for(&final_path);
        assert_eq!(temp.file_name().unwrap(), "raw_hash_value.part");
    }
}
