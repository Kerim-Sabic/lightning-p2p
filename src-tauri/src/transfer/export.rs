//! Export helpers for downloaded blobs and collections.

use crate::error::{FastDropError, Result};
use iroh_blobs::rpc::client::blobs::{BlobStatus, MemClient};
use iroh_blobs::store::{ExportFormat, ExportMode};
use iroh_blobs::ticket::BlobTicket;
use iroh_blobs::Hash;

/// Exports a downloaded ticket to the destination directory and returns its size.
///
/// # Errors
///
/// Returns `FastDropError` if the ticket cannot be exported to disk.
pub async fn export_ticket(
    client: &MemClient,
    ticket: &BlobTicket,
    destination: &std::path::Path,
) -> Result<u64> {
    tokio::fs::create_dir_all(destination).await?;
    let export_path = if ticket.recursive() {
        destination.to_path_buf()
    } else {
        destination.join(ticket.hash().to_string())
    };
    let format = if ticket.recursive() {
        ExportFormat::Collection
    } else {
        ExportFormat::Blob
    };
    client
        .export(ticket.hash(), export_path, format, ExportMode::TryReference)
        .await
        .map_err(|error| blob_error(&error))?
        .finish()
        .await
        .map_err(|error| blob_error(&error))?;
    ticket_size(client, ticket).await
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
