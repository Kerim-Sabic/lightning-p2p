//! Lightweight LAN protocol used to advertise device identity, list active
//! shares, and exchange push-style share offers with nearby peers.
//!
//! Version 2 messages are tagged enums so a single ALPN can carry multiple
//! request kinds (`Hello`, `ListShares`, `OfferShare`). The receiver dispatches
//! by tag and replies on the same bi-stream. The `Hello` round-trip is small
//! and cheap, which lets the discovery layer name a freshly-discovered device
//! without waiting on the heavier `ListShares` response.

use super::nearby::{ActiveShare, NearbyShareRegistry};
use super::nearby_offer::{
    handle_offer_request, OfferDecision, OfferInbox, OfferResponseMessage, OfferShareMessage,
};
use crate::error::{LightningP2PError, Result};
use anyhow::Result as AnyhowResult;
use iroh::{endpoint::Connecting, protocol::ProtocolHandler, Endpoint, NodeAddr};
use iroh_blobs::{BlobFormat, Hash};
use n0_future::boxed::BoxFuture;
use serde::{Deserialize, Serialize};
use std::env;
use std::str::FromStr;
use tauri::AppHandle;

/// ALPN identifier for nearby discovery + offer protocol (v2).
pub const NEARBY_PROTOCOL_ALPN: &[u8] = b"lightning-p2p/nearby/2";

const MAX_MESSAGE_BYTES: usize = 64 * 1024;
const PROTOCOL_VERSION: u8 = 2;

/// Tagged request envelope sent over the nearby ALPN.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NearbyRequest {
    /// Lightweight identity probe — returns only the peer's device name.
    Hello { protocol_version: u8 },
    /// Returns the peer's currently advertised shares (if any).
    ListShares { protocol_version: u8 },
    /// Push-style offer from a sender to a receiver.
    OfferShare {
        protocol_version: u8,
        offer: OfferShareMessage,
    },
}

/// Tagged response envelope returned by the nearby protocol handler.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NearbyResponse {
    /// Hello reply.
    Hello {
        protocol_version: u8,
        device_name: String,
    },
    /// Share list reply.
    Shares {
        protocol_version: u8,
        device_name: String,
        shares: Vec<RemoteAdvertisedShare>,
    },
    /// Offer decision reply.
    OfferDecision {
        protocol_version: u8,
        response: OfferResponseMessage,
    },
}

/// Wire-level blob format that mirrors `iroh_blobs::BlobFormat`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WireBlobFormat {
    /// Single-blob payload.
    Raw,
    /// Hash sequence for multi-file / directory payloads.
    HashSeq,
}

/// Share metadata returned by a nearby peer over the nearby ALPN.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteAdvertisedShare {
    /// Root blob hash as hex.
    pub hash: String,
    /// User-visible label.
    pub label: String,
    /// Total share size in bytes.
    pub size: u64,
    /// Wire-format encoding of the blob.
    pub format: WireBlobFormat,
    /// Unix timestamp when the share was first advertised.
    pub published_at: u64,
}

/// Parsed nearby-share response envelope returned by a remote peer.
#[derive(Debug, Clone)]
pub(crate) struct RemoteShareEnvelope {
    pub device_name: String,
    pub shares: Vec<RemoteAdvertisedShare>,
}

/// Protocol handler that serves nearby identity, share list, and push-offer
/// requests over a single ALPN.
#[derive(Debug, Clone)]
pub struct NearbyShareProtocol {
    registry: NearbyShareRegistry,
    offers: OfferInbox,
    app_handle: AppHandle,
}

impl NearbyShareProtocol {
    /// Creates a new nearby-share protocol handler.
    #[must_use]
    pub fn new(registry: NearbyShareRegistry, offers: OfferInbox, app_handle: AppHandle) -> Self {
        Self {
            registry,
            offers,
            app_handle,
        }
    }

    /// Returns the offer inbox so command handlers can resolve pending
    /// decisions from the UI side.
    #[must_use]
    pub fn offer_inbox(&self) -> OfferInbox {
        self.offers.clone()
    }

    async fn response_bytes(&self, request_bytes: Vec<u8>) -> Result<Vec<u8>> {
        let request: NearbyRequest = serde_json::from_slice(&request_bytes)?;
        let version = request_version(&request);
        if version > PROTOCOL_VERSION {
            return Err(LightningP2PError::Other(format!(
                "Unsupported nearby protocol version {version}"
            )));
        }

        let response = match request {
            NearbyRequest::Hello { .. } => NearbyResponse::Hello {
                protocol_version: PROTOCOL_VERSION,
                device_name: local_device_name(),
            },
            NearbyRequest::ListShares { .. } => {
                let shares = if self.registry.local_discovery_enabled().await {
                    self.registry
                        .active_share()
                        .await
                        .into_iter()
                        .map(RemoteAdvertisedShare::from)
                        .collect()
                } else {
                    Vec::new()
                };
                NearbyResponse::Shares {
                    protocol_version: PROTOCOL_VERSION,
                    device_name: local_device_name(),
                    shares,
                }
            }
            NearbyRequest::OfferShare { offer, .. } => {
                let response = handle_offer_request(&self.app_handle, &self.offers, offer).await?;
                NearbyResponse::OfferDecision {
                    protocol_version: PROTOCOL_VERSION,
                    response,
                }
            }
        };

        serde_json::to_vec(&response).map_err(LightningP2PError::from)
    }
}

impl ProtocolHandler for NearbyShareProtocol {
    fn accept(&self, connecting: Connecting) -> BoxFuture<AnyhowResult<()>> {
        let this = self.clone();
        Box::pin(async move {
            let connection = connecting.await?;
            let (mut send, mut recv) = connection.accept_bi().await?;
            let request = recv.read_to_end(MAX_MESSAGE_BYTES).await?;
            let response = this.response_bytes(request).await?;
            send.write_all(&response).await?;
            send.finish()?;
            connection.closed().await;
            Ok(())
        })
    }
}

impl From<ActiveShare> for RemoteAdvertisedShare {
    fn from(share: ActiveShare) -> Self {
        Self {
            hash: share.hash.to_string(),
            label: share.label,
            size: share.total_size,
            format: WireBlobFormat::from(share.format),
            published_at: share.published_at,
        }
    }
}

impl From<BlobFormat> for WireBlobFormat {
    fn from(format: BlobFormat) -> Self {
        match format {
            BlobFormat::Raw => Self::Raw,
            BlobFormat::HashSeq => Self::HashSeq,
        }
    }
}

impl WireBlobFormat {
    /// Converts to the iroh-blobs `BlobFormat`.
    #[must_use]
    pub fn blob_format(self) -> BlobFormat {
        match self {
            Self::Raw => BlobFormat::Raw,
            Self::HashSeq => BlobFormat::HashSeq,
        }
    }
}

impl RemoteAdvertisedShare {
    /// Parses the hex hash into an iroh-blobs `Hash`.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError::Blob` if the hash string is malformed.
    pub fn hash(&self) -> Result<Hash> {
        Hash::from_str(&self.hash).map_err(|error| LightningP2PError::Blob(error.to_string()))
    }

    /// Returns the iroh-blobs format for the share.
    #[must_use]
    pub fn blob_format(&self) -> BlobFormat {
        self.format.blob_format()
    }
}

fn request_version(request: &NearbyRequest) -> u8 {
    match request {
        NearbyRequest::Hello { protocol_version }
        | NearbyRequest::ListShares { protocol_version }
        | NearbyRequest::OfferShare {
            protocol_version, ..
        } => *protocol_version,
    }
}

/// Queries a nearby peer for active share metadata.
///
/// # Errors
///
/// Returns `LightningP2PError` if the peer cannot be reached or the response is invalid.
pub(crate) async fn fetch_remote_shares(
    endpoint: &Endpoint,
    node_addr: NodeAddr,
) -> Result<RemoteShareEnvelope> {
    let response = exchange(
        endpoint,
        node_addr,
        NearbyRequest::ListShares {
            protocol_version: PROTOCOL_VERSION,
        },
    )
    .await?;
    match response {
        NearbyResponse::Shares {
            protocol_version,
            device_name,
            shares,
        } => {
            if protocol_version > PROTOCOL_VERSION {
                return Err(LightningP2PError::Other(format!(
                    "Unsupported nearby protocol version {protocol_version}"
                )));
            }
            Ok(RemoteShareEnvelope {
                device_name,
                shares,
            })
        }
        other => Err(LightningP2PError::Other(format!(
            "unexpected nearby response: {other:?}"
        ))),
    }
}

/// Sends a push-style offer to a nearby peer and awaits their decision.
///
/// # Errors
///
/// Returns `LightningP2PError` if the peer cannot be reached or the response is
/// not a valid offer decision.
pub async fn send_offer(
    endpoint: &Endpoint,
    node_addr: NodeAddr,
    offer: OfferShareMessage,
) -> Result<OfferDecision> {
    let response = exchange(
        endpoint,
        node_addr,
        NearbyRequest::OfferShare {
            protocol_version: PROTOCOL_VERSION,
            offer,
        },
    )
    .await?;
    match response {
        NearbyResponse::OfferDecision { response, .. } => Ok(response.decision),
        other => Err(LightningP2PError::Other(format!(
            "unexpected nearby response: {other:?}"
        ))),
    }
}

async fn exchange(
    endpoint: &Endpoint,
    node_addr: NodeAddr,
    request: NearbyRequest,
) -> Result<NearbyResponse> {
    let connection = endpoint
        .connect(node_addr, NEARBY_PROTOCOL_ALPN)
        .await
        .map_err(|error| LightningP2PError::Other(error.to_string()))?;
    let (mut send, mut recv) = connection
        .open_bi()
        .await
        .map_err(|error| LightningP2PError::Other(error.to_string()))?;
    let request_bytes = serde_json::to_vec(&request)?;
    send.write_all(&request_bytes)
        .await
        .map_err(|error| LightningP2PError::Other(error.to_string()))?;
    send.finish()
        .map_err(|error| LightningP2PError::Other(error.to_string()))?;
    let response_bytes = recv
        .read_to_end(MAX_MESSAGE_BYTES)
        .await
        .map_err(|error| LightningP2PError::Other(error.to_string()))?;
    serde_json::from_slice(&response_bytes).map_err(LightningP2PError::from)
}

/// Returns the local device name reported to nearby peers.
///
/// Priority:
/// 1. `LIGHTNING_P2P_DEVICE_NAME` — explicit override, always wins.
/// 2. On Android, `ro.product.model` from system properties (e.g. "Pixel 7").
///    Android typically doesn't populate `HOSTNAME`/`COMPUTERNAME`, so without
///    this branch every Android peer would show up as "Nearby device".
/// 3. `COMPUTERNAME` (Windows), `HOSTNAME` (Unix), `USERDOMAIN` (Windows fallback).
/// 4. `"Nearby device"` as a last resort — keeps the UI useful even on a host
///    with no resolvable identity.
#[must_use]
pub fn local_device_name() -> String {
    if let Some(explicit) = env::var("LIGHTNING_P2P_DEVICE_NAME")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return explicit;
    }

    #[cfg(target_os = "android")]
    {
        if let Some(android_name) = android_device_name() {
            return android_name;
        }
    }

    [
        env::var("COMPUTERNAME").ok(),
        env::var("HOSTNAME").ok(),
        env::var("USERDOMAIN").ok(),
    ]
    .into_iter()
    .flatten()
    .map(|value| value.trim().to_string())
    .find(|value| !value.is_empty())
    .unwrap_or_else(|| "Nearby device".into())
}

/// Reads `ro.product.model` (and `ro.product.manufacturer` as a fallback) from
/// the Android property service, returning a user-recognizable device name
/// like "Pixel 7" or "Samsung SM-G991U".
///
/// Uses the libc bionic `__system_property_get` directly rather than crossing
/// JNI — keeps the resolution out of the activity lifecycle and works from any
/// Rust thread.
#[cfg(target_os = "android")]
fn android_device_name() -> Option<String> {
    let model = read_android_property("ro.product.model");
    let manufacturer = read_android_property("ro.product.manufacturer");
    match (manufacturer, model) {
        (Some(mfr), Some(mdl)) => {
            // If the model already starts with the manufacturer (e.g. "Google
            // Pixel 7" is rare; usually it's just "Pixel 7"), don't duplicate.
            if mdl.to_ascii_lowercase().starts_with(&mfr.to_ascii_lowercase()) {
                Some(mdl)
            } else {
                Some(mdl)
            }
        }
        (None, Some(mdl)) => Some(mdl),
        (Some(mfr), None) => Some(mfr),
        (None, None) => None,
    }
}

#[cfg(target_os = "android")]
fn read_android_property(name: &str) -> Option<String> {
    use std::ffi::CString;
    use std::os::raw::{c_char, c_int};

    extern "C" {
        fn __system_property_get(name: *const c_char, value: *mut c_char) -> c_int;
    }

    let c_name = CString::new(name).ok()?;
    // PROP_VALUE_MAX in bionic is 92 bytes including the trailing NUL.
    let mut buf = [0u8; 92];
    let len = unsafe { __system_property_get(c_name.as_ptr(), buf.as_mut_ptr().cast::<c_char>()) };
    if len <= 0 {
        return None;
    }
    let trimmed = &buf[..len as usize];
    let value = std::str::from_utf8(trimmed).ok()?.trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_share_round_trips_to_wire_format() {
        let advertised = RemoteAdvertisedShare::from(ActiveShare {
            label: "demo".into(),
            hash: Hash::new(b"demo"),
            format: BlobFormat::HashSeq,
            total_size: 42,
            published_at: 10,
        });

        assert_eq!(advertised.label, "demo");
        assert_eq!(advertised.size, 42);
        assert_eq!(advertised.blob_format(), BlobFormat::HashSeq);
    }

    #[test]
    fn local_device_name_has_fallback() {
        assert!(!local_device_name().trim().is_empty());
    }

    #[test]
    fn tagged_request_round_trips_through_json() {
        let hello = NearbyRequest::Hello {
            protocol_version: PROTOCOL_VERSION,
        };
        let bytes = serde_json::to_vec(&hello).expect("encode hello");
        let parsed: NearbyRequest = serde_json::from_slice(&bytes).expect("decode hello");
        assert!(matches!(parsed, NearbyRequest::Hello { .. }));
    }

    #[test]
    fn tagged_response_round_trips_through_json() {
        let envelope = NearbyResponse::Shares {
            protocol_version: PROTOCOL_VERSION,
            device_name: "peer".into(),
            shares: vec![],
        };
        let bytes = serde_json::to_vec(&envelope).expect("encode response");
        let parsed: NearbyResponse = serde_json::from_slice(&bytes).expect("decode response");
        assert!(matches!(parsed, NearbyResponse::Shares { .. }));
    }
}
