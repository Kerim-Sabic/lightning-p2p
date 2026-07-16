//! `wasm-bindgen` surface consumed by the receive page.
//!
//! Kept thin on purpose: it adapts the [`Receiver`](crate::Receiver) engine to
//! JS types (strings, `Uint8Array`, JSON). All transfer logic stays in Rust.

use crate::sender::Sharer;
use crate::Receiver;
use iroh_blobs::Hash;
use std::str::FromStr;
use wasm_bindgen::prelude::*;

/// Installs a readable panic hook so a Rust panic surfaces in the JS console
/// instead of an opaque `unreachable` trap. Call once on module load.
#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

/// Renders text (a receive link or raw ticket) as an SVG QR code string,
/// styled identically to the desktop app's QR.
#[wasm_bindgen]
pub fn render_qr_svg(text: &str) -> Result<String, JsError> {
    crate::qr::render_svg(text).map_err(|e| JsError::new(&e))
}

/// Ticket metadata for the pre-fetch size gate, as a JSON string
/// (`{"label":...,"size":...}`). Fetches nothing.
#[wasm_bindgen]
pub fn inspect_ticket(ticket: &str) -> Result<String, JsError> {
    let info = Receiver::inspect(ticket).map_err(|e| JsError::new(&e))?;
    Ok(format!(
        "{{\"label\":{},\"size\":{}}}",
        serde_json::to_string(&info.label).unwrap_or_else(|_| "\"\"".into()),
        info.size
    ))
}

/// A live browser receiver handle exposed to JS.
#[wasm_bindgen]
pub struct WebReceiver {
    inner: Receiver,
}

#[wasm_bindgen]
impl WebReceiver {
    /// Binds the iroh endpoint and in-memory store.
    #[wasm_bindgen]
    pub async fn spawn() -> Result<WebReceiver, JsError> {
        let inner = Receiver::spawn().await.map_err(|e| JsError::new(&e))?;
        Ok(Self { inner })
    }

    /// Downloads the ticket's content (BLAKE3-verified) and returns the root
    /// collection hash as a hex string. Pass it to
    /// [`list_collection`](Self::list_collection) to enumerate the files.
    #[wasm_bindgen]
    pub async fn fetch(&self, ticket: String) -> Result<String, JsError> {
        let hash = self
            .inner
            .fetch(&ticket)
            .await
            .map_err(|e| JsError::new(&e))?;
        Ok(hash.to_string())
    }

    /// Lists the files inside a fetched collection as a JSON string:
    /// `[{"name":...,"hash":...,"size":...}, ...]`. A single-file share is a
    /// one-entry collection.
    #[wasm_bindgen]
    pub async fn list_collection(&self, root_hex: String) -> Result<String, JsError> {
        let root = Hash::from_str(&root_hex).map_err(|e| JsError::new(&e.to_string()))?;
        let entries = self
            .inner
            .list_collection(root)
            .await
            .map_err(|e| JsError::new(&e))?;
        let json: Vec<String> = entries
            .iter()
            .map(|entry| {
                format!(
                    "{{\"name\":{},\"hash\":\"{}\",\"size\":{}}}",
                    serde_json::to_string(&entry.name).unwrap_or_else(|_| "\"\"".into()),
                    entry.hash,
                    entry.size
                )
            })
            .collect();
        Ok(format!("[{}]", json.join(",")))
    }

    /// Reads a fetched blob's bytes for saving to disk.
    #[wasm_bindgen]
    pub async fn read_blob(&self, hash_hex: String) -> Result<js_sys::Uint8Array, JsError> {
        let hash = Hash::from_str(&hash_hex).map_err(|e| JsError::new(&e.to_string()))?;
        let bytes = self
            .inner
            .read_bytes(hash)
            .await
            .map_err(|e| JsError::new(&e))?;
        Ok(js_sys::Uint8Array::from(bytes.as_slice()))
    }

    /// Reads one slice of a fetched blob, so big saves stream to disk chunk
    /// by chunk instead of doubling the file in memory.
    #[wasm_bindgen]
    pub async fn read_blob_range(
        &self,
        hash_hex: String,
        offset: f64,
        len: f64,
    ) -> Result<js_sys::Uint8Array, JsError> {
        let hash = Hash::from_str(&hash_hex).map_err(|e| JsError::new(&e.to_string()))?;
        // f64 keeps JS ergonomics; exact for any offset a tab can hold.
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let bytes = self
            .inner
            .read_range(hash, offset as u64, len as u64)
            .await
            .map_err(|e| JsError::new(&e))?;
        Ok(js_sys::Uint8Array::from(bytes.as_slice()))
    }
}

/// A live browser share exposed to JS: stage files, then publish a ticket.
/// The tab must stay open while peers download.
#[wasm_bindgen]
pub struct WebSender {
    inner: Sharer,
}

#[wasm_bindgen]
impl WebSender {
    /// Binds the endpoint and starts accepting iroh-blobs requests.
    #[wasm_bindgen]
    pub async fn spawn() -> Result<WebSender, JsError> {
        let inner = Sharer::spawn().await.map_err(|e| JsError::new(&e))?;
        Ok(Self { inner })
    }

    /// Stages one file's bytes under `name`.
    #[wasm_bindgen]
    pub async fn add_file(
        &mut self,
        name: String,
        bytes: js_sys::Uint8Array,
    ) -> Result<(), JsError> {
        self.inner
            .add_file(name, bytes.to_vec())
            .await
            .map_err(|e| JsError::new(&e))
    }

    /// Begins a streamed import under `name`; push chunks, then finish.
    /// Streaming keeps big files from being double-buffered in wasm memory.
    #[wasm_bindgen]
    pub fn begin_file(&mut self, name: String) -> Result<(), JsError> {
        self.inner.begin_file(name).map_err(|e| JsError::new(&e))
    }

    /// Appends one chunk to the in-flight import (parks under backpressure).
    #[wasm_bindgen]
    pub async fn push_chunk(&mut self, chunk: js_sys::Uint8Array) -> Result<(), JsError> {
        self.inner
            .push_chunk(chunk.to_vec())
            .await
            .map_err(|e| JsError::new(&e))
    }

    /// Seals the in-flight import and stages the file for publishing.
    #[wasm_bindgen]
    pub async fn finish_file(&mut self) -> Result<(), JsError> {
        self.inner.finish_file().await.map_err(|e| JsError::new(&e))
    }

    /// Total bytes staged so far, for the UI's size gate.
    #[wasm_bindgen]
    pub fn staged_bytes(&self) -> f64 {
        // f64 keeps JS ergonomics; exact for anything a tab can hold.
        self.inner.staged_bytes() as f64
    }

    /// Publishes the staged files and returns the `fd2:` ticket string.
    /// Waits for relay reachability, so the returned ticket dials.
    #[wasm_bindgen]
    pub async fn publish(&mut self, label: String) -> Result<String, JsError> {
        self.inner
            .publish(&label)
            .await
            .map_err(|e| JsError::new(&e))
    }

    /// Stops serving for real: shuts down the accept loop and closes the
    /// endpoint. Call before `free()` — freeing alone leaves the spawned
    /// accept task serving.
    #[wasm_bindgen]
    pub async fn shutdown(&self) {
        self.inner.shutdown().await;
    }
}
