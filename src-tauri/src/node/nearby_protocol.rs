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
    handle_offer_request, OfferDecision, OfferInbox, OfferReceiptLedger, OfferResponseMessage,
    OfferSavedEvent, OfferSavedReceipt, OfferShareMessage, ReceiptConfirmation,
    NEARBY_OFFER_SAVED_EVENT,
};
use crate::error::{LightningP2PError, Result};
use crate::storage::{blocked_peers::BlockedPeers, paired_devices::PairedDevices};
use iroh::{
    endpoint::Connection,
    protocol::{AcceptError, ProtocolHandler},
    Endpoint, EndpointAddr,
};
use iroh_blobs::{BlobFormat, Hash};
use serde::{Deserialize, Serialize};
use std::env;
use std::str::FromStr;
use tauri::{AppHandle, Emitter};

/// ALPN identifier for nearby discovery + offer protocol (v2).
pub const NEARBY_PROTOCOL_ALPN: &[u8] = b"lightning-p2p/nearby/2";

const MAX_MESSAGE_BYTES: usize = 64 * 1024;
const PROTOCOL_VERSION: u8 = 2;
const SAVE_RECEIPT_RETRY_DELAYS: [std::time::Duration; 2] = [
    std::time::Duration::from_millis(250),
    std::time::Duration::from_millis(750),
];

/// Tagged request envelope sent over the nearby ALPN.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NearbyRequest {
    /// Lightweight identity probe — returns only the peer's device name.
    Hello { protocol_version: u8 },
    /// Returns active-share metadata to a locally verified peer (if any).
    ListShares { protocol_version: u8 },
    /// Push-style offer from a sender to a receiver.
    OfferShare {
        protocol_version: u8,
        offer: OfferShareMessage,
    },
    /// Verified-save receipt sent to the original offer sender.
    OfferSaved {
        protocol_version: u8,
        receipt: OfferSavedReceipt,
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
    /// Acknowledges a receipt that matched a pending authenticated offer.
    OfferSavedAck {
        protocol_version: u8,
        accepted: bool,
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
    receipts: OfferReceiptLedger,
    blocked_peers: BlockedPeers,
    paired_devices: PairedDevices,
    app_handle: AppHandle,
}

impl NearbyShareProtocol {
    /// Creates a new nearby-share protocol handler.
    #[must_use]
    pub fn new(
        registry: NearbyShareRegistry,
        offers: OfferInbox,
        receipts: OfferReceiptLedger,
        blocked_peers: BlockedPeers,
        paired_devices: PairedDevices,
        app_handle: AppHandle,
    ) -> Self {
        Self {
            registry,
            offers,
            receipts,
            blocked_peers,
            paired_devices,
            app_handle,
        }
    }

    /// Returns the offer inbox so command handlers can resolve pending
    /// decisions from the UI side.
    #[must_use]
    pub fn offer_inbox(&self) -> OfferInbox {
        self.offers.clone()
    }

    async fn response_bytes(
        &self,
        request_bytes: Vec<u8>,
        connection: &Connection,
    ) -> Result<Vec<u8>> {
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
                let authenticated_peer = connection.remote_id().to_string();
                let peer_is_verified = self.paired_devices.contains(&authenticated_peer).await;
                let shares = if should_disclose_share_metadata(
                    self.registry.local_discovery_enabled().await,
                    peer_is_verified,
                ) {
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
                let peer = connection.remote_id();
                let response = if self.blocked_peers.contains(peer).await {
                    OfferResponseMessage {
                        offer_id: offer.offer_id,
                        decision: OfferDecision::Rejected,
                    }
                } else {
                    handle_offer_request(&self.app_handle, &self.offers, offer, peer, connection)
                        .await?
                };
                NearbyResponse::OfferDecision {
                    protocol_version: PROTOCOL_VERSION,
                    response,
                }
            }
            NearbyRequest::OfferSaved { receipt, .. } => {
                let peer = connection.remote_id();
                let hash = iroh_blobs::Hash::from_str(&receipt.blob_hash).ok();
                let confirmation = match hash {
                    Some(hash) => self.receipts.confirm(&receipt.offer_id, peer, hash).await,
                    None => ReceiptConfirmation::Rejected,
                };
                let accepted = match confirmation {
                    ReceiptConfirmation::Rejected | ReceiptConfirmation::InProgress => false,
                    ReceiptConfirmation::Retry => true,
                    ReceiptConfirmation::First => {
                        let event = OfferSavedEvent {
                            offer_id: receipt.offer_id.clone(),
                            receiver_node_id: peer.to_string(),
                        };
                        let event_emitted = match self
                            .app_handle
                            .emit(NEARBY_OFFER_SAVED_EVENT, event)
                        {
                            Ok(()) => true,
                            Err(error) => {
                                tracing::warn!(%error, "could not publish verified nearby save receipt");
                                false
                            }
                        };
                        match hash {
                            Some(hash) => {
                                self.receipts
                                    .finish_confirmation(
                                        &receipt.offer_id,
                                        peer,
                                        hash,
                                        event_emitted,
                                    )
                                    .await
                                    && event_emitted
                            }
                            None => false,
                        }
                    }
                };
                NearbyResponse::OfferSavedAck {
                    protocol_version: PROTOCOL_VERSION,
                    accepted,
                }
            }
        };

        serde_json::to_vec(&response).map_err(LightningP2PError::from)
    }
}

fn should_disclose_share_metadata(local_discovery_enabled: bool, peer_is_verified: bool) -> bool {
    local_discovery_enabled && peer_is_verified
}

impl ProtocolHandler for NearbyShareProtocol {
    async fn accept(&self, connection: Connection) -> std::result::Result<(), AcceptError> {
        let (mut send, mut recv) = connection
            .accept_bi()
            .await
            .map_err(AcceptError::from_err)?;
        let request = recv
            .read_to_end(MAX_MESSAGE_BYTES)
            .await
            .map_err(AcceptError::from_err)?;
        let response = self
            .response_bytes(request, &connection)
            .await
            .map_err(AcceptError::from_err)?;
        send.write_all(&response)
            .await
            .map_err(AcceptError::from_err)?;
        send.finish().map_err(AcceptError::from_err)?;
        connection.closed().await;
        Ok(())
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
        }
        | NearbyRequest::OfferSaved {
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
    node_addr: EndpointAddr,
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
    node_addr: EndpointAddr,
    offer: OfferShareMessage,
) -> Result<OfferDecision> {
    let expected_offer_id = offer.offer_id.clone();
    let response = exchange(
        endpoint,
        node_addr,
        NearbyRequest::OfferShare {
            protocol_version: PROTOCOL_VERSION,
            offer,
        },
    )
    .await?;
    validate_offer_response(response, &expected_offer_id)
}

/// Sends a verified-save receipt to the original offer sender.
///
/// Retries transient exchange failures. The sender acknowledges an exact
/// matching receipt idempotently, so a lost response cannot create a duplicate
/// completion event.
///
/// # Errors
///
/// Returns an error when the peer is unreachable or responds with an
/// unexpected or unsupported message.
pub async fn send_offer_saved_receipt(
    endpoint: &Endpoint,
    node_addr: EndpointAddr,
    receipt: OfferSavedReceipt,
) -> Result<()> {
    let mut last_error = None;
    for attempt in 0..=SAVE_RECEIPT_RETRY_DELAYS.len() {
        let response = exchange(
            endpoint,
            node_addr.clone(),
            NearbyRequest::OfferSaved {
                protocol_version: PROTOCOL_VERSION,
                receipt: receipt.clone(),
            },
        )
        .await;
        match response {
            Ok(NearbyResponse::OfferSavedAck {
                protocol_version,
                accepted,
            }) if protocol_version <= PROTOCOL_VERSION && accepted => return Ok(()),
            Ok(NearbyResponse::OfferSavedAck {
                protocol_version,
                accepted: false,
            }) if protocol_version <= PROTOCOL_VERSION => {
                last_error = Some(LightningP2PError::Other(
                    "Nearby peer did not confirm the verified save receipt.".into(),
                ));
            }
            Ok(NearbyResponse::OfferSavedAck { .. }) => {
                return Err(LightningP2PError::Other(
                    "Nearby peer uses an unsupported save receipt protocol version.".into(),
                ));
            }
            Ok(other) => {
                return Err(LightningP2PError::Other(format!(
                    "unexpected nearby save receipt response: {other:?}"
                )));
            }
            Err(error) => last_error = Some(error),
        }
        if let Some(delay) = SAVE_RECEIPT_RETRY_DELAYS.get(attempt) {
            tokio::time::sleep(*delay).await;
        }
    }
    Err(last_error
        .unwrap_or_else(|| LightningP2PError::Other("Nearby save receipt delivery failed.".into())))
}

fn validate_offer_response(
    response: NearbyResponse,
    expected_offer_id: &str,
) -> Result<OfferDecision> {
    match response {
        NearbyResponse::OfferDecision {
            protocol_version,
            response,
        } if protocol_version <= PROTOCOL_VERSION => {
            if response.offer_id != expected_offer_id {
                return Err(LightningP2PError::Other(
                    "Nearby offer response did not match the pending offer.".into(),
                ));
            }
            Ok(response.decision)
        }
        NearbyResponse::OfferDecision { .. } => Err(LightningP2PError::Other(
            "Nearby peer uses an unsupported offer protocol version.".into(),
        )),
        other => Err(LightningP2PError::Other(format!(
            "unexpected nearby response: {other:?}"
        ))),
    }
}

async fn exchange(
    endpoint: &Endpoint,
    node_addr: EndpointAddr,
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
            if mdl
                .to_ascii_lowercase()
                .starts_with(&mfr.to_ascii_lowercase())
            {
                Some(mdl)
            } else {
                Some(format!("{mfr} {mdl}"))
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
    let len = usize::try_from(len).ok()?;
    let trimmed = &buf[..len];
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
        assert_ne!(local_device_name().trim(), "");
    }

    #[test]
    fn tagged_request_round_trips_through_json() {
        let hello = NearbyRequest::Hello {
            protocol_version: PROTOCOL_VERSION,
        };
        let bytes = serde_json::to_vec(&hello).expect("encode hello");
        let parsed: NearbyRequest = serde_json::from_slice(&bytes).expect("decode hello");
        assert!(matches!(parsed, NearbyRequest::Hello { .. }));

        let saved = NearbyRequest::OfferSaved {
            protocol_version: PROTOCOL_VERSION,
            receipt: OfferSavedReceipt {
                offer_id: "offer-saved".into(),
                blob_hash: Hash::new(b"saved").to_string(),
            },
        };
        let bytes = serde_json::to_vec(&saved).expect("encode saved receipt");
        let parsed: NearbyRequest = serde_json::from_slice(&bytes).expect("decode saved receipt");
        assert!(matches!(parsed, NearbyRequest::OfferSaved { .. }));
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

    #[test]
    fn offer_response_must_match_the_pending_offer_id() {
        let response = NearbyResponse::OfferDecision {
            protocol_version: PROTOCOL_VERSION,
            response: OfferResponseMessage {
                offer_id: "offer-1".into(),
                decision: OfferDecision::Accepted,
            },
        };

        assert_eq!(
            validate_offer_response(response, "offer-1").expect("matching offer response"),
            OfferDecision::Accepted
        );

        let mismatched = NearbyResponse::OfferDecision {
            protocol_version: PROTOCOL_VERSION,
            response: OfferResponseMessage {
                offer_id: "offer-2".into(),
                decision: OfferDecision::Accepted,
            },
        };
        assert!(validate_offer_response(mismatched, "offer-1").is_err());
    }

    #[test]
    fn offer_response_rejects_unknown_protocol_versions() {
        let response = NearbyResponse::OfferDecision {
            protocol_version: PROTOCOL_VERSION + 1,
            response: OfferResponseMessage {
                offer_id: "offer-1".into(),
                decision: OfferDecision::Accepted,
            },
        };

        assert!(validate_offer_response(response, "offer-1").is_err());
    }

    #[test]
    fn active_share_metadata_requires_local_discovery_and_verified_identity() {
        assert!(should_disclose_share_metadata(true, true));
        assert!(!should_disclose_share_metadata(true, false));
        assert!(!should_disclose_share_metadata(false, true));
        assert!(!should_disclose_share_metadata(false, false));
    }
}
