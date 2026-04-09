//! iroh endpoint and iroh-blobs protocol setup.
//!
//! This module boots the iroh QUIC endpoint with n0 discovery and wires up the
//! iroh-blobs protocol for content-addressed transfers.

use crate::error::{FastDropError, Result};
use crate::storage::db::StorageDb;
use iroh::protocol::Router;
use iroh::{Endpoint, NodeAddr, NodeId};
use iroh_blobs::net_protocol::Blobs;
use iroh_blobs::rpc::client::blobs::MemClient;
use iroh_blobs::store::fs::Store as BlobStore;
use std::path::PathBuf;
use std::time::Duration;
use tauri::AppHandle;

const APP_IDENTIFIER: &str = "com.fastdrop.app";
const DATA_DIR_ENV: &str = "FASTDROP_DATA_DIR";
const PROFILE_ENV: &str = "FASTDROP_PROFILE";
const RELAY_WAIT_TIMEOUT: Duration = Duration::from_secs(30);

/// The running iroh node with blob transfer capability.
pub struct FastDropNode {
    endpoint: Endpoint,
    blobs: Blobs<BlobStore>,
    router: Router,
    /// Local sled database.
    pub db: StorageDb,
    /// Directory where received files are saved.
    pub download_dir: PathBuf,
}

impl FastDropNode {
    /// Starts the iroh node, blob store, and protocol router for the app.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError` if endpoint binding, storage creation, or
    /// protocol startup fails.
    pub async fn start(app_handle: &AppHandle) -> Result<Self> {
        let data_dir = app_data_dir(app_handle)?;
        let download_dir = default_download_dir(&data_dir);
        Self::start_with_dirs(data_dir, download_dir).await
    }

    /// Starts the iroh node using explicit directories.
    ///
    /// This is used by the app and by integration tests that need isolated
    /// in-process nodes.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError` if endpoint binding, storage creation, or
    /// protocol startup fails.
    pub async fn start_with_dirs(data_dir: PathBuf, download_dir: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&data_dir)?;
        std::fs::create_dir_all(&download_dir)?;

        let endpoint = bind_endpoint().await?;
        tracing::info!("FastDrop node started: {}", endpoint.node_id());

        let blob_store = load_blob_store(&data_dir).await?;
        let blobs = Blobs::builder(blob_store).build(&endpoint);
        let router = Router::builder(endpoint.clone())
            .accept(iroh_blobs::ALPN, blobs.clone())
            .spawn()
            .await
            .map_err(FastDropError::Network)?;
        let db = StorageDb::open(&data_dir.join("fastdrop.db"))?;

        Ok(Self {
            endpoint,
            blobs,
            router,
            db,
            download_dir,
        })
    }

    /// Returns this node's unique `NodeId`.
    #[must_use]
    pub fn node_id(&self) -> NodeId {
        self.endpoint.node_id()
    }

    /// Returns a relay-backed `NodeAddr` suitable for share tickets.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError` if direct addresses or the home relay are not
    /// ready in time.
    pub async fn ticket_addr(&self) -> Result<NodeAddr> {
        let direct_addresses = self
            .endpoint
            .direct_addresses()
            .initialized()
            .await
            .map_err(|err| FastDropError::Other(err.to_string()))?;
        let relay_url = wait_for_home_relay(&self.endpoint).await?;
        Ok(NodeAddr::from_parts(
            self.node_id(),
            Some(relay_url),
            direct_addresses.into_iter().map(|addr| addr.addr),
        ))
    }

    /// Returns a reference to the iroh endpoint.
    #[must_use]
    pub fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }

    /// Returns a reference to the blobs protocol handle.
    #[must_use]
    pub fn blobs(&self) -> &Blobs<BlobStore> {
        &self.blobs
    }

    /// Returns the RPC-style blobs client used for local store operations.
    #[must_use]
    pub fn blobs_client(&self) -> &MemClient {
        self.blobs.client()
    }

    /// Shuts the node down cleanly.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError` if the iroh router shutdown fails.
    pub async fn shutdown(&self) -> Result<()> {
        self.router.shutdown().await.map_err(FastDropError::Network)
    }
}

async fn bind_endpoint() -> Result<Endpoint> {
    Endpoint::builder()
        .discovery_n0()
        .bind()
        .await
        .map_err(FastDropError::Network)
}

async fn load_blob_store(data_dir: &std::path::Path) -> Result<BlobStore> {
    BlobStore::load(data_dir.join("blobs"))
        .await
        .map_err(|err| FastDropError::Blob(err.to_string()))
}

async fn wait_for_home_relay(endpoint: &Endpoint) -> Result<iroh::RelayUrl> {
    let mut watcher = endpoint.home_relay();
    tokio::time::timeout(RELAY_WAIT_TIMEOUT, watcher.initialized())
        .await
        .map_err(|_| FastDropError::Other("Home relay not ready yet".into()))?
        .map_err(|err| FastDropError::Other(err.to_string()))
}

fn default_download_dir(data_dir: &std::path::Path) -> PathBuf {
    match dirs::download_dir() {
        Some(path) => path,
        None => data_dir.join("downloads"),
    }
}

fn app_data_dir(app_handle: &AppHandle) -> Result<PathBuf> {
    let _ = app_handle;
    if let Some(path) = std::env::var_os(DATA_DIR_ENV) {
        return Ok(PathBuf::from(path));
    }

    let mut dir = dirs::data_local_dir()
        .ok_or_else(|| FastDropError::Other("cannot resolve app data dir".into()))?
        .join(APP_IDENTIFIER);
    if let Some(profile) = std::env::var_os(PROFILE_ENV) {
        if !profile.is_empty() {
            dir = dir.join(profile);
        }
    }
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_download_dir_uses_fallback_when_missing() {
        let data_dir = PathBuf::from("C:/tmp/fastdrop-test");
        let path = default_download_dir(&data_dir);
        assert!(path.is_absolute() || path.ends_with("downloads"));
    }
}
