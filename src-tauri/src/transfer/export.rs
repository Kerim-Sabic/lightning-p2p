//! Export helpers for downloaded blobs and collections.

pub(crate) use super::destination::preflight_destination;
use super::destination::{
    ensure_enough_space, next_available_path, safe_collection_label, staging_dir_name,
};
use crate::error::{FastDropError, Result};
use iroh_blobs::rpc::client::blobs::{BlobStatus, MemClient};
use iroh_blobs::store::{ExportFormat, ExportMode};
use iroh_blobs::ticket::BlobTicket;
use iroh_blobs::Hash;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

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
/// Returns `FastDropError` if the ticket cannot be exported to disk.
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

    Ok(ExportSummary {
        label,
        size,
        output_path,
    })
}

/// Resolves the user-visible label for a downloaded ticket.
///
/// # Errors
///
/// Returns `FastDropError` if collection metadata cannot be read.
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
    let output_path = next_available_path(&destination.join(ticket.hash().to_string()));
    client
        .export(
            ticket.hash(),
            output_path.clone(),
            ExportFormat::Blob,
            ExportMode::TryReference,
        )
        .await
        .map_err(|error| blob_error(&error))?
        .finish()
        .await
        .map_err(|error| blob_error(&error))?;
    Ok(output_path)
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
            .ok_or_else(|| FastDropError::Other("Export staging directory is empty".into()))?;
        let file_name = source
            .file_name()
            .map(OsString::from)
            .ok_or_else(|| FastDropError::Other("Export output has no filename".into()))?;
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
        BlobStatus::NotFound => Err(FastDropError::Blob(format!("Missing blob {hash}"))),
    }
}

fn blob_error(err: &impl ToString) -> FastDropError {
    FastDropError::Blob(err.to_string())
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
}
