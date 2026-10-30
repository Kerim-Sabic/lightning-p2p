//! Blob-store retention: what the transfer store keeps, and when garbage
//! collection may reclaim the rest.
//!
//! iroh-blobs garbage collection deletes every blob that no tag, temp tag, or
//! protect callback keeps alive. The store therefore marks everything it must
//! keep:
//!
//! - `share/<root>` pins every share prepared on this device.
//! - `receive/<transfer id>` pins a receive while it downloads and for as long
//!   as a resume record exists, so pause and restart-safe resume keep their
//!   verified data.
//! - `legacy/<hash>` pins everything that was already in the store when
//!   retention was introduced, so no earlier share loses its data.
//!
//! A received share is released once it has been saved and its resume record
//! is gone. Collection runs shortly after every release, so the store's copy
//! of saved content leaves app data within seconds even in short sessions,
//! and waits until the legacy migration has finished.

use crate::error::{LightningP2PError, Result};
use crate::storage::resumable_receives::ResumableReceiveStore;
use futures_util::StreamExt;
use iroh_blobs::api::Store;
use iroh_blobs::hashseq::HashSeq;
use iroh_blobs::store::fs::options::Options;
use iroh_blobs::store::{GcConfig, ProtectCb, ProtectOutcome};
use iroh_blobs::{BlobFormat, Hash, HashAndFormat};
use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

const SHARE_TAG_PREFIX: &str = "share/";
const RECEIVE_TAG_PREFIX: &str = "receive/";
const LEGACY_TAG_PREFIX: &str = "legacy/";
/// Written once every pre-existing blob carries a legacy tag.
const MIGRATION_MARKER: &str = ".retention-v1";
/// How often the collector wakes. A wake costs nothing unless content was
/// released, so saved duplicates are freed within seconds of a receive.
const GC_TICK: Duration = Duration::from_secs(10);
/// Collection walks every tag and hash sequence, so without a release it
/// runs only this often.
const GC_INTERVAL: Duration = Duration::from_secs(10 * 60);

/// Bumped by every release; each store's collector runs once it settles.
static RELEASES: AtomicU64 = AtomicU64::new(0);

/// Store options with garbage collection gated on `ready`. Until the gate
/// opens, every collection run aborts before deleting anything.
pub(crate) fn store_options(blob_dir: &Path, ready: Arc<AtomicBool>) -> Options {
    options_with_interval(blob_dir, ready, GC_TICK)
}

/// [`store_options`] with a custom collector wake interval.
pub(crate) fn options_with_interval(
    blob_dir: &Path,
    ready: Arc<AtomicBool>,
    tick: Duration,
) -> Options {
    let mut options = Options::new(blob_dir);
    options.gc = Some(GcConfig {
        interval: tick,
        add_protected: Some(gate(ready, tick)),
    });
    options
}

/// Decides, on every collector wake, whether this wake collects.
struct Collector {
    /// Release count when this collector last ran (`u64::MAX`: never ran,
    /// so the first settled wake collects what earlier sessions released).
    collected: AtomicU64,
    /// Release count seen on the previous wake.
    previous: AtomicU64,
    idle_wakes: AtomicU64,
    wakes_per_sweep: u64,
}

impl Collector {
    fn new(tick: Duration) -> Self {
        let wakes = GC_INTERVAL.as_millis() / tick.as_millis().max(1);
        Self {
            collected: AtomicU64::new(u64::MAX),
            previous: AtomicU64::new(u64::MAX),
            idle_wakes: AtomicU64::new(0),
            wakes_per_sweep: u64::try_from(wakes).unwrap_or(u64::MAX).max(1),
        }
    }

    /// Collects once `releases` has been quiet for one wake, so a burst of
    /// receives is collected once after it ends rather than mid-transfer.
    fn should_collect(&self, releases: u64) -> bool {
        let settled = self.previous.swap(releases, Ordering::SeqCst) == releases;
        let idle_wakes = self.idle_wakes.fetch_add(1, Ordering::SeqCst) + 1;
        let uncollected = settled && self.collected.load(Ordering::SeqCst) != releases;
        if uncollected || idle_wakes >= self.wakes_per_sweep {
            self.collected.store(releases, Ordering::SeqCst);
            self.idle_wakes.store(0, Ordering::SeqCst);
            return true;
        }
        false
    }
}

fn gate(ready: Arc<AtomicBool>, tick: Duration) -> ProtectCb {
    let collector = Arc::new(Collector::new(tick));
    Arc::new(move |_live| {
        let open = ready.load(Ordering::SeqCst);
        let outcome = if open && collector.should_collect(RELEASES.load(Ordering::SeqCst)) {
            ProtectOutcome::Continue
        } else {
            ProtectOutcome::Abort
        };
        Box::pin(async move { outcome })
    })
}

/// Pins every blob already in the store, once. Idempotent; a run that stops
/// part-way repeats on the next start because the marker is written last.
///
/// # Errors
///
/// Returns `LightningP2PError::Blob` if the store cannot be listed or tagged.
pub(crate) async fn migrate_legacy_content(store: &Store, blob_dir: &Path) -> Result<()> {
    let marker = blob_dir.join(MIGRATION_MARKER);
    if marker.exists() {
        return Ok(());
    }
    let mut blobs = store
        .blobs()
        .list()
        .stream()
        .await
        .map_err(|error| blob_error(&error))?;
    let mut pinned = 0_usize;
    while let Some(hash) = blobs.next().await {
        let hash = hash.map_err(|error| blob_error(&error))?;
        store
            .tags()
            .set(legacy_tag(hash), HashAndFormat::raw(hash))
            .await
            .map_err(|error| blob_error(&error))?;
        pinned += 1;
    }
    tokio::fs::write(&marker, b"1").await?;
    tracing::info!(pinned, "pinned existing transfer-store content");
    Ok(())
}

/// Pins a prepared share so collection never removes content a ticket can
/// still request.
///
/// # Errors
///
/// Returns `LightningP2PError::Blob` if the tag cannot be stored.
pub(crate) async fn pin_share(store: &Store, root: Hash) -> Result<()> {
    store
        .tags()
        .set(
            format!("{SHARE_TAG_PREFIX}{root}"),
            HashAndFormat::hash_seq(root),
        )
        .await
        .map_err(|error| blob_error(&error))
}

/// Pins the content of a receive before it starts downloading.
///
/// # Errors
///
/// Returns `LightningP2PError::Blob` if the tag cannot be stored.
pub(crate) async fn pin_receive(store: &Store, id: &str, content: HashAndFormat) -> Result<()> {
    store
        .tags()
        .set(receive_tag(id), content)
        .await
        .map_err(|error| blob_error(&error))
}

/// Releases a receive's pin. Failures are logged: an unreleased pin only
/// keeps a duplicate in app data until the next startup reconcile.
pub(crate) async fn release_receive(store: &Store, id: &str) {
    if let Err(error) = store.tags().delete(receive_tag(id)).await {
        tracing::warn!(%error, "could not release received content for reclaim");
    }
    RELEASES.fetch_add(1, Ordering::SeqCst);
}

/// Every hash some pin other than `receive/<own_id>` keeps alive: shares,
/// legacy content, other receives, and each child of a pinned hash sequence.
/// A save may hard-link only content outside this set, so editing a saved
/// file in place can never change bytes a share or paused receive serves.
///
/// # Errors
///
/// Returns `LightningP2PError::Blob` if tags cannot be listed.
pub(crate) async fn pinned_elsewhere(store: &Store, own_id: &str) -> Result<HashSet<Hash>> {
    let own = receive_tag(own_id);
    let mut tags = store
        .tags()
        .list()
        .await
        .map_err(|error| blob_error(&error))?;
    let mut pinned = HashSet::new();
    let mut sequences = Vec::new();
    while let Some(tag) = tags.next().await {
        let tag = tag.map_err(|error| blob_error(&error))?;
        if tag.name.as_ref() == own.as_bytes() {
            continue;
        }
        pinned.insert(tag.hash);
        if tag.format == BlobFormat::HashSeq {
            sequences.push(tag.hash);
        }
    }
    for root in sequences {
        // A pinned sequence that is still downloading pins no children yet.
        let Ok(bytes) = store.blobs().get_bytes(root).await else {
            continue;
        };
        if let Ok(sequence) = HashSeq::try_from(bytes) {
            pinned.extend(sequence.iter());
        }
    }
    Ok(pinned)
}

/// Drops receive pins that have no resume record, left behind by a receive
/// that ended without cleanup (crash, forced quit). Run at node start, before
/// any receive begins.
///
/// # Errors
///
/// Returns `LightningP2PError::Blob` if receive tags cannot be listed.
pub(crate) async fn release_orphaned_receives(store: &Store, data_dir: &Path) -> Result<()> {
    let resumable = ResumableReceiveStore::load(data_dir)?;
    let mut tags = store
        .tags()
        .list_prefix(RECEIVE_TAG_PREFIX)
        .await
        .map_err(|error| blob_error(&error))?;
    let mut orphans = Vec::new();
    while let Some(tag) = tags.next().await {
        let tag = tag.map_err(|error| blob_error(&error))?;
        let name = String::from_utf8_lossy(tag.name.as_ref()).into_owned();
        if let Some(id) = name.strip_prefix(RECEIVE_TAG_PREFIX) {
            if resumable.get(id).is_none() {
                orphans.push(id.to_owned());
            }
        }
    }
    for id in &orphans {
        release_receive(store, id).await;
    }
    if !orphans.is_empty() {
        tracing::info!(released = orphans.len(), "released orphaned receive pins");
    }
    Ok(())
}

fn receive_tag(id: &str) -> String {
    format!("{RECEIVE_TAG_PREFIX}{id}")
}

fn legacy_tag(hash: Hash) -> String {
    format!("{LEGACY_TAG_PREFIX}{hash}")
}

fn blob_error(error: &impl ToString) -> LightningP2PError {
    LightningP2PError::Blob(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use iroh_blobs::store::fs::FsStore;

    async fn tag_names(store: &Store) -> HashSet<String> {
        let mut names = HashSet::new();
        let mut tags = store.tags().list().await.expect("list tags");
        while let Some(tag) = tags.next().await {
            let tag = tag.expect("tag");
            names.insert(String::from_utf8_lossy(tag.name.as_ref()).into_owned());
        }
        names
    }

    async fn wait_until_missing(store: &Store, hash: Hash) -> bool {
        for _ in 0..200 {
            if matches!(
                store.blobs().status(hash).await.expect("status"),
                iroh_blobs::api::proto::BlobStatus::NotFound
            ) {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        false
    }

    async fn is_complete(store: &Store, hash: Hash) -> bool {
        matches!(
            store.blobs().status(hash).await.expect("status"),
            iroh_blobs::api::proto::BlobStatus::Complete { .. }
        )
    }

    #[tokio::test]
    async fn collection_reclaims_released_receives_and_keeps_pinned_content() {
        let dir = tempfile::tempdir().expect("tempdir");
        let blob_dir = dir.path().join("blobs");
        let ready = Arc::new(AtomicBool::new(true));
        let store = FsStore::load_with_opts(
            blob_dir.join("blobs.db"),
            options_with_interval(&blob_dir, ready, Duration::from_millis(50)),
        )
        .await
        .expect("store");
        let shared = store
            .add_bytes(vec![1_u8; 64 * 1024])
            .temp_tag()
            .await
            .unwrap()
            .hash();
        let root = iroh_blobs::format::collection::Collection::from_iter([(
            "shared.bin".to_string(),
            shared,
        )])
        .store(&store)
        .await
        .unwrap()
        .hash();
        pin_share(&store, root).await.unwrap();
        let resumable = store
            .add_bytes(vec![2_u8; 64 * 1024])
            .temp_tag()
            .await
            .unwrap()
            .hash();
        pin_receive(&store, "paused", HashAndFormat::raw(resumable))
            .await
            .unwrap();
        let saved = store
            .add_bytes(vec![3_u8; 64 * 1024])
            .temp_tag()
            .await
            .unwrap()
            .hash();
        pin_receive(&store, "saved", HashAndFormat::raw(saved))
            .await
            .unwrap();

        release_receive(&store, "saved").await;

        assert!(
            wait_until_missing(&store, saved).await,
            "released receive was not reclaimed"
        );
        assert!(is_complete(&store, root).await);
        assert!(is_complete(&store, shared).await);
        assert!(is_complete(&store, resumable).await);
        store.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn closed_gate_keeps_everything_even_without_pins() {
        let dir = tempfile::tempdir().expect("tempdir");
        let blob_dir = dir.path().join("blobs");
        let ready = Arc::new(AtomicBool::new(false));
        let store = FsStore::load_with_opts(
            blob_dir.join("blobs.db"),
            options_with_interval(&blob_dir, ready, Duration::from_millis(20)),
        )
        .await
        .expect("store");
        let unpinned = store
            .add_bytes(vec![4_u8; 64 * 1024])
            .temp_tag()
            .await
            .unwrap()
            .hash();

        tokio::time::sleep(Duration::from_millis(300)).await;

        assert!(is_complete(&store, unpinned).await);
        store.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn gate_aborts_collection_until_ready() {
        let ready = Arc::new(AtomicBool::new(false));
        let gate = gate(ready.clone(), GC_TICK);
        let mut live = HashSet::new();
        for _ in 0..3 {
            assert!(matches!(gate(&mut live).await, ProtectOutcome::Abort));
        }
        ready.store(true, Ordering::SeqCst);
        let mut outcomes = Vec::new();
        for _ in 0..3 {
            outcomes.push(matches!(gate(&mut live).await, ProtectOutcome::Continue));
        }
        assert!(outcomes.contains(&true), "an open gate never collected");
    }

    #[test]
    fn collector_runs_once_releases_settle() {
        let collector = Collector::new(GC_TICK);
        assert!(!collector.should_collect(0), "the first wake only settles");
        assert!(
            collector.should_collect(0),
            "then earlier releases are collected"
        );
        assert!(!collector.should_collect(0), "nothing new was released");
        assert!(
            !collector.should_collect(1),
            "a release waits one quiet wake"
        );
        assert!(!collector.should_collect(2), "a burst keeps waiting");
        assert!(
            collector.should_collect(2),
            "settled releases are collected"
        );
        assert!(!collector.should_collect(2));
    }

    #[test]
    fn collector_also_sweeps_without_releases() {
        let collector = Collector::new(GC_INTERVAL / 3);
        assert!(!collector.should_collect(5));
        assert!(collector.should_collect(5));
        assert!(!collector.should_collect(5));
        assert!(!collector.should_collect(5));
        assert!(collector.should_collect(5), "slow sweep after the interval");
    }

    #[tokio::test]
    async fn pins_elsewhere_cover_shares_children_and_other_receives_only() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = FsStore::load(dir.path().join("blobs"))
            .await
            .expect("store");
        let child = store
            .add_bytes(vec![5_u8; 64 * 1024])
            .temp_tag()
            .await
            .unwrap();
        let root = iroh_blobs::format::collection::Collection::from_iter([(
            "child.bin".to_string(),
            child.hash(),
        )])
        .store(&store)
        .await
        .unwrap();
        pin_share(&store, root.hash()).await.unwrap();
        let paused = store
            .add_bytes(vec![6_u8; 64 * 1024])
            .temp_tag()
            .await
            .unwrap();
        pin_receive(&store, "paused", HashAndFormat::raw(paused.hash()))
            .await
            .unwrap();
        let own = store
            .add_bytes(vec![7_u8; 64 * 1024])
            .temp_tag()
            .await
            .unwrap();
        pin_receive(&store, "own", HashAndFormat::raw(own.hash()))
            .await
            .unwrap();

        let pinned = pinned_elsewhere(&store, "own").await.expect("pins");

        assert!(pinned.contains(&root.hash()));
        assert!(pinned.contains(&child.hash()));
        assert!(pinned.contains(&paused.hash()));
        assert!(!pinned.contains(&own.hash()));
        store.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn migration_pins_existing_blobs_once() {
        let dir = tempfile::tempdir().expect("tempdir");
        let blob_dir = dir.path().join("blobs");
        let store = FsStore::load(&blob_dir).await.expect("store");
        let existing = store.add_bytes(vec![7_u8; 64 * 1024]).await.unwrap().hash;

        migrate_legacy_content(&store, &blob_dir)
            .await
            .expect("migrate");
        let later = store.add_bytes(vec![9_u8; 64 * 1024]).await.unwrap().hash;
        migrate_legacy_content(&store, &blob_dir)
            .await
            .expect("second run");

        let names = tag_names(&store).await;
        assert!(names.contains(&legacy_tag(existing)));
        assert!(!names.contains(&legacy_tag(later)));
        assert!(blob_dir.join(MIGRATION_MARKER).exists());
        store.shutdown().await.expect("shutdown");
    }

    #[tokio::test]
    async fn orphaned_receive_pins_are_released() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = FsStore::load(dir.path().join("blobs"))
            .await
            .expect("store");
        let hash = store.add_bytes(b"received".to_vec()).await.unwrap().hash;
        pin_receive(&store, "orphan", HashAndFormat::raw(hash))
            .await
            .unwrap();

        release_orphaned_receives(&store, dir.path())
            .await
            .expect("reconcile");

        assert!(!tag_names(&store).await.contains(&receive_tag("orphan")));
        store.shutdown().await.expect("shutdown");
    }
}
