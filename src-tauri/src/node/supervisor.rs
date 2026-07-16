//! Runtime supervisor for the iroh node lifecycle.

use super::{
    spawn_nearby_discovery_loop, LightningP2PNode, NearbyShareProtocol, NodeRuntimeStatus,
};
use crate::error::{LightningP2PError, Result};
use crate::node::{NearbyShareRegistry, OfferInbox};
use crate::storage::settings::AppSettings;
use crate::transfer::queue::TransferQueue;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, RwLock};

const NODE_SUPERVISOR_STATUS_EVENT: &str = "node-supervisor-status";
const NODE_START_TIMEOUT: Duration = Duration::from_secs(25);

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
    /// A restart was requested while transfers were still active.
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
        }
    }

    /// Returns a snapshot of the current supervisor status.
    pub async fn status(&self) -> NodeSupervisorStatus {
        self.status.read().await.clone()
    }

    /// Starts the node during app startup.
    pub async fn start(
        &self,
        app: AppHandle,
        settings: AppSettings,
        nearby_shares: NearbyShareRegistry,
        offer_inbox: OfferInbox,
    ) {
        if let Err(error) = self
            .replace_node(
                app,
                settings,
                nearby_shares,
                offer_inbox,
                NodeSupervisorPhase::Starting,
                "app_startup",
            )
            .await
        {
            tracing::error!("Failed to start supervised iroh node: {error}");
        }
    }

    /// Restarts the node after settings that affect endpoint construction change.
    ///
    /// Returns `true` when a restart happened, `false` when it was blocked by
    /// active transfers.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if the replacement node cannot be built or
    /// if the persisted node identity changes unexpectedly during restart.
    pub async fn restart_if_idle(
        &self,
        app: AppHandle,
        settings: AppSettings,
        transfers: &TransferQueue,
        nearby_shares: NearbyShareRegistry,
        offer_inbox: OfferInbox,
        reason: &'static str,
    ) -> Result<bool> {
        if transfers.has_active().await {
            self.set_status(
                &app,
                NodeSupervisorStatus::new(
                    NodeSupervisorPhase::BlockedActiveTransfers,
                    Some(reason.into()),
                    Some("restart deferred because transfers are active".into()),
                ),
            )
            .await;
            tracing::warn!(reason, "node restart blocked while transfers are active");
            return Ok(false);
        }

        self.replace_node(
            app,
            settings,
            nearby_shares,
            offer_inbox,
            NodeSupervisorPhase::Restarting,
            reason,
        )
        .await?;
        Ok(true)
    }

    async fn replace_node(
        &self,
        app: AppHandle,
        settings: AppSettings,
        nearby_shares: NearbyShareRegistry,
        offer_inbox: OfferInbox,
        phase: NodeSupervisorPhase,
        reason: &'static str,
    ) -> Result<()> {
        let _guard = self.lifecycle_lock.lock().await;
        self.set_status(
            &app,
            NodeSupervisorStatus::new(phase, Some(reason.into()), None),
        )
        .await;
        {
            let mut runtime = self.runtime_status.write().await;
            *runtime = NodeRuntimeStatus::starting();
        }

        nearby_shares
            .set_local_discovery_enabled(settings.local_discovery_enabled)
            .await;
        nearby_shares
            .set_bluetooth_discovery_enabled(settings.bluetooth_discovery_enabled)
            .await;

        let old_node = {
            let mut guard = self.node.write().await;
            guard.take()
        };
        let old_node_id = old_node.as_ref().map(|node| node.node_id());

        if let Some(node) = old_node {
            if let Err(error) = node.shutdown().await {
                tracing::warn!(error = %error, "old iroh node shutdown failed during restart");
            }
        }

        match self
            .build_node(&app, settings, nearby_shares.clone(), offer_inbox)
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
                spawn_nearby_discovery_loop(app.clone(), endpoint, nearby_shares, lan_flag, mdns);
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
        nearby_shares: NearbyShareRegistry,
        offer_inbox: OfferInbox,
    ) -> Result<LightningP2PNode> {
        let relay_url = settings.resolved_custom_relay_url()?;
        let profile = settings.transfer_mode.profile();
        let nearby_protocol = Arc::new(NearbyShareProtocol::new(
            nearby_shares,
            offer_inbox,
            app.clone(),
        ));
        let start = LightningP2PNode::start_with_dirs_and_relay(
            self.data_dir.clone(),
            settings.download_dir,
            relay_url,
            Some(nearby_protocol),
            profile,
        );
        tokio::time::timeout(NODE_START_TIMEOUT, start)
            .await
            .map_err(|_| {
                LightningP2PError::Other(
                    "Node startup timed out; open Settings and copy diagnostics.".into(),
                )
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
        tracing::error!(reason, "supervised node lifecycle failed: {error}");
    }

    async fn set_status(&self, app: &AppHandle, status: NodeSupervisorStatus) {
        {
            let mut guard = self.status.write().await;
            *guard = status.clone();
        }
        if let Err(error) = app.emit(NODE_SUPERVISOR_STATUS_EVENT, status) {
            tracing::warn!("failed to emit node supervisor status: {error}");
        }
    }
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}
