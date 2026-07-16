//! Sender: imports content into iroh-blobs and produces share tickets.

use crate::error::{LightningP2PError, Result};
use crate::node::LightningP2PNode;
use crate::storage::history::{self, TransferRecord};
use crate::transfer::metrics::{RouteKind, TransferMetrics, TransferStrategy};
use crate::transfer::mode::TransferProfile;
use crate::transfer::progress::{
    EventReporter, FailureCategory, ProgressHandle, ProgressSampler, TransferDirection,
    TransferPhase,
};
use futures_util::stream;
use futures_util::StreamExt;
use iroh_blobs::api::proto::AddProgressItem;
use iroh_blobs::api::Store;
use iroh_blobs::format::collection::Collection;
use iroh_blobs::ticket::BlobTicket;
use iroh_blobs::{BlobFormat, Hash};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::Window;

/// A single file to import, with the name it should carry inside a collection.
#[derive(Debug, Clone)]
struct Source {
    name: String,
    path: PathBuf,
}

/// Hard upper bound on import parallelism. The per-transfer
/// [`TransferProfile`] picks a value within this range; env-var override is
/// still honored as the final escape hatch for bench sweeps.
const MAX_IMPORT_PARALLELISM: usize = 128;

struct SharePlan {
    sources: Vec<Source>,
    label: String,
    total_size: u64,
}

struct ImportedSource {
    name: String,
    hash: Hash,
}

struct IndexedImport {
    index: usize,
    source: ImportedSource,
}

/// Fully prepared share state returned by the core send flow.
#[derive(Debug, Clone)]
pub struct ShareOutcome {
    /// Root collection hash.
    pub hash: Hash,
    /// Ticket used by receivers.
    pub ticket: BlobTicket,
    /// User-visible label for the share.
    pub label: String,
    /// Total size of source files.
    pub total_size: u64,
}

/// Adds files or directories to the local blob store and returns a share ticket.
///
/// # Errors
///
/// Returns `LightningP2PError` if the paths are invalid, the add operation fails,
/// or the ticket cannot be generated.
pub async fn send_files(
    node: &LightningP2PNode,
    window: Window,
    paths: Vec<PathBuf>,
    profile: TransferProfile,
) -> Result<ShareOutcome> {
    let _foreground = crate::commands::mobile::TransferForegroundGuard::acquire();
    let started_at = Instant::now();
    let plan = build_share_plan(paths)?;
    let reporter = EventReporter::new(
        window,
        "share".into(),
        TransferDirection::Send,
        plan.label.clone(),
        None,
    );
    reporter.emit_started(
        plan.total_size,
        TransferMetrics::default(),
        TransferPhase::Preparing,
    )?;
    let sampler =
        ProgressSampler::spawn_with_interval(reporter.clone(), None, profile.progress_interval);
    let progress = sampler.handle();

    let result = create_share_with_plan(node, plan, Some(progress.clone()), profile).await;
    match result {
        Ok(outcome) => {
            let prep_ms = elapsed_ms(started_at.elapsed());
            let metrics = TransferMetrics {
                route_kind: RouteKind::Unknown,
                connect_ms: prep_ms,
                download_ms: 0,
                export_ms: 0,
                provider_count: 1,
                direct_provider_count: 0,
                relay_provider_count: 0,
                strategy: TransferStrategy::QueuedSingleProvider,
                first_byte_ms: 0,
                effective_mbps: effective_mbps(outcome.total_size, prep_ms),
            };
            progress.set(outcome.total_size, outcome.total_size);
            progress.set_metrics(metrics);
            sampler.finish().await?;
            reporter.emit_completed(outcome.hash.to_string(), outcome.total_size, metrics, None)?;
            save_send_record(node, &outcome)?;
            Ok(outcome)
        }
        Err(error) => {
            let _ = sampler.finish().await;
            let error_payload = error.to_payload();
            let error_message = error_payload.message.clone();
            let _ = reporter.emit_failed_with_payload(
                &error_message,
                progress.metrics_snapshot().route_kind,
                Some(FailureCategory::Unknown),
                Some(error_payload),
            );
            Err(error)
        }
    }
}

/// Adds files or directories to the local blob store without emitting UI events.
///
/// Uses the platform-default [`TransferProfile`]. Production code paths should
/// call [`send_files`] which threads the user-selected profile through.
///
/// # Errors
///
/// Returns `LightningP2PError` if the paths are invalid, the add operation fails,
/// or the ticket cannot be generated.
pub async fn create_share(node: &LightningP2PNode, paths: Vec<PathBuf>) -> Result<ShareOutcome> {
    let plan = build_share_plan(paths)?;
    let profile = crate::transfer::TransferMode::platform_default().profile();
    create_share_with_plan(node, plan, None, profile).await
}

async fn create_share_with_plan(
    node: &LightningP2PNode,
    plan: SharePlan,
    progress: Option<ProgressHandle>,
    profile: TransferProfile,
) -> Result<ShareOutcome> {
    let imported = import_sources(node.blobs_client(), &plan, progress, profile).await?;
    let hash = persist_collection(node.blobs_client(), imported).await?;
    let ticket = build_ticket(node, hash).await?;
    tracing::info!(
        hash = %hash,
        total_size = plan.total_size,
        "Lightning P2P share ticket created"
    );
    Ok(ShareOutcome {
        hash,
        ticket,
        label: plan.label,
        total_size: plan.total_size,
    })
}

fn build_share_plan(paths: Vec<PathBuf>) -> Result<SharePlan> {
    let canonical = canonicalize_paths(paths)?;
    let sources = collect_sources(&canonical)?;
    let total_size = total_size(&sources)?;
    Ok(SharePlan {
        label: summarize_sources(&sources),
        sources,
        total_size,
    })
}

fn canonicalize_paths(paths: Vec<PathBuf>) -> Result<Vec<PathBuf>> {
    if paths.is_empty() {
        return Err(LightningP2PError::Other("No files selected".into()));
    }
    paths
        .into_iter()
        .map(|path| {
            #[cfg(target_os = "android")]
            if path.to_string_lossy().starts_with("content://") {
                // Android's Storage Access Framework hands the picker back
                // `content://...` URIs. `tauri-plugin-dialog` normally resolves
                // those into real file paths before we see them, but if a URI
                // slips through we surface a clear error instead of an opaque
                // "no such file" from `canonicalize`. Full SAF streaming
                // (ContentResolver -> app-private cache) needs a JNI shim that
                // lives outside this module — track under the mobile RFC.
                return Err(LightningP2PError::Other(
                    "Android did not give us a regular file path for this pick. \
                     Copy the file into the Lightning P2P app folder and try again."
                        .into(),
                ));
            }
            path.canonicalize().map_err(LightningP2PError::from)
        })
        .collect()
}

fn collect_sources(paths: &[PathBuf]) -> Result<Vec<Source>> {
    let mut sources = Vec::new();
    for path in paths {
        scan_into(path, &mut sources)?;
    }
    if sources.is_empty() {
        return Err(LightningP2PError::Other(
            "Cannot share an empty directory".into(),
        ));
    }
    ensure_unique_names(&sources)?;
    Ok(sources)
}

/// Walks `path` and appends importable [`Source`]s. A file is wrapped under its
/// own name; a directory is walked recursively with `dirname/relative` names.
/// Replaces iroh-blobs 0.35's `scan_path` (removed in the 1.0 line).
fn scan_into(path: &Path, out: &mut Vec<Source>) -> Result<()> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let meta = fs::metadata(path)?;
    if meta.is_file() {
        out.push(Source {
            name,
            path: path.to_path_buf(),
        });
    } else if meta.is_dir() {
        scan_dir(path, &name, out)?;
    }
    Ok(())
}

fn scan_dir(dir: &Path, prefix: &str, out: &mut Vec<Source>) -> Result<()> {
    let mut entries = fs::read_dir(dir)?
        .map(|entry| entry.map(|e| e.path()))
        .collect::<std::io::Result<Vec<_>>>()?;
    entries.sort();
    for entry in entries {
        let entry_name = entry
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let name = format!("{prefix}/{entry_name}");
        let meta = fs::metadata(&entry)?;
        if meta.is_file() {
            out.push(Source { name, path: entry });
        } else if meta.is_dir() {
            scan_dir(&entry, &name, out)?;
        }
    }
    Ok(())
}

fn ensure_unique_names(sources: &[Source]) -> Result<()> {
    let mut names = HashSet::new();
    for source in sources {
        if !names.insert(source.name.clone()) {
            return Err(LightningP2PError::Other(format!(
                "Duplicate share path name: {}",
                source.name
            )));
        }
    }
    Ok(())
}

fn total_size(sources: &[Source]) -> Result<u64> {
    sources
        .iter()
        .try_fold(0, |total, source| Ok(total + file_size(&source.path)?))
}

fn file_size(path: &Path) -> Result<u64> {
    Ok(fs::metadata(path)?.len())
}

fn summarize_sources(sources: &[Source]) -> String {
    let mut roots = sources
        .iter()
        .map(|source| source.name.split('/').next().unwrap_or_default().to_string())
        .collect::<Vec<_>>();
    roots.sort();
    roots.dedup();
    match roots.as_slice() {
        [single] => single.clone(),
        _ => format!("{} items", roots.len()),
    }
}

async fn import_sources(
    store: &Store,
    plan: &SharePlan,
    progress: Option<ProgressHandle>,
    profile: TransferProfile,
) -> Result<Vec<ImportedSource>> {
    let tasks = plan
        .sources
        .iter()
        .cloned()
        .enumerate()
        .map(|(index, source)| {
            import_source(store, source, index, plan.total_size, progress.clone())
        });
    let mut pending =
        stream::iter(tasks).buffer_unordered(import_parallelism(plan.sources.len(), profile));
    let mut imported = Vec::with_capacity(plan.sources.len());

    while let Some(item) = pending.next().await {
        imported.push(item?);
    }

    imported.sort_by_key(|item| item.index);
    Ok(imported.into_iter().map(|item| item.source).collect())
}

fn import_parallelism(source_count: usize, profile: TransferProfile) -> usize {
    // Import is I/O-bound (disk read + hashing handled by iroh-blobs in async tasks),
    // so CPU count is a poor proxy — NVMe can comfortably absorb many in-flight imports.
    // Resolution order:
    //   1. `LIGHTNING_P2P_IMPORT_PARALLELISM` env var (bench tuning escape hatch)
    //   2. the active TransferProfile's `import_parallelism`
    //   3. hard floor of 1, hard ceiling of MAX_IMPORT_PARALLELISM
    let cap = env_import_parallelism_cap().unwrap_or(profile.import_parallelism);
    compute_import_parallelism(source_count, cap.min(MAX_IMPORT_PARALLELISM))
}

fn env_import_parallelism_cap() -> Option<usize> {
    std::env::var("LIGHTNING_P2P_IMPORT_PARALLELISM")
        .ok()
        .and_then(|raw| raw.parse::<usize>().ok())
        .filter(|&n| n > 0)
}

fn compute_import_parallelism(source_count: usize, cap: usize) -> usize {
    source_count.clamp(1, cap.max(1))
}

async fn import_source(
    store: &Store,
    source: Source,
    index: usize,
    total_size: u64,
    progress: Option<ProgressHandle>,
) -> Result<IndexedImport> {
    let size = file_size(&source.path)?;
    let mut last_offset = 0u64;
    let mut stream = store.blobs().add_path(&source.path).stream().await;
    let mut hash: Option<Hash> = None;

    while let Some(item) = stream.next().await {
        match item {
            AddProgressItem::CopyProgress(offset) | AddProgressItem::OutboardProgress(offset) => {
                advance_progress(
                    progress.as_ref(),
                    offset.saturating_sub(last_offset),
                    total_size,
                );
                last_offset = offset;
            }
            AddProgressItem::Done(temp_tag) => {
                hash = Some(temp_tag.hash());
            }
            AddProgressItem::Error(error) => {
                return Err(LightningP2PError::Blob(error.to_string()))
            }
            AddProgressItem::Size(_) | AddProgressItem::CopyDone => {}
        }
    }

    let hash = hash.ok_or_else(|| {
        LightningP2PError::Blob("Import stream ended before completion".into())
    })?;
    advance_progress(progress.as_ref(), size.saturating_sub(last_offset), total_size);
    Ok(IndexedImport {
        index,
        source: ImportedSource {
            name: source.name,
            hash,
        },
    })
}

fn advance_progress(progress: Option<&ProgressHandle>, bytes_delta: u64, total_size: u64) {
    if let Some(progress) = progress {
        progress.advance(bytes_delta, total_size);
    }
}

async fn persist_collection(store: &Store, imported: Vec<ImportedSource>) -> Result<Hash> {
    let collection = imported
        .into_iter()
        .map(|item| (item.name, item.hash))
        .collect::<Collection>();
    let temp_tag = collection
        .store(store)
        .await
        .map_err(|err| blob_error(&err))?;
    Ok(temp_tag.hash())
}

async fn build_ticket(node: &LightningP2PNode, hash: Hash) -> Result<BlobTicket> {
    Ok(BlobTicket::new(
        node.ticket_addr().await?,
        hash,
        BlobFormat::HashSeq,
    ))
}

fn save_send_record(node: &LightningP2PNode, outcome: &ShareOutcome) -> Result<()> {
    history::save_record(
        node.db(),
        &TransferRecord {
            hash: outcome.hash.to_string(),
            filename: outcome.label.clone(),
            size: outcome.total_size,
            peer: None,
            timestamp: unix_timestamp(),
            direction: TransferDirection::Send,
        },
    )
}

fn blob_error(err: &impl ToString) -> LightningP2PError {
    LightningP2PError::Blob(err.to_string())
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

fn elapsed_ms(duration: std::time::Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

fn effective_mbps(bytes: u64, duration_ms: u64) -> u64 {
    if duration_ms == 0 {
        return 0;
    }
    let mbps = u128::from(bytes).saturating_mul(8) / u128::from(duration_ms) / 1000;
    u64::try_from(mbps).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(name: &str) -> Source {
        Source {
            name: name.into(),
            path: PathBuf::from(name),
        }
    }

    #[test]
    fn summarize_single_root() {
        let sources = vec![source("folder/a.txt")];
        assert_eq!(summarize_sources(&sources), "folder");
    }

    #[test]
    fn summarize_multiple_roots() {
        let sources = vec![source("one/a.txt"), source("two/b.txt")];
        assert_eq!(summarize_sources(&sources), "2 items");
    }

    #[test]
    fn duplicate_names_are_rejected() {
        let sources = vec![source("dup.txt"), source("dup.txt")];
        let err = ensure_unique_names(&sources).expect_err("duplicates should fail");
        assert!(err.to_string().contains("Duplicate share path name"));
    }

    #[test]
    fn parallelism_is_bounded() {
        assert_eq!(compute_import_parallelism(1, MAX_IMPORT_PARALLELISM), 1);
        assert_eq!(
            compute_import_parallelism(256, MAX_IMPORT_PARALLELISM),
            MAX_IMPORT_PARALLELISM
        );
    }

    #[test]
    fn parallelism_respects_cap_override() {
        assert_eq!(compute_import_parallelism(256, 4), 4);
        assert_eq!(compute_import_parallelism(1, 4), 1);
        assert_eq!(compute_import_parallelism(10, 0), 1);
    }

    #[test]
    fn effective_mbps_uses_payload_and_elapsed_time() {
        assert_eq!(effective_mbps(125_000_000, 1_000), 1000);
        assert_eq!(effective_mbps(125_000_000, 0), 0);
    }
}
