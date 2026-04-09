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
use node::FastDropNode;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;
use transfer::queue::TransferQueue;

/// Shared application state accessible from Tauri commands.
pub struct AppState {
    /// The iroh-backed P2P node.
    pub node: Arc<RwLock<Option<Arc<FastDropNode>>>>,
    /// In-memory registry of active transfers.
    pub transfers: TransferQueue,
}

impl AppState {
    /// Creates a new `AppState` with no node initialized yet.
    #[must_use]
    pub fn new() -> Self {
        Self {
            node: Arc::new(RwLock::new(None)),
            transfers: TransferQueue::new(),
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

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

/// Entry point: configures Tauri with plugins, state, and command handlers.
///
/// # Panics
///
/// Panics if Tauri fails to build (unrecoverable).
pub fn run() {
    telemetry::init_tracing();

    let app_state = AppState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::share::create_share,
            commands::share::describe_share_paths,
            commands::share::get_ticket,
            commands::share::render_ticket_qr,
            commands::transfer::start_receive,
            commands::transfer::cancel_transfer,
            commands::transfer::get_active_transfers,
            commands::transfer::get_transfer_history,
            commands::peer::get_node_id,
            commands::peer::get_node_status,
            commands::settings::get_download_dir,
            commands::settings::set_download_dir,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match node::FastDropNode::start(&handle).await {
                    Ok(node) => {
                        let state = handle.state::<AppState>();
                        let mut guard = state.node.write().await;
                        *guard = Some(Arc::new(node));
                        tracing::info!("iroh node started successfully");
                    }
                    Err(e) => {
                        tracing::error!("Failed to start iroh node: {e}");
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
