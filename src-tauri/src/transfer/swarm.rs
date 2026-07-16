//! Experimental swarm receive: concurrent child-blob downloads for collections.
//!
//! iroh-blobs' standard `HashSeq` download walks collection children
//! sequentially over a single stream, so many-file transfers pay one
//! round-trip of dead air per file. The swarm path first fetches the tiny
//! `HashSeq` root, then fans the children out over parallel *direct*
//! connections (`DownloadMode::Direct` applies no queue limits by design).
//! Every child still lands in the same verified iroh-blobs store, so
//! BLAKE3 verification and resume semantics are unchanged.
//!
//! Opt-in via Settings ("Swarm receive"), and the receiver falls back to the
//! standard sequential path if the swarm attempt fails for any reason other
//! than user cancellation, so enabling it is never worse than the default.

use crate::error::{LightningP2PError, Result};
use crate::node::LightningP2PNode;
use crate::transfer::mode::TransferProfile;
use crate::transfer::progress::{ProgressHandle, TransferPhase};
use crate::transfer::ticket::ShareTicket;
use futures_util::{stream, StreamExt};
use iroh::EndpointId;
use iroh_blobs::api::downloader::DownloadProgressItem;
use iroh_blobs::hashseq::HashSeq;
use iroh_blobs::Hash;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::watch;

/// Hard ceiling on concurrent child fetches. Each in-flight fetch is its own
/// QUIC connection to the sender, so this bounds sender-side load too.
const MAX_SWARM_FETCHES: usize = 16;

/// Floor on the per-stream idle timeout, mirroring the standard receive path.
const MIN_IDLE_TIMEOUT: Duration = Duration::from_secs(10);

/// Route/timing facts observed while the swarm ran.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct SwarmObservations {
    /// Milliseconds until the first successful peer contact.
    pub connect_ms: u64,
    /// Milliseconds until the first payload byte landed.
    pub first_byte_ms: u64,
}

/// Shared accounting across the concurrently polled child downloads.
struct SwarmTracker {
    started_at: Instant,
    done_bytes: AtomicU64,
    total_bytes: AtomicU64,
    contacted: AtomicBool,
    connect_ms: AtomicU64,
    first_byte_ms: AtomicU64,
}

impl SwarmTracker {
    fn new(known_total: Option<u64>) -> Self {
        Self {
            started_at: Instant::now(),
            done_bytes: AtomicU64::new(0),
            total_bytes: AtomicU64::new(known_total.unwrap_or(0)),
            contacted: AtomicBool::new(false),
            connect_ms: AtomicU64::new(0),
            first_byte_ms: AtomicU64::new(0),
        }
    }

    fn mark_contacted(&self) {
        if !self.contacted.swap(true, Ordering::Relaxed) {
            let _ = self.connect_ms.compare_exchange(
                0,
                elapsed_ms(self.started_at.elapsed()).max(1),
                Ordering::Relaxed,
                Ordering::Relaxed,
            );
        }
    }

    fn add_done(&self, delta: u64) {
        if delta == 0 {
            return;
        }
        self.done_bytes.fetch_add(delta, Ordering::Relaxed);
        let _ = self.first_byte_ms.compare_exchange(
            0,
            elapsed_ms(self.started_at.elapsed()).max(1),
            Ordering::Relaxed,
            Ordering::Relaxed,
        );
    }

    fn publish(&self, progress: Option<&ProgressHandle>) {
        if let Some(progress) = progress {
            progress.set(
                self.done_bytes.load(Ordering::Relaxed),
                self.total_bytes.load(Ordering::Relaxed),
            );
            if self.contacted.load(Ordering::Relaxed) {
                progress.set_phase(TransferPhase::Downloading);
                progress.set_connect_ms(self.connect_ms.load(Ordering::Relaxed));
            }
            let first_byte = self.first_byte_ms.load(Ordering::Relaxed);
            if first_byte > 0 {
                progress.set_first_byte_ms(first_byte);
            }
        }
    }

    fn observations(&self) -> SwarmObservations {
        SwarmObservations {
            connect_ms: self.connect_ms.load(Ordering::Relaxed),
            first_byte_ms: self.first_byte_ms.load(Ordering::Relaxed),
        }
    }
}

/// True when the swarm path applies: a collection ticket with children to
/// parallelize. Single-blob tickets gain nothing from fan-out.
pub(crate) fn eligible(ticket: &ShareTicket) -> bool {
    ticket.primary().recursive()
}

/// Number of concurrent child fetches for the active profile,
/// env-overridable for bench sweeps via `LIGHTNING_P2P_SWARM_PARALLELISM`.
pub(crate) fn swarm_parallelism(profile: TransferProfile) -> usize {
    std::env::var("LIGHTNING_P2P_SWARM_PARALLELISM")
        .ok()
        .and_then(|raw| raw.parse::<usize>().ok())
        .filter(|&n| n > 0)
        .unwrap_or(profile.swarm_parallelism)
        .clamp(1, MAX_SWARM_FETCHES)
}

/// Downloads a collection by fanning children out over parallel direct
/// connections. Returns route/timing observations for the metrics row.
///
/// # Errors
///
/// Returns `LightningP2PError` on cancellation, per-stream idle timeout, or
/// any child download failure. Verified children stay in the store, so a
/// retry (swarm or standard) only fetches what is still missing.
pub(crate) async fn download_collection(
    node: &LightningP2PNode,
    ticket: &ShareTicket,
    cancel_rx: &watch::Receiver<bool>,
    progress: Option<&ProgressHandle>,
    profile: TransferProfile,
) -> Result<SwarmObservations> {
    let idle_timeout = profile.idle_timeout.max(MIN_IDLE_TIMEOUT);
    // Teach the endpoint how to reach the sender, then dial by endpoint id.
    node.register_ticket_addrs(ticket.provider_node_addrs());
    let providers: Vec<EndpointId> = ticket
        .provider_node_addrs()
        .iter()
        .map(|addr| addr.id)
        .collect();
    let root = ticket.primary().hash();
    let tracker = SwarmTracker::new(ticket.size().filter(|&size| size > 0));

    // Stage 1: the HashSeq root is a tiny blob listing child hashes.
    fetch_blob(node, root, &providers, cancel_rx, &tracker, None, idle_timeout).await?;
    let children = read_child_hashes(node, root).await?;
    tracing::info!(
        children = children.len(),
        parallelism = swarm_parallelism(profile),
        "swarm receive: fanning out child downloads"
    );

    // Stage 2: fan the children out. Futures are polled in place (not
    // spawned), so the first error drops all in-flight siblings.
    let mut fan_out = stream::iter(children.into_iter().map(|child| {
        fetch_blob(node, child, &providers, cancel_rx, &tracker, progress, idle_timeout)
    }))
    .buffer_unordered(swarm_parallelism(profile));
    while let Some(result) = fan_out.next().await {
        result?;
    }
    drop(fan_out);

    tracker.publish(progress);
    Ok(tracker.observations())
}

/// Reads and parses the `HashSeq` root, deduplicating repeated content hashes
/// so identical files are fetched once.
async fn read_child_hashes(node: &LightningP2PNode, root: Hash) -> Result<Vec<Hash>> {
    let bytes = node
        .blobs_client()
        .blobs()
        .get_bytes(root)
        .await
        .map_err(|error| blob_error(&error))?;
    let seq = HashSeq::try_from(bytes)
        .map_err(|error| LightningP2PError::Blob(format!("Invalid hash sequence: {error}")))?;
    // The first entry of a collection HashSeq is the metadata blob, not a file.
    let mut seen = HashSet::new();
    Ok(seq
        .iter()
        .skip(1)
        .filter(|hash| seen.insert(*hash))
        .collect())
}

/// Runs one blob download to completion, forwarding progress into the shared
/// tracker. Cancel-aware and idle-timeout-guarded like the standard path.
async fn fetch_blob(
    node: &LightningP2PNode,
    hash: Hash,
    providers: &[EndpointId],
    cancel_rx: &watch::Receiver<bool>,
    tracker: &SwarmTracker,
    progress: Option<&ProgressHandle>,
    idle_timeout: Duration,
) -> Result<()> {
    let mut cancel_rx = cancel_rx.clone();
    let downloader = node.blobs_client().downloader(node.endpoint());
    let mut events = downloader
        .download(hash, providers.to_vec())
        .stream()
        .await
        .map_err(|error| blob_error(&error))?;

    // The new downloader emits a single cumulative offset per blob.
    let mut credited = 0u64;
    loop {
        let event = tokio::select! {
            changed = cancel_rx.changed() => {
                if changed.is_ok() && *cancel_rx.borrow() {
                    return Err(LightningP2PError::Other("Cancelled".into()));
                }
                continue;
            }
            item = tokio::time::timeout(idle_timeout, events.next()) => match item {
                Ok(Some(event)) => event,
                Ok(None) => return Ok(()),
                Err(_) => return Err(idle_error(tracker)),
            },
        };
        handle_event(event, tracker, &mut credited)?;
        tracker.publish(progress);
    }
}

/// Applies one download event to the shared tracker.
fn handle_event(
    event: DownloadProgressItem,
    tracker: &SwarmTracker,
    credited: &mut u64,
) -> Result<()> {
    match event {
        DownloadProgressItem::TryProvider { .. } => tracker.mark_contacted(),
        DownloadProgressItem::Progress(offset) => {
            tracker.mark_contacted();
            tracker.add_done(offset.saturating_sub(*credited));
            *credited = offset;
        }
        DownloadProgressItem::ProviderFailed { .. } | DownloadProgressItem::PartComplete { .. } => {}
        DownloadProgressItem::Error(error) => {
            return Err(abort_error(&error.to_string(), tracker));
        }
        DownloadProgressItem::DownloadError => {
            return Err(abort_error("download failed", tracker));
        }
    }
    Ok(())
}

/// Mirrors the standard path's timeout wording so failure categorization
/// (Unreachable vs Interrupted) stays consistent for retries and the UI.
fn idle_error(tracker: &SwarmTracker) -> LightningP2PError {
    if tracker.contacted.load(Ordering::Relaxed) {
        LightningP2PError::Other("Transfer interrupted".into())
    } else {
        LightningP2PError::Other("Peer not reachable".into())
    }
}

fn abort_error(message: &str, tracker: &SwarmTracker) -> LightningP2PError {
    if tracker.contacted.load(Ordering::Relaxed) {
        LightningP2PError::Blob(message.to_string())
    } else {
        LightningP2PError::Other("Peer not reachable".into())
    }
}

fn blob_error(err: &impl ToString) -> LightningP2PError {
    LightningP2PError::Blob(err.to_string())
}

fn elapsed_ms(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parallelism_follows_profile_and_ceiling() {
        use crate::transfer::TransferMode;
        // No env override in the test environment.
        std::env::remove_var("LIGHTNING_P2P_SWARM_PARALLELISM");
        for mode in [
            TransferMode::Standard,
            TransferMode::Fast,
            TransferMode::Extreme,
            TransferMode::LanBeast,
            TransferMode::Warp,
            TransferMode::BatterySafe,
        ] {
            let profile = mode.profile();
            assert_eq!(swarm_parallelism(profile), profile.swarm_parallelism);
            assert!(profile.swarm_parallelism >= 1);
            assert!(profile.swarm_parallelism <= MAX_SWARM_FETCHES);
        }
    }

    #[test]
    fn tracker_reports_first_contact_and_first_byte_once() {
        let tracker = SwarmTracker::new(Some(100));
        tracker.mark_contacted();
        let first_connect = tracker.connect_ms.load(Ordering::Relaxed);
        tracker.mark_contacted();
        assert_eq!(tracker.connect_ms.load(Ordering::Relaxed), first_connect);

        tracker.add_done(10);
        let first_byte = tracker.first_byte_ms.load(Ordering::Relaxed);
        assert!(first_byte > 0);
        tracker.add_done(10);
        assert_eq!(tracker.first_byte_ms.load(Ordering::Relaxed), first_byte);
        assert_eq!(tracker.done_bytes.load(Ordering::Relaxed), 20);
    }

    #[test]
    fn progress_credits_only_the_delta() {
        let tracker = SwarmTracker::new(Some(1000));
        let mut credited = 0u64;

        handle_event(DownloadProgressItem::Progress(60), &tracker, &mut credited)
            .expect("progress event");
        assert_eq!(tracker.done_bytes.load(Ordering::Relaxed), 60);
        assert_eq!(credited, 60);

        handle_event(DownloadProgressItem::Progress(100), &tracker, &mut credited)
            .expect("progress event");
        assert_eq!(tracker.done_bytes.load(Ordering::Relaxed), 100);
        assert_eq!(credited, 100);
    }
}
