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
        let hash = self.inner.fetch(&ticket).await.map_err(|e| JsError::new(&e))?;
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
        let bytes = self.inner.read_bytes(hash).await.map_err(|e| JsError::new(&e))?;
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
    pub async fn add_file(&mut self, name: String, bytes: js_sys::Uint8Array) -> Result<(), JsError> {
        self.inner
            .add_file(name, bytes.to_vec())
            .await
            .map_err(|e| JsError::new(&e))
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
        self.inner.publish(&label).await.map_err(|e| JsError::new(&e))
    }
}
