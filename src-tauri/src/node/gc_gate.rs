//! Admission gate for iroh-blobs garbage collection of the transfer store.
//!
//! The store's GC task asks the gate before every run. The gate refuses until
//! node startup has loaded the live access rules and reconciled persistent
//! retention tags, so a run can never start against a half-loaded view of
//! what is still shared. Once armed, it re-protects everything the blob
//! provider may currently serve: public share hashes and live nearby grants.
//!
//! Nearby offers additionally pin their collection root with a temp tag while
//! the recipient's grant is alive (GC traverses the pinned collection), and
//! each served request pins what it reads until the response is finished.

use super::blob_access::BlobAccessController;
use iroh::EndpointId;
use iroh_blobs::api::{Store, TempTag};
use iroh_blobs::protocol::ChunkRangesSeq;
use iroh_blobs::store::fs::options::Options;
use iroh_blobs::store::{GcConfig, ProtectCb, ProtectOutcome};
use iroh_blobs::{Hash, HashAndFormat};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::Duration;

/// How often the transfer store collects blobs nothing retains any more.
pub(crate) const GC_INTERVAL: Duration = Duration::from_secs(5 * 60);

/// Shared state consulted by the store's GC task before every run.
#[derive(Debug, Clone, Default)]
pub(crate) struct GcGate(Arc<GateState>);

#[derive(Debug, Default)]
struct GateState {
    /// Live access rules; GC is refused until startup attaches them.
    access: OnceLock<BlobAccessController>,
    /// Collection roots offered to nearby peers, pinned while the grant lives.
    nearby_pins: Mutex<HashMap<(EndpointId, Hash), TempTag>>,
}

impl GcGate {
    /// Store options that run GC every `interval`, admitted by this gate.
    pub(crate) fn store_options(&self, store_dir: &Path, interval: Duration) -> Options {
        let gate = self.clone();
        let protect: ProtectCb = Arc::new(move |live: &mut HashSet<Hash>| {
            let outcome = gate.protect(live);
            Box::pin(std::future::ready(outcome))
        });
        let mut options = Options::new(store_dir);
        options.gc = Some(GcConfig {
            interval,
            add_protected: Some(protect),
        });
        options
    }

    /// Admits GC runs now that startup loaded `access` and reconciled tags.
    pub(crate) fn arm(&self, access: BlobAccessController) {
        if self.0.access.set(access).is_err() {
            tracing::warn!("transfer store GC gate was already armed");
        }
    }

    /// Keeps a nearby-offered collection while `peer` may still fetch it.
    pub(crate) fn pin_nearby(&self, peer: EndpointId, root: Hash, pin: TempTag) {
        self.pins().entry((peer, root)).or_insert(pin);
    }

    fn protect(&self, live: &mut HashSet<Hash>) -> ProtectOutcome {
        let Some(access) = self.0.access.get() else {
            tracing::debug!("transfer store GC deferred until startup finishes");
            return ProtectOutcome::Abort;
        };
        // Grants expire lazily; release pins whose recipient can no longer
        // fetch before this run lists temp tags.
        self.pins()
            .retain(|(peer, root), _pin| access.is_granted(*peer, *root));
        access.extend_servable(live);
        ProtectOutcome::Continue
    }

    fn pins(&self) -> MutexGuard<'_, HashMap<(EndpointId, Hash), TempTag>> {
        self.0
            .nearby_pins
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

/// Pins the content of one authorized `Get` until the response is finished.
///
/// Grants are refreshed only when a request starts, so a long collection
/// download can outlive the grant that admitted it; the pin keeps its root
/// and every child it lists out of GC meanwhile.
pub(crate) async fn pin_request(
    store: &Store,
    hash: Hash,
    ranges: &ChunkRangesSeq,
) -> Option<TempTag> {
    let content = if ranges.is_blob() {
        HashAndFormat::raw(hash)
    } else {
        HashAndFormat::hash_seq(hash)
    };
    pin(store, content).await
}

/// Pins every blob of one authorized `GetMany` until the response is finished.
pub(crate) async fn pin_many(store: &Store, hashes: &[Hash]) -> Vec<TempTag> {
    let mut pins = Vec::with_capacity(hashes.len());
    for hash in hashes {
        pins.extend(pin(store, HashAndFormat::raw(*hash)).await);
    }
    pins
}

async fn pin(store: &Store, content: HashAndFormat) -> Option<TempTag> {
    match store.tags().temp_tag(content).await {
        Ok(pin) => Some(pin),
        Err(_error) => {
            tracing::warn!("could not pin served blob content against store GC");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use iroh::SecretKey;

    fn peer(value: u8) -> EndpointId {
        SecretKey::from_bytes(&[value; 32]).public()
    }

    #[test]
    fn gc_is_refused_until_startup_arms_the_gate() {
        let gate = GcGate::default();
        let mut live = HashSet::new();
        assert!(matches!(gate.protect(&mut live), ProtectOutcome::Abort));

        let access = BlobAccessController::with_public_hashes([Hash::from([1; 32])]);
        gate.arm(access);
        assert!(matches!(gate.protect(&mut live), ProtectOutcome::Continue));
        assert!(live.contains(&Hash::from([1; 32])));
    }

    #[test]
    fn live_private_grants_are_protected_and_revoked_ones_are_not() {
        let access = BlobAccessController::default();
        let kept = Hash::from([2; 32]);
        let revoked = Hash::from([3; 32]);
        assert!(access.authorize_peer(peer(1), &[kept, revoked]));
        access.revoke_peer(peer(1), &[revoked]);
        let gate = GcGate::default();
        gate.arm(access);

        let mut live = HashSet::new();
        assert!(matches!(gate.protect(&mut live), ProtectOutcome::Continue));
        assert!(live.contains(&kept));
        assert!(!live.contains(&revoked));
    }

    #[tokio::test]
    async fn nearby_pins_are_released_once_the_grant_is_gone() {
        let store = iroh_blobs::store::mem::MemStore::new();
        let root = store
            .add_bytes(b"offered".to_vec())
            .temp_tag()
            .await
            .expect("add");
        let root_hash = root.hash();
        let access = BlobAccessController::default();
        assert!(access.authorize_peer(peer(1), &[root_hash]));
        let gate = GcGate::default();
        gate.arm(access.clone());
        gate.pin_nearby(peer(1), root_hash, root);

        gate.protect(&mut HashSet::new());
        assert_eq!(gate.pins().len(), 1);

        access.revoke_peer(peer(1), &[root_hash]);
        gate.protect(&mut HashSet::new());
        assert!(gate.pins().is_empty());
    }
}
