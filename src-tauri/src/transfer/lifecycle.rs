//! Admission gate for transfer work and endpoint lifecycle changes.

use std::sync::Arc;
use tokio::sync::{watch, OwnedRwLockReadGuard, OwnedRwLockWriteGuard, RwLock};

#[derive(Clone)]
pub(crate) struct TransferLifecycleGate {
    lock: Arc<RwLock<()>>,
    restart_pending: watch::Sender<bool>,
}

impl TransferLifecycleGate {
    pub(crate) fn new() -> Self {
        let (restart_pending, _) = watch::channel(false);
        Self {
            lock: Arc::new(RwLock::new(())),
            restart_pending,
        }
    }

    pub(crate) async fn begin_activity(&self) -> OwnedRwLockReadGuard<()> {
        let mut restart_pending = self.restart_pending.subscribe();
        loop {
            if *restart_pending.borrow() {
                if restart_pending.changed().await.is_err() {
                    continue;
                }
                continue;
            }
            let activity = self.lock.clone().read_owned().await;
            if !*restart_pending.borrow() {
                return activity;
            }
            drop(activity);
        }
    }

    pub(crate) fn request_restart(&self) {
        self.restart_pending.send_replace(true);
    }

    pub(crate) fn finish_restart(&self) {
        self.restart_pending.send_replace(false);
    }

    pub(crate) async fn begin_restart(&self) -> OwnedRwLockWriteGuard<()> {
        self.lock.clone().write_owned().await
    }
}

#[cfg(test)]
mod tests {
    use super::TransferLifecycleGate;
    use tokio::time::{timeout, Duration};

    #[tokio::test]
    async fn restart_waits_for_admitted_transfer_activity() {
        let gate = TransferLifecycleGate::new();
        let activity = gate.begin_activity().await;
        gate.request_restart();

        let mut restart = tokio::spawn({
            let gate = gate.clone();
            async move { gate.begin_restart().await }
        });
        assert!(timeout(Duration::from_millis(20), &mut restart)
            .await
            .is_err());
        drop(activity);
        let _restart = timeout(Duration::from_secs(1), restart)
            .await
            .expect("restart should acquire the gate")
            .expect("restart task should complete");
    }

    #[tokio::test]
    async fn pending_restart_blocks_new_transfer_activity() {
        let gate = TransferLifecycleGate::new();
        gate.request_restart();

        let mut activity = tokio::spawn({
            let gate = gate.clone();
            async move { gate.begin_activity().await }
        });
        assert!(timeout(Duration::from_millis(20), &mut activity)
            .await
            .is_err());
        gate.finish_restart();
        let _activity = timeout(Duration::from_secs(1), activity)
            .await
            .expect("activity should resume after restart")
            .expect("activity task should complete");
    }
}
