//! Export helpers for downloaded blobs and collections.

pub(crate) use super::destination::preflight_destination;
use super::destination::{
    ensure_enough_space, safe_collection_entry_path, safe_collection_label, suffixed_path,
};
use super::progress::ProgressHandle;
use crate::error::{LightningP2PError, Result};
use futures_util::StreamExt;
use iroh_blobs::api::blobs::ExportOptions;
use iroh_blobs::api::proto::{BlobStatus, ExportMode, ExportProgressItem};
use iroh_blobs::api::Store;
use iroh_blobs::format::collection::Collection;
use iroh_blobs::store::fs::options::PathOptions;
use iroh_blobs::ticket::BlobTicket;
use iroh_blobs::Hash;
use std::collections::{BTreeSet, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use tokio::io::AsyncReadExt;
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

/// What the receiver knows about the content it is saving.
#[derive(Debug, Clone, Copy)]
pub struct SaveRequest<'a> {
    /// Verified total size, when already computed.
    pub known_size: Option<u64>,
    /// Sender-provided name for a single-file share.
    pub suggested_file_name: Option<&'a str>,
    /// Store files the save may hard-link instead of copying.
    pub links: Option<&'a StoreLinks>,
    /// Progress handle that tracks bytes written to disk.
    pub progress: Option<&'a ProgressHandle>,
}

/// Blobs above this size live in their own store file; smaller ones are
/// kept inline in the store database and are always copied.
const LINKABLE_MIN_BYTES: u64 = 16 * 1024;

/// Verified store files a save may hard-link into place.
///
/// The file store keeps every verified blob above the inline limit as one
/// plain file. Linking it into the save location costs one metadata write
/// instead of writing the whole file a second time, and leaves the store's
/// own state untouched: collection later drops only the store's name for
/// the data. Blobs another pin still uses are copied instead, so editing a
/// saved file in place can never change bytes a share or paused receive
/// depends on.
#[derive(Debug, Clone)]
pub struct StoreLinks {
    paths: PathOptions,
    pinned_elsewhere: HashSet<Hash>,
}

impl StoreLinks {
    /// Links from the file store rooted at `blob_dir`, never touching
    /// `pinned_elsewhere`.
    #[must_use]
    pub fn new(blob_dir: &Path, pinned_elsewhere: HashSet<Hash>) -> Self {
        Self {
            paths: PathOptions::new(blob_dir),
            pinned_elsewhere,
        }
    }

    fn source(&self, hash: &Hash, size: u64) -> Option<PathBuf> {
        (size > LINKABLE_MIN_BYTES && !self.pinned_elsewhere.contains(hash))
            .then(|| self.paths.data_path(hash))
    }
}

/// Exports a downloaded ticket to the destination directory.
///
/// When `known_size` is provided the expensive per-blob size query is skipped.
/// Existing files are never overwritten; conflicting outputs receive a safe
/// numeric suffix. When `progress` is provided it tracks bytes copied to disk,
/// so a long save shows movement instead of a finished bar.
///
/// # Errors
///
/// Returns `LightningP2PError` if the ticket cannot be exported to disk.
pub async fn export_ticket(
    store: &Store,
    ticket: &BlobTicket,
    destination: &Path,
    request: SaveRequest<'_>,
    cancel_rx: &mut watch::Receiver<bool>,
) -> Result<ExportSummary> {
    let SaveRequest {
        known_size,
        suggested_file_name,
        links,
        progress,
    } = request;
    ensure_not_cancelled(cancel_rx)?;
    preflight_destination(destination)?;
    let suggested_file_name = if ticket.recursive() {
        None
    } else {
        suggested_file_name.map(safe_suggested_file_name)
    };
    let label = match suggested_file_name.as_deref() {
        Some(name) => name.to_string(),
        None => resolve_label(store, ticket).await?,
    };
    let size = match known_size {
        Some(size) if size > 0 => size,
        _ => ticket_size(store, ticket).await?,
    };
    ensure_enough_space(destination, size)?;
    let save = SaveProgress::start(progress, size);
    let output_path = if ticket.recursive() {
        export_collection(store, ticket, destination, &label, &save, links, cancel_rx).await?
    } else {
        export_blob(
            store,
            ticket,
            destination,
            suggested_file_name.as_deref(),
            &save,
            links,
            cancel_rx,
        )
        .await?
    };

    let output_path = match publish_to_public_storage(output_path.clone(), ticket.recursive()).await
    {
        Ok(output_path) => output_path,
        Err(error) => {
            discard_failed_public_export(&output_path).await;
            return Err(error);
        }
    };

    Ok(ExportSummary {
        label,
        size,
        output_path,
    })
}

/// On Android, move verified exports from app-private staging into public
/// MediaStore collections. Folder trees are published below Downloads with
/// their relative paths preserved. A publish failure remains a failed receive;
/// verified blobs stay in the local iroh store for a retry.
///
/// On non-Android targets this is an identity pass-through.
#[cfg(target_os = "android")]
async fn publish_to_public_storage(staged_path: PathBuf, _recursive: bool) -> Result<PathBuf> {
    let is_directory = match tokio::fs::metadata(&staged_path).await {
        Ok(metadata) => metadata.is_dir(),
        Err(error) => {
            tracing::warn!(error_kind = ?error.kind(), "could not inspect verified Android staging output");
            return Err(android_public_storage_error());
        }
    };
    if is_directory {
        let Some(folder_name) = staged_path.file_name().and_then(|name| name.to_str()) else {
            tracing::warn!("received folder has no usable name");
            return Err(android_public_storage_error());
        };
        let staged_path_string = staged_path.to_string_lossy().into_owned();
        let folder_name = folder_name.to_owned();
        return match tokio::task::spawn_blocking(move || {
            android_bridge::publish_folder_to_mediastore(&staged_path_string, &folder_name)
        })
        .await
        {
            Ok(Ok(published_path)) => {
                if let Err(error) = tokio::fs::remove_dir_all(&staged_path).await {
                    tracing::warn!(error_kind = ?error.kind(), "could not remove staged folder after MediaStore publish");
                }
                Ok(PathBuf::from(published_path))
            }
            Ok(Err(error)) => {
                tracing::warn!(
                    "MediaStore folder publish failed; verified blobs remain available for retry"
                );
                Err(android_public_storage_error())
            }
            Err(error) => {
                tracing::warn!("MediaStore folder publish task failed; verified blobs remain available for retry");
                Err(android_public_storage_error())
            }
        };
    }

    let file_name = match staged_path.file_name().and_then(|n| n.to_str()) {
        Some(name) if !name.is_empty() => name.to_string(),
        _ => {
            tracing::warn!("received file has no usable name; keeping app-private");
            return Err(android_public_storage_error());
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
                tracing::warn!(error_kind = ?error.kind(), "could not remove staged file after MediaStore publish");
            }
            Ok(PathBuf::from(format!(
                "{bucket_id}/Lightning P2P/{file_name}"
            )))
        }
        Ok(Err(error)) => {
            tracing::warn!("MediaStore publish failed; verified blobs remain available for retry");
            Err(android_public_storage_error())
        }
        Err(join_error) => {
            tracing::warn!(
                "MediaStore publish task failed; verified blobs remain available for retry"
            );
            Err(android_public_storage_error())
        }
    }
}

#[cfg(target_os = "android")]
fn android_public_storage_error() -> LightningP2PError {
    LightningP2PError::Other(
        "Export failed: Android could not save the verified transfer to public storage. Retry to try saving it again.".into(),
    )
}

async fn discard_failed_public_export(staged_path: &Path) {
    let metadata = match tokio::fs::symlink_metadata(staged_path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => {
            tracing::warn!(error_kind = ?error.kind(), "could not inspect failed export staging output");
            return;
        }
    };
    let result = if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() {
        tokio::fs::remove_dir_all(staged_path).await
    } else {
        tokio::fs::remove_file(staged_path).await
    };
    if let Err(error) = result {
        tracing::warn!(error_kind = ?error.kind(), "could not remove failed public export staging output");
    }
}

#[cfg(not(target_os = "android"))]
#[allow(clippy::unused_async)] // mirrors the Android-side async signature
async fn publish_to_public_storage(staged_path: PathBuf, _recursive: bool) -> Result<PathBuf> {
    Ok(staged_path)
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

/// Exports one file and returns its published path.
async fn export_blob(
    store: &Store,
    ticket: &BlobTicket,
    destination: &Path,
    suggested_file_name: Option<&str>,
    save: &SaveProgress,
    links: Option<&StoreLinks>,
    cancel_rx: &mut watch::Receiver<bool>,
) -> Result<PathBuf> {
    let base_path = destination
        .join(suggested_file_name.map_or_else(|| ticket.hash().to_string(), str::to_string));
    let staging_dir = create_export_staging_dir(destination, ticket.hash())?;
    let temp_path = staging_dir.join(ticket.hash().to_string());

    let export_result = tokio::select! {
        biased;
        () = wait_for_cancellation(cancel_rx) => Err(cancelled_error()),
        result = save_hash(store, ticket.hash(), None, &temp_path, save, links) => result,
    };
    if let Err(error) = export_result {
        let _ = tokio::fs::remove_dir_all(&staging_dir).await;
        return Err(error);
    }

    // A cancel can arrive after the export resolved; never publish then.
    if let Err(error) = ensure_not_cancelled(cancel_rx) {
        let _ = tokio::fs::remove_dir_all(&staging_dir).await;
        return Err(error);
    }

    let published = publish_staged_file(&temp_path, &base_path).await;
    let _ = tokio::fs::remove_dir_all(&staging_dir).await;
    published
}

/// Saves one verified blob to `target`: a hard link to the store's own file
/// when `links` allows it, otherwise a copy. A link that cannot be made
/// (another volume, no link support, data kept inline or by reference)
/// falls back to the copy. `size` skips a store lookup when already known.
async fn save_hash(
    store: &Store,
    hash: Hash,
    size: Option<u64>,
    target: &Path,
    save: &SaveProgress,
    links: Option<&StoreLinks>,
) -> Result<()> {
    if let Some(links) = links {
        let size = match size {
            Some(size) => size,
            None => blob_size(store, hash).await?,
        };
        if let Some(source) = links.source(&hash, size) {
            let link = target.to_path_buf();
            let linked = tokio::task::spawn_blocking(move || link_store_file(&source, &link, size))
                .await
                .unwrap_or(false);
            if linked {
                save.advance(size);
                return Ok(());
            }
        }
    }
    export_hash(store, hash, target, save, ExportMode::Copy)
        .await
        .map(|_| ())
}

/// Hard-links `source` to `target` when it is a plain file of exactly
/// `size` bytes. Creates nothing at `target` on failure.
fn link_store_file(source: &Path, target: &Path, size: u64) -> bool {
    let complete = std::fs::symlink_metadata(source)
        .is_ok_and(|metadata| metadata.file_type().is_file() && metadata.len() == size);
    if !complete {
        return false;
    }
    match std::fs::hard_link(source, target) {
        Ok(()) => true,
        Err(error) => {
            tracing::debug!(error_kind = ?error.kind(), "could not link received file; copying");
            false
        }
    }
}

pub(crate) fn safe_suggested_file_name(label: &str) -> String {
    let name = label.rsplit(['/', '\\']).next().unwrap_or_default();
    safe_collection_label(name)
}

/// Finds a previously published single-file output matching a durable receive
/// finalization intent. Only safe suffix candidates under the selected
/// destination are inspected; symlinks and non-files are ignored.
pub(crate) async fn recover_published_blob(
    destination: &Path,
    finalization: &crate::storage::resumable_receives::ReceiveFinalization,
) -> Option<PathBuf> {
    let expected_hash = finalization.hash.as_str();
    let base = destination.join(safe_suggested_file_name(&finalization.file_name));
    for index in 0..1000 {
        let candidate = if index == 0 {
            base.clone()
        } else {
            suffixed_path(&base, index)
        };
        match tokio::fs::symlink_metadata(&candidate).await {
            Ok(metadata)
                if metadata.file_type().is_file() && metadata.len() == finalization.size => {}
            _ => continue,
        }
        let Ok(mut file) = tokio::fs::File::open(&candidate).await else {
            continue;
        };
        let mut hasher = blake3::Hasher::new();
        let mut buffer = vec![0_u8; 64 * 1024].into_boxed_slice();
        let mut read_size = 0_u64;
        loop {
            let Ok(count) = file.read(&mut buffer).await else {
                read_size = u64::MAX;
                break;
            };
            if count == 0 {
                break;
            }
            read_size = read_size.saturating_add(count as u64);
            if read_size > finalization.size {
                break;
            }
            hasher.update(&buffer[..count]);
        }
        if read_size == finalization.size && hasher.finalize().to_hex().as_str() == expected_hash {
            return Some(candidate);
        }
    }
    None
}

/// Finds a previously published collection whose files still match the local
/// verified manifest. Candidate paths are confined to safe suffixes in the
/// selected destination and reject symlinks/reparse points.
pub(crate) async fn recover_published_collection(
    store: &Store,
    destination: &Path,
    finalization: &crate::storage::resumable_receives::ReceiveFinalization,
    root: Hash,
) -> Option<PathBuf> {
    let collection = Collection::load(root, store).await.ok()?;
    let base = collection_output_base(destination, &collection, &finalization.file_name)?;
    let entries = collection.iter().collect::<Vec<_>>();
    let single_file = entries
        .as_slice()
        .first()
        .filter(|(name, _)| entries.len() == 1 && !name.contains(['/', '\\']))
        .map(|(_, hash)| *hash);
    let strip_root = if single_file.is_none() {
        collection_only_root(&collection)
    } else {
        None
    };
    for index in 0..1000 {
        let candidate = if index == 0 {
            base.clone()
        } else {
            suffixed_path(&base, index)
        };
        let matches = if let Some(hash) = single_file {
            verified_file_size(&candidate, hash).await == Some(finalization.size)
        } else {
            verify_published_collection(
                &candidate,
                &collection,
                finalization.size,
                strip_root.as_deref(),
            )
            .await
        };
        if matches {
            return Some(candidate);
        }
    }
    None
}

fn collection_output_base(
    destination: &Path,
    collection: &Collection,
    label: &str,
) -> Option<PathBuf> {
    let roots = collection
        .iter()
        .map(|(name, _)| safe_collection_entry_path(name).ok())
        .collect::<Option<Vec<_>>>()?
        .into_iter()
        .filter_map(|path| {
            path.components()
                .next()
                .map(|part| part.as_os_str().to_owned())
        })
        .collect::<BTreeSet<_>>();
    let name = if roots.len() == 1 {
        roots.into_iter().next()?
    } else {
        safe_collection_label(label).into()
    };
    Some(destination.join(name))
}

fn collection_only_root(collection: &Collection) -> Option<OsString> {
    let roots = collection
        .iter()
        .map(|(name, _)| safe_collection_entry_path(name).ok())
        .collect::<Option<Vec<_>>>()?
        .into_iter()
        .filter_map(|path| {
            path.components()
                .next()
                .map(|part| part.as_os_str().to_owned())
        })
        .collect::<BTreeSet<_>>();
    (roots.len() == 1)
        .then(|| roots.into_iter().next())
        .flatten()
}

async fn verify_published_collection(
    candidate: &Path,
    collection: &Collection,
    expected_size: u64,
    strip_root: Option<&std::ffi::OsStr>,
) -> bool {
    let Ok(metadata) = tokio::fs::symlink_metadata(candidate).await else {
        return false;
    };
    if !is_plain_directory(&metadata) {
        return false;
    }
    let mut total_size = 0_u64;
    for (name, hash) in collection.iter() {
        let Some(path) = safe_collection_output_file(candidate, name, strip_root).await else {
            return false;
        };
        let Some(size) = verified_file_size(&path, *hash).await else {
            return false;
        };
        let Some(next_size) = total_size.checked_add(size) else {
            return false;
        };
        total_size = next_size;
    }
    total_size == expected_size
}

async fn safe_collection_output_file(
    root: &Path,
    name: &str,
    strip_root: Option<&std::ffi::OsStr>,
) -> Option<PathBuf> {
    let mut relative = safe_collection_entry_path(name).ok()?;
    if let Some(strip_root) = strip_root {
        relative = relative
            .strip_prefix(Path::new(strip_root))
            .ok()?
            .to_path_buf();
    }
    let mut current = root.to_path_buf();
    let components = relative.components().collect::<Vec<_>>();
    for (index, component) in components.iter().enumerate() {
        let std::path::Component::Normal(component) = component else {
            return None;
        };
        current.push(component);
        let metadata = tokio::fs::symlink_metadata(&current).await.ok()?;
        let is_file = index + 1 == components.len();
        if (is_file && !is_plain_file(&metadata)) || (!is_file && !is_plain_directory(&metadata)) {
            return None;
        }
    }
    Some(current)
}

async fn verified_file_size(path: &Path, expected: Hash) -> Option<u64> {
    let metadata = tokio::fs::symlink_metadata(path).await.ok()?;
    if !is_plain_file(&metadata) {
        return None;
    }
    let mut file = tokio::fs::File::open(path).await.ok()?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0_u8; 64 * 1024].into_boxed_slice();
    let mut size = 0_u64;
    loop {
        let count = file.read(&mut buffer).await.ok()?;
        if count == 0 {
            break;
        }
        size = size.checked_add(count as u64)?;
        hasher.update(&buffer[..count]);
    }
    (hasher.finalize().to_hex().as_str() == expected.to_string()).then_some(size)
}

fn is_plain_file(metadata: &std::fs::Metadata) -> bool {
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
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

/// Name prefix of the private folders exports stage into before publishing.
const EXPORT_STAGING_PREFIX: &str = ".lightning-p2p-export-";
/// Staging folders untouched for this long are leftovers from a crash or a
/// forced quit; no live export keeps one that long without writing to it.
const STALE_EXPORT_STAGING_AGE: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);

/// Removes export staging folders that a crash or forced quit left in the
/// download folder. Only plain directories carrying the private staging
/// prefix and untouched for a day are removed; symlinks, files, and anything
/// else are left alone. Returns how many folders were removed.
pub(crate) fn sweep_stale_export_staging(destination: &Path) -> usize {
    sweep_export_staging_older_than(
        destination,
        STALE_EXPORT_STAGING_AGE,
        std::time::SystemTime::now(),
    )
}

fn sweep_export_staging_older_than(
    destination: &Path,
    max_age: std::time::Duration,
    now: std::time::SystemTime,
) -> usize {
    let Ok(entries) = std::fs::read_dir(destination) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let is_staging = entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.starts_with(EXPORT_STAGING_PREFIX));
        if !is_staging {
            continue;
        }
        let path = entry.path();
        let Ok(metadata) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        let stale = metadata
            .modified()
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age >= max_age);
        if is_plain_directory(&metadata) && stale && std::fs::remove_dir_all(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// Creates a fresh private directory for a single-file export. A predictable
/// sibling `.part` file could be planted as a symlink before `iroh-blobs`
/// opens it, redirecting the write outside the download folder.
fn create_export_staging_dir(destination: &Path, hash: Hash) -> Result<PathBuf> {
    for _ in 0..64 {
        let candidate = destination.join(format!(
            "{EXPORT_STAGING_PREFIX}{hash}-{}",
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
    save: &SaveProgress,
    links: Option<&StoreLinks>,
    cancel_rx: &mut watch::Receiver<bool>,
) -> Result<PathBuf> {
    let staging_dir = create_export_staging_dir(destination, ticket.hash())?;
    let scratch_dir = match create_export_staging_dir(destination, ticket.hash()) {
        Ok(scratch_dir) => scratch_dir,
        Err(error) => {
            let _ = tokio::fs::remove_dir_all(&staging_dir).await;
            return Err(error);
        }
    };

    // iroh-blobs 1.0 has no collection-export helper, so load the collection
    // and export each child to `staging/<name>` (creating parent dirs for
    // nested names).
    let export_result = export_collection_children(
        store,
        ticket.hash(),
        (&staging_dir, &scratch_dir),
        save,
        links,
        cancel_rx,
    )
    .await;
    let _ = tokio::fs::remove_dir_all(&scratch_dir).await;

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

/// Exports every collection child, overlapping the per-file store and
/// filesystem latency that dominates folders full of small files.
///
/// Phase one saves each child concurrently to a unique numbered file in a
/// private scratch directory (a hard link to the store file when `links`
/// allows it), so concurrent writers can never collide even when two
/// manifest names map to the same file on a case-insensitive filesystem.
/// Phase two moves the verified files into the staged tree in manifest order
/// with a cheap same-volume rename, keeping the existing conflict, symlink,
/// and unsafe-path checks exactly as strict as before.
async fn export_collection_children(
    store: &Store,
    root: Hash,
    (staging_dir, scratch_dir): (&Path, &Path),
    save: &SaveProgress,
    links: Option<&StoreLinks>,
    cancel_rx: &mut watch::Receiver<bool>,
) -> Result<()> {
    let collection = Collection::load(root, store)
        .await
        .map_err(|error| blob_error(&error))?;
    let entries = collection
        .iter()
        .map(|(name, hash)| Ok((safe_collection_entry_path(name)?, *hash)))
        .collect::<Result<Vec<_>>>()?;
    let sizes = blob_sizes(store, entries.iter().map(|(_, hash)| *hash).collect()).await?;
    let children = entries
        .iter()
        .zip(&sizes)
        .map(|((_, hash), size)| (*hash, *size))
        .collect::<Vec<_>>();
    let parallelism = child_export_parallelism(&sizes);
    let scratch = ScratchExport {
        dir: scratch_dir,
        parallelism,
        links,
    };
    export_children_to_scratch(store, &children, &scratch, save, cancel_rx).await?;
    let relatives = entries.into_iter().map(|(relative, _)| relative).collect();
    let staging_dir = staging_dir.to_path_buf();
    let scratch_dir = scratch_dir.to_path_buf();
    let cancel = cancel_rx.clone();
    tokio::task::spawn_blocking(move || {
        place_exported_children(&staging_dir, &scratch_dir, relatives, &cancel)
    })
    .await
    .map_err(|error| LightningP2PError::Other(error.to_string()))?
}

/// Moves numbered scratch exports into the staged tree in manifest order.
/// Runs as one blocking job: per-file async filesystem calls would each pay a
/// thread hop, which dominated the cost for folders of small files.
fn place_exported_children(
    staging_dir: &Path,
    scratch_dir: &Path,
    relatives: Vec<PathBuf>,
    cancel_rx: &watch::Receiver<bool>,
) -> Result<()> {
    let mut known_dirs = HashSet::new();
    for (index, relative) in relatives.into_iter().enumerate() {
        ensure_not_cancelled(cancel_rx)?;
        let target = prepare_staging_file_target(staging_dir, &relative, &mut known_dirs)?;
        std::fs::rename(scratch_dir.join(index.to_string()), &target)?;
    }
    Ok(())
}

/// Most concurrent child exports for small-file collections.
const MAX_PARALLEL_CHILD_EXPORTS: usize = 16;
/// Concurrent child exports when files are large enough that disk bandwidth,
/// not per-file latency, is the limit (avoids seek thrash on spinning disks).
const LARGE_FILE_CHILD_EXPORTS: usize = 2;
/// Average child size above which a collection counts as large-file work.
const LARGE_CHILD_EXPORT_BYTES: u64 = 32 * 1024 * 1024;

fn child_export_parallelism(sizes: &[u64]) -> usize {
    if sizes.len() <= 1 {
        return 1;
    }
    let total = sizes.iter().copied().fold(0_u64, u64::saturating_add);
    parallelism_for_average(total / sizes.len() as u64, sizes.len())
}

/// Looks up verified blob sizes with overlapping store round trips, in input
/// order. Futures own their inputs so the combinator stays `Send` inside
/// spawned receive tasks.
async fn blob_sizes(store: &Store, hashes: Vec<Hash>) -> Result<Vec<u64>> {
    let lookups = hashes
        .into_iter()
        .map(|hash| {
            let store = store.clone();
            async move { blob_size(&store, hash).await }
        })
        .collect::<Vec<_>>();
    futures_util::stream::iter(lookups)
        .buffered(MAX_PARALLEL_CHILD_EXPORTS)
        .collect::<Vec<_>>()
        .await
        .into_iter()
        .collect()
}

fn parallelism_for_average(average_size: u64, entry_count: usize) -> usize {
    let cap = if average_size >= LARGE_CHILD_EXPORT_BYTES {
        LARGE_FILE_CHILD_EXPORTS
    } else {
        MAX_PARALLEL_CHILD_EXPORTS
    };
    entry_count.clamp(1, cap)
}

/// Where and how phase one of a collection save writes its children.
struct ScratchExport<'a> {
    dir: &'a Path,
    parallelism: usize,
    links: Option<&'a StoreLinks>,
}

async fn export_children_to_scratch(
    store: &Store,
    children: &[(Hash, u64)],
    scratch: &ScratchExport<'_>,
    save: &SaveProgress,
    cancel_rx: &mut watch::Receiver<bool>,
) -> Result<()> {
    let links = scratch.links;
    let jobs = children
        .iter()
        .enumerate()
        .map(|(index, &(hash, size))| {
            let store = store.clone();
            let save = save.clone();
            let target = scratch.dir.join(index.to_string());
            async move { save_hash(&store, hash, Some(size), &target, &save, links).await }
        })
        .collect::<Vec<_>>();
    let mut exports = futures_util::stream::iter(jobs).buffer_unordered(scratch.parallelism.max(1));
    loop {
        tokio::select! {
            biased;
            () = wait_for_cancellation(cancel_rx) => return Err(cancelled_error()),
            next = exports.next() => match next {
                Some(result) => {
                    result?;
                }
                None => return Ok(()),
            },
        }
    }
}

/// Save-phase progress shared by every concurrent child export. Each export
/// reports only the bytes it newly copied, so the handle's atomic total stays
/// monotonic no matter how the exports interleave.
#[derive(Clone, Default)]
struct SaveProgress {
    handle: Option<ProgressHandle>,
    total: u64,
}

impl SaveProgress {
    fn start(handle: Option<&ProgressHandle>, total: u64) -> Self {
        if let Some(handle) = handle {
            handle.set(0, total);
        }
        Self {
            handle: handle.cloned(),
            total,
        }
    }

    fn advance(&self, copied: u64) {
        if let Some(handle) = &self.handle {
            handle.advance(copied, self.total);
        }
    }
}

/// Copies one verified blob to `target`, reporting copied bytes as they land.
/// Copy-on-write filesystems finish without intermediate offsets.
async fn export_hash(
    store: &Store,
    hash: Hash,
    target: &Path,
    save: &SaveProgress,
    mode: ExportMode,
) -> Result<u64> {
    let options = ExportOptions {
        hash,
        mode,
        target: target.to_path_buf(),
    };
    let mut items = std::pin::pin!(store.blobs().export_with_opts(options).stream().await);
    let mut reported = 0_u64;
    let mut size = None;
    while let Some(item) = items.next().await {
        match item {
            ExportProgressItem::Size(bytes) => size = Some(bytes),
            ExportProgressItem::CopyProgress(offset) => {
                save.advance(offset.saturating_sub(reported));
                reported = reported.max(offset);
            }
            ExportProgressItem::Done => {
                let size = size.ok_or_else(|| {
                    LightningP2PError::Blob("Export finished without a size".into())
                })?;
                save.advance(size.saturating_sub(reported));
                return Ok(size);
            }
            ExportProgressItem::Error(error) => return Err(blob_error(&error)),
        }
    }
    Err(LightningP2PError::Blob(
        "Export stream ended before completion".into(),
    ))
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

/// Creates the parent folders for one staged collection file and returns its
/// path. Every folder this export did not create itself is re-checked so a
/// symlink or file in a parent position is rejected; `known_dirs` remembers
/// folders already created or verified during this export.
fn prepare_staging_file_target(
    staging_dir: &Path,
    relative: &Path,
    known_dirs: &mut HashSet<PathBuf>,
) -> Result<PathBuf> {
    if known_dirs.is_empty() {
        let root_metadata = std::fs::symlink_metadata(staging_dir)?;
        if !is_plain_directory(&root_metadata) {
            return Err(unsafe_collection_destination_error());
        }
        known_dirs.insert(staging_dir.to_path_buf());
    }

    let mut current = staging_dir.to_path_buf();
    if let Some(parent) = relative.parent() {
        for component in parent.components() {
            let std::path::Component::Normal(name) = component else {
                return Err(unsafe_collection_destination_error());
            };
            current.push(name);
            if known_dirs.contains(&current) {
                continue;
            }
            match std::fs::create_dir(&current) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    let metadata = std::fs::symlink_metadata(&current)?;
                    if !is_plain_directory(&metadata) {
                        return Err(unsafe_collection_destination_error());
                    }
                }
                Err(error) => return Err(error.into()),
            }
            known_dirs.insert(current.clone());
        }
    }
    let file_name = relative
        .file_name()
        .ok_or_else(unsafe_collection_destination_error)?;
    current.push(file_name);
    match std::fs::symlink_metadata(&current) {
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
    // One store round trip per child; overlap them so 10k-file folders do
    // not pay 10k sequential lookups before saving can start.
    let hashes = collection.iter().map(|(_name, hash)| *hash).collect();
    blob_sizes(store, hashes)
        .await?
        .into_iter()
        .try_fold(0u64, u64::checked_add)
        .ok_or_else(|| {
            LightningP2PError::Other("The received collection is too large to export.".into())
        })
}

/// Returns the names of files represented by a verified collection ticket.
pub(crate) async fn ticket_file_names(store: &Store, ticket: &BlobTicket) -> Result<Vec<String>> {
    if !ticket.recursive() {
        return Ok(Vec::new());
    }

    let collection = Collection::load(ticket.hash(), store)
        .await
        .map_err(|error| blob_error(&error))?;
    Ok(collection.iter().map(|(name, _)| name.clone()).collect())
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
                    tracing::warn!(error_kind = ?error.kind(), "could not remove staged file after publishing");
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
        // A partial blob is not verified content; reporting its (possibly
        // unknown) size as final would let an incomplete receive look done.
        BlobStatus::Partial { .. } => Err(LightningP2PError::Blob(format!(
            "Blob {hash} is incomplete"
        ))),
        BlobStatus::NotFound => Err(LightningP2PError::Blob(format!("Missing blob {hash}"))),
    }
}

fn blob_error(err: &impl ToString) -> LightningP2PError {
    LightningP2PError::Blob(err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn copy_request(progress: Option<&ProgressHandle>) -> SaveRequest<'_> {
        SaveRequest {
            known_size: None,
            suggested_file_name: None,
            links: None,
            progress,
        }
    }

    #[tokio::test]
    async fn recovery_finds_only_the_matching_published_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let original = b"verified payload";
        let hash = blake3::hash(original).to_hex().to_string();
        tokio::fs::write(dir.path().join("report.txt"), b"different content")
            .await
            .expect("unrelated existing file");
        let expected_path = dir.path().join("report (1).txt");
        tokio::fs::write(&expected_path, original)
            .await
            .expect("published output");
        let finalization = crate::storage::resumable_receives::ReceiveFinalization {
            hash,
            size: original.len() as u64,
            file_name: "report.txt".into(),
        };

        assert_eq!(
            recover_published_blob(dir.path(), &finalization).await,
            Some(expected_path)
        );
    }

    #[tokio::test]
    async fn recovery_ignores_files_with_the_wrong_size_or_digest() {
        let dir = tempfile::tempdir().expect("tempdir");
        tokio::fs::write(dir.path().join("report.txt"), b"wrong")
            .await
            .expect("unrelated file");
        let finalization = crate::storage::resumable_receives::ReceiveFinalization {
            hash: blake3::hash(b"expected").to_hex().to_string(),
            size: b"expected".len() as u64,
            file_name: "report.txt".into(),
        };

        assert_eq!(
            recover_published_blob(dir.path(), &finalization).await,
            None
        );
    }

    #[tokio::test]
    async fn recovery_finds_only_a_collection_matching_its_verified_manifest() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = iroh_blobs::store::mem::MemStore::new();
        let first = store.add_bytes(b"first file".to_vec()).await.unwrap();
        let second = store.add_bytes(b"second file".to_vec()).await.unwrap();
        let root = Collection::from_iter([
            ("folder/first.txt".to_string(), first.hash),
            ("folder/nested/second.txt".to_string(), second.hash),
        ])
        .store(store.as_ref())
        .await
        .unwrap()
        .hash();
        let wrong = dir.path().join("folder");
        let expected = dir.path().join("folder (1)");
        tokio::fs::create_dir_all(wrong.join("nested"))
            .await
            .unwrap();
        tokio::fs::write(wrong.join("first.txt"), b"wrong")
            .await
            .unwrap();
        tokio::fs::create_dir_all(expected.join("nested"))
            .await
            .unwrap();
        tokio::fs::write(expected.join("first.txt"), b"first file")
            .await
            .unwrap();
        tokio::fs::write(expected.join("nested/second.txt"), b"second file")
            .await
            .unwrap();
        let finalization = crate::storage::resumable_receives::ReceiveFinalization {
            hash: root.to_string(),
            size: 21,
            file_name: "folder".into(),
        };

        assert_eq!(
            recover_published_collection(store.as_ref(), dir.path(), &finalization, root).await,
            Some(expected)
        );
    }

    #[tokio::test]
    async fn recovery_handles_a_collection_exported_as_one_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = iroh_blobs::store::mem::MemStore::new();
        let file = store.add_bytes(b"collection file".to_vec()).await.unwrap();
        let root = Collection::from_iter([("report.txt".to_string(), file.hash)])
            .store(store.as_ref())
            .await
            .unwrap()
            .hash();
        let output = dir.path().join("report.txt");
        tokio::fs::write(&output, b"collection file").await.unwrap();
        let finalization = crate::storage::resumable_receives::ReceiveFinalization {
            hash: root.to_string(),
            size: b"collection file".len() as u64,
            file_name: "report.txt".into(),
        };

        assert_eq!(
            recover_published_collection(store.as_ref(), dir.path(), &finalization, root).await,
            Some(output)
        );
    }

    #[tokio::test]
    async fn failed_public_export_cleanup_removes_only_its_staging_output() {
        let dir = tempfile::tempdir().expect("tempdir");
        let keep = dir.path().join("keep.txt");
        let staged_file = dir.path().join("staged.txt");
        let staged_folder = dir.path().join("staged-folder");
        tokio::fs::write(&keep, b"keep").await.expect("keep file");
        tokio::fs::write(&staged_file, b"verified file")
            .await
            .expect("staged file");
        tokio::fs::create_dir(&staged_folder)
            .await
            .expect("staged folder");
        tokio::fs::write(staged_folder.join("verified.txt"), b"verified folder")
            .await
            .expect("staged child");

        discard_failed_public_export(&staged_file).await;
        discard_failed_public_export(&staged_folder).await;

        assert!(!staged_file.exists());
        assert!(!staged_folder.exists());
        assert_eq!(tokio::fs::read(keep).await.unwrap(), b"keep");
    }

    #[test]
    fn suggested_file_names_keep_only_a_safe_basename() {
        assert_eq!(safe_suggested_file_name(r"C:\users\photo.png"), "photo.png");
        assert_eq!(safe_suggested_file_name("../CON.txt"), "_CON.txt");
        assert_eq!(safe_suggested_file_name("folder/"), "download");
    }

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

        assert!(export_blob(
            store.as_ref(),
            &ticket,
            dir.path(),
            None,
            &SaveProgress::default(),
            None,
            &mut cancel_rx
        )
        .await
        .is_err());
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

        let published = export_blob(
            store.as_ref(),
            &ticket,
            dir.path(),
            None,
            &SaveProgress::default(),
            None,
            &mut cancel_rx,
        )
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

        let published = export_blob(
            store.as_ref(),
            &ticket,
            dir.path(),
            None,
            &SaveProgress::default(),
            None,
            &mut cancel_rx,
        )
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

    async fn collection_ticket(
        store: &iroh_blobs::store::mem::MemStore,
        files: &[(&str, Vec<u8>)],
    ) -> BlobTicket {
        let mut entries = Vec::new();
        for (name, bytes) in files {
            let hash = store.add_bytes(bytes.clone()).await.unwrap().hash;
            entries.push(((*name).to_string(), hash));
        }
        let root = Collection::from_iter(entries)
            .store(store.as_ref())
            .await
            .unwrap()
            .hash();
        BlobTicket::new(
            iroh::EndpointAddr::new(iroh::SecretKey::from_bytes(&[1; 32]).public()),
            root,
            iroh_blobs::BlobFormat::HashSeq,
        )
    }

    #[tokio::test]
    async fn parallel_collection_export_writes_every_nested_file_once() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = iroh_blobs::store::mem::MemStore::new();
        let files = (0..300)
            .map(|index| {
                (
                    format!("album/disc-{}/track-{index:03}.txt", index % 7),
                    format!("payload {index}").into_bytes(),
                )
            })
            .collect::<Vec<_>>();
        let borrowed = files
            .iter()
            .map(|(name, bytes)| (name.as_str(), bytes.clone()))
            .collect::<Vec<_>>();
        let ticket = collection_ticket(&store, &borrowed).await;
        let (_cancel_tx, mut cancel_rx) = watch::channel(false);

        let summary = export_ticket(
            store.as_ref(),
            &ticket,
            dir.path(),
            copy_request(None),
            &mut cancel_rx,
        )
        .await
        .expect("export collection");

        assert_eq!(summary.output_path, dir.path().join("album"));
        for (name, bytes) in &files {
            assert_eq!(
                &tokio::fs::read(dir.path().join(name)).await.unwrap(),
                bytes
            );
        }
        // Only the published folder remains: no staging or scratch leftovers.
        assert_eq!(read_dir_entries(dir.path()).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn parallel_collection_export_rejects_a_file_used_as_a_folder() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = iroh_blobs::store::mem::MemStore::new();
        let ticket = collection_ticket(
            &store,
            &[
                ("shared/report", b"a file".to_vec()),
                ("shared/report/inner.txt", b"nested".to_vec()),
            ],
        )
        .await;
        let (_cancel_tx, mut cancel_rx) = watch::channel(false);

        assert!(export_ticket(
            store.as_ref(),
            &ticket,
            dir.path(),
            copy_request(None),
            &mut cancel_rx
        )
        .await
        .is_err());
        assert_eq!(read_dir_entries(dir.path()).await.unwrap().len(), 0);
    }

    #[tokio::test]
    async fn cancelled_collection_export_leaves_no_staging_behind() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = iroh_blobs::store::mem::MemStore::new();
        let ticket = collection_ticket(
            &store,
            &[("a/one.txt", b"1".to_vec()), ("a/two.txt", b"2".to_vec())],
        )
        .await;
        let (_cancel_tx, mut cancel_rx) = watch::channel(true);

        assert!(export_collection(
            store.as_ref(),
            &ticket,
            dir.path(),
            "a",
            &SaveProgress::default(),
            None,
            &mut cancel_rx
        )
        .await
        .is_err());
        assert_eq!(read_dir_entries(dir.path()).await.unwrap().len(), 0);
    }

    #[tokio::test]
    async fn blob_export_reports_saved_bytes_as_progress() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = iroh_blobs::store::fs::FsStore::load(dir.path().join("store"))
            .await
            .expect("store");
        let payload = vec![7_u8; 3 * 1024 * 1024];
        let hash = store.add_bytes(payload.clone()).await.unwrap().hash;
        let ticket = BlobTicket::new(
            iroh::EndpointAddr::new(iroh::SecretKey::from_bytes(&[1; 32]).public()),
            hash,
            iroh_blobs::BlobFormat::Raw,
        );
        let destination = dir.path().join("out");
        tokio::fs::create_dir(&destination).await.expect("out dir");
        let total = payload.len() as u64;
        let handle = ProgressHandle::default();
        handle.set(total, total);
        let (_cancel_tx, mut cancel_rx) = watch::channel(false);

        let summary = export_ticket(
            store.as_ref(),
            &ticket,
            &destination,
            SaveRequest {
                known_size: Some(total),
                suggested_file_name: Some("payload.bin"),
                links: None,
                progress: Some(&handle),
            },
            &mut cancel_rx,
        )
        .await
        .expect("export");

        assert_eq!(handle.snapshot(), (total, total));
        assert_eq!(tokio::fs::read(summary.output_path).await.unwrap(), payload);
        store.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn concurrent_collection_export_progress_sums_every_child() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = iroh_blobs::store::mem::MemStore::new();
        let children = (0..24_u8)
            .map(|index| {
                (
                    format!("folder/file-{index}.bin"),
                    vec![index; 64 * 1024 + usize::from(index)],
                )
            })
            .collect::<Vec<_>>();
        let total = children
            .iter()
            .map(|(_, body)| body.len() as u64)
            .sum::<u64>();
        let named = children
            .iter()
            .map(|(name, body)| (name.as_str(), body.clone()))
            .collect::<Vec<_>>();
        let ticket = collection_ticket(&store, &named).await;
        let handle = ProgressHandle::default();
        let save = SaveProgress::start(Some(&handle), total);
        let (_cancel_tx, mut cancel_rx) = watch::channel(false);

        let output = export_collection(
            store.as_ref(),
            &ticket,
            dir.path(),
            "folder",
            &save,
            None,
            &mut cancel_rx,
        )
        .await
        .expect("export");

        assert_eq!(handle.snapshot(), (total, total));
        assert_eq!(
            tokio::fs::read(output.join("file-23.bin")).await.unwrap(),
            vec![23_u8; 64 * 1024 + 23]
        );
    }

    #[test]
    fn save_progress_start_resets_the_bar_for_the_save_phase() {
        let handle = ProgressHandle::default();
        handle.set(900, 900);
        let save = SaveProgress::start(Some(&handle), 1_000);
        assert_eq!(handle.snapshot(), (0, 1_000));
        save.clone().advance(400);
        save.advance(600);
        assert_eq!(handle.snapshot(), (1_000, 1_000));
    }

    async fn linkable_store(dir: &Path) -> (iroh_blobs::store::fs::FsStore, PathBuf) {
        let store_dir = dir.join("store");
        let store = iroh_blobs::store::fs::FsStore::load(&store_dir)
            .await
            .expect("store");
        (store, store_dir)
    }

    fn patterned(len: u32, seed: u32) -> Vec<u8> {
        (0..len)
            .map(|index| u8::try_from((index + seed) % 241).expect("byte"))
            .collect()
    }

    #[cfg(unix)]
    fn same_file(left: &Path, right: &Path) -> bool {
        use std::os::unix::fs::MetadataExt;
        std::fs::metadata(left).unwrap().ino() == std::fs::metadata(right).unwrap().ino()
    }

    #[tokio::test]
    async fn linked_save_publishes_the_store_file_without_a_second_copy() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (store, store_dir) = linkable_store(dir.path()).await;
        let payload = patterned(2 * 1024 * 1024, 0);
        let tag = store.add_bytes(payload.clone()).temp_tag().await.unwrap();
        let ticket = BlobTicket::new(
            iroh::EndpointAddr::new(iroh::SecretKey::from_bytes(&[1; 32]).public()),
            tag.hash(),
            iroh_blobs::BlobFormat::Raw,
        );
        let destination = dir.path().join("out");
        tokio::fs::create_dir(&destination).await.expect("out dir");
        let links = StoreLinks::new(&store_dir, HashSet::new());
        let (_cancel_tx, mut cancel_rx) = watch::channel(false);

        let published = export_blob(
            store.as_ref(),
            &ticket,
            &destination,
            Some("movie.bin"),
            &SaveProgress::default(),
            Some(&links),
            &mut cancel_rx,
        )
        .await
        .expect("export");

        assert_eq!(tokio::fs::read(&published).await.unwrap(), payload);
        #[cfg(unix)]
        assert!(
            same_file(
                &published,
                &PathOptions::new(&store_dir).data_path(&tag.hash())
            ),
            "save copied the data instead of linking it"
        );
        assert_eq!(
            read_dir_entries(&destination).await.unwrap(),
            vec![published]
        );
        let read_back = store.blobs().get_bytes(tag.hash()).await.expect("store");
        assert_eq!(read_back.as_ref(), payload.as_slice());
        store.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn linked_save_outlives_the_store_reclaiming_its_entry() {
        use crate::node::retention;
        use std::sync::atomic::AtomicBool;
        use std::sync::Arc;

        let dir = tempfile::tempdir().expect("tempdir");
        let blob_dir = dir.path().join("blobs");
        let store = iroh_blobs::store::fs::FsStore::load_with_opts(
            blob_dir.join("blobs.db"),
            retention::options_with_interval(
                &blob_dir,
                Arc::new(AtomicBool::new(true)),
                std::time::Duration::from_millis(20),
            ),
        )
        .await
        .expect("store");
        let payload = patterned(1024 * 1024, 5);
        let tag = store.add_bytes(payload.clone()).temp_tag().await.unwrap();
        let hash = tag.hash();
        retention::pin_receive(&store, "linked", iroh_blobs::HashAndFormat::raw(hash))
            .await
            .unwrap();
        drop(tag);
        let ticket = BlobTicket::new(
            iroh::EndpointAddr::new(iroh::SecretKey::from_bytes(&[1; 32]).public()),
            hash,
            iroh_blobs::BlobFormat::Raw,
        );
        let links = StoreLinks::new(&blob_dir, HashSet::new());
        let (_cancel_tx, mut cancel_rx) = watch::channel(false);
        let published = export_blob(
            store.as_ref(),
            &ticket,
            dir.path(),
            Some("kept.bin"),
            &SaveProgress::default(),
            Some(&links),
            &mut cancel_rx,
        )
        .await
        .expect("export");

        retention::release_receive(&store, "linked").await;
        let mut reclaimed = false;
        for _ in 0..200 {
            if blob_size(store.as_ref(), hash).await.is_err() {
                reclaimed = true;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }

        assert!(reclaimed, "released entry was not reclaimed");
        assert!(!PathOptions::new(&blob_dir).data_path(&hash).exists());
        assert_eq!(tokio::fs::read(&published).await.unwrap(), payload);
        store.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn linked_folder_save_copies_inline_and_pinned_children() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (store, store_dir) = linkable_store(dir.path()).await;
        let large = patterned(512 * 1024, 1);
        let shared = patterned(256 * 1024, 2);
        let small = patterned(1024, 3);
        let mut tags = Vec::new();
        for bytes in [&large, &shared, &small] {
            tags.push(store.add_bytes(bytes.clone()).temp_tag().await.unwrap());
        }
        let root = Collection::from_iter([
            ("album/large.bin".to_string(), tags[0].hash()),
            ("album/shared.bin".to_string(), tags[1].hash()),
            ("album/small.txt".to_string(), tags[2].hash()),
        ])
        .store(&store)
        .await
        .unwrap();
        let ticket = BlobTicket::new(
            iroh::EndpointAddr::new(iroh::SecretKey::from_bytes(&[1; 32]).public()),
            root.hash(),
            iroh_blobs::BlobFormat::HashSeq,
        );
        let destination = dir.path().join("out");
        tokio::fs::create_dir(&destination).await.expect("out dir");
        let links = StoreLinks::new(&store_dir, HashSet::from([tags[1].hash()]));
        let handle = ProgressHandle::default();
        let (_cancel_tx, mut cancel_rx) = watch::channel(false);

        let summary = export_ticket(
            store.as_ref(),
            &ticket,
            &destination,
            SaveRequest {
                known_size: None,
                suggested_file_name: None,
                links: Some(&links),
                progress: Some(&handle),
            },
            &mut cancel_rx,
        )
        .await
        .expect("export");

        let album = summary.output_path;
        let total = u64::try_from(large.len() + shared.len() + small.len()).unwrap();
        assert_eq!(handle.snapshot(), (total, total));
        assert_eq!(
            tokio::fs::read(album.join("large.bin")).await.unwrap(),
            large
        );
        assert_eq!(
            tokio::fs::read(album.join("shared.bin")).await.unwrap(),
            shared
        );
        assert_eq!(
            tokio::fs::read(album.join("small.txt")).await.unwrap(),
            small
        );
        #[cfg(unix)]
        {
            let paths = PathOptions::new(&store_dir);
            assert!(same_file(
                &album.join("large.bin"),
                &paths.data_path(&tags[0].hash())
            ));
            assert!(!same_file(
                &album.join("shared.bin"),
                &paths.data_path(&tags[1].hash())
            ));
        }
        store.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn save_copies_when_the_store_file_is_not_where_links_expect() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (store, _store_dir) = linkable_store(dir.path()).await;
        let payload = patterned(300 * 1024, 4);
        let tag = store.add_bytes(payload.clone()).temp_tag().await.unwrap();
        let ticket = BlobTicket::new(
            iroh::EndpointAddr::new(iroh::SecretKey::from_bytes(&[1; 32]).public()),
            tag.hash(),
            iroh_blobs::BlobFormat::Raw,
        );
        let links = StoreLinks::new(&dir.path().join("elsewhere"), HashSet::new());
        let destination = dir.path().join("out");
        tokio::fs::create_dir(&destination).await.expect("out dir");
        let (_cancel_tx, mut cancel_rx) = watch::channel(false);

        let published = export_blob(
            store.as_ref(),
            &ticket,
            &destination,
            Some("copy.bin"),
            &SaveProgress::default(),
            Some(&links),
            &mut cancel_rx,
        )
        .await
        .expect("export");

        assert_eq!(tokio::fs::read(&published).await.unwrap(), payload);
        assert_eq!(
            read_dir_entries(&destination).await.unwrap(),
            vec![published]
        );
        store.shutdown().await.expect("shutdown");
    }

    #[test]
    fn only_blobs_in_their_own_unpinned_store_file_are_linkable() {
        let pinned = Hash::new(b"pinned");
        let fresh = Hash::new(b"fresh");
        let links = StoreLinks::new(Path::new("store"), HashSet::from([pinned]));
        assert!(links.source(&fresh, LINKABLE_MIN_BYTES + 1).is_some());
        assert!(links.source(&fresh, LINKABLE_MIN_BYTES).is_none());
        assert!(links.source(&pinned, 1 << 30).is_none());
    }

    #[tokio::test]
    async fn missing_blobs_have_no_verified_size() {
        let store = iroh_blobs::store::mem::MemStore::new();
        let missing = iroh_blobs::Hash::new(b"never stored");
        assert!(blob_size(store.as_ref(), missing).await.is_err());
    }

    #[test]
    fn small_files_export_in_parallel_and_large_files_stay_gentle() {
        assert_eq!(parallelism_for_average(4 * 1024, 1_000), 16);
        assert_eq!(parallelism_for_average(4 * 1024, 3), 3);
        assert_eq!(parallelism_for_average(1024 * 1024 * 1024, 50), 2);
        assert_eq!(parallelism_for_average(0, 0), 1);
    }

    #[test]
    fn startup_sweep_removes_only_stale_private_staging_folders() {
        let dir = tempfile::tempdir().expect("tempdir");
        let stale = dir.path().join(format!("{EXPORT_STAGING_PREFIX}abc-1"));
        std::fs::create_dir(&stale).unwrap();
        std::fs::write(stale.join("partial.bin"), b"partial").unwrap();
        let user_folder = dir.path().join("holiday photos");
        std::fs::create_dir(&user_folder).unwrap();
        let lookalike_file = dir.path().join(format!("{EXPORT_STAGING_PREFIX}note"));
        std::fs::write(&lookalike_file, b"user file").unwrap();
        let day_later = std::time::SystemTime::now() + STALE_EXPORT_STAGING_AGE;

        assert_eq!(
            sweep_export_staging_older_than(dir.path(), STALE_EXPORT_STAGING_AGE, day_later),
            1
        );
        assert!(!stale.exists());
        assert!(user_folder.exists());
        assert!(lookalike_file.exists());
    }

    #[test]
    fn startup_sweep_leaves_recent_staging_for_live_exports() {
        let dir = tempfile::tempdir().expect("tempdir");
        let live = dir.path().join(format!("{EXPORT_STAGING_PREFIX}live"));
        std::fs::create_dir(&live).unwrap();

        assert_eq!(sweep_stale_export_staging(dir.path()), 0);
        assert!(live.exists());
        assert_eq!(sweep_stale_export_staging(&dir.path().join("missing")), 0);
    }

    #[cfg(unix)]
    #[test]
    fn startup_sweep_never_follows_a_staging_named_symlink() {
        let dir = tempfile::tempdir().expect("tempdir");
        let outside = dir.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(outside.join("keep.txt"), b"keep").unwrap();
        let link = dir.path().join(format!("{EXPORT_STAGING_PREFIX}link"));
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        let day_later = std::time::SystemTime::now() + STALE_EXPORT_STAGING_AGE;

        assert_eq!(
            sweep_export_staging_older_than(dir.path(), STALE_EXPORT_STAGING_AGE, day_later),
            0
        );
        assert!(outside.join("keep.txt").exists());
    }

    #[tokio::test]
    async fn collection_staging_rejects_a_file_in_a_parent_position() {
        let dir = tempfile::tempdir().expect("tempdir");
        let stage = dir.path().join("stage");
        tokio::fs::create_dir(&stage).await.expect("stage");
        tokio::fs::write(stage.join("nested"), b"not a directory")
            .await
            .expect("parent blocker");

        assert!(prepare_staging_file_target(
            &stage,
            Path::new("nested/file.txt"),
            &mut HashSet::new()
        )
        .is_err());
    }

    #[tokio::test]
    async fn collection_staging_rejects_an_existing_leaf() {
        let dir = tempfile::tempdir().expect("tempdir");
        let stage = dir.path().join("stage");
        tokio::fs::create_dir(&stage).await.expect("stage");
        tokio::fs::write(stage.join("member.txt"), b"first member")
            .await
            .expect("existing member");

        assert!(
            prepare_staging_file_target(&stage, Path::new("member.txt"), &mut HashSet::new())
                .is_err()
        );
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

        assert!(prepare_staging_file_target(
            &stage,
            Path::new("nested/file.txt"),
            &mut HashSet::new()
        )
        .is_err());
        assert!(!outside.join("file.txt").exists());
    }
}
