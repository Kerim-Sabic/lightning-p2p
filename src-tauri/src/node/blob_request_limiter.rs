//! Bounds concurrently handled blob requests across peers.

use iroh::EndpointId;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

const MAX_CONCURRENT_BLOB_REQUESTS: usize = 128;
const MAX_CONCURRENT_BLOB_REQUESTS_PER_PEER: usize = 16;

/// Admission controller for incoming blob protocol streams.
#[derive(Debug, Clone, Default)]
pub(crate) struct BlobRequestLimiter(Arc<Mutex<ActiveRequests>>);

#[derive(Debug, Default)]
struct ActiveRequests {
    total: usize,
    by_peer: HashMap<EndpointId, usize>,
}

/// A slot held for the full lifetime of one accepted blob request.
#[derive(Debug)]
pub(crate) struct BlobRequestPermit {
    limiter: BlobRequestLimiter,
    peer: EndpointId,
}

impl BlobRequestLimiter {
    /// Acquires a request slot when both global and per-peer limits allow it.
    pub(crate) fn try_acquire(&self, peer: EndpointId) -> Option<BlobRequestPermit> {
        let mut active = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let peer_count = active.by_peer.get(&peer).copied().unwrap_or_default();
        if active.total >= MAX_CONCURRENT_BLOB_REQUESTS
            || peer_count >= MAX_CONCURRENT_BLOB_REQUESTS_PER_PEER
        {
            return None;
        }

        active.total += 1;
        active.by_peer.insert(peer, peer_count + 1);
        Some(BlobRequestPermit {
            limiter: self.clone(),
            peer,
        })
    }
}

impl Drop for BlobRequestPermit {
    fn drop(&mut self) {
        let mut active = self
            .limiter
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        active.total = active.total.saturating_sub(1);
        if let Some(peer_count) = active.by_peer.get_mut(&self.peer) {
            *peer_count = peer_count.saturating_sub(1);
            if *peer_count == 0 {
                active.by_peer.remove(&self.peer);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use iroh::SecretKey;

    fn test_peer(value: u8) -> EndpointId {
        SecretKey::from_bytes(&[value; 32]).public()
    }

    #[test]
    fn request_limit_is_enforced_per_peer_without_blocking_other_peers() {
        let limiter = BlobRequestLimiter::default();
        let first_peer = test_peer(1);
        let second_peer = test_peer(2);
        let first_peer_permits = (0..MAX_CONCURRENT_BLOB_REQUESTS_PER_PEER)
            .map(|_| limiter.try_acquire(first_peer).expect("slot available"))
            .collect::<Vec<_>>();

        assert!(limiter.try_acquire(first_peer).is_none());
        let other_peer_permit = limiter
            .try_acquire(second_peer)
            .expect("one peer cannot consume another peer's allowance");

        drop(first_peer_permits);
        assert!(limiter.try_acquire(first_peer).is_some());
        drop(other_peer_permit);
    }

    #[test]
    fn request_limit_is_enforced_globally_and_released_on_drop() {
        let limiter = BlobRequestLimiter::default();
        let permits = (0..MAX_CONCURRENT_BLOB_REQUESTS)
            .map(|index| {
                let peer = test_peer(u8::try_from(index).expect("peer ID fits in one byte"));
                limiter.try_acquire(peer).expect("global slot available")
            })
            .collect::<Vec<_>>();

        assert!(limiter.try_acquire(test_peer(250)).is_none());
        drop(permits);
        assert!(limiter.try_acquire(test_peer(250)).is_some());
    }
}
