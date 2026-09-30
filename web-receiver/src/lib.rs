//! Lightning P2P browser receiver.
//!
//! Runs the same Rust engine as the desktop/mobile app — iroh for transport,
//! iroh-blobs for content-addressed, BLAKE3-verified transfer — compiled to
//! WebAssembly and executed in the page. There is no file-serving backend:
//! browser peers use iroh's relay-over-WebSocket transport, which may forward
//! encrypted traffic. The compatibility receive path stores verified payloads
//! in memory; the streaming path sends Bao-verified chunks to a caller sink.
//!
//! Browser peers are relay-only (no hole punching in a browser). The UI caps
//! the in-memory path at 128 MiB; browsers with the File System Access API can
//! receive larger files through the streaming sink. See
//! `docs/browser-receiver-spike.md` for the original compatibility spike.

pub mod qr;
pub mod sender;
pub mod ticket;

use bao_tree::io::BaoContentItem;
use bytes::Bytes;
use iroh::address_lookup::memory::MemoryLookup;
use iroh::endpoint::presets;
use iroh::Endpoint;
use iroh_blobs::api::downloader::DownloadProgressItem;
use iroh_blobs::api::proto::BlobStatus;
use iroh_blobs::format::collection::{Collection, CollectionMeta};
use iroh_blobs::store::mem::MemStore;
use iroh_blobs::{hashseq::HashSeq, ticket::BlobTicket, Hash};
use n0_future::StreamExt;
use std::{future::Future, sync::Mutex};
use ticket::ParsedTicket;

#[cfg(target_arch = "wasm32")]
pub mod wasm;

const MAX_COLLECTION_ENTRIES: usize = 10_000;
const MAX_HASH_SEQUENCE_BYTES: u64 = (MAX_COLLECTION_ENTRIES as u64 + 1) * 32;
const MAX_COLLECTION_METADATA_BYTES: u64 = 8 * 1024 * 1024;

struct StreamAttemptError {
    message: String,
    retryable: bool,
}

fn provider_stream_failure(message: String, delivered_bytes: u64) -> StreamAttemptError {
    StreamAttemptError {
        message,
        retryable: delivered_bytes == 0,
    }
}

/// A running browser receiver: an iroh endpoint plus an in-memory blob store.
pub struct Receiver {
    endpoint: Endpoint,
    lookup: MemoryLookup,
    store: MemStore,
    streaming_providers: Mutex<Vec<BlobTicket>>,
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
            streaming_providers: Mutex::new(Vec::new()),
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
        self.fetch_with_limit(ticket_str, u64::MAX, |_| true).await
    }

    /// Closes the endpoint so any in-flight browser receive is cancelled.
    pub async fn cancel(&self) {
        self.endpoint.close().await;
    }

    /// Downloads only the bounded collection manifest and authenticates each
    /// entry's size. File bodies are fetched later by `stream_blob_to`, which
    /// yields each Bao-verified leaf before awaiting the writable sink.
    pub async fn prepare_streamed_collection<F>(
        &self,
        ticket_str: &str,
        mut on_progress: F,
    ) -> Result<Vec<CollectionEntry>, String>
    where
        F: FnMut(u64) -> bool,
    {
        let parsed = ticket::parse(ticket_str)?;
        let primary = parsed.primary();
        if primary.format() != iroh_blobs::BlobFormat::HashSeq {
            return Err("This ticket does not contain a supported file collection.".into());
        }
        self.register_providers(&parsed);
        *self
            .streaming_providers
            .lock()
            .map_err(|_| "browser receive provider state is unavailable")? =
            parsed.providers.clone();

        let connection = self.connect_stream_provider().await?;
        let (root_bytes, root_size) = read_bounded_blob(
            connection.clone(),
            primary.hash(),
            MAX_HASH_SEQUENCE_BYTES,
            &mut on_progress,
        )
        .await?;
        if root_size != root_bytes.len() as u64 {
            return Err("The collection index length did not match its verified size.".into());
        }
        let links = HashSeq::try_from(Bytes::from(root_bytes))
            .map_err(|error| format!("invalid collection index: {error}"))?;
        if links.is_empty() || links.len() > MAX_COLLECTION_ENTRIES + 1 {
            return Err("The collection contains too many files or no metadata.".into());
        }
        let meta_hash = links.get(0).ok_or("collection metadata is missing")?;
        let (meta_bytes, _) = read_bounded_blob(
            connection.clone(),
            meta_hash,
            MAX_COLLECTION_METADATA_BYTES,
            &mut on_progress,
        )
        .await?;
        let meta: CollectionMeta = postcard::from_bytes(&meta_bytes)
            .map_err(|error| format!("invalid collection metadata: {error}"))?;
        if !meta.check_header() || meta.names().len() + 1 != links.len() {
            return Err("The collection metadata does not match its file index.".into());
        }

        let mut entries = Vec::with_capacity(meta.names().len());
        for (name, hash) in meta.names().iter().zip(links.into_iter().skip(1)) {
            if name.is_empty() || name.len() > 4096 || name.chars().any(char::is_control) {
                return Err("The collection contains an invalid file name.".into());
            }
            let (size, _) = iroh_blobs::get::request::get_verified_size(&connection, &hash)
                .await
                .map_err(|error| format!("could not verify file size: {error}"))?;
            entries.push(CollectionEntry {
                name: name.clone(),
                hash,
                size,
            });
        }
        Ok(entries)
    }

    /// Streams one content-addressed blob directly to a sink. Each leaf is
    /// passed to the sink only after iroh-blobs has verified its Bao proof.
    /// The caller must publish the destination only after this method returns
    /// successfully and the observed length equals `expected_size`.
    pub async fn stream_blob_to<F, Fut>(
        &self,
        hash: Hash,
        expected_size: u64,
        mut on_chunk: F,
    ) -> Result<u64, String>
    where
        F: FnMut(Vec<u8>) -> Fut,
        Fut: Future<Output = Result<bool, String>>,
    {
        let providers = self
            .streaming_providers
            .lock()
            .map_err(|_| "browser receive provider state is unavailable")?
            .clone();
        let mut last_error = "the sender is unreachable".to_owned();
        for provider in providers {
            let connection = match self
                .endpoint
                .connect(provider.addr().clone(), iroh_blobs::ALPN)
                .await
            {
                Ok(connection) => connection,
                Err(error) => {
                    last_error = error.to_string();
                    continue;
                }
            };
            match stream_verified_blob(connection, hash, expected_size, &mut on_chunk).await {
                Ok(size) => return Ok(size),
                Err(error) if error.retryable => last_error = error.message,
                Err(error) => return Err(error.message),
            }
        }
        Err(last_error)
    }

    /// Downloads while enforcing an aggregate byte ceiling from actual transport progress.
    /// The callback returns false to cancel. The sender's advertised size is never used as the limit.
    ///
    /// # Errors
    ///
    /// Returns an error for invalid tickets, transport failures, cancellation, or when the limit is exceeded.
    pub async fn fetch_with_limit<F>(
        &self,
        ticket_str: &str,
        max_bytes: u64,
        mut on_progress: F,
    ) -> Result<Hash, String>
    where
        F: FnMut(u64) -> bool,
    {
        let parsed = ticket::parse(ticket_str)?;
        self.register_providers(&parsed);
        let primary = parsed.primary();
        let downloader = self.store.downloader(&self.endpoint);
        let mut progress = downloader
            .download(primary.hash_and_format(), provider_ids(&parsed))
            .stream()
            .await
            .map_err(|error| error.to_string())?;
        while let Some(item) = progress.next().await {
            match item {
                DownloadProgressItem::Progress(bytes) => {
                    if bytes > max_bytes {
                        return Err(
                            "Browser receive stopped at its actual-data memory limit.".into()
                        );
                    }
                    if !on_progress(bytes) {
                        return Err("Browser receive cancelled.".into());
                    }
                }
                DownloadProgressItem::Error(error) => return Err(error.to_string()),
                DownloadProgressItem::DownloadError => {
                    return Err("The sender could not complete the transfer.".into());
                }
                DownloadProgressItem::TryProvider { .. }
                | DownloadProgressItem::ProviderFailed { .. }
                | DownloadProgressItem::PartComplete { .. } => {}
            }
        }
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

    async fn connect_stream_provider(&self) -> Result<iroh::endpoint::Connection, String> {
        let providers = self
            .streaming_providers
            .lock()
            .map_err(|_| "browser receive provider state is unavailable")?
            .clone();
        let mut last_error = "the sender is unreachable".to_owned();
        for provider in providers {
            match self
                .endpoint
                .connect(provider.addr().clone(), iroh_blobs::ALPN)
                .await
            {
                Ok(connection) => return Ok(connection),
                Err(error) => last_error = error.to_string(),
            }
        }
        Err(last_error)
    }
}

async fn read_bounded_blob<F>(
    connection: iroh::endpoint::Connection,
    hash: Hash,
    max_bytes: u64,
    on_progress: &mut F,
) -> Result<(Vec<u8>, u64), String>
where
    F: FnMut(u64) -> bool,
{
    let mut stream = iroh_blobs::get::request::get_blob(connection, hash);
    let mut bytes = Vec::new();
    let mut received = 0_u64;
    while let Some(item) = stream.next().await {
        match item {
            iroh_blobs::get::request::GetBlobItem::Item(BaoContentItem::Leaf(leaf)) => {
                received = received
                    .checked_add(leaf.data.len() as u64)
                    .ok_or("collection metadata size overflow")?;
                if received > max_bytes {
                    return Err("The collection metadata exceeds the safe browser limit.".into());
                }
                if !on_progress(received) {
                    return Err("Browser receive cancelled.".into());
                }
                bytes.extend_from_slice(&leaf.data);
            }
            iroh_blobs::get::request::GetBlobItem::Item(_) => {}
            iroh_blobs::get::request::GetBlobItem::Done(_) => {
                return Ok((bytes, received));
            }
            iroh_blobs::get::request::GetBlobItem::Error(error) => {
                return Err(error.to_string());
            }
        }
    }
    Err("The sender stopped before the collection metadata was verified.".into())
}

async fn stream_verified_blob<F, Fut>(
    connection: iroh::endpoint::Connection,
    hash: Hash,
    expected_size: u64,
    on_chunk: &mut F,
) -> Result<u64, StreamAttemptError>
where
    F: FnMut(Vec<u8>) -> Fut,
    Fut: Future<Output = Result<bool, String>>,
{
    let mut stream = iroh_blobs::get::request::get_blob(connection, hash);
    let mut received = 0_u64;
    while let Some(item) = stream.next().await {
        match item {
            iroh_blobs::get::request::GetBlobItem::Item(BaoContentItem::Leaf(leaf)) => {
                let next_received =
                    received
                        .checked_add(leaf.data.len() as u64)
                        .ok_or_else(|| StreamAttemptError {
                            message: "received file size overflow".into(),
                            retryable: false,
                        })?;
                if next_received > expected_size {
                    return Err(StreamAttemptError {
                        message: "Received bytes exceed the authenticated file size.".into(),
                        retryable: false,
                    });
                }
                match on_chunk(leaf.data.to_vec()).await {
                    Ok(true) => received = next_received,
                    Ok(false) => {
                        return Err(StreamAttemptError {
                            message: "Browser receive cancelled.".into(),
                            retryable: false,
                        });
                    }
                    Err(message) => {
                        return Err(StreamAttemptError {
                            message,
                            retryable: false,
                        });
                    }
                }
            }
            iroh_blobs::get::request::GetBlobItem::Item(_) => {}
            iroh_blobs::get::request::GetBlobItem::Done(_) => {
                if received != expected_size {
                    return Err(StreamAttemptError {
                        message: "The verified file length does not match its manifest.".into(),
                        retryable: false,
                    });
                }
                return Ok(received);
            }
            iroh_blobs::get::request::GetBlobItem::Error(error) => {
                return Err(provider_stream_failure(error.to_string(), received));
            }
        }
    }
    Err(provider_stream_failure(
        "The sender stopped before the file was fully verified.".into(),
        received,
    ))
}

/// Provider endpoint ids the downloader may dial for the content.
fn provider_ids(parsed: &ParsedTicket) -> Vec<iroh::EndpointId> {
    parsed.providers.iter().map(|t| t.addr().id).collect()
}

#[cfg(test)]
mod tests {
    use super::provider_stream_failure;

    #[test]
    fn only_provider_failures_before_any_output_can_fall_back() {
        assert!(provider_stream_failure("unavailable".into(), 0).retryable);
        assert!(!provider_stream_failure("disconnected".into(), 1).retryable);
    }
}
