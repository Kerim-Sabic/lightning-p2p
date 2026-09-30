//! Export helpers for downloaded blobs and collections.

pub(crate) use super::destination::preflight_destination;
use super::destination::{
    ensure_enough_space, safe_collection_entry_path, safe_collection_label, suffixed_path,
};
use crate::error::{LightningP2PError, Result};
use iroh_blobs::api::proto::BlobStatus;
use iroh_blobs::api::Store;
use iroh_blobs::format::collection::Collection;
use iroh_blobs::ticket::BlobTicket;
use iroh_blobs::Hash;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use tokio::sync::watch;

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
    store: &Store,
    ticket: &BlobTicket,
    destination: &Path,
    known_size: Option<u64>,
    cancel_rx: &mut watch::Receiver<bool>,
) -> Result<ExportSummary> {
    ensure_not_cancelled(cancel_rx)?;
    preflight_destination(destination)?;
    let label = resolve_label(store, ticket).await?;
    let size = match known_size {
        Some(size) if size > 0 => size,
        _ => ticket_size(store, ticket).await?,
    };
    ensure_enough_space(destination, size)?;
    let output_path = if ticket.recursive() {
        export_collection(store, ticket, destination, &label, cancel_rx).await?
    } else {
        export_blob(store, ticket, destination, cancel_rx).await?
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
pub async fn resolve_label(store: &Store, ticket: &BlobTicket) -> Result<String> {
    if !ticket.recursive() {
        return Ok(ticket.hash().to_string());
    }

    let collection = Collection::load(ticket.hash(), store)
        .await
        .map_err(|error| blob_error(&error))?;
    Ok(summarize_names(
        collection.iter().map(|(name, _hash)| name.as_str()),
    ))
}

async fn export_blob(
    store: &Store,
    ticket: &BlobTicket,
    destination: &Path,
    cancel_rx: &mut watch::Receiver<bool>,
) -> Result<PathBuf> {
    let base_path = destination.join(ticket.hash().to_string());
    let staging_dir = create_export_staging_dir(destination, ticket.hash())?;
    let temp_path = staging_dir.join(ticket.hash().to_string());

    let export_result = tokio::select! {
        biased;
        () = wait_for_cancellation(cancel_rx) => Err(cancelled_error()),
        result = store.blobs().export(ticket.hash(), &temp_path) => {
            result.map_err(|error| blob_error(&error))
        }
    };

    if let Err(error) = export_result {
        let _ = tokio::fs::remove_dir_all(&staging_dir).await;
        return Err(error);
    }

    if let Err(error) = ensure_not_cancelled(cancel_rx) {
        let _ = tokio::fs::remove_dir_all(&staging_dir).await;
        return Err(error);
    }

    let published = publish_staged_file(&temp_path, &base_path).await;
    let _ = tokio::fs::remove_dir_all(&staging_dir).await;
    published
}

/// Creates a fresh private directory for a single-file export. A predictable
/// sibling `.part` file could be planted as a symlink before `iroh-blobs`
/// opens it, redirecting the write outside the download folder.
fn create_export_staging_dir(destination: &Path, hash: Hash) -> Result<PathBuf> {
    for _ in 0..64 {
        let candidate = destination.join(format!(
            ".lightning-p2p-export-{hash}-{}",
            uuid::Uuid::new_v4()
        ));
        match create_private_directory(&candidate) {
            Ok(()) => {
                let metadata = std::fs::symlink_metadata(&candidate)?;
                if !is_plain_directory(&metadata) {
                    let _ = std::fs::remove_dir(&candidate);
                    return Err(unsafe_collection_destination_error());
                }
                return Ok(candidate);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
    }
    Err(LightningP2PError::Other(
        "Could not reserve a safe location for received content.".into(),
    ))
}

#[cfg(unix)]
fn create_private_directory(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;

    let mut builder = std::fs::DirBuilder::new();
    builder.mode(0o700).create(path)
}

#[cfg(not(unix))]
fn create_private_directory(path: &Path) -> std::io::Result<()> {
    std::fs::create_dir(path)
}

async fn export_collection(
    store: &Store,
    ticket: &BlobTicket,
    destination: &Path,
    label: &str,
    cancel_rx: &mut watch::Receiver<bool>,
) -> Result<PathBuf> {
    let staging_dir = create_export_staging_dir(destination, ticket.hash())?;

    // iroh-blobs 1.0 has no collection-export helper, so load the collection
    // and export each child to `staging/<name>` (creating parent dirs for
    // nested names).
    let export_result =
        export_collection_children(store, ticket.hash(), &staging_dir, cancel_rx).await;

    if let Err(error) = export_result {
        let _ = tokio::fs::remove_dir_all(&staging_dir).await;
        return Err(error);
    }

    if let Err(error) = ensure_not_cancelled(cancel_rx) {
        let _ = tokio::fs::remove_dir_all(&staging_dir).await;
        return Err(error);
    }

    match move_staged_collection(&staging_dir, destination, label).await {
        Ok(path) => Ok(path),
        Err(error) => {
            let _ = tokio::fs::remove_dir_all(&staging_dir).await;
            Err(error)
        }
    }
}

async fn export_collection_children(
    store: &Store,
    root: Hash,
    staging_dir: &Path,
    cancel_rx: &mut watch::Receiver<bool>,
) -> Result<()> {
    let collection = Collection::load(root, store)
        .await
        .map_err(|error| blob_error(&error))?;
    for (name, hash) in collection.iter() {
        ensure_not_cancelled(cancel_rx)?;
        let safe_relative_path = safe_collection_entry_path(name)?;
        let target = prepare_staging_file_target(staging_dir, &safe_relative_path).await?;
        tokio::select! {
            biased;
            () = wait_for_cancellation(cancel_rx) => return Err(cancelled_error()),
            result = store.blobs().export(*hash, &target) => {
                result.map_err(|error| blob_error(&error))?;
            }
        }
    }
    Ok(())
}

fn ensure_not_cancelled(cancel_rx: &watch::Receiver<bool>) -> Result<()> {
    if *cancel_rx.borrow() {
        Err(cancelled_error())
    } else {
        Ok(())
    }
}

async fn wait_for_cancellation(cancel_rx: &mut watch::Receiver<bool>) {
    loop {
        if *cancel_rx.borrow() {
            return;
        }
        if cancel_rx.changed().await.is_err() {
            std::future::pending::<()>().await;
        }
    }
}

fn cancelled_error() -> LightningP2PError {
    LightningP2PError::Other("Cancelled".into())
}

async fn prepare_staging_file_target(staging_dir: &Path, relative: &Path) -> Result<PathBuf> {
    let root_metadata = tokio::fs::symlink_metadata(staging_dir).await?;
    if !is_plain_directory(&root_metadata) {
        return Err(unsafe_collection_destination_error());
    }

    let mut current = staging_dir.to_path_buf();
    if let Some(parent) = relative.parent() {
        for component in parent.components() {
            let std::path::Component::Normal(name) = component else {
                return Err(unsafe_collection_destination_error());
            };
            current.push(name);
            match tokio::fs::create_dir(&current).await {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    let metadata = tokio::fs::symlink_metadata(&current).await?;
                    if !is_plain_directory(&metadata) {
                        return Err(unsafe_collection_destination_error());
                    }
                }
                Err(error) => return Err(error.into()),
            }
        }
    }
    let file_name = relative
        .file_name()
        .ok_or_else(unsafe_collection_destination_error)?;
    current.push(file_name);
    match tokio::fs::symlink_metadata(&current).await {
        Ok(_) => {
            return Err(LightningP2PError::Other(
                "The shared folder contains conflicting file paths.".into(),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    Ok(current)
}

fn is_plain_directory(metadata: &std::fs::Metadata) -> bool {
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0
    }
    #[cfg(not(windows))]
    {
        true
    }
}

fn unsafe_collection_destination_error() -> LightningP2PError {
    LightningP2PError::Other("The shared folder contains an unsafe file path.".into())
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

pub(crate) async fn ticket_size(store: &Store, ticket: &BlobTicket) -> Result<u64> {
    if !ticket.recursive() {
        return blob_size(store, ticket.hash()).await;
    }

    let collection = Collection::load(ticket.hash(), store)
        .await
        .map_err(|error| blob_error(&error))?;
    let mut total = 0u64;
    for (_name, hash) in collection.iter() {
        total = total
            .checked_add(blob_size(store, *hash).await?)
            .ok_or_else(|| {
                LightningP2PError::Other("The received collection is too large to export.".into())
            })?;
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
        let base = destination.join(file_name);
        let target = if tokio::fs::metadata(&source).await?.is_dir() {
            publish_staged_directory(&source, &base).await?
        } else {
            publish_staged_file(&source, &base).await?
        };
        let _ = tokio::fs::remove_dir(staging_dir).await;
        return Ok(target);
    }

    publish_staged_directory(staging_dir, &destination.join(safe_collection_label(label))).await
}

/// Atomically creates a no-clobber output file on the same filesystem.
/// Hard-link creation fails when the destination already exists, so a racing
/// file cannot be overwritten after the suffix was selected.
async fn publish_staged_file(source: &Path, base: &Path) -> Result<PathBuf> {
    for index in 0..1000 {
        let candidate = if index == 0 {
            base.to_path_buf()
        } else {
            suffixed_path(base, index)
        };
        match tokio::fs::hard_link(source, &candidate).await {
            Ok(()) => {
                if let Err(error) = tokio::fs::remove_file(source).await {
                    tracing::warn!(%error, path = %source.display(), "could not remove staged file after publishing");
                }
                return Ok(candidate);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(LightningP2PError::from(error)),
        }
    }
    Err(LightningP2PError::Other(
        "Could not reserve a unique filename for the received file.".into(),
    ))
}

/// Reserves a directory name with an atomic create operation, then atomically
/// replaces only that empty reservation with the fully staged tree on Unix.
/// Windows requires removing the reservation before rename; its rename fails
/// if another path appears in the gap, so existing files still are not replaced.
async fn publish_staged_directory(source: &Path, base: &Path) -> Result<PathBuf> {
    for index in 0..1000 {
        let candidate = if index == 0 {
            base.to_path_buf()
        } else {
            suffixed_path(base, index)
        };
        match tokio::fs::create_dir(&candidate).await {
            Ok(()) => {
                #[cfg(windows)]
                tokio::fs::remove_dir(&candidate).await?;
                match tokio::fs::rename(source, &candidate).await {
                    Ok(()) => return Ok(candidate),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(error) => {
                        let _ = tokio::fs::remove_dir(&candidate).await;
                        return Err(LightningP2PError::from(error));
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(LightningP2PError::from(error)),
        }
    }
    Err(LightningP2PError::Other(
        "Could not reserve a unique folder for the received files.".into(),
    ))
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

async fn blob_size(store: &Store, hash: Hash) -> Result<u64> {
    match store
        .blobs()
        .status(hash)
        .await
        .map_err(|error| blob_error(&error))?
    {
        BlobStatus::Complete { size } => Ok(size),
        BlobStatus::Partial { size } => Ok(size.unwrap_or(0)),
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

    #[tokio::test]
    async fn publishing_a_file_preserves_existing_output() {
        let dir = tempfile::tempdir().expect("tempdir");
        let existing = dir.path().join("payload.txt");
        let staged = dir.path().join("payload.txt.part");
        tokio::fs::write(&existing, b"keep")
            .await
            .expect("existing");
        tokio::fs::write(&staged, b"new").await.expect("staged");

        let published = publish_staged_file(&staged, &existing)
            .await
            .expect("publish");

        assert_eq!(tokio::fs::read(existing).await.unwrap(), b"keep");
        assert_eq!(tokio::fs::read(published).await.unwrap(), b"new");
        assert!(!staged.exists());
    }

    #[tokio::test]
    async fn cancelled_blob_export_does_not_publish_a_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = iroh_blobs::store::mem::MemStore::new();
        let hash = store.add_bytes(b"payload".to_vec()).await.unwrap().hash;
        let ticket = BlobTicket::new(
            iroh::EndpointAddr::new(iroh::SecretKey::from_bytes(&[1; 32]).public()),
            hash,
            iroh_blobs::BlobFormat::Raw,
        );
        let (_cancel_tx, mut cancel_rx) = watch::channel(true);

        assert!(
            export_blob(store.as_ref(), &ticket, dir.path(), &mut cancel_rx)
                .await
                .is_err()
        );
        assert_eq!(read_dir_entries(dir.path()).await.unwrap().len(), 0);
    }

    #[tokio::test]
    async fn blob_export_leaves_preexisting_predictable_part_file_untouched() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = iroh_blobs::store::mem::MemStore::new();
        let content = b"received payload";
        let hash = store.add_bytes(content.to_vec()).await.unwrap().hash;
        let planted_part = dir.path().join(format!("{hash}.part"));
        tokio::fs::write(&planted_part, b"existing user data")
            .await
            .expect("preexisting part file");
        let ticket = BlobTicket::new(
            iroh::EndpointAddr::new(iroh::SecretKey::from_bytes(&[1; 32]).public()),
            hash,
            iroh_blobs::BlobFormat::Raw,
        );
        let (_cancel_tx, mut cancel_rx) = watch::channel(false);

        let published = export_blob(store.as_ref(), &ticket, dir.path(), &mut cancel_rx)
            .await
            .expect("export safely");

        assert_eq!(
            tokio::fs::read(&planted_part).await.unwrap(),
            b"existing user data"
        );
        assert_eq!(tokio::fs::read(&published).await.unwrap(), content);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn blob_export_does_not_follow_a_planted_part_symlink() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().expect("tempdir");
        let outside = dir.path().join("outside.txt");
        tokio::fs::write(&outside, b"keep this file")
            .await
            .expect("outside file");
        let store = iroh_blobs::store::mem::MemStore::new();
        let content = b"received payload";
        let hash = store.add_bytes(content.to_vec()).await.unwrap().hash;
        let planted_part = dir.path().join(format!("{hash}.part"));
        symlink(&outside, &planted_part).expect("plant predictable part symlink");
        let ticket = BlobTicket::new(
            iroh::EndpointAddr::new(iroh::SecretKey::from_bytes(&[1; 32]).public()),
            hash,
            iroh_blobs::BlobFormat::Raw,
        );
        let (_cancel_tx, mut cancel_rx) = watch::channel(false);

        let published = export_blob(store.as_ref(), &ticket, dir.path(), &mut cancel_rx)
            .await
            .expect("export safely");

        assert_eq!(tokio::fs::read(&outside).await.unwrap(), b"keep this file");
        assert_eq!(tokio::fs::read(&published).await.unwrap(), content);
        assert!(tokio::fs::symlink_metadata(&planted_part)
            .await
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(read_dir_entries(dir.path()).await.unwrap().len(), 3);
    }

    #[tokio::test]
    async fn collection_size_uses_verified_file_blobs_only() {
        let store = iroh_blobs::store::mem::MemStore::new();
        let first = store.add_bytes(b"first".to_vec()).await.unwrap();
        let second = store.add_bytes(b"second file".to_vec()).await.unwrap();
        let root = Collection::from_iter([
            ("first.txt".to_string(), first.hash),
            ("second.txt".to_string(), second.hash),
        ])
        .store(store.as_ref())
        .await
        .unwrap();
        let ticket = BlobTicket::new(
            iroh::EndpointAddr::new(iroh::SecretKey::from_bytes(&[1; 32]).public()),
            root.hash(),
            iroh_blobs::BlobFormat::HashSeq,
        );

        assert_eq!(ticket_size(store.as_ref(), &ticket).await.unwrap(), 16);
    }

    #[tokio::test]
    async fn publishing_a_directory_preserves_existing_output() {
        let dir = tempfile::tempdir().expect("tempdir");
        let existing = dir.path().join("folder");
        let staged = dir.path().join("staged");
        tokio::fs::create_dir(&existing)
            .await
            .expect("existing dir");
        tokio::fs::write(existing.join("keep.txt"), b"keep")
            .await
            .expect("existing file");
        tokio::fs::create_dir(&staged).await.expect("staged dir");
        tokio::fs::write(staged.join("new.txt"), b"new")
            .await
            .expect("staged file");

        let published = publish_staged_directory(&staged, &existing)
            .await
            .expect("publish");

        assert_eq!(
            tokio::fs::read(existing.join("keep.txt")).await.unwrap(),
            b"keep"
        );
        assert_eq!(
            tokio::fs::read(published.join("new.txt")).await.unwrap(),
            b"new"
        );
        assert!(!staged.exists());
    }

    #[tokio::test]
    async fn collection_staging_rejects_a_file_in_a_parent_position() {
        let dir = tempfile::tempdir().expect("tempdir");
        let stage = dir.path().join("stage");
        tokio::fs::create_dir(&stage).await.expect("stage");
        tokio::fs::write(stage.join("nested"), b"not a directory")
            .await
            .expect("parent blocker");

        assert!(
            prepare_staging_file_target(&stage, Path::new("nested/file.txt"))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn collection_staging_rejects_an_existing_leaf() {
        let dir = tempfile::tempdir().expect("tempdir");
        let stage = dir.path().join("stage");
        tokio::fs::create_dir(&stage).await.expect("stage");
        tokio::fs::write(stage.join("member.txt"), b"first member")
            .await
            .expect("existing member");

        assert!(prepare_staging_file_target(&stage, Path::new("member.txt"))
            .await
            .is_err());
        assert_eq!(
            tokio::fs::read(stage.join("member.txt")).await.unwrap(),
            b"first member"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn collection_staging_rejects_a_symlinked_parent() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().expect("tempdir");
        let stage = dir.path().join("stage");
        let outside = dir.path().join("outside");
        tokio::fs::create_dir(&stage).await.expect("stage");
        tokio::fs::create_dir(&outside).await.expect("outside");
        symlink(&outside, stage.join("nested")).expect("symlink");

        assert!(
            prepare_staging_file_target(&stage, Path::new("nested/file.txt"))
                .await
                .is_err()
        );
        assert!(!outside.join("file.txt").exists());
    }
}
