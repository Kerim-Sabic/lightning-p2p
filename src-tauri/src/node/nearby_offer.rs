//! Push-style share offer protocol.
//!
//! When a sender picks a visible nearby device and pushes a file, the offer
//! travels over the same nearby ALPN as device/share discovery but carries an
//! `OfferShare` tag. The receiver's handler parks the offer in an
//! [`OfferInbox`], emits an `nearby-offer-received` Tauri event, and waits for
//! the user to accept or reject. Only after the user accepts does the receiver
//! dial the sender's blob store to pull bytes.

use crate::error::{LightningP2PError, Result};
use iroh::EndpointId;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex};

/// Tauri event emitted to the frontend when a remote peer offers a share.
pub const NEARBY_OFFER_RECEIVED_EVENT: &str = "nearby-offer-received";
/// Tauri event emitted on the sender side when its outbound offer is resolved.
pub const NEARBY_OFFER_RESOLVED_EVENT: &str = "nearby-offer-resolved";

/// How long the receiver's UI prompt is allowed to remain unanswered before
/// the offer auto-expires. `AirDrop` uses around 30 s for the visible prompt; we
/// double it to be lenient on slower mobile devices.
pub const OFFER_DECISION_TIMEOUT: Duration = Duration::from_secs(60);

/// On-wire offer payload exchanged via the nearby ALPN.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfferShareMessage {
    /// Sender-generated offer identifier.
    pub offer_id: String,
    /// Human-readable device name reported by the sender.
    pub sender_device_name: String,
    /// Sender's iroh node identifier, in hex.
    pub sender_node_id: String,
    /// User-visible label of the content being offered.
    pub label: String,
    /// Total size of the offered content in bytes.
    pub size: u64,
    /// Root content hash of the offered blob.
    pub blob_hash: String,
    /// Wire format of the offered blob.
    pub blob_format: super::nearby_protocol::WireBlobFormat,
}

/// On-wire decision returned by the receiver.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OfferDecision {
    /// The receiver accepted the offer and is starting a download.
    Accepted,
    /// The receiver rejected the offer.
    Rejected,
    /// The receiver did not respond before the deadline.
    Expired,
}

/// On-wire response sent back over the same bi-stream that carried the offer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfferResponseMessage {
    /// Offer identifier echoed back to correlate with the request.
    pub offer_id: String,
    /// Receiver's decision.
    pub decision: OfferDecision,
}

/// Frontend-facing snapshot of an incoming offer.
#[derive(Debug, Clone, Serialize)]
pub struct IncomingOffer {
    /// Stable identifier — pass back to `respond_to_offer`.
    pub offer_id: String,
    /// Sender's iroh node identifier, in hex.
    pub sender_node_id: String,
    /// Sender's human-readable device name.
    pub sender_device_name: String,
    /// User-visible label of the offered content.
    pub label: String,
    /// Total size in bytes.
    pub size: u64,
    /// Root content hash of the offered blob.
    pub blob_hash: String,
    /// Wire format of the offered blob.
    pub blob_format: super::nearby_protocol::WireBlobFormat,
    /// Unix timestamp when the offer was received.
    pub received_at_unix: u64,
}

/// Frontend-facing payload emitted when the sender's outbound offer resolves.
#[derive(Debug, Clone, Serialize)]
pub struct OfferResolvedEvent {
    /// Offer identifier.
    pub offer_id: String,
    /// Outcome reported by the receiver.
    pub outcome: OfferDecision,
    /// Receiver's iroh node identifier, in hex.
    pub receiver_node_id: String,
}

/// Internal record describing an offer awaiting a user decision.
#[derive(Debug)]
pub struct PendingOffer {
    /// Public payload (also mirrored into the frontend).
    pub offer: IncomingOffer,
    /// One-shot signal back to the protocol handler.
    pub responder: oneshot::Sender<OfferDecision>,
}

/// Reason that a `respond_to_offer` call could fail.
#[derive(Debug, thiserror::Error)]
pub enum OfferRejection {
    /// The offer expired or was already responded to before the user replied.
    #[error("Offer is no longer pending")]
    NotFound,
    /// The protocol handler is gone (likely because the connection dropped).
    #[error("Offer connection has closed")]
    HandlerDropped,
}

/// In-memory inbox of inbound offers waiting for a user decision.
#[derive(Debug, Clone, Default)]
pub struct OfferInbox {
    pending: Arc<Mutex<HashMap<String, PendingOffer>>>,
}

impl OfferInbox {
    /// Creates an empty inbox.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns the current pending offers as a frontend-safe snapshot.
    pub async fn snapshot(&self) -> Vec<IncomingOffer> {
        let guard = self.pending.lock().await;
        let mut snapshot = guard
            .values()
            .map(|pending| pending.offer.clone())
            .collect::<Vec<_>>();
        snapshot.sort_by_key(|offer| std::cmp::Reverse(offer.received_at_unix));
        snapshot
    }

    /// Records a new pending offer and returns the receiver side of the
    /// decision channel so the protocol handler can await the user's reply.
    pub async fn record(&self, offer: IncomingOffer) -> oneshot::Receiver<OfferDecision> {
        let (tx, rx) = oneshot::channel();
        let pending = PendingOffer {
            offer: offer.clone(),
            responder: tx,
        };
        let mut guard = self.pending.lock().await;
        guard.insert(offer.offer_id.clone(), pending);
        rx
    }

    /// Resolves an offer with the given decision.
    ///
    /// # Errors
    ///
    /// Returns `OfferRejection::NotFound` if the offer expired or is unknown,
    /// or `OfferRejection::HandlerDropped` if the receiver side has gone away
    /// (e.g. the QUIC connection closed before the user responded).
    pub async fn resolve(
        &self,
        offer_id: &str,
        decision: OfferDecision,
    ) -> std::result::Result<(), OfferRejection> {
        let pending = {
            let mut guard = self.pending.lock().await;
            guard.remove(offer_id)
        };
        let pending = pending.ok_or(OfferRejection::NotFound)?;
        pending
            .responder
            .send(decision)
            .map_err(|_decision| OfferRejection::HandlerDropped)
    }

    /// Drops the offer from the inbox without delivering a decision.
    ///
    /// Used when the protocol handler's await completes (e.g. timeout) and the
    /// pending state should be cleared even if no decision arrived.
    pub async fn drop_offer(&self, offer_id: &str) {
        let mut guard = self.pending.lock().await;
        guard.remove(offer_id);
    }
}

/// Handler invoked by the nearby protocol when an `OfferShare` request arrives.
///
/// Parks the offer in the inbox, fires the `nearby-offer-received` event, and
/// awaits the user's decision. Returns the wire-level `OfferResponseMessage`
/// the protocol should send back to the requesting sender.
///
/// # Errors
///
/// Returns a `LightningP2PError` if event emission fails. Decision timeouts
/// are reported via `OfferDecision::Expired` in the response, not as an error.
pub async fn handle_offer_request(
    app_handle: &AppHandle,
    inbox: &OfferInbox,
    request: OfferShareMessage,
) -> Result<OfferResponseMessage> {
    let offer = IncomingOffer {
        offer_id: request.offer_id.clone(),
        sender_node_id: request.sender_node_id.clone(),
        sender_device_name: request.sender_device_name,
        label: request.label,
        size: request.size,
        blob_hash: request.blob_hash,
        blob_format: request.blob_format,
        received_at_unix: unix_timestamp(),
    };

    let receiver = inbox.record(offer.clone()).await;
    if let Err(error) = app_handle.emit(NEARBY_OFFER_RECEIVED_EVENT, offer) {
        // The connection is still open but the UI never saw the offer — best
        // we can do is auto-reject so the sender stops waiting.
        inbox.drop_offer(&request.offer_id).await;
        tracing::warn!("failed to emit nearby-offer-received: {error}");
        return Ok(OfferResponseMessage {
            offer_id: request.offer_id,
            decision: OfferDecision::Rejected,
        });
    }

    let decision = match tokio::time::timeout(OFFER_DECISION_TIMEOUT, receiver).await {
        Ok(Ok(decision)) => decision,
        Ok(Err(_)) => {
            // Inbox dropped the channel without sending — treat as rejection.
            OfferDecision::Rejected
        }
        Err(_) => {
            inbox.drop_offer(&request.offer_id).await;
            OfferDecision::Expired
        }
    };

    Ok(OfferResponseMessage {
        offer_id: request.offer_id,
        decision,
    })
}

/// Emits the `nearby-offer-resolved` event to the frontend on the sender side.
///
/// # Errors
///
/// Returns `LightningP2PError::Other` if event emission fails.
pub fn emit_offer_resolved(
    app_handle: &AppHandle,
    offer_id: String,
    receiver_node_id: EndpointId,
    outcome: OfferDecision,
) -> Result<()> {
    app_handle
        .emit(
            NEARBY_OFFER_RESOLVED_EVENT,
            OfferResolvedEvent {
                offer_id,
                outcome,
                receiver_node_id: receiver_node_id.to_string(),
            },
        )
        .map_err(|error| LightningP2PError::Other(error.to_string()))
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_offer(offer_id: &str) -> IncomingOffer {
        IncomingOffer {
            offer_id: offer_id.into(),
            sender_node_id: "sender-node".into(),
            sender_device_name: "Sender".into(),
            label: "demo.bin".into(),
            size: 42,
            blob_hash: "abc".into(),
            blob_format: super::super::nearby_protocol::WireBlobFormat::Raw,
            received_at_unix: 0,
        }
    }

    #[tokio::test]
    async fn record_and_resolve_round_trips_decision() {
        let inbox = OfferInbox::new();
        let mut receiver = inbox.record(sample_offer("offer-1")).await;

        inbox
            .resolve("offer-1", OfferDecision::Accepted)
            .await
            .expect("resolve should succeed");

        let decision = receiver.try_recv().expect("decision should arrive");
        assert_eq!(decision, OfferDecision::Accepted);
    }

    #[tokio::test]
    async fn resolve_returns_not_found_when_expired() {
        let inbox = OfferInbox::new();
        drop(inbox.record(sample_offer("offer-2")).await);
        inbox.drop_offer("offer-2").await;

        let err = inbox
            .resolve("offer-2", OfferDecision::Accepted)
            .await
            .expect_err("missing offer should fail");
        assert!(matches!(err, OfferRejection::NotFound));
    }

    #[tokio::test]
    async fn snapshot_returns_newest_first() {
        let inbox = OfferInbox::new();
        let mut first = sample_offer("first");
        first.received_at_unix = 100;
        let mut second = sample_offer("second");
        second.received_at_unix = 200;

        drop(inbox.record(first).await);
        drop(inbox.record(second).await);

        let snapshot = inbox.snapshot().await;
        assert_eq!(snapshot.len(), 2);
        assert_eq!(snapshot[0].offer_id, "second");
        assert_eq!(snapshot[1].offer_id, "first");
    }
}
