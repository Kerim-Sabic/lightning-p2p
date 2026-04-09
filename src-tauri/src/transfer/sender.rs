//! Sender: imports content into iroh-blobs and produces share tickets.

use crate::error::{FastDropError, Result};
use crate::node::FastDropNode;
use crate::storage::history::{self, TransferRecord};
use crate::transfer::progress::{EventReporter, TransferDirection};
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
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Window;

struct SharePlan {
    sources: Vec<DataSource>,
    label: String,
    total_size: u64,
}

struct ImportedSource {
    name: String,
    hash: Hash,
    tag: Tag,
    size: u64,
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

trait ShareObserver {
    fn started(&mut self, total_size: u64) -> Result<()>;
    fn progress(&mut self, bytes: u64, total_size: u64) -> Result<()>;
    fn completed(&mut self, hash: Hash, total_size: u64) -> Result<()>;
    fn failed(&mut self, error: &FastDropError) -> Result<()>;
}

struct NoopShareObserver;

impl ShareObserver for NoopShareObserver {
    fn started(&mut self, _total_size: u64) -> Result<()> {
        Ok(())
    }

    fn progress(&mut self, _bytes: u64, _total_size: u64) -> Result<()> {
        Ok(())
    }

    fn completed(&mut self, _hash: Hash, _total_size: u64) -> Result<()> {
        Ok(())
    }

    fn failed(&mut self, _error: &FastDropError) -> Result<()> {
        Ok(())
    }
}

struct WindowShareObserver {
    reporter: EventReporter,
}

impl WindowShareObserver {
    fn new(window: Window, label: String) -> Self {
        Self {
            reporter: EventReporter::new(window, "share".into(), TransferDirection::Send, label, None),
        }
    }
}

impl ShareObserver for WindowShareObserver {
    fn started(&mut self, total_size: u64) -> Result<()> {
        self.reporter.emit_started(total_size)
    }

    fn progress(&mut self, bytes: u64, total_size: u64) -> Result<()> {
        if let Some(update) = self.reporter.progress_update(bytes, total_size) {
            self.reporter.emit_progress(update)?;
        }
        Ok(())
    }

    fn completed(&mut self, hash: Hash, total_size: u64) -> Result<()> {
        self.reporter.emit_completed(hash.to_string(), total_size)
    }

    fn failed(&mut self, error: &FastDropError) -> Result<()> {
        self.reporter.emit_failed(&error.to_string())
    }
}

/// Adds files or directories to the local blob store and returns a share ticket.
///
/// # Errors
///
/// Returns `FastDropError` if the paths are invalid, the add operation fails,
/// or the ticket cannot be generated.
pub async fn send_files(node: &FastDropNode, window: Window, paths: Vec<PathBuf>) -> Result<String> {
    let plan = build_share_plan(paths)?;
    let mut observer = WindowShareObserver::new(window, plan.label.clone());
    let result = create_share_with_plan(node, plan, &mut observer).await;
    match result {
        Ok(outcome) => {
            save_send_record(node, &outcome)?;
            Ok(outcome.ticket.to_string())
        }
        Err(error) => {
            let _ = observer.failed(&error);
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
    let mut observer = NoopShareObserver;
    create_share_with_plan(node, plan, &mut observer).await
}

async fn create_share_with_plan<O: ShareObserver>(
    node: &FastDropNode,
    plan: SharePlan,
    observer: &mut O,
) -> Result<ShareOutcome> {
    observer.started(plan.total_size)?;
    let imported = import_sources(node.blobs_client(), &plan, observer).await?;
    let hash = persist_collection(node.blobs_client(), imported).await?;
    let ticket = build_ticket(node, hash).await?;
    observer.completed(hash, plan.total_size)?;
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
        return Err(FastDropError::Other("Cannot share an empty directory".into()));
    }
    ensure_unique_names(&sources)?;
    Ok(sources)
}

fn ensure_unique_names(sources: &[DataSource]) -> Result<()> {
    let mut names = HashSet::new();
    for source in sources {
        let name = source.name().into_owned();
        if !names.insert(name.clone()) {
            return Err(FastDropError::Other(format!("Duplicate share path name: {name}")));
        }
    }
    Ok(())
}

fn total_size(sources: &[DataSource]) -> Result<u64> {
    sources.iter().try_fold(0, |total, source| Ok(total + file_size(source.path())?))
}

fn file_size(path: &Path) -> Result<u64> {
    Ok(fs::metadata(path)?.len())
}

fn summarize_sources(sources: &[DataSource]) -> String {
    let mut roots = sources
        .iter()
        .map(|source| source.name().split('/').next().unwrap_or_default().to_string())
        .collect::<Vec<_>>();
    roots.sort();
    roots.dedup();
    match roots.as_slice() {
        [single] => single.clone(),
        _ => format!("{} items", roots.len()),
    }
}

async fn import_sources<O: ShareObserver>(
    client: &MemClient,
    plan: &SharePlan,
    observer: &mut O,
) -> Result<Vec<ImportedSource>> {
    let mut imported = Vec::with_capacity(plan.sources.len());
    let mut completed = 0u64;

    for source in &plan.sources {
        let item = import_source(client, source, completed, plan.total_size, observer).await?;
        completed += item.size;
        imported.push(item);
    }

    Ok(imported)
}

async fn import_source<O: ShareObserver>(
    client: &MemClient,
    source: &DataSource,
    completed_before: u64,
    total_size: u64,
    observer: &mut O,
) -> Result<ImportedSource> {
    let mut stream = client
        .add_from_path(
            source.path().to_path_buf(),
            true,
            SetTagOption::Auto,
            WrapOption::NoWrap,
        )
        .await
        .map_err(|err| blob_error(&err))?;

    let mut imported = None;
    while let Some(event) = stream.next().await {
        let event = event.map_err(|err| blob_error(&err))?;
        imported = apply_add_progress(
            observer,
            source,
            completed_before,
            total_size,
            imported,
            event,
        )?;
    }

    imported.ok_or_else(|| FastDropError::Blob("Import stream ended before completion".into()))
}

fn apply_add_progress<O: ShareObserver>(
    observer: &mut O,
    source: &DataSource,
    completed_before: u64,
    total_size: u64,
    imported: Option<ImportedSource>,
    event: AddProgress,
) -> Result<Option<ImportedSource>> {
    match event {
        AddProgress::Found { .. } | AddProgress::Done { .. } => Ok(imported),
        AddProgress::Progress { offset, .. } => {
            observer.progress(completed_before + offset, total_size)?;
            Ok(imported)
        }
        AddProgress::AllDone { hash, tag, .. } => {
            let size = file_size(source.path())?;
            observer.progress(completed_before + size, total_size)?;
            Ok(Some(ImportedSource {
                name: source.name().into_owned(),
                hash,
                tag,
                size,
            }))
        }
        AddProgress::Abort(error) => Err(FastDropError::Blob(error.to_string())),
    }
}

async fn persist_collection(client: &MemClient, imported: Vec<ImportedSource>) -> Result<Hash> {
    let tags = imported.iter().map(|item| item.tag.clone()).collect::<Vec<_>>();
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
    BlobTicket::new(node.ticket_addr().await?, hash, iroh_blobs::BlobFormat::HashSeq)
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
}
