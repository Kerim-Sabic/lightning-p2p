//! Transfer queue - manages concurrent downloads and their cancellation handles.

use crate::transfer::progress::TransferInfo;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{watch, RwLock};

#[derive(Debug, Clone)]
struct QueueEntry {
    info: TransferInfo,
    cancel: Option<watch::Sender<bool>>,
}

/// Manages active transfers and exposes snapshots for the frontend.
#[derive(Debug, Clone, Default)]
pub struct TransferQueue {
    active: Arc<RwLock<HashMap<String, QueueEntry>>>,
    next_id: Arc<AtomicU64>,
}

impl TransferQueue {
    /// Creates a new empty transfer queue.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Creates a new stable transfer identifier.
    #[must_use]
    pub fn next_transfer_id(&self, prefix: &str) -> String {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        format!("{prefix}-{id}")
    }

    /// Adds a transfer to the active queue.
    pub async fn add(&self, info: TransferInfo, cancel: Option<watch::Sender<bool>>) {
        let mut map = self.active.write().await;
        map.insert(info.transfer_id.clone(), QueueEntry { info, cancel });
    }

    /// Updates the progress snapshot for an active transfer.
    pub async fn update_progress(&self, transfer_id: &str, bytes: u64, total: u64, speed_bps: u64) {
        let mut map = self.active.write().await;
        if let Some(entry) = map.get_mut(transfer_id) {
            entry.info.bytes = bytes;
            entry.info.total = total;
            entry.info.speed_bps = speed_bps;
        }
    }

    /// Removes a transfer from the active queue.
    pub async fn remove(&self, transfer_id: &str) -> Option<TransferInfo> {
        let mut map = self.active.write().await;
        map.remove(transfer_id).map(|entry| entry.info)
    }

    /// Requests cancellation for a transfer if it is cancelable.
    pub async fn cancel(&self, transfer_id: &str) -> bool {
        let map = self.active.read().await;
        map.get(transfer_id)
            .and_then(|entry| entry.cancel.as_ref())
            .is_some_and(|cancel| cancel.send(true).is_ok())
    }

    /// Returns a snapshot of all active transfers.
    pub async fn list(&self) -> Vec<TransferInfo> {
        let map = self.active.read().await;
        let mut transfers = map
            .values()
            .map(|entry| entry.info.clone())
            .collect::<Vec<_>>();
        transfers.sort_by(|left, right| left.transfer_id.cmp(&right.transfer_id));
        transfers
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transfer::progress::TransferDirection;

    fn sample_info() -> TransferInfo {
        TransferInfo {
            transfer_id: "recv-1".into(),
            direction: TransferDirection::Receive,
            name: "test.txt".into(),
            peer: Some("peer-1".into()),
            bytes: 0,
            total: 1000,
            speed_bps: 0,
        }
    }

    #[tokio::test]
    async fn add_and_list() {
        let queue = TransferQueue::new();
        queue.add(sample_info(), None).await;
        let list = queue.list().await;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].transfer_id, "recv-1");
    }

    #[tokio::test]
    async fn remove_returns_item() {
        let queue = TransferQueue::new();
        queue.add(sample_info(), None).await;
        let removed = queue.remove("recv-1").await;
        assert!(removed.is_some());
        assert!(queue.list().await.is_empty());
    }

    #[tokio::test]
    async fn cancel_notifies_listener() {
        let queue = TransferQueue::new();
        let (tx, mut rx) = watch::channel(false);
        queue.add(sample_info(), Some(tx)).await;
        assert!(queue.cancel("recv-1").await);
        rx.changed().await.expect("watch should update");
        assert!(*rx.borrow());
    }
}
