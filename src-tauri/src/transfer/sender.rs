//! Sender: imports content into iroh-blobs and produces share tickets.

use crate::error::{LightningP2PError, Result};
use crate::node::LightningP2PNode;
use crate::storage::history::{self, TransferRecord, TransferRecordStatus};
use crate::transfer::metrics::TransferMetrics;
use crate::transfer::mode::TransferProfile;
use crate::transfer::progress::{
    EventReporter, FailureCategory, ProgressHandle, ProgressSampler, QueueProgressTarget,
    TransferDirection, TransferInfo, TransferPhase,
};
use crate::transfer::queue::TransferQueue;
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
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Window;
use tokio::sync::{watch, Semaphore, SemaphorePermit};

/// A single file to import, with the name it should carry inside a collection.
#[derive(Debug, Clone)]
struct Source {
    name: String,
    path: PathBuf,
    snapshot: SourceSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SourceSnapshot {
    size: u64,
    modified: Option<SystemTime>,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(windows)]
    creation_time: u64,
}

/// Hard upper bound on import parallelism. The per-transfer
/// [`TransferProfile`] picks a value within this range; env-var override is
/// still honored as the final escape hatch for bench sweeps.
const MAX_IMPORT_PARALLELISM: usize = 128;
const MAX_SMART_AUTO_IMPORTS: usize = 8;
pub(crate) const MAX_SHARE_FILES: usize = 10_000;
pub(crate) const MAX_SHARE_SCAN_ENTRIES: usize = 50_000;
static SHARE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static SMART_AUTO_IMPORT_BUDGET: OnceLock<Semaphore> = OnceLock::new();

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
    /// Number of source files included in the collection.
    pub file_count: u32,
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
    queue: TransferQueue,
) -> Result<ShareOutcome> {
    let _foreground = crate::commands::mobile::TransferForegroundGuard::acquire();
    let preparation_label = summarize_selected_paths(&paths);
    let (transfer_id, cancel_rx) = register_send_preparation(&queue, &preparation_label, 0).await;
    let reporter = EventReporter::new(
        window,
        transfer_id.clone(),
        TransferDirection::Send,
        preparation_label,
        None,
    );
    if let Err(error) =
        reporter.emit_started(0, TransferMetrics::default(), TransferPhase::Preparing)
    {
        queue.remove(&transfer_id).await;
        return Err(error);
    }
    let sampler = ProgressSampler::spawn_with_interval(
        reporter.clone(),
        Some(QueueProgressTarget::new(queue.clone(), transfer_id.clone())),
        profile.progress_interval,
    );
    let progress = sampler.handle();

    let (plan, sampler) =
        prepare_share_plan(paths, &cancel_rx, &reporter, sampler, &queue, &transfer_id).await?;
    progress.set(0, plan.total_size);

    let mut result = create_share_with_plan(
        node,
        plan,
        Some(progress.clone()),
        profile,
        Some(cancel_rx.clone()),
    )
    .await;
    if *cancel_rx.borrow() {
        result = Err(transfer_cancelled());
    }
    if let Ok(outcome) = &result {
        progress.set(outcome.total_size, outcome.total_size);
    }
    let sampler_result = sampler.finish().await;
    if result.is_ok() {
        if let Err(error) = sampler_result {
            result = Err(error);
        }
    }

    finish_share_preparation(
        node,
        &queue,
        &transfer_id,
        &reporter,
        &cancel_rx,
        &progress,
        result,
    )
    .await
}

async fn prepare_share_plan(
    paths: Vec<PathBuf>,
    cancel_rx: &watch::Receiver<bool>,
    reporter: &EventReporter,
    sampler: ProgressSampler,
    queue: &TransferQueue,
    transfer_id: &str,
) -> Result<(SharePlan, ProgressSampler)> {
    let planning_cancel = cancel_rx.clone();
    let plan_result = tokio::task::spawn_blocking(move || {
        build_share_plan_with_cancel(paths, Some(&planning_cancel))
    })
    .await;
    let plan = match plan_result {
        Ok(Ok(plan)) => plan,
        Ok(Err(error)) => {
            let category = if *cancel_rx.borrow() {
                FailureCategory::Cancelled
            } else {
                FailureCategory::Unknown
            };
            emit_share_preparation_failure(&error, category, reporter, sampler, queue, transfer_id)
                .await;
            return Err(error);
        }
        Err(error) => {
            let error = LightningP2PError::Other(error.to_string());
            emit_share_preparation_failure(
                &error,
                FailureCategory::Unknown,
                reporter,
                sampler,
                queue,
                transfer_id,
            )
            .await;
            return Err(error);
        }
    };
    Ok((plan, sampler))
}

async fn emit_share_preparation_failure(
    error: &LightningP2PError,
    category: FailureCategory,
    reporter: &EventReporter,
    sampler: ProgressSampler,
    queue: &TransferQueue,
    transfer_id: &str,
) {
    let _ = sampler.finish().await;
    let error_payload = error.to_payload();
    let error_message = error_payload.message.clone();
    let _ = reporter.emit_failed_with_payload(
        &error_message,
        crate::transfer::metrics::RouteKind::Unknown,
        Some(category),
        Some(error_payload),
    );
    queue.remove(transfer_id).await;
}

async fn finish_share_preparation(
    node: &LightningP2PNode,
    queue: &TransferQueue,
    transfer_id: &str,
    reporter: &EventReporter,
    cancel_rx: &watch::Receiver<bool>,
    progress: &ProgressHandle,
    result: Result<ShareOutcome>,
) -> Result<ShareOutcome> {
    match result {
        Ok(outcome) => {
            if let Err(error) = save_send_record(node, &outcome) {
                let payload = error.to_payload();
                let message = payload.message.clone();
                let _ = reporter.emit_failed_with_payload(
                    &message,
                    progress.metrics_snapshot().route_kind,
                    Some(FailureCategory::Unknown),
                    Some(payload),
                );
                queue.remove(transfer_id).await;
                return Err(error);
            }
            if let Err(error) =
                reporter.emit_share_prepared(outcome.hash.to_string(), outcome.total_size)
            {
                queue.remove(transfer_id).await;
                return Err(error);
            }
            queue.remove(transfer_id).await;
            Ok(outcome)
        }
        Err(error) => {
            let error_payload = error.to_payload();
            let error_message = error_payload.message.clone();
            let _ = reporter.emit_failed_with_payload(
                &error_message,
                progress.metrics_snapshot().route_kind,
                Some(if *cancel_rx.borrow() {
                    FailureCategory::Cancelled
                } else {
                    FailureCategory::Unknown
                }),
                Some(error_payload),
            );
            queue.remove(transfer_id).await;
            Err(error)
        }
    }
}

async fn register_send_preparation(
    queue: &TransferQueue,
    name: &str,
    total: u64,
) -> (String, watch::Receiver<bool>) {
    let transfer_id = next_share_id();
    let (cancel_tx, cancel_rx) = watch::channel(false);
    queue
        .add(
            TransferInfo {
                transfer_id: transfer_id.clone(),
                direction: TransferDirection::Send,
                name: name.to_string(),
                peer: None,
                bytes: 0,
                total,
                speed_bps: 0,
                route_kind: crate::transfer::metrics::RouteKind::Unknown,
                phase: TransferPhase::Preparing,
                failure_category: None,
                output_path: None,
                connect_ms: 0,
                download_ms: 0,
                export_ms: 0,
                provider_count: 0,
                direct_provider_count: 0,
                relay_provider_count: 0,
                strategy: crate::transfer::metrics::TransferStrategy::Unknown,
                first_byte_ms: 0,
                effective_mbps: 0,
            },
            Some(cancel_tx),
        )
        .await;
    (transfer_id, cancel_rx)
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
    let plan = tokio::task::spawn_blocking(move || build_share_plan(paths))
        .await
        .map_err(|error| LightningP2PError::Other(error.to_string()))??;
    let profile = crate::transfer::TransferMode::platform_default().profile();
    let outcome = create_share_with_plan(node, plan, None, profile, None).await?;
    node.authorize_public_share(outcome.hash).await?;
    Ok(outcome)
}

async fn create_share_with_plan(
    node: &LightningP2PNode,
    plan: SharePlan,
    progress: Option<ProgressHandle>,
    profile: TransferProfile,
    cancel_rx: Option<watch::Receiver<bool>>,
) -> Result<ShareOutcome> {
    let file_count = u32::try_from(plan.sources.len()).map_err(|_| {
        LightningP2PError::Other("The share contains too many files to describe.".into())
    })?;
    let imported = import_sources(node.blobs_client(), &plan, progress, profile, cancel_rx).await?;
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
        file_count,
    })
}

fn build_share_plan(paths: Vec<PathBuf>) -> Result<SharePlan> {
    build_share_plan_with_cancel(paths, None)
}

fn summarize_selected_paths(paths: &[PathBuf]) -> String {
    let mut names = paths
        .iter()
        .filter_map(|path| path.file_name())
        .map(|name| name.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    match names.as_slice() {
        [single] => single.clone(),
        [] => "Preparing share".into(),
        _ => format!("{} items", names.len()),
    }
}

fn build_share_plan_with_cancel(
    paths: Vec<PathBuf>,
    cancel_rx: Option<&watch::Receiver<bool>>,
) -> Result<SharePlan> {
    ensure_not_cancelled(cancel_rx)?;
    if paths.len() > MAX_SHARE_FILES {
        return Err(too_many_share_files_error());
    }
    let canonical = canonicalize_paths(paths, cancel_rx)?;
    let sources = collect_sources(&canonical, cancel_rx)?;
    let total_size = total_size(&sources)?;
    Ok(SharePlan {
        label: summarize_sources(&sources),
        sources,
        total_size,
    })
}

fn canonicalize_paths(
    paths: Vec<PathBuf>,
    cancel_rx: Option<&watch::Receiver<bool>>,
) -> Result<Vec<PathBuf>> {
    if paths.is_empty() {
        return Err(LightningP2PError::Other("No files selected".into()));
    }
    paths
        .into_iter()
        .map(|path| {
            ensure_not_cancelled(cancel_rx)?;
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
            let metadata = fs::symlink_metadata(&path)?;
            if is_reparse_point(&metadata) || !(metadata.is_file() || metadata.is_dir()) {
                return Err(unsafe_source_path_error());
            }
            path.canonicalize().map_err(LightningP2PError::from)
        })
        .collect()
}

fn collect_sources(
    paths: &[PathBuf],
    cancel_rx: Option<&watch::Receiver<bool>>,
) -> Result<Vec<Source>> {
    let mut sources = Vec::new();
    let mut scanned_entry_count = 0;
    for path in paths {
        ensure_not_cancelled(cancel_rx)?;
        scan_into(path, &mut sources, &mut scanned_entry_count, cancel_rx)?;
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
fn scan_into(
    path: &Path,
    out: &mut Vec<Source>,
    scanned_entry_count: &mut usize,
    cancel_rx: Option<&watch::Receiver<bool>>,
) -> Result<()> {
    ensure_not_cancelled(cancel_rx)?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let meta = fs::symlink_metadata(path)?;
    if is_reparse_point(&meta) {
        return Err(unsafe_source_path_error());
    }
    if meta.is_file() {
        push_source(
            out,
            Source {
                name,
                path: path.to_path_buf(),
                snapshot: source_snapshot(path)?,
            },
        )?;
    } else if meta.is_dir() {
        scan_dir(path, &name, out, scanned_entry_count, cancel_rx)?;
    }
    Ok(())
}

fn scan_dir(
    dir: &Path,
    prefix: &str,
    out: &mut Vec<Source>,
    scanned_entry_count: &mut usize,
    cancel_rx: Option<&watch::Receiver<bool>>,
) -> Result<()> {
    ensure_not_cancelled(cancel_rx)?;
    let directory_metadata = fs::symlink_metadata(dir)?;
    if !directory_metadata.is_dir() || is_reparse_point(&directory_metadata) {
        return Err(unsafe_source_path_error());
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir)? {
        ensure_not_cancelled(cancel_rx)?;
        record_share_scan_entry(scanned_entry_count)?;
        entries.push(entry?.path());
    }
    entries.sort();
    for entry in entries {
        ensure_not_cancelled(cancel_rx)?;
        let entry_name = entry
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let name = format!("{prefix}/{entry_name}");
        let meta = fs::symlink_metadata(&entry)?;
        if is_reparse_point(&meta) {
            return Err(unsafe_source_path_error());
        }
        if meta.is_file() {
            push_source(
                out,
                Source {
                    name,
                    snapshot: source_snapshot(&entry)?,
                    path: entry,
                },
            )?;
        } else if meta.is_dir() {
            scan_dir(&entry, &name, out, scanned_entry_count, cancel_rx)?;
        }
    }
    Ok(())
}

fn ensure_unique_names(sources: &[Source]) -> Result<()> {
    let mut names = HashSet::new();
    for source in sources {
        if source
            .name
            .split('/')
            .any(|component| component.contains('\\'))
            || super::destination::safe_collection_entry_path(&source.name).is_err()
        {
            return Err(LightningP2PError::Other(
                "A selected file or folder name cannot be safely shared between devices.".into(),
            ));
        }
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
    sources.iter().try_fold(0_u64, |total, source| {
        total
            .checked_add(source.snapshot.size)
            .ok_or_else(|| LightningP2PError::Other("Selected files are too large.".into()))
    })
}

fn push_source(sources: &mut Vec<Source>, source: Source) -> Result<()> {
    if sources.len() >= MAX_SHARE_FILES {
        return Err(too_many_share_files_error());
    }
    sources.push(source);
    Ok(())
}

fn too_many_share_files_error() -> LightningP2PError {
    LightningP2PError::Other(format!(
        "A share can contain at most {MAX_SHARE_FILES} files."
    ))
}

pub(crate) fn record_share_scan_entry(count: &mut usize) -> Result<()> {
    *count = count
        .checked_add(1)
        .ok_or_else(|| LightningP2PError::Other("Selected folder is too large.".into()))?;
    if *count > MAX_SHARE_SCAN_ENTRIES {
        return Err(LightningP2PError::Other(format!(
            "A share can contain at most {MAX_SHARE_SCAN_ENTRIES} folder entries."
        )));
    }
    Ok(())
}

fn ensure_not_cancelled(cancel_rx: Option<&watch::Receiver<bool>>) -> Result<()> {
    if cancel_rx.is_some_and(|receiver| *receiver.borrow()) {
        Err(transfer_cancelled())
    } else {
        Ok(())
    }
}

fn source_snapshot(path: &Path) -> Result<SourceSnapshot> {
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    #[cfg(windows)]
    use std::os::windows::fs::MetadataExt;

    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || is_reparse_point(&metadata) {
        return Err(unsafe_source_path_error());
    }
    Ok(SourceSnapshot {
        size: metadata.len(),
        modified: metadata.modified().ok(),
        #[cfg(unix)]
        device: metadata.dev(),
        #[cfg(unix)]
        inode: metadata.ino(),
        #[cfg(windows)]
        creation_time: metadata.creation_time(),
    })
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

fn unsafe_source_path_error() -> LightningP2PError {
    LightningP2PError::Other(
        "Selected files changed or contain a symbolic link or reparse point.".into(),
    )
}

fn summarize_sources(sources: &[Source]) -> String {
    let mut roots = sources
        .iter()
        .map(|source| {
            source
                .name
                .split('/')
                .next()
                .unwrap_or_default()
                .to_string()
        })
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
    cancel_rx: Option<watch::Receiver<bool>>,
) -> Result<Vec<ImportedSource>> {
    let tasks = plan
        .sources
        .iter()
        .cloned()
        .enumerate()
        .map(|(index, source)| {
            import_source(
                store,
                source,
                index,
                plan.total_size,
                progress.clone(),
                profile.mode == crate::transfer::TransferMode::SmartAuto,
                cancel_rx.clone(),
            )
        });
    let mut pending = stream::iter(tasks).buffer_unordered(import_parallelism(
        plan.sources.len(),
        plan.total_size,
        profile,
    ));
    let mut imported = Vec::with_capacity(plan.sources.len());

    while let Some(item) = pending.next().await {
        imported.push(item?);
    }

    imported.sort_by_key(|item| item.index);
    Ok(imported.into_iter().map(|item| item.source).collect())
}

fn import_parallelism(source_count: usize, total_size: u64, profile: TransferProfile) -> usize {
    // Import is I/O-bound (disk read + hashing handled by iroh-blobs in async tasks),
    // so CPU count is a poor proxy — NVMe can comfortably absorb many in-flight imports.
    // Resolution order:
    //   1. `LIGHTNING_P2P_IMPORT_PARALLELISM` env var (bench tuning escape hatch)
    //   2. the active TransferProfile's `import_parallelism`
    //   3. hard floor of 1, hard ceiling of MAX_IMPORT_PARALLELISM
    let cap = env_import_parallelism_cap().unwrap_or_else(|| {
        if profile.mode == crate::transfer::TransferMode::SmartAuto {
            let cores = std::thread::available_parallelism().map_or(2, std::num::NonZeroUsize::get);
            smart_auto_import_parallelism(source_count, total_size, cores)
        } else {
            profile.import_parallelism
        }
    });
    compute_import_parallelism(source_count, cap.min(MAX_IMPORT_PARALLELISM))
}

/// Adapts only the bounded import fanout from observable CPU and payload shape.
/// Large files use fewer simultaneous hashing pipelines; small-file batches can
/// use up to twice the available parallelism, with an eight-job ceiling.
fn smart_auto_import_parallelism(source_count: usize, total_size: u64, cores: usize) -> usize {
    if source_count <= 1 {
        return 1;
    }
    let cores = cores.max(1);
    let average_file_size = total_size / source_count as u64;
    let cap = if average_file_size >= 64 * 1024 * 1024 || total_size >= 1024 * 1024 * 1024 {
        cores.min(4)
    } else if average_file_size <= 4 * 1024 * 1024 {
        cores.saturating_mul(2).min(8)
    } else {
        cores.min(8)
    };
    source_count.min(cap.max(1))
}

fn smart_auto_global_parallelism(cores: usize) -> usize {
    cores
        .max(1)
        .saturating_mul(2)
        .clamp(1, MAX_SMART_AUTO_IMPORTS)
}

fn smart_auto_import_budget() -> &'static Semaphore {
    SMART_AUTO_IMPORT_BUDGET.get_or_init(|| {
        let cap = env_import_parallelism_cap().unwrap_or_else(|| {
            let cores = std::thread::available_parallelism().map_or(2, std::num::NonZeroUsize::get);
            smart_auto_global_parallelism(cores)
        });
        Semaphore::new(cap.clamp(1, MAX_IMPORT_PARALLELISM))
    })
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

async fn wait_for_cancellation(cancel_rx: &mut watch::Receiver<bool>) {
    if *cancel_rx.borrow() {
        return;
    }
    loop {
        if cancel_rx.changed().await.is_err() || *cancel_rx.borrow() {
            return;
        }
    }
}

fn transfer_cancelled() -> LightningP2PError {
    LightningP2PError::Other("Transfer cancelled".into())
}

async fn import_source(
    store: &Store,
    source: Source,
    index: usize,
    total_size: u64,
    progress: Option<ProgressHandle>,
    smart_auto: bool,
    mut cancel_rx: Option<watch::Receiver<bool>>,
) -> Result<IndexedImport> {
    if cancel_rx.as_ref().is_some_and(|rx| *rx.borrow()) {
        return Err(transfer_cancelled());
    }
    let _budget_permit: Option<SemaphorePermit<'static>> = if smart_auto {
        Some(if let Some(rx) = cancel_rx.as_mut() {
            tokio::select! {
                permit = smart_auto_import_budget().acquire() => permit
                    .map_err(|_| LightningP2PError::Other("SmartAuto import budget closed".into()))?,
                () = wait_for_cancellation(rx) => return Err(transfer_cancelled()),
            }
        } else {
            smart_auto_import_budget()
                .acquire()
                .await
                .map_err(|_| LightningP2PError::Other("SmartAuto import budget closed".into()))?
        })
    } else {
        None
    };
    if source_snapshot(&source.path)? != source.snapshot {
        return Err(unsafe_source_path_error());
    }
    let mut last_offset = 0u64;
    let mut stream = store.blobs().add_path(&source.path).stream().await;
    let mut hash: Option<Hash> = None;

    loop {
        let next_item = if let Some(rx) = cancel_rx.as_mut() {
            tokio::select! {
                item = stream.next() => item,
                () = wait_for_cancellation(rx) => return Err(transfer_cancelled()),
            }
        } else {
            stream.next().await
        };
        let Some(item) = next_item else {
            break;
        };
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

    let hash = hash
        .ok_or_else(|| LightningP2PError::Blob("Import stream ended before completion".into()))?;
    if source_snapshot(&source.path)? != source.snapshot {
        return Err(unsafe_source_path_error());
    }
    advance_progress(
        progress.as_ref(),
        source.snapshot.size.saturating_sub(last_offset),
        total_size,
    );
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
            status: Some(TransferRecordStatus::SharePrepared),
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

fn next_share_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    let sequence = SHARE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("share-{nanos:x}-{sequence:x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(name: &str) -> Source {
        Source {
            name: name.into(),
            path: PathBuf::from(name),
            snapshot: SourceSnapshot {
                size: 0,
                modified: None,
                #[cfg(unix)]
                device: 0,
                #[cfg(unix)]
                inode: 0,
                #[cfg(windows)]
                creation_time: 0,
            },
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
    fn share_file_count_is_bounded_before_metadata_growth() {
        let mut sources = (0..MAX_SHARE_FILES)
            .map(|index| source(&format!("file-{index}.txt")))
            .collect::<Vec<_>>();

        let error = push_source(&mut sources, source("one-too-many.txt"))
            .expect_err("share file cap should be enforced");
        assert!(error.to_string().contains("at most 10000 files"));
        assert_eq!(sources.len(), MAX_SHARE_FILES);
    }

    #[test]
    fn folder_entry_count_is_bounded() {
        let mut count = MAX_SHARE_SCAN_ENTRIES;
        assert!(record_share_scan_entry(&mut count).is_err());
        assert_eq!(count, MAX_SHARE_SCAN_ENTRIES + 1);
    }

    #[test]
    fn share_planning_stops_when_cancelled_before_scanning() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("payload.txt");
        fs::write(&path, b"payload").expect("source");
        let (cancel_tx, cancel_rx) = watch::channel(false);
        cancel_tx.send(true).expect("receiver is active");

        let error = build_share_plan_with_cancel(vec![path], Some(&cancel_rx))
            .err()
            .expect("cancelled planning should fail");
        assert_eq!(error.to_string(), "Transfer cancelled");
    }

    #[cfg(unix)]
    #[test]
    fn selected_symlink_is_rejected_before_canonicalization() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("target.txt");
        let link = dir.path().join("link.txt");
        fs::write(&target, b"private target").expect("target");
        symlink(&target, &link).expect("symlink");

        let error = canonicalize_paths(vec![link], None).expect_err("symlink root is unsafe");
        assert!(error.to_string().contains("symbolic link"));
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
    fn smart_auto_scales_imports_to_workload_and_available_cores() {
        const MB: u64 = 1024 * 1024;
        assert_eq!(smart_auto_import_parallelism(100, 100 * MB, 2), 4);
        assert_eq!(smart_auto_import_parallelism(100, 8 * 1024 * MB, 16), 4);
        assert_eq!(smart_auto_import_parallelism(100, 100 * MB, 1), 2);
        assert_eq!(smart_auto_import_parallelism(1, 8 * 1024 * MB, 16), 1);
        assert_eq!(smart_auto_import_parallelism(3, 6 * MB, 12), 3);
    }

    #[test]
    fn smart_auto_global_budget_scales_with_cores_and_stays_bounded() {
        assert_eq!(smart_auto_global_parallelism(0), 2);
        assert_eq!(smart_auto_global_parallelism(1), 2);
        assert_eq!(smart_auto_global_parallelism(2), 4);
        assert_eq!(smart_auto_global_parallelism(64), MAX_SMART_AUTO_IMPORTS);
    }

    #[test]
    fn share_preparation_ids_are_unique() {
        assert_ne!(next_share_id(), next_share_id());
    }

    #[tokio::test]
    async fn source_mutation_after_planning_is_rejected_before_import() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("payload.txt");
        fs::write(&path, b"original").expect("source");
        let source = Source {
            name: "payload.txt".into(),
            path: path.clone(),
            snapshot: source_snapshot(&path).expect("snapshot"),
        };
        fs::write(&path, b"changed content").expect("mutate source");
        let store = iroh_blobs::store::mem::MemStore::new();

        assert!(
            import_source(store.as_ref(), source, 0, 8, None, false, None)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn cancelled_share_preparation_stops_before_importing_next_source() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("payload.txt");
        fs::write(&path, b"payload").expect("source");
        let source = Source {
            name: "payload.txt".into(),
            path,
            snapshot: SourceSnapshot {
                size: 7,
                modified: None,
                #[cfg(unix)]
                device: 0,
                #[cfg(unix)]
                inode: 0,
                #[cfg(windows)]
                creation_time: 0,
            },
        };
        let (_cancel_tx, cancel_rx) = watch::channel(true);
        let store = iroh_blobs::store::mem::MemStore::new();

        let Err(error) =
            import_source(store.as_ref(), source, 0, 7, None, false, Some(cancel_rx)).await
        else {
            panic!("cancel should stop before import");
        };
        assert_eq!(error.to_string(), "Transfer cancelled");
    }

    #[cfg(unix)]
    #[test]
    fn directory_scanning_rejects_nested_symlinks() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().join("selected");
        let outside = dir.path().join("outside.txt");
        fs::create_dir(&root).expect("selected dir");
        fs::write(&outside, b"outside").expect("outside file");
        symlink(&outside, root.join("linked.txt")).expect("symlink");

        assert!(collect_sources(&[root], None).is_err());
    }
}
