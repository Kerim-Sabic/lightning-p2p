//! Lightning P2P browser receiver.
//!
//! Runs the same Rust engine as the desktop/mobile app — iroh for transport,
//! iroh-blobs for content-addressed, BLAKE3-verified transfer — compiled to
//! WebAssembly and executed in the page. There is no server backend: the
//! browser dials the sender directly over iroh's relay-over-WebSocket
//! transport and pulls verified bytes into an in-memory store.
//!
//! Browser peers are relay-only (no hole punching in a browser) and
//! memory-bound (the blob lives in wasm memory), so the UI enforces a size
//! gate before fetching. See `docs/browser-receiver-spike.md`.

pub mod qr;
pub mod sender;
pub mod ticket;

use iroh::address_lookup::memory::MemoryLookup;
use iroh::endpoint::presets;
use iroh::Endpoint;
use iroh_blobs::api::proto::BlobStatus;
use iroh_blobs::format::collection::Collection;
use iroh_blobs::store::mem::MemStore;
use iroh_blobs::Hash;
use ticket::ParsedTicket;

#[cfg(target_arch = "wasm32")]
pub mod wasm;

/// A running browser receiver: an iroh endpoint plus an in-memory blob store.
pub struct Receiver {
    endpoint: Endpoint,
    lookup: MemoryLookup,
    store: MemStore,
}

/// Metadata shown before a fetch so the UI can gate on size.
#[derive(Debug, Clone)]
pub struct TicketInfo {
    pub label: String,
    pub size: u64,
}

/// One file inside a fetched collection, ready to save.
#[derive(Debug, Clone)]
pub struct CollectionEntry {
    /// File name (may contain `/` for nested directory entries).
    pub name: String,
    /// Content hash to pass back into [`Receiver::read_bytes`].
    pub hash: Hash,
    /// Size in bytes.
    pub size: u64,
}

impl Receiver {
    /// Binds an iroh endpoint (relay transport, n0 preset) and an in-memory
    /// store. Cheap enough to create lazily when the user opts into browser
    /// receive.
    ///
    /// # Errors
    ///
    /// Returns a message if the endpoint cannot bind.
    pub async fn spawn() -> Result<Self, String> {
        let lookup = MemoryLookup::new();
        let endpoint = Endpoint::builder(presets::N0)
            .address_lookup(lookup.clone())
            .bind()
            .await
            .map_err(|e| e.to_string())?;
        Ok(Self {
            endpoint,
            lookup,
            store: MemStore::new(),
        })
    }

    /// Reads a ticket's label and size without fetching any payload.
    ///
    /// # Errors
    ///
    /// Returns a message if the ticket cannot be parsed.
    pub fn inspect(ticket_str: &str) -> Result<TicketInfo, String> {
        let parsed = ticket::parse(ticket_str)?;
        Ok(TicketInfo {
            label: parsed.label,
            size: parsed.size,
        })
    }

    /// Downloads the ticket's content into the in-memory store. iroh-blobs
    /// verifies every chunk against its BLAKE3 hash as it lands, so a
    /// successful return means the bytes are proven-correct.
    ///
    /// Returns the root [`Hash`] to read from and whether it is a collection.
    ///
    /// # Errors
    ///
    /// Returns a message if the ticket is invalid or the download fails.
    pub async fn fetch(&self, ticket_str: &str) -> Result<Hash, String> {
        let parsed = ticket::parse(ticket_str)?;
        self.register_providers(&parsed);
        let primary = parsed.primary();
        let downloader = self.store.downloader(&self.endpoint);
        downloader
            .download(primary.hash_and_format(), provider_ids(&parsed))
            .await
            .map_err(|e| e.to_string())?;
        Ok(primary.hash())
    }

    /// Lists the files inside a fetched collection so the UI can offer a save
    /// button per file. Every Lightning P2P ticket is a HashSeq collection
    /// (a single shared file is a one-entry collection), so this is the
    /// uniform way to enumerate what landed.
    ///
    /// # Errors
    ///
    /// Returns a message if the collection metadata is missing or unreadable.
    pub async fn list_collection(&self, root: Hash) -> Result<Vec<CollectionEntry>, String> {
        let collection = Collection::load(root, &*self.store)
            .await
            .map_err(|e| e.to_string())?;
        let mut entries = Vec::new();
        for (name, hash) in collection.iter() {
            let size = self.blob_size(*hash).await?;
            entries.push(CollectionEntry {
                name: name.clone(),
                hash: *hash,
                size,
            });
        }
        Ok(entries)
    }

    /// Reads a fetched blob's bytes out of the store.
    ///
    /// # Errors
    ///
    /// Returns a message if the blob is absent or unreadable.
    pub async fn read_bytes(&self, hash: Hash) -> Result<Vec<u8>, String> {
        self.store
            .blobs()
            .get_bytes(hash)
            .await
            .map(|bytes| bytes.to_vec())
            .map_err(|e| e.to_string())
    }

    /// Reads one slice of a fetched blob, so a big save can stream to disk in
    /// pieces instead of materializing a second full-size copy in memory.
    ///
    /// # Errors
    ///
    /// Returns a message if the blob is absent or the range is unreadable.
    pub async fn read_range(&self, hash: Hash, offset: u64, len: u64) -> Result<Vec<u8>, String> {
        self.store
            .blobs()
            .export_ranges(hash, offset..offset.saturating_add(len))
            .concatenate()
            .await
            .map_err(|e| e.to_string())
    }

    /// Returns a stored blob's size in bytes.
    async fn blob_size(&self, hash: Hash) -> Result<u64, String> {
        match self
            .store
            .blobs()
            .status(hash)
            .await
            .map_err(|e| e.to_string())?
        {
            BlobStatus::Complete { size } => Ok(size),
            BlobStatus::Partial { size } => Ok(size.unwrap_or(0)),
            BlobStatus::NotFound => Err(format!("missing blob {hash}")),
        }
    }

    /// Teaches the endpoint how to reach every provider (relay addresses from
    /// the ticket), so the downloader can dial them.
    fn register_providers(&self, parsed: &ParsedTicket) {
        for provider in &parsed.providers {
            self.lookup.add_endpoint_info(provider.addr().clone());
        }
    }
}

/// Provider endpoint ids the downloader may dial for the content.
fn provider_ids(parsed: &ParsedTicket) -> Vec<iroh::EndpointId> {
    parsed.providers.iter().map(|t| t.addr().id).collect()
}
