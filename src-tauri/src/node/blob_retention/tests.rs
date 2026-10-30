//! Store GC behaviour: what is reclaimed and what must survive it.

use super::*;
use crate::node::endpoint::NodeStartOptions;
use crate::node::gc_gate::GcGate;
use crate::storage::history::{TransferRecord, TransferRecordStatus};
use crate::storage::resumable_receives::ResumableReceive;
use crate::storage::share_access;
use crate::transfer::metrics::{RouteKind, TransferStrategy};
use crate::transfer::progress::{TransferDirection, TransferInfo, TransferPhase};
use crate::transfer::receiver::{self, ReceiveLimits};
use crate::transfer::{sender, TransferMode};
use iroh::SecretKey;
use iroh_blobs::api::blobs::{AddPathOptions, BlobStatus, ImportMode};
use iroh_blobs::hashseq::HashSeq;
use iroh_blobs::protocol::{ChunkRanges, ChunkRangesExt};
use iroh_blobs::store::fs::FsStore;
use iroh_blobs::store::mem::MemStore;
use iroh_blobs::BlobFormat;
use std::path::PathBuf;
use std::time::Duration;

type TestResult<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

const TEST_GC_INTERVAL: Duration = Duration::from_millis(25);
const WAIT: Duration = Duration::from_secs(60);

async fn start_node(data_dir: PathBuf, download_dir: PathBuf) -> TestResult<LightningP2PNode> {
    Ok(LightningP2PNode::start_with_options(NodeStartOptions {
        data_dir,
        download_dir,
        relay_url: None,
        nearby_protocol: None,
        chat_protocol: None,
        profile: TransferMode::platform_default().profile(),
        local_discovery_enabled: false,
        gc_interval: TEST_GC_INTERVAL,
    })
    .await?)
}

async fn stop_node(node: LightningP2PNode) -> TestResult {
    node.shutdown().await?;
    drop(node);
    Ok(())
}

/// Returns once a GC run that started after this call has finished.
///
/// A fresh, unprotected sentinel is only collected by a run that cleared the
/// store's write protection after the sentinel was written. Runs are
/// sequential, so seeing a second sentinel go proves that the run which
/// collected the first one has completed.
async fn wait_for_full_gc_run(store: &Store) -> TestResult {
    for _ in 0..2 {
        let sentinel = store
            .add_bytes(uuid::Uuid::new_v4().as_bytes().to_vec())
            .temp_tag()
            .await?
            .hash();
        tokio::time::timeout(WAIT, async {
            while store.has(sentinel).await? {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            Ok::<_, iroh_blobs::api::RequestError>(())
        })
        .await??;
    }
    Ok(())
}

/// Every hash a collection share serves: root, metadata, and files.
async fn collection_hashes(store: &Store, root: Hash) -> TestResult<Vec<Hash>> {
    let links = HashSeq::try_from(store.get_bytes(root).await?)?;
    Ok(std::iter::once(root).chain(links.iter()).collect())
}

async fn present(store: &Store, hash: Hash) -> TestResult<bool> {
    Ok(!matches!(store.status(hash).await?, BlobStatus::NotFound))
}

fn write_payload(path: &Path, seed: u8) -> TestResult<Vec<u8>> {
    let payload = (0..256 * 1024_u32)
        .map(|index| seed.wrapping_add(index.to_le_bytes()[0] ^ index.to_le_bytes()[1]))
        .collect::<Vec<_>>();
    std::fs::write(path, &payload)?;
    Ok(payload)
}

/// Stores the first 16 KiB of a 1 MiB blob, like an interrupted download.
async fn import_partial_blob(store: &Store, hash: Hash, source: &Store) -> TestResult {
    let ranges = ChunkRanges::chunks(0..16);
    let bao = source.export_bao(hash, ranges.clone()).bao_to_vec().await?;
    store.import_bao_bytes(hash, ranges, bao).await?;
    assert!(matches!(
        store.status(hash).await?,
        BlobStatus::Partial { .. }
    ));
    Ok(())
}

fn resume_record(transfer_id: &str) -> ResumableReceive {
    ResumableReceive {
        transfer: TransferInfo {
            transfer_id: transfer_id.to_owned(),
            direction: TransferDirection::Receive,
            name: "partial.bin".into(),
            peer: None,
            bytes: 16 * 1024,
            total: 1024 * 1024,
            speed_bps: 0,
            route_kind: RouteKind::Unknown,
            phase: TransferPhase::Paused,
            failure_category: None,
            output_path: None,
            connect_ms: 0,
            download_ms: 0,
            export_ms: 0,
            provider_count: 1,
            direct_provider_count: 0,
            relay_provider_count: 0,
            strategy: TransferStrategy::QueuedSingleProvider,
            first_byte_ms: 0,
            effective_mbps: 0,
            can_resume: true,
        },
        limits: ReceiveLimits::default(),
        fallback_file_name: None,
        finalization: None,
        pending_offer_receipt: None,
    }
}

#[tokio::test]
async fn completed_receive_is_reclaimed_while_its_public_share_survives() -> TestResult {
    let root = tempfile::tempdir()?;
    let source = root.path().join("payload.bin");
    let payload = write_payload(&source, 1)?;
    let sender = start_node(root.path().join("sender"), root.path().join("sender-dl")).await?;
    let receiver = start_node(root.path().join("receiver"), root.path().join("recv-dl")).await?;

    let share = sender::create_share(&sender, vec![source]).await?;
    let ticket = ShareTicket::from_blob_ticket(share.ticket.clone());
    let shared = collection_hashes(sender.blobs_client(), share.hash).await?;
    // From here on only the share's persistent tags keep it.
    drop(share);

    let first_dir = root.path().join("first");
    tokio::time::timeout(
        WAIT,
        receiver::receive_ticket(&receiver, ticket.clone(), first_dir.clone()),
    )
    .await??;
    assert!(receiver.blobs_client().has(shared[0]).await?);

    wait_for_full_gc_run(receiver.blobs_client()).await?;
    wait_for_full_gc_run(sender.blobs_client()).await?;
    for hash in &shared {
        assert!(!present(receiver.blobs_client(), *hash).await?);
        assert!(sender.blobs_client().has(*hash).await?);
    }
    assert_eq!(std::fs::read(first_dir.join("payload.bin"))?, payload);

    // The link keeps working after the sender's store was collected.
    let second_dir = root.path().join("second");
    tokio::time::timeout(
        WAIT,
        receiver::receive_ticket(&receiver, ticket, second_dir.clone()),
    )
    .await??;
    assert_eq!(std::fs::read(second_dir.join("payload.bin"))?, payload);

    stop_node(receiver).await?;
    stop_node(sender).await
}

#[tokio::test]
async fn nearby_offer_survives_until_its_grant_ends() -> TestResult {
    let root = tempfile::tempdir()?;
    let source = root.path().join("offer.bin");
    write_payload(&source, 2)?;
    let node = start_node(root.path().join("data"), root.path().join("dl")).await?;
    let store = node.blobs_client();

    // Prepared but not yet offered: the share outcome alone keeps it.
    let share = sender::prepare_share(&node, vec![source]).await?;
    let hashes = collection_hashes(store, share.hash).await?;
    wait_for_full_gc_run(store).await?;
    for hash in &hashes {
        assert!(store.has(*hash).await?);
    }

    // Offer pending: the recipient's live grant keeps it.
    let recipient = SecretKey::from_bytes(&[7; 32]).public();
    node.authorize_private_peer(recipient, share.hash).await?;
    let root_hash = share.hash;
    drop(share);
    wait_for_full_gc_run(store).await?;
    for hash in &hashes {
        assert!(store.has(*hash).await?);
    }

    // Declined: nothing serves it any more, so it is reclaimed.
    node.revoke_private_peer(recipient, root_hash).await;
    wait_for_full_gc_run(store).await?;
    for hash in &hashes {
        assert!(!present(store, *hash).await?);
    }
    stop_node(node).await
}

#[tokio::test]
async fn resumable_partial_receive_survives_gc_and_restart() -> TestResult {
    let root = tempfile::tempdir()?;
    let data_dir = root.path().join("data");
    let source = MemStore::new();
    let mut hashes = Vec::new();
    for seed in 0..3_u8 {
        let tag = source.add_bytes(vec![seed; 1024 * 1024]).temp_tag().await?;
        hashes.push(tag.hash());
    }
    let (resumable, orphaned, completed) = (hashes[0], hashes[1], hashes[2]);
    let ids = [(); 3].map(|()| uuid::Uuid::new_v4().to_string());
    let node = start_node(data_dir.clone(), root.path().join("dl")).await?;
    for (id, hash) in ids.iter().zip([resumable, orphaned, completed]) {
        node.retain_receive(id, HashAndFormat::raw(hash)).await?;
        import_partial_blob(node.blobs_client(), hash, &source).await?;
    }
    let records = ResumableReceiveStore::load(&data_dir)?;
    records.save(resume_record(&ids[0]))?;
    records.save(resume_record(&ids[2]))?;
    // The completed receive's export already reached history; only its
    // recovery record (awaiting a receipt) is left.
    history::save_record(
        node.db(),
        &TransferRecord {
            transfer_id: Some(ids[2].clone()),
            hash: completed.to_string(),
            filename: "partial.bin".into(),
            size: 1024 * 1024,
            peer: None,
            timestamp: 0,
            direction: TransferDirection::Receive,
            status: Some(TransferRecordStatus::Completed),
        },
    )?;
    node.db().flush()?;

    wait_for_full_gc_run(node.blobs_client()).await?;
    for hash in [resumable, orphaned, completed] {
        assert!(present(node.blobs_client(), hash).await?);
    }
    stop_node(node).await?;

    // Startup keeps only receives a resume record can still pick up.
    let node = start_node(data_dir, root.path().join("dl")).await?;
    wait_for_full_gc_run(node.blobs_client()).await?;
    assert!(matches!(
        node.blobs_client().status(resumable).await?,
        BlobStatus::Partial { .. }
    ));
    assert!(!present(node.blobs_client(), orphaned).await?);
    assert!(!present(node.blobs_client(), completed).await?);
    stop_node(node).await
}

#[tokio::test]
async fn public_shares_from_older_releases_are_tagged_before_gc() -> TestResult {
    let root = tempfile::tempdir()?;
    let data_dir = root.path().join("data");
    let source = root.path().join("legacy.bin");
    write_payload(&source, 3)?;
    let node = start_node(data_dir.clone(), root.path().join("dl")).await?;
    let share = sender::prepare_share(&node, vec![source]).await?;
    let hashes = collection_hashes(node.blobs_client(), share.hash).await?;
    // Older releases recorded the grant without any store tag.
    share_access::authorize_public_hashes(node.db(), &hashes)?;
    stop_node(node).await?;
    drop(share);

    let node = start_node(data_dir, root.path().join("dl")).await?;
    let mut tagged = HashSet::new();
    let mut tags = node
        .blobs_client()
        .tags()
        .list_prefix(SHARE_TAG_PREFIX)
        .await?;
    while let Some(tag) = tags.next().await {
        tagged.insert(tag?.hash);
    }
    wait_for_full_gc_run(node.blobs_client()).await?;
    for hash in &hashes {
        assert!(tagged.contains(hash));
        assert!(node.blobs_client().has(*hash).await?);
    }
    stop_node(node).await
}

#[tokio::test]
async fn reclaiming_an_in_place_reference_never_touches_the_source_file() -> TestResult {
    let root = tempfile::tempdir()?;
    let source = root.path().join("referenced.bin");
    let payload = write_payload(&source, 4)?;
    let store_dir = root.path().join("blobs");
    let gate = GcGate::default();
    let store = FsStore::load_with_opts(
        store_dir.join("blobs.db"),
        gate.store_options(&store_dir, TEST_GC_INTERVAL),
    )
    .await?;
    gate.arm(crate::node::blob_access::BlobAccessController::default());

    let hash = store
        .add_path_with_opts(AddPathOptions {
            path: source.clone(),
            format: BlobFormat::Raw,
            mode: ImportMode::TryReference,
        })
        .temp_tag()
        .await?
        .hash();
    // Referenced in place: the store holds no copy of the data.
    assert!(!store_dir.join("data").join(format!("{hash}.data")).exists());

    wait_for_full_gc_run(&store).await?;
    assert!(!present(&store, hash).await?);
    assert_eq!(std::fs::read(&source)?, payload);
    store.shutdown().await?;
    Ok(())
}
