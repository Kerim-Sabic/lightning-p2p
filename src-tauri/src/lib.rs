#![deny(clippy::all, clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]

//! `FastDrop` — P2P file sharing at maximum speed.
//!
//! Built on [iroh](https://iroh.computer) for P2P networking and
//! [iroh-blobs](https://docs.rs/iroh-blobs) for content-addressed blob transfer.

pub mod commands;
pub mod crypto;
pub mod error;
pub mod node;
pub mod storage;
pub mod telemetry;
pub mod transfer;

use error::{FastDropError, Result};
use node::{FastDropNode, NearbyShareProtocol, NearbyShareRegistry, NodeRuntimeStatus};
use std::sync::Arc;
use storage::settings::{resolve_app_data_dir, SettingsState};
use tauri::Manager;
use tokio::sync::RwLock;
use transfer::queue::TransferQueue;

/// Shared application state accessible from Tauri commands.
pub struct AppState {
    /// Resolved application data directory for this profile.
    pub data_dir: std::path::PathBuf,
    /// The iroh-backed P2P node.
    pub node: Arc<RwLock<Option<Arc<FastDropNode>>>>,
    /// Last known node startup or reachability status.
    pub node_runtime: Arc<RwLock<NodeRuntimeStatus>>,
    /// Persisted user settings shared across sessions.
    pub settings: SettingsState,
    /// In-memory registry of active transfers.
    pub transfers: TransferQueue,
    /// Nearby-share discovery state for LAN-based receive flows.
    pub nearby_shares: NearbyShareRegistry,
}

impl AppState {
    /// Creates a new `AppState` with no node initialized yet.
    #[must_use]
    pub fn new(data_dir: std::path::PathBuf, settings: SettingsState) -> Self {
        Self {
            data_dir,
            node: Arc::new(RwLock::new(None)),
            node_runtime: Arc::new(RwLock::new(NodeRuntimeStatus::starting())),
            settings,
            transfers: TransferQueue::new(),
            nearby_shares: NearbyShareRegistry::new(true),
        }
    }

    /// Returns the initialized node handle.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError::Other` if the node is not ready yet.
    pub async fn get_node(&self) -> Result<Arc<FastDropNode>> {
        self.node
            .read()
            .await
            .clone()
            .ok_or_else(|| FastDropError::Other("Node not initialized yet".into()))
    }
}

#[cfg(windows)]
fn register_deep_links<R: tauri::Runtime>(app: &tauri::App<R>) {
    use tauri_plugin_deep_link::DeepLinkExt;

    if let Err(error) = app.deep_link().register_all() {
        tracing::warn!("Failed to register deep links at runtime: {error}");
    }
}

#[cfg(not(windows))]
fn register_deep_links<R: tauri::Runtime>(_app: &tauri::App<R>) {}

/// Entry point: configures Tauri with plugins, state, and command handlers.
///
/// # Panics
///
/// Panics if Tauri fails to build (unrecoverable).
pub fn run() {
    telemetry::init_tracing();

    let data_dir =
        resolve_app_data_dir().expect("FastDrop could not resolve an application data dir");
    let settings =
        SettingsState::load_or_create(&data_dir).expect("FastDrop could not load settings");
    let app_state = AppState::new(data_dir, settings);

    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::share::create_share,
            commands::share::describe_share_paths,
            commands::share::get_ticket,
            commands::share::render_ticket_qr,
            commands::share::clear_active_share,
            commands::transfer::start_receive,
            commands::transfer::get_discovered_shares,
            commands::transfer::start_receive_discovered_share,
            commands::transfer::cancel_transfer,
            commands::transfer::get_active_transfers,
            commands::transfer::get_transfer_history,
            commands::peer::get_node_id,
            commands::peer::get_node_status,
            commands::settings::get_app_settings,
            commands::settings::get_download_dir,
            commands::settings::set_download_dir,
            commands::settings::set_auto_update_enabled,
            commands::settings::complete_first_run,
            commands::settings::set_relay_mode,
            commands::settings::set_custom_relay_url,
            commands::settings::set_local_discovery_enabled,
            commands::settings::open_download_dir,
        ])
        .setup(|app| {
            register_deep_links(app);

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = handle.state::<AppState>();
                let data_dir = state.data_dir.clone();
                let settings = state.settings.snapshot().await;
                let download_dir = settings.download_dir.clone();
                state
                    .nearby_shares
                    .set_local_discovery_enabled(settings.local_discovery_enabled)
                    .await;
                let nearby_protocol =
                    Arc::new(NearbyShareProtocol::new(state.nearby_shares.clone()));

                {
                    let mut runtime = state.node_runtime.write().await;
                    *runtime = NodeRuntimeStatus::starting();
                }

                let relay_url = match settings.resolved_custom_relay_url() {
                    Ok(relay_url) => relay_url,
                    Err(error) => {
                        tracing::error!("Invalid relay configuration: {error}");
                        let mut runtime = state.node_runtime.write().await;
                        *runtime = NodeRuntimeStatus::offline();
                        return;
                    }
                };

                match node::FastDropNode::start_with_dirs_and_relay(
                    data_dir,
                    download_dir,
                    relay_url,
                    nearby_protocol,
                )
                .await
                {
                    Ok(node) => {
                        let runtime_status = node.runtime_status();
                        let endpoint = node.endpoint().clone();
                        let lan_flag = node.lan_discovery_flag();
                        let mut guard = state.node.write().await;
                        *guard = Some(Arc::new(node));
                        let mut runtime = state.node_runtime.write().await;
                        *runtime = runtime_status;
                        node::spawn_nearby_discovery_loop(
                            handle.clone(),
                            endpoint,
                            state.nearby_shares.clone(),
                            lan_flag,
                        );
                        tracing::info!("iroh node started successfully");
                    }
                    Err(e) => {
                        let mut runtime = state.node_runtime.write().await;
                        *runtime = NodeRuntimeStatus::offline();
                        tracing::error!("Failed to start iroh node: {e}");
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
