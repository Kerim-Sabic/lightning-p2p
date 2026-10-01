//! Runtime supervisor for the iroh node lifecycle.

use super::{
    chat_protocol::ChatProtocol, spawn_nearby_discovery_loop, LightningP2PNode,
    NearbyShareProtocol, NodeRuntimeStatus,
};
use crate::error::{LightningP2PError, Result};
use crate::node::{NearbyShareRegistry, OfferInbox};
use crate::storage::blocked_peers::BlockedPeers;
use crate::storage::paired_devices::PairedDevices;
use crate::storage::settings::AppSettings;
use crate::transfer::lifecycle::TransferLifecycleGate;
use serde::Serialize;
use std::future::Future;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, RwLock};

const NODE_SUPERVISOR_STATUS_EVENT: &str = "node-supervisor-status";
const NODE_START_PREPARATION_TIMEOUT: Duration = Duration::from_secs(5);
// Opening an existing on-disk blob store can take longer on Windows when the
// database is large or the disk is cold. Use this as a warning threshold only:
// iroh-blobs starts its own actor/runtime while opening the store, so cancelling
// this future can leave an orphaned database actor holding the file lock.
const NODE_START_WARNING_AFTER: Duration = Duration::from_secs(60);
const NODE_START_RECOVERY_AFTER: Duration = Duration::from_secs(5 * 60);

/// Nearby services that must remain attached to the node across restarts.
#[derive(Debug, Clone)]
pub(crate) struct NearbyServices {
    registry: NearbyShareRegistry,
    offers: OfferInbox,
    blocked_peers: BlockedPeers,
    paired_devices: PairedDevices,
}

impl NearbyServices {
    pub(crate) fn new(
        registry: NearbyShareRegistry,
        offers: OfferInbox,
        blocked_peers: BlockedPeers,
        paired_devices: PairedDevices,
    ) -> Self {
        Self {
            registry,
            offers,
            blocked_peers,
            paired_devices,
        }
    }
}

/// Coarse supervisor phase surfaced to diagnostics and the frontend.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeSupervisorPhase {
    /// The current node is running or no restart has been requested.
    Idle,
    /// The initial app startup is creating the node.
    Starting,
    /// A settings change is rebuilding the endpoint/router/discovery stack.
    Restarting,
    /// An endpoint restart is queued behind admitted transfer work.
    BlockedActiveTransfers,
    /// The last start/restart attempt failed.
    Failed,
}

/// Public node-supervisor snapshot.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NodeSupervisorStatus {
    /// Current supervisor phase.
    pub phase: NodeSupervisorPhase,
    /// Reason attached to the last lifecycle action.
    pub last_reason: Option<String>,
    /// Last restart/start failure, if any.
    pub last_error: Option<String>,
    /// Last lifecycle action timestamp.
    pub last_changed_unix: u64,
}

impl NodeSupervisorStatus {
    fn new(phase: NodeSupervisorPhase, reason: Option<String>, error: Option<String>) -> Self {
        Self {
            phase,
            last_reason: reason,
            last_error: error,
            last_changed_unix: unix_timestamp(),
        }
    }
}

/// Owns node startup and restart sequencing.
#[derive(Clone)]
pub struct NodeSupervisor {
    data_dir: PathBuf,
    node: Arc<RwLock<Option<Arc<LightningP2PNode>>>>,
    runtime_status: Arc<RwLock<NodeRuntimeStatus>>,
    status: Arc<RwLock<NodeSupervisorStatus>>,
    lifecycle_lock: Arc<Mutex<()>>,
    transfer_gate: TransferLifecycleGate,
    pending_restart: Arc<Mutex<Option<PendingRestart>>>,
    pending_worker_running: Arc<AtomicBool>,
}

struct PendingRestart {
    app: AppHandle,
    settings: AppSettings,
    nearby: NearbyServices,
    reason: &'static str,
}

impl NodeSupervisor {
    /// Creates a supervisor over the shared node and runtime-status cells.
    #[must_use]
    pub fn new(
        data_dir: PathBuf,
        node: Arc<RwLock<Option<Arc<LightningP2PNode>>>>,
        runtime_status: Arc<RwLock<NodeRuntimeStatus>>,
    ) -> Self {
        Self {
            data_dir,
            node,
            runtime_status,
            status: Arc::new(RwLock::new(NodeSupervisorStatus::new(
                NodeSupervisorPhase::Starting,
                Some("app_startup".into()),
                None,
            ))),
            lifecycle_lock: Arc::new(Mutex::new(())),
            transfer_gate: TransferLifecycleGate::new(),
            pending_restart: Arc::new(Mutex::new(None)),
            pending_worker_running: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Holds endpoint lifecycle stable for one complete send or receive flow.
    pub(crate) async fn begin_transfer_activity(&self) -> tokio::sync::OwnedRwLockReadGuard<()> {
        self.transfer_gate.begin_activity().await
    }

    /// Returns a snapshot of the current supervisor status.
    pub async fn status(&self) -> NodeSupervisorStatus {
        self.status.read().await.clone()
    }

    /// Retries startup after a failed initial node build when no node is live.
    ///
    /// # Errors
    ///
    /// Returns an error unless the supervisor is failed and the node is absent,
    /// or if the replacement node cannot be built.
    pub(crate) async fn retry_failed_startup(
        &self,
        app: AppHandle,
        settings: AppSettings,
        nearby: NearbyServices,
    ) -> Result<()> {
        let _guard = self.lifecycle_lock.lock().await;
        let phase = self.status.read().await.phase;
        if !startup_retry_allowed(phase, self.node.read().await.is_some()) {
            return Err(LightningP2PError::Other(
                "Node startup can only be retried after a failed start when no node is running."
                    .into(),
            ));
        }
        if self.pending_restart.lock().await.is_some()
            || self.pending_worker_running.load(Ordering::Acquire)
        {
            return Err(LightningP2PError::Other(
                "A node update is already queued. Wait for it to finish before retrying startup."
                    .into(),
            ));
        }

        self.replace_node_locked(
            app,
            settings,
            nearby,
            NodeSupervisorPhase::Starting,
            "user_retry",
        )
        .await
    }

    /// Starts the node during app startup.
    pub(crate) async fn start(
        &self,
        app: AppHandle,
        settings: AppSettings,
        nearby: NearbyServices,
    ) {
        let prepare_nearby_trust = async {
            let blocked_peers = nearby.blocked_peers.list().await;
            nearby.offers.load_blocked_peers(blocked_peers).await;
        };
        if tokio::time::timeout(NODE_START_PREPARATION_TIMEOUT, prepare_nearby_trust)
            .await
            .is_err()
        {
            let error = LightningP2PError::Other(
                "Node startup timed out while loading nearby-device trust settings. Open Settings and retry startup.".into(),
            );
            self.mark_failed(&app, "app_startup_preparation", &error)
                .await;
            return;
        }

        if let Err(error) = self
            .replace_node(
                app,
                settings,
                nearby,
                NodeSupervisorPhase::Starting,
                "app_startup",
            )
            .await
        {
            tracing::error!(%error, "failed to start supervised iroh node");
        }
    }

    /// Queues an endpoint restart behind active transfer workflows and stops
    /// admitting new work until the replacement node is ready.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if the replacement node cannot be built or
    /// if the persisted node identity changes unexpectedly during restart.
    pub(crate) async fn restart_if_idle(
        &self,
        app: AppHandle,
        settings: AppSettings,
        nearby: NearbyServices,
        reason: &'static str,
    ) -> Result<()> {
        {
            let mut pending = self.pending_restart.lock().await;
            *pending = Some(PendingRestart {
                app: app.clone(),
                settings,
                nearby,
                reason,
            });
            self.transfer_gate.request_restart();
        }
        self.set_status(
            &app,
            NodeSupervisorStatus::new(
                NodeSupervisorPhase::BlockedActiveTransfers,
                Some(reason.into()),
                Some("Endpoint update queued until current transfer work finishes".into()),
            ),
        )
        .await;
        let started_worker = self
            .pending_worker_running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok();
        if started_worker {
            let supervisor = self.clone();
            tauri::async_runtime::spawn(async move {
                supervisor.apply_pending_restarts().await;
            });
        }
        Ok(())
    }

    async fn apply_pending_restarts(&self) {
        loop {
            let _transfer_gate = self.transfer_gate.begin_restart().await;
            let pending = {
                let mut slot = self.pending_restart.lock().await;
                if let Some(pending) = slot.take() {
                    Some(pending)
                } else {
                    self.transfer_gate.finish_restart();
                    self.pending_worker_running.store(false, Ordering::Release);
                    None
                }
            };
            let Some(pending) = pending else {
                return;
            };
            if let Err(_error) = self
                .replace_node(
                    pending.app,
                    pending.settings,
                    pending.nearby,
                    NodeSupervisorPhase::Restarting,
                    pending.reason,
                )
                .await
            {
                tracing::error!(reason = pending.reason, "queued node restart failed");
            }
        }
    }

    async fn replace_node(
        &self,
        app: AppHandle,
        settings: AppSettings,
        nearby: NearbyServices,
        phase: NodeSupervisorPhase,
        reason: &'static str,
    ) -> Result<()> {
        let _guard = self.lifecycle_lock.lock().await;
        self.replace_node_locked(app, settings, nearby, phase, reason)
            .await
    }

    async fn replace_node_locked(
        &self,
        app: AppHandle,
        settings: AppSettings,
        nearby: NearbyServices,
        phase: NodeSupervisorPhase,
        reason: &'static str,
    ) -> Result<()> {
        self.set_status(
            &app,
            NodeSupervisorStatus::new(phase, Some(reason.into()), None),
        )
        .await;
        {
            let mut runtime = self.runtime_status.write().await;
            *runtime = NodeRuntimeStatus::starting();
        }

        nearby
            .registry
            .set_local_discovery_enabled(settings.local_discovery_enabled)
            .await;
        nearby
            .registry
            .set_bluetooth_discovery_enabled(settings.bluetooth_discovery_enabled)
            .await;

        let old_node = {
            let mut guard = self.node.write().await;
            guard.take()
        };
        let old_node_id = old_node.as_ref().map(|node| node.node_id());

        if let Some(node) = old_node {
            if let Err(_error) = node.shutdown().await {
                tracing::warn!("old iroh node shutdown failed during restart");
            }
        }

        match self
            .build_node(&app, settings, nearby.clone(), phase, reason)
            .await
        {
            Ok(node) => {
                if let Some(expected) = old_node_id {
                    if node.node_id() != expected {
                        let error = LightningP2PError::Other(
                            "Node identity changed during restart; refusing to continue".into(),
                        );
                        self.mark_failed(&app, reason, &error).await;
                        return Err(error);
                    }
                }

                let runtime_status = node.runtime_status();
                let endpoint = node.endpoint().clone();
                let lan_flag = node.lan_discovery_flag();
                let mdns = node.mdns_lookup();
                {
                    let mut guard = self.node.write().await;
                    *guard = Some(Arc::new(node));
                }
                {
                    let mut runtime = self.runtime_status.write().await;
                    *runtime = runtime_status;
                }
                spawn_nearby_discovery_loop(app.clone(), endpoint, nearby.registry, lan_flag, mdns);
                self.set_status(
                    &app,
                    NodeSupervisorStatus::new(NodeSupervisorPhase::Idle, Some(reason.into()), None),
                )
                .await;
                tracing::info!(reason, "supervised iroh node ready");
                Ok(())
            }
            Err(error) => {
                self.mark_failed(&app, reason, &error).await;
                Err(error)
            }
        }
    }

    async fn build_node(
        &self,
        app: &AppHandle,
        settings: AppSettings,
        nearby: NearbyServices,
        phase: NodeSupervisorPhase,
        reason: &'static str,
    ) -> Result<LightningP2PNode> {
        let relay_url = settings.resolved_custom_relay_url()?;
        let profile = settings.transfer_mode.profile();
        let nearby_protocol = Arc::new(NearbyShareProtocol::new(
            nearby.registry,
            nearby.offers,
            nearby.blocked_peers,
            nearby.paired_devices,
            app.clone(),
        ));
        let chat_protocol = Arc::new(ChatProtocol::new(app.clone()));
        let start = LightningP2PNode::start_with_dirs_and_relay_with_local_discovery(
            self.data_dir.clone(),
            settings.download_dir,
            relay_url,
            Some(nearby_protocol),
            Some(chat_protocol),
            profile,
            settings.local_discovery_enabled,
        );
        Box::pin(await_start_with_warning(
            start,
            NODE_START_WARNING_AFTER,
            NODE_START_RECOVERY_AFTER,
            async {
            let message = "The transfer engine is still opening its local store. Startup is continuing; keep Lightning open. Closing the app while this is running can interrupt store initialization.";
            tracing::warn!(
                reason,
                "node storage initialization is still running after 60 seconds"
            );
            self.set_status(
                app,
                NodeSupervisorStatus::new(phase, Some(reason.into()), Some(message.into())),
            )
            .await;
            },
        ))
        .await
        .map_err(|error| {
            LightningP2PError::Other(format!("Node startup task failed: {error}"))
        })?
    }

    async fn mark_failed(&self, app: &AppHandle, reason: &str, error: &LightningP2PError) {
        {
            let mut runtime = self.runtime_status.write().await;
            *runtime = NodeRuntimeStatus::offline();
        }
        self.set_status(
            app,
            NodeSupervisorStatus::new(
                NodeSupervisorPhase::Failed,
                Some(reason.into()),
                Some(error.to_string()),
            ),
        )
        .await;
        tracing::error!(reason, error = %error, "supervised node lifecycle failed");
    }

    async fn set_status(&self, app: &AppHandle, status: NodeSupervisorStatus) {
        {
            let mut guard = self.status.write().await;
            *guard = status.clone();
        }
        if let Err(_error) = app.emit(NODE_SUPERVISOR_STATUS_EVENT, status) {
            tracing::warn!("failed to emit node supervisor status");
        }
    }
}

async fn await_start_with_warning<F, W>(
    start: F,
    warning_after: Duration,
    recovery_after: Duration,
    warning: W,
) -> std::result::Result<F::Output, String>
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
    W: Future<Output = ()>,
{
    let mut start = tokio::spawn(start);
    if let Ok(result) = tokio::time::timeout(warning_after, &mut start).await {
        return result.map_err(|error| error.to_string());
    }

    warning.await;
    // FsStore initialization is not cancellation-safe: aborting it can strand
    // its database actor and lock. Keep the task alive while waiting, then
    // detach it on timeout so the supervisor can surface a recoverable state.
    let remaining = recovery_after.saturating_sub(warning_after);
    match tokio::time::timeout(remaining, &mut start).await {
        Ok(result) => result.map_err(|error| error.to_string()),
        Err(_elapsed) => Err(
            "The transfer engine did not finish initializing within five minutes. Its local database task was left running safely. Close and reopen Lightning to reset startup; if this repeats, collect a diagnostic bundle from Settings.".into(),
        ),
    }
}

fn startup_retry_allowed(phase: NodeSupervisorPhase, node_initialized: bool) -> bool {
    phase == NodeSupervisorPhase::Failed && !node_initialized
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

#[cfg(test)]
mod tests {
    use super::{await_start_with_warning, startup_retry_allowed, NodeSupervisorPhase};
    use std::future::poll_fn;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use std::task::Poll;
    use std::time::Duration;

    #[test]
    fn startup_retry_requires_a_failed_supervisor_without_a_live_node() {
        assert!(startup_retry_allowed(NodeSupervisorPhase::Failed, false));
        assert!(!startup_retry_allowed(NodeSupervisorPhase::Failed, true));
        assert!(!startup_retry_allowed(NodeSupervisorPhase::Starting, false));
        assert!(!startup_retry_allowed(NodeSupervisorPhase::Idle, false));
    }

    #[tokio::test]
    async fn completed_startup_result_is_returned_without_polling_future_again() {
        let polls = Arc::new(AtomicUsize::new(0));
        let observed_polls = polls.clone();
        let start = poll_fn(move |_| {
            observed_polls.fetch_add(1, Ordering::SeqCst);
            Poll::Ready(42)
        });

        let result = await_start_with_warning(
            start,
            Duration::from_secs(1),
            Duration::from_secs(2),
            async {},
        )
        .await
        .expect("startup task should complete");

        assert_eq!(result, 42);
        assert_eq!(polls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn slow_start_emits_warning_then_returns_its_result() {
        let warned = Arc::new(AtomicUsize::new(0));
        let warning_state = warned.clone();
        let start = async {
            tokio::time::sleep(Duration::from_millis(20)).await;
            42
        };

        let result = await_start_with_warning(
            start,
            Duration::from_millis(1),
            Duration::from_secs(1),
            async move {
                warning_state.fetch_add(1, Ordering::SeqCst);
            },
        )
        .await
        .expect("startup task should complete after warning");

        assert_eq!(result, 42);
        assert_eq!(warned.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn startup_that_never_finishes_surfaces_recovery_without_aborting_store_task() {
        let warned = Arc::new(AtomicUsize::new(0));
        let warning_state = warned.clone();
        let task_finished = Arc::new(AtomicUsize::new(0));
        let observed_finish = task_finished.clone();
        let start = async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            observed_finish.store(1, Ordering::SeqCst);
        };
        let result = await_start_with_warning(
            start,
            Duration::from_millis(1),
            Duration::from_millis(5),
            async move {
                warning_state.fetch_add(1, Ordering::SeqCst);
            },
        )
        .await;

        assert!(result.is_err());
        assert_eq!(warned.load(Ordering::SeqCst), 1);
        tokio::time::sleep(Duration::from_millis(25)).await;
        assert_eq!(task_finished.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn startup_panic_is_returned_as_a_join_error() {
        let result = await_start_with_warning(
            async { panic!("simulated startup panic") },
            Duration::from_secs(1),
            Duration::from_secs(2),
            async {},
        )
        .await;

        assert!(result.is_err());
    }
}
