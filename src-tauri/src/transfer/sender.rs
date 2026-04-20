//! Sender: imports content into iroh-blobs and produces share tickets.

use crate::error::{FastDropError, Result};
use crate::node::FastDropNode;
use crate::storage::history::{self, TransferRecord};
use crate::transfer::metrics::{RouteKind, TransferMetrics};
use crate::transfer::progress::{
    EventReporter, FailureCategory, ProgressHandle, ProgressSampler, TransferDirection,
    TransferPhase,
};
use futures_util::stream;
use futures_util::StreamExt;
use iroh_blobs::format::collection::Collection;
use iroh_blobs::provider::AddProgress;
use iroh_blobs::rpc::client::blobs::{MemClient, WrapOption};
use iroh_blobs::ticket::BlobTicket;
use iroh_blobs::util::fs::{scan_path, DataSource};
use iroh_blobs::util::{SetTagOption, Tag};
use iroh_blobs::Hash;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::Window;

const MAX_IMPORT_PARALLELISM: usize = 128;

struct SharePlan {
    sources: Vec<DataSource>,
    label: String,
    total_size: u64,
}

struct ImportedSource {
    name: String,
    hash: Hash,
    tag: Tag,
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
/// Returns `FastDropError` if the paths are invalid, the add operation fails,
/// or the ticket cannot be generated.
pub async fn send_files(
    node: &FastDropNode,
    window: Window,
    paths: Vec<PathBuf>,
) -> Result<ShareOutcome> {
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
    let sampler = ProgressSampler::spawn(reporter.clone(), None);
    let progress = sampler.handle();

    let result = create_share_with_plan(node, plan, Some(progress.clone())).await;
    match result {
        Ok(outcome) => {
            let metrics = TransferMetrics {
                route_kind: RouteKind::Unknown,
                connect_ms: elapsed_ms(started_at.elapsed()),
                download_ms: 0,
                export_ms: 0,
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
            let _ = reporter.emit_failed(
                &error.to_string(),
                progress.metrics_snapshot().route_kind,
                Some(FailureCategory::Unknown),
            );
            Err(error)
        }
    }
}

/// Adds files or directories to the local blob store without emitting UI events.
///
/// # Errors
///
/// Returns `FastDropError` if the paths are invalid, the add operation fails,
/// or the ticket cannot be generated.
pub async fn create_share(node: &FastDropNode, paths: Vec<PathBuf>) -> Result<ShareOutcome> {
    let plan = build_share_plan(paths)?;
    create_share_with_plan(node, plan, None).await
}

async fn create_share_with_plan(
    node: &FastDropNode,
    plan: SharePlan,
    progress: Option<ProgressHandle>,
) -> Result<ShareOutcome> {
    let imported = import_sources(node.blobs_client().clone(), &plan, progress).await?;
    let hash = persist_collection(node.blobs_client(), imported).await?;
    let ticket = build_ticket(node, hash).await?;
    tracing::info!(ticket = %ticket, hash = %hash, "FastDrop share ticket created");
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
        return Err(FastDropError::Other("No files selected".into()));
    }
    paths
        .into_iter()
        .map(|path| path.canonicalize().map_err(FastDropError::from))
        .collect()
}

fn collect_sources(paths: &[PathBuf]) -> Result<Vec<DataSource>> {
    let mut sources = Vec::new();
    for path in paths {
        let mut scanned = scan_path(path.clone(), WrapOption::Wrap { name: None })
            .map_err(|err| FastDropError::Blob(err.to_string()))?;
        sources.append(&mut scanned);
    }
    if sources.is_empty() {
        return Err(FastDropError::Other(
            "Cannot share an empty directory".into(),
        ));
    }
    ensure_unique_names(&sources)?;
    Ok(sources)
}

fn ensure_unique_names(sources: &[DataSource]) -> Result<()> {
    let mut names = HashSet::new();
    for source in sources {
        let name = source.name().into_owned();
        if !names.insert(name.clone()) {
            return Err(FastDropError::Other(format!(
                "Duplicate share path name: {name}"
            )));
        }
    }
    Ok(())
}

fn total_size(sources: &[DataSource]) -> Result<u64> {
    sources
        .iter()
        .try_fold(0, |total, source| Ok(total + file_size(source.path())?))
}

fn file_size(path: &Path) -> Result<u64> {
    Ok(fs::metadata(path)?.len())
}

fn summarize_sources(sources: &[DataSource]) -> String {
    let mut roots = sources
        .iter()
        .map(|source| {
            source
                .name()
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
    client: MemClient,
    plan: &SharePlan,
    progress: Option<ProgressHandle>,
) -> Result<Vec<ImportedSource>> {
    let tasks = plan
        .sources
        .iter()
        .cloned()
        .enumerate()
        .map(|(index, source)| {
            import_task(&client, source, index, plan.total_size, progress.clone())
        });
    let mut pending = stream::iter(tasks).buffer_unordered(import_parallelism(plan.sources.len()));
    let mut imported = Vec::with_capacity(plan.sources.len());

    while let Some(item) = pending.next().await {
        imported.push(item?);
    }

    imported.sort_by_key(|item| item.index);
    Ok(imported.into_iter().map(|item| item.source).collect())
}

fn import_task(
    client: &MemClient,
    source: DataSource,
    index: usize,
    total_size: u64,
    progress: Option<ProgressHandle>,
) -> impl std::future::Future<Output = Result<IndexedImport>> {
    let client = client.clone();
    async move { import_source(client, source, index, total_size, progress).await }
}

fn import_parallelism(source_count: usize) -> usize {
    // Import is I/O-bound (disk read + hashing handled by iroh-blobs in async tasks),
    // so CPU count is a poor proxy — NVMe can comfortably absorb many in-flight imports.
    // Scale directly with the batch size, capped at MAX.
    source_count.clamp(1, MAX_IMPORT_PARALLELISM)
}

async fn import_source(
    client: MemClient,
    source: DataSource,
    index: usize,
    total_size: u64,
    progress: Option<ProgressHandle>,
) -> Result<IndexedImport> {
    let size = file_size(source.path())?;
    let mut last_offset = 0u64;
    let mut stream = client
        .add_from_path(
            source.path().to_path_buf(),
            true,
            SetTagOption::Auto,
            WrapOption::NoWrap,
        )
        .await
        .map_err(|err| blob_error(&err))?;

    while let Some(event) = stream.next().await {
        let event = event.map_err(|err| blob_error(&err))?;
        if let Some(imported) = handle_add_progress(
            event,
            &source,
            size,
            total_size,
            progress.as_ref(),
            &mut last_offset,
        )? {
            return Ok(IndexedImport {
                index,
                source: imported,
            });
        }
    }

    Err(FastDropError::Blob(
        "Import stream ended before completion".into(),
    ))
}

fn handle_add_progress(
    event: AddProgress,
    source: &DataSource,
    size: u64,
    total_size: u64,
    progress: Option<&ProgressHandle>,
    last_offset: &mut u64,
) -> Result<Option<ImportedSource>> {
    match event {
        AddProgress::Found { .. } | AddProgress::Done { .. } => Ok(None),
        AddProgress::Progress { offset, .. } => {
            advance_progress(progress, offset.saturating_sub(*last_offset), total_size);
            *last_offset = offset;
            Ok(None)
        }
        AddProgress::AllDone { hash, tag, .. } => {
            advance_progress(progress, size.saturating_sub(*last_offset), total_size);
            Ok(Some(ImportedSource {
                name: source.name().into_owned(),
                hash,
                tag,
            }))
        }
        AddProgress::Abort(error) => Err(FastDropError::Blob(error.to_string())),
    }
}

fn advance_progress(progress: Option<&ProgressHandle>, bytes_delta: u64, total_size: u64) {
    if let Some(progress) = progress {
        progress.advance(bytes_delta, total_size);
    }
}

async fn persist_collection(client: &MemClient, imported: Vec<ImportedSource>) -> Result<Hash> {
    let tags = imported
        .iter()
        .map(|item| item.tag.clone())
        .collect::<Vec<_>>();
    let collection = imported
        .into_iter()
        .map(|item| (item.name, item.hash))
        .collect::<Collection>();
    client
        .create_collection(collection, SetTagOption::Auto, tags)
        .await
        .map(|(hash, _tag)| hash)
        .map_err(|err| blob_error(&err))
}

async fn build_ticket(node: &FastDropNode, hash: Hash) -> Result<BlobTicket> {
    BlobTicket::new(
        node.ticket_addr().await?,
        hash,
        iroh_blobs::BlobFormat::HashSeq,
    )
    .map_err(|err| blob_error(&err))
}

fn save_send_record(node: &FastDropNode, outcome: &ShareOutcome) -> Result<()> {
    history::save_record(
        &node.db,
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

fn blob_error(err: &impl ToString) -> FastDropError {
    FastDropError::Blob(err.to_string())
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

fn elapsed_ms(duration: std::time::Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarize_single_root() {
        let sources = vec![DataSource::with_name("a.txt".into(), "folder/a.txt".into())];
        assert_eq!(summarize_sources(&sources), "folder");
    }

    #[test]
    fn summarize_multiple_roots() {
        let sources = vec![
            DataSource::with_name("a.txt".into(), "one/a.txt".into()),
            DataSource::with_name("b.txt".into(), "two/b.txt".into()),
        ];
        assert_eq!(summarize_sources(&sources), "2 items");
    }

    #[test]
    fn duplicate_names_are_rejected() {
        let sources = vec![
            DataSource::with_name("a.txt".into(), "dup.txt".into()),
            DataSource::with_name("b.txt".into(), "dup.txt".into()),
        ];
        let err = ensure_unique_names(&sources).expect_err("duplicates should fail");
        assert!(err.to_string().contains("Duplicate share path name"));
    }

    #[test]
    fn parallelism_is_bounded() {
        assert_eq!(import_parallelism(1), 1);
        assert!(import_parallelism(256) <= MAX_IMPORT_PARALLELISM);
    }
}
