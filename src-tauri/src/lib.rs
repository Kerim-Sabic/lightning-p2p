#![deny(clippy::all, clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]

//! Lightning P2P direct peer-to-peer file sharing.
//!
//! Built on [iroh](https://iroh.computer) for P2P networking and
//! [iroh-blobs](https://docs.rs/iroh-blobs) for content-addressed blob transfer.

#[cfg(feature = "cli")]
pub mod cli;
pub mod commands;
pub mod crypto;
pub mod error;
pub mod node;
pub mod proximity;
pub mod storage;
pub mod telemetry;
pub mod transfer;

use error::{LightningP2PError, Result};
use node::{
    chat_mesh::ChatMeshRuntime, nearby_offer::OfferReceiptLedger, LightningP2PNode, NearbyServices,
    NearbyShareRegistry, NodeRuntimeStatus, NodeSupervisor, OfferInbox,
};
use std::sync::{atomic::AtomicBool, Arc};
use storage::{
    blocked_peers::BlockedPeers,
    paired_devices::PairedDevices,
    resumable_receives::ResumableReceiveStore,
    settings::{resolve_app_data_dir, SettingsState},
};
use tauri::Manager;
use tokio::sync::{Mutex, RwLock};
use transfer::queue::TransferQueue;

/// Shared application state accessible from Tauri commands.
pub struct AppState {
    /// Resolved application data directory for this profile.
    pub data_dir: std::path::PathBuf,
    /// The iroh-backed P2P node.
    pub node: Arc<RwLock<Option<Arc<LightningP2PNode>>>>,
    /// Last known node startup or reachability status.
    pub node_runtime: Arc<RwLock<NodeRuntimeStatus>>,
    /// Supervises node startup and restart sequencing.
    pub node_supervisor: NodeSupervisor,
    /// Persisted user settings shared across sessions.
    pub settings: SettingsState,
    /// Persisted user-confirmed public device identities.
    pub paired_devices: PairedDevices,
    /// Persisted identities blocked from sending nearby file offers.
    pub blocked_peers: BlockedPeers,
    /// In-memory registry of active transfers.
    pub transfers: TransferQueue,
    /// Bounded, non-secret metadata for restart-safe incoming receives.
    pub resumable_receives: ResumableReceiveStore,
    /// Nearby-share discovery state for LAN-based receive flows.
    pub nearby_shares: NearbyShareRegistry,
    /// Inbox of inbound push-share offers awaiting a user decision.
    pub offer_inbox: OfferInbox,
    /// Bounded ledger for sender-side verified-save receipts.
    pub offer_receipts: OfferReceiptLedger,
    /// Guards the BLE discovery drain loop so only one poller runs.
    pub ble_polling_active: Arc<AtomicBool>,
    /// Isolated native encrypted chat-mesh state.
    pub chat_mesh: Arc<Mutex<ChatMeshRuntime>>,
    /// Guards the Windows GATT chat drain loop.
    pub chat_mesh_polling_active: Arc<AtomicBool>,
}

impl AppState {
    /// Creates a new `AppState` with no node initialized yet.
    ///
    /// # Panics
    ///
    /// Panics only if the operating system cannot provide cryptographic
    /// randomness for the session identity or a temporary recovery runtime
    /// cannot be initialized.
    #[must_use]
    pub fn new(data_dir: std::path::PathBuf, settings: SettingsState) -> Self {
        let paired_devices = PairedDevices::load(&data_dir).unwrap_or_else(|_error| {
            tracing::error!("could not load saved devices; using an in-memory empty list");
            PairedDevices::in_memory(&data_dir)
        });
        let blocked_peers = BlockedPeers::load(&data_dir).unwrap_or_else(|_error| {
            tracing::error!("could not load nearby block list; using an in-memory empty list");
            BlockedPeers::in_memory()
        });
        let node = Arc::new(RwLock::new(None));
        let node_runtime = Arc::new(RwLock::new(NodeRuntimeStatus::starting()));
        let node_supervisor =
            NodeSupervisor::new(data_dir.clone(), node.clone(), node_runtime.clone());
        let mesh_identity =
            crypto::load_or_create_chat_mesh_identity(&data_dir).unwrap_or_else(|_error| {
                tracing::error!(
                    "could not load persisted chat mesh identity; using a session identity"
                );
                node::chat_mesh::MeshIdentity::generate()
                    .expect("operating system randomness is required for chat identity")
            });
        let chat_mesh = ChatMeshRuntime::load(
            &data_dir,
            mesh_identity,
            node::nearby_protocol::local_device_name(),
        )
        .unwrap_or_else(|_error| {
            tracing::error!("could not load chat mesh stores; using clean bounded stores");
            let fallback = std::env::temp_dir().join("lightning-chat-recovery");
            ChatMeshRuntime::load(
                &fallback,
                node::chat_mesh::MeshIdentity::generate()
                    .expect("operating system randomness is required for chat identity"),
                node::nearby_protocol::local_device_name(),
            )
            .expect("temporary chat mesh runtime must initialize")
        });
        let resumable_receives = ResumableReceiveStore::load(&data_dir).unwrap_or_else(|_error| {
            tracing::warn!(
                "could not load receive recovery metadata; resume disabled this session"
            );
            ResumableReceiveStore::in_memory()
        });
        Self {
            data_dir,
            node,
            node_runtime,
            node_supervisor,
            settings,
            paired_devices,
            blocked_peers,
            transfers: TransferQueue::new(),
            resumable_receives,
            nearby_shares: NearbyShareRegistry::new(true),
            offer_inbox: OfferInbox::new(),
            offer_receipts: OfferReceiptLedger::new(),
            ble_polling_active: Arc::new(AtomicBool::new(false)),
            chat_mesh: Arc::new(Mutex::new(chat_mesh)),
            chat_mesh_polling_active: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Returns the initialized node handle.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError::Other` if the node is unavailable or still
    /// starting, with the supervisor's current status attached when available.
    pub async fn get_node(&self) -> Result<Arc<LightningP2PNode>> {
        if let Some(node) = self.node.read().await.clone() {
            return Ok(node);
        }

        let status = self.node_supervisor.status().await;
        let message = match status.phase {
            node::NodeSupervisorPhase::Starting
            | node::NodeSupervisorPhase::Restarting
            | node::NodeSupervisorPhase::BlockedActiveTransfers => {
                status.last_error.unwrap_or_else(|| {
                    "The transfer engine is still starting. Try again when Settings shows Ready."
                        .into()
                })
            }
            node::NodeSupervisorPhase::Failed => status
                .last_error
                .unwrap_or_else(|| "Node startup failed. Open Settings to retry startup.".into()),
            node::NodeSupervisorPhase::Idle => {
                "The transfer engine is unavailable. Open Settings to review its status.".into()
            }
        };
        Err(LightningP2PError::Other(message))
    }
}

#[cfg(windows)]
fn register_deep_links<R: tauri::Runtime>(app: &tauri::App<R>) {
    use tauri_plugin_deep_link::DeepLinkExt;

    if let Err(_error) = app.deep_link().register_all() {
        tracing::warn!("failed to register deep links at runtime");
    }
}

#[cfg(not(windows))]
fn register_deep_links<R: tauri::Runtime>(_app: &tauri::App<R>) {}

/// Trim Android share-staging cache entries older than 24h so a long-running
/// install doesn't leak unbounded picker bytes into the cache directory.
///
/// Runs as a deferred async task because the underlying JNI calls require the
/// activity to be live and the app classloader to be reachable — neither is
/// guaranteed during synchronous Tauri setup. Any failure is logged and
/// swallowed so it can never crash app startup.
fn sweep_mobile_staging_cache() {
    #[cfg(target_os = "android")]
    {
        tauri::async_runtime::spawn_blocking(|| {
            let cutoff = commands::mobile::android::epoch_ms_24h_ago();
            match commands::mobile::android::sweep_staging_older_than(cutoff) {
                Ok(removed) => {
                    tracing::info!(removed, "Android JNI bootstrap verified");
                    if removed > 0 {
                        tracing::info!(removed, "swept stale shared-staging cache entries");
                    }
                }
                Err(_error) => tracing::warn!("shared-staging cleanup failed"),
            }
        });
    }
}

fn app_builder() -> tauri::Builder<tauri::Wry> {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init());

    #[cfg(any(target_os = "android", target_os = "ios"))]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());

    builder.plugin(tauri_plugin_updater::Builder::new().build())
}

fn spawn_node_startup(handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = handle.state::<AppState>();
        let settings = state.settings.snapshot().await;
        state
            .node_supervisor
            .start(
                handle.clone(),
                settings,
                NearbyServices::new(
                    state.nearby_shares.clone(),
                    state.offer_inbox.clone(),
                    state.offer_receipts.clone(),
                    state.blocked_peers.clone(),
                    state.paired_devices.clone(),
                ),
            )
            .await;
    });
}

/// Entry point: configures Tauri with plugins, state, and command handlers.
///
/// # Panics
///
/// Panics if Tauri fails to build (unrecoverable).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(clippy::too_many_lines)]
pub fn run() {
    telemetry::init_tracing();

    let data_dir = match resolve_app_data_dir() {
        Ok(data_dir) => data_dir,
        Err(_error) => {
            let fallback = std::env::temp_dir().join("com.lightningp2p.app");
            tracing::error!("failed to resolve app data dir; using temporary fallback");
            fallback
        }
    };
    let settings = match SettingsState::load_or_create(&data_dir) {
        Ok(settings) => settings,
        Err(_error) => {
            tracing::error!("failed to load settings; launching with in-memory defaults");
            SettingsState::in_memory_defaults(&data_dir)
        }
    };
    let app_state = AppState::new(data_dir, settings);

    if let Err(_error) = app_builder()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::chat::send_chat_message,
            commands::chat::load_lightning_chat_secret,
            commands::chat::store_lightning_chat_secret,
            commands::chat::panic_wipe_lightning_chat,
            commands::chat::get_chat_mesh_status,
            commands::chat::set_chat_mesh_nickname,
            commands::chat::send_chat_mesh_message,
            commands::chat::send_chat_mesh_private_message,
            commands::chat::send_chat_mesh_media,
            commands::chat::create_chat_mesh_group,
            commands::chat::send_chat_mesh_group_message,
            commands::chat::render_chat_trust_qr,
            commands::chat::verify_chat_trust_qr,
            commands::share::create_share,
            commands::share::describe_share_paths,
            commands::share::cancel_share_path_scan,
            commands::share::get_ticket,
            commands::share::render_ticket_qr,
            commands::share::clear_active_share,
            commands::transfer::start_receive,
            commands::transfer::prewarm_ticket,
            commands::transfer::get_discovered_shares,
            commands::transfer::start_receive_discovered_share,
            commands::transfer::cancel_transfer,
            commands::transfer::pause_transfer,
            commands::transfer::resume_transfer,
            commands::transfer::get_active_transfers,
            commands::transfer::get_transfer_history,
            commands::transfer::clear_transfer_history,
            commands::nearby::get_nearby_devices,
            commands::nearby::get_pending_incoming_offers,
            commands::nearby::clear_peer_cache,
            commands::nearby::offer_share_to_peer,
            commands::nearby::offer_share_to_peers,
            commands::nearby::respond_to_offer,
            commands::nearby::set_nearby_peer_blocked,
            commands::nearby::get_blocked_nearby_peers,
            commands::nearby::set_ready_to_catch,
            commands::diagnostics::get_network_diagnostics,
            commands::diagnostics::get_ble_discovery_status,
            commands::diagnostics::collect_diagnostic_bundle,
            commands::diagnostics::record_frontend_diagnostic,
            commands::peer::get_node_id,
            commands::peer::get_node_status,
            commands::peer::get_node_supervisor_status,
            commands::peer::retry_node_startup,
            commands::peer::get_local_device_identity,
            commands::peer::get_device_pairing_code,
            commands::peer::list_paired_devices,
            commands::peer::pair_verified_device,
            commands::peer::rename_paired_device,
            commands::peer::remove_paired_device,
            commands::platform::get_platform_profile,
            commands::settings::get_app_settings,
            commands::settings::get_download_dir,
            commands::settings::set_download_dir,
            commands::settings::set_auto_update_enabled,
            commands::settings::complete_first_run,
            commands::settings::set_relay_mode,
            commands::settings::set_custom_relay_url,
            commands::settings::set_local_discovery_enabled,
            commands::settings::set_bluetooth_discovery_enabled,
            commands::settings::set_transfer_mode,
            commands::settings::set_experimental_swarm_receive,
            commands::settings::open_download_dir,
            commands::mobile::resolve_content_uris,
            commands::mobile::take_pending_shared_files,
            commands::mobile::delete_staged_shared_files,
            commands::mobile::take_pending_shared_ticket,
            commands::mobile::open_android_bucket,
            commands::mobile::start_ble_discovery,
            commands::mobile::stop_ble_discovery,
        ])
        .setup(|app| {
            register_deep_links(app);
            spawn_node_startup(app.handle().clone());
            sweep_mobile_staging_cache();
            Ok(())
        })
        .run(tauri::generate_context!())
    {
        tracing::error!("error while running tauri application");
    }
}
