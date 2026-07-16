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
use bytes::Bytes;
use futures_channel::{mpsc, oneshot};
use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::Endpoint;
use iroh_blobs::format::collection::Collection;
use iroh_blobs::store::mem::MemStore;
use iroh_blobs::ticket::BlobTicket;
use iroh_blobs::{BlobFormat, BlobsProtocol, Hash};
use n0_future::{task, SinkExt as _};

/// Chunks buffered between the JS reader and the hashing store before
/// backpressure parks the producer (bounds extra memory during import).
const IMPORT_CHANNEL_DEPTH: usize = 8;

/// A file import in flight: chunks stream through the channel into the store,
/// which hashes them incrementally — the file never needs a second full-size
/// buffer in wasm memory.
struct ActiveImport {
    name: String,
    len: u64,
    tx: mpsc::Sender<std::io::Result<Bytes>>,
    done: oneshot::Receiver<Result<Hash, String>>,
}

/// A live browser share: an endpoint accepting iroh-blobs requests plus the
/// staged files. Use [`shutdown`](Self::shutdown) to stop serving — dropping
/// the handle alone leaves the router's accept task running.
pub struct Sharer {
    endpoint: Endpoint,
    router: Router,
    store: MemStore,
    staged: Vec<(String, Hash)>,
    total_bytes: u64,
    active: Option<ActiveImport>,
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
            router,
            store,
            staged: Vec::new(),
            total_bytes: 0,
            active: None,
        })
    }

    /// Stops serving for real: shuts down the accept loop and closes the
    /// endpoint. The router's spawned accept task holds endpoint and store
    /// clones, so merely dropping the `Sharer` leaves it serving — call this
    /// when the user ends the share.
    pub async fn shutdown(&self) {
        let _ = self.router.shutdown().await;
        self.endpoint.close().await;
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

    /// Begins a streamed import under `name`: push chunks with
    /// [`push_chunk`](Self::push_chunk), then seal with
    /// [`finish_file`](Self::finish_file). The store hashes chunks as they
    /// arrive, so the file is never double-buffered in memory — this is how
    /// big files fit inside the browser's wasm memory budget.
    ///
    /// # Errors
    ///
    /// Returns a message if another streamed import is already in progress.
    pub fn begin_file(&mut self, name: String) -> Result<(), String> {
        if self.active.is_some() {
            return Err("a file import is already in progress".to_owned());
        }
        let (tx, rx) = mpsc::channel(IMPORT_CHANNEL_DEPTH);
        let (done_tx, done_rx) = oneshot::channel();
        let store = self.store.clone();
        task::spawn(async move {
            let result = store
                .blobs()
                .add_stream(rx)
                .await
                .with_tag()
                .await
                .map(|tag| tag.hash)
                .map_err(|e| e.to_string());
            let _ = done_tx.send(result);
        });
        self.active = Some(ActiveImport {
            name,
            len: 0,
            tx,
            done: done_rx,
        });
        Ok(())
    }

    /// Appends one chunk to the in-flight import. Applies backpressure: the
    /// call parks while the store is behind, keeping buffered chunks bounded.
    ///
    /// # Errors
    ///
    /// Returns a message if no import is in progress or the store task died.
    pub async fn push_chunk(&mut self, chunk: Vec<u8>) -> Result<(), String> {
        let import = self.active.as_mut().ok_or("no file import in progress")?;
        import.len += chunk.len() as u64;
        import
            .tx
            .send(Ok(Bytes::from(chunk)))
            .await
            .map_err(|_| "file import stopped unexpectedly".to_owned())
    }

    /// Seals the in-flight import and stages the file for publishing.
    ///
    /// # Errors
    ///
    /// Returns a message if no import is in progress or hashing failed.
    pub async fn finish_file(&mut self) -> Result<(), String> {
        let ActiveImport {
            name,
            len,
            tx,
            done,
        } = self.active.take().ok_or("no file import in progress")?;
        drop(tx);
        let hash = done
            .await
            .map_err(|_| "file import task dropped".to_owned())??;
        self.staged.push((name, hash));
        self.total_bytes += len;
        Ok(())
    }

    /// Total bytes staged so far, for the UI's size gate.
    #[must_use]
    pub fn staged_bytes(&self) -> u64 {
        self.total_bytes
    }

    /// Hashes of the staged files, in staging order.
    #[must_use]
    pub fn staged_hashes(&self) -> Vec<Hash> {
        self.staged.iter().map(|(_, hash)| *hash).collect()
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
        if self.active.is_some() {
            return Err("a file import is still in progress".to_owned());
        }
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
