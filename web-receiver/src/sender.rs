//! Browser-side sharing: serve files from the tab over the iroh relay.
//!
//! An iroh endpoint in a browser is a first-class peer — it is dialable
//! through the relay even though it cannot hole-punch. So a tab can *provide*
//! blobs, not just fetch them: files go into an in-memory store, a
//! `BlobsProtocol` router answers incoming iroh-blobs requests, and the ticket
//! we hand out is the exact `fd2:` envelope the desktop app, the CLI, and the
//! browser receiver already parse. The tab must stay open while sharing (the
//! same "sender stays online" rule as the native app) and everything lives in
//! wasm memory, so the UI gates on size before importing.

use crate::ticket::fd2_encode;
use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::Endpoint;
use iroh_blobs::format::collection::Collection;
use iroh_blobs::store::mem::MemStore;
use iroh_blobs::ticket::BlobTicket;
use iroh_blobs::{BlobFormat, BlobsProtocol, Hash};

/// A live browser share: an endpoint accepting iroh-blobs requests plus the
/// staged files. Dropping it stops serving.
pub struct Sharer {
    endpoint: Endpoint,
    _router: Router,
    store: MemStore,
    staged: Vec<(String, Hash)>,
    total_bytes: u64,
}

impl Sharer {
    /// Binds an endpoint (relay transport, n0 preset) and starts accepting
    /// iroh-blobs requests over it.
    ///
    /// # Errors
    ///
    /// Returns a message if the endpoint cannot bind.
    pub async fn spawn() -> Result<Self, String> {
        let endpoint = Endpoint::builder(presets::N0)
            .bind()
            .await
            .map_err(|e| e.to_string())?;
        let store = MemStore::new();
        let blobs = BlobsProtocol::new(&store, None);
        let router = Router::builder(endpoint.clone())
            .accept(iroh_blobs::ALPN, blobs)
            .spawn();
        Ok(Self {
            endpoint,
            _router: router,
            store,
            staged: Vec::new(),
            total_bytes: 0,
        })
    }

    /// Imports one file's bytes into the in-memory store under `name`.
    ///
    /// # Errors
    ///
    /// Returns a message if the import fails.
    pub async fn add_file(&mut self, name: String, bytes: Vec<u8>) -> Result<(), String> {
        let len = bytes.len() as u64;
        let tag = self
            .store
            .blobs()
            .add_bytes(bytes)
            .with_tag()
            .await
            .map_err(|e| e.to_string())?;
        self.staged.push((name, tag.hash));
        self.total_bytes += len;
        Ok(())
    }

    /// Total bytes staged so far, for the UI's size gate.
    #[must_use]
    pub fn staged_bytes(&self) -> u64 {
        self.total_bytes
    }

    /// Publishes the staged files as one collection and returns the `fd2:`
    /// ticket string that any Lightning P2P receiver (app, CLI, or another
    /// browser tab) can consume. Waits until the endpoint is reachable via
    /// the relay so the ticket dials.
    ///
    /// # Errors
    ///
    /// Returns a message if nothing is staged, the collection cannot be
    /// persisted, or the endpoint never comes online.
    pub async fn publish(&mut self, label: &str) -> Result<String, String> {
        if self.staged.is_empty() {
            return Err("no files staged to share".to_owned());
        }
        let collection: Collection = self.staged.iter().cloned().collect();
        let tag = collection
            .store(&self.store)
            .await
            .map_err(|e| e.to_string())?;
        let root = tag.hash();
        // MemStore::new() runs no garbage collector, and forgetting the temp
        // tag keeps the collection protected even if that ever changes.
        std::mem::forget(tag);

        self.endpoint.online().await;
        let addr = self.endpoint.addr();
        let ticket = BlobTicket::new(addr, root, BlobFormat::HashSeq);
        Ok(fd2_encode(&ticket, label, self.total_bytes))
    }
}
