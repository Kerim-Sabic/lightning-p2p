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
    collections::{HashMap, HashSet},
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex};

/// Tauri event emitted to the frontend when a remote peer offers a share.
pub const NEARBY_OFFER_RECEIVED_EVENT: &str = "nearby-offer-received";
/// Tauri event emitted when an offer expires or its connection closes.
pub const NEARBY_OFFER_CLOSED_EVENT: &str = "nearby-offer-closed";
/// Tauri event emitted on the sender side when its outbound offer is resolved.
pub const NEARBY_OFFER_RESOLVED_EVENT: &str = "nearby-offer-resolved";

/// How long the receiver's UI prompt is allowed to remain unanswered before
/// the offer auto-expires. `AirDrop` uses around 30 s for the visible prompt; we
/// double it to be lenient on slower mobile devices.
pub const OFFER_DECISION_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_PENDING_OFFERS: usize = 64;
const MAX_PENDING_OFFERS_PER_PEER: usize = 4;
const MAX_SEEN_OFFER_IDS: usize = 4096;
const MAX_SEEN_OFFER_IDS_PER_PEER: usize = 128;
const OFFER_REPLAY_WINDOW: Duration = Duration::from_secs(10 * 60);
const MAX_OFFER_ID_BYTES: usize = 128;
const MAX_DEVICE_NAME_BYTES: usize = 128;
const MAX_OFFER_LABEL_BYTES: usize = 512;
const MAX_OFFER_FILE_COUNT: u32 = 10_000;
const READY_TO_CATCH_WINDOW: Duration = Duration::from_secs(30);
const READY_TO_CATCH_MAX_BYTES: u64 = 100 * 1024 * 1024;

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
    /// Number of files in the collection when known. Optional for old peers.
    #[serde(default)]
    pub file_count: Option<u32>,
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
    /// Number of files in the collection when known. Missing for legacy peers.
    pub file_count: Option<u32>,
    /// Unix timestamp when the offer was received.
    pub received_at_unix: u64,
    /// True when this offer fits the receiver's active, peer-bound catch session.
    pub ready_to_catch: bool,
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

/// Frontend payload used to remove an offer whose request handler is inactive.
#[derive(Debug, Clone, Serialize)]
pub struct OfferClosedEvent {
    /// Offer identifier.
    pub offer_id: String,
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
    /// The inbox has a duplicate/replayed identifier or reached a safety limit.
    #[error("Offer inbox is full or the identifier is duplicate or replayed")]
    CapacityOrDuplicate,
    /// The offer contains a field that is too large or empty.
    #[error("Offer contains invalid or oversized metadata")]
    InvalidMetadata,
    /// The authenticated sender is blocked from sending nearby offers.
    #[error("Sender is blocked")]
    Blocked,
}

/// In-memory inbox of inbound offers waiting for a user decision.
#[derive(Debug, Clone, Default)]
pub struct OfferInbox {
    state: Arc<Mutex<OfferInboxState>>,
}

#[derive(Debug, Default)]
struct OfferInboxState {
    pending: HashMap<String, PendingOffer>,
    blocked_peers: HashSet<String>,
    ready_to_catch: Option<ReadyToCatchSession>,
    /// IDs are reserved on first receipt, not just while awaiting consent, so
    /// an authenticated peer cannot replay a resolved offer during this window.
    seen_until: HashMap<(String, String), Instant>,
}

#[derive(Debug)]
struct ReadyToCatchSession {
    peer_id: String,
    expires_at: Instant,
    claimed_offer_id: Option<String>,
}

impl OfferInbox {
    /// Creates an empty inbox.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns the current pending offers as a frontend-safe snapshot.
    pub async fn snapshot(&self) -> Vec<IncomingOffer> {
        let guard = self.state.lock().await;
        let mut snapshot = guard
            .pending
            .values()
            .map(|pending| pending.offer.clone())
            .collect::<Vec<_>>();
        snapshot.sort_by_key(|offer| std::cmp::Reverse(offer.received_at_unix));
        snapshot
    }

    /// Opens a one-off automatic receive window for one explicitly paired peer.
    pub async fn arm_ready_to_catch(&self, peer_id: String) -> u64 {
        let expires_at = Instant::now() + READY_TO_CATCH_WINDOW;
        self.state.lock().await.ready_to_catch = Some(ReadyToCatchSession {
            peer_id,
            expires_at,
            claimed_offer_id: None,
        });
        unix_timestamp().saturating_add(READY_TO_CATCH_WINDOW.as_secs())
    }

    /// Revokes the currently armed receive window.
    pub async fn cancel_ready_to_catch(&self, peer_id: &str) {
        let mut guard = self.state.lock().await;
        if guard
            .ready_to_catch
            .as_ref()
            .is_some_and(|session| session.peer_id == peer_id)
        {
            guard.ready_to_catch = None;
        }
    }

    /// Tests whether an offer can use the current scoped catch window.
    pub async fn is_ready_to_catch(&self, offer: &IncomingOffer) -> bool {
        let mut guard = self.state.lock().await;
        let eligible = ready_to_catch_matches(&mut guard.ready_to_catch, offer);
        if eligible {
            if let Some(session) = guard.ready_to_catch.as_mut() {
                session.claimed_offer_id = Some(offer.offer_id.clone());
            }
        }
        if let Some(pending) = guard.pending.get_mut(&offer.offer_id) {
            pending.offer.ready_to_catch = eligible;
        }
        eligible
    }

    /// Atomically consumes the one-off catch authorization for an offer.
    pub async fn claim_ready_to_catch(&self, offer: &IncomingOffer) -> bool {
        let mut guard = self.state.lock().await;
        let Some(session) = guard.ready_to_catch.as_ref() else {
            return false;
        };
        if session.expires_at <= Instant::now()
            || session.peer_id != offer.sender_node_id
            || session.claimed_offer_id.as_deref() != Some(offer.offer_id.as_str())
            || offer.size > READY_TO_CATCH_MAX_BYTES
            || !is_single_file_offer(offer)
            || is_risky_executable_label(&offer.label)
        {
            return false;
        }
        if !offer.ready_to_catch {
            return false;
        }
        guard.ready_to_catch = None;
        true
    }

    /// Records a new pending offer and returns the receiver side of the
    /// decision channel so the protocol handler can await the user's reply.
    ///
    /// # Errors
    ///
    /// Returns `OfferRejection` if metadata is invalid, the identifier is
    /// duplicate/replayed inside the replay window, or a safety limit is hit.
    pub async fn record(
        &self,
        offer: IncomingOffer,
    ) -> std::result::Result<oneshot::Receiver<OfferDecision>, OfferRejection> {
        if offer.offer_id.is_empty()
            || offer.offer_id.len() > MAX_OFFER_ID_BYTES
            || offer.sender_device_name.len() > MAX_DEVICE_NAME_BYTES
            || offer.label.is_empty()
            || offer.label.len() > MAX_OFFER_LABEL_BYTES
            || offer
                .file_count
                .is_some_and(|count| count == 0 || count > MAX_OFFER_FILE_COUNT)
            || matches!(
                (offer.blob_format, offer.file_count),
                (super::nearby_protocol::WireBlobFormat::Raw, Some(count)) if count != 1
            )
        {
            return Err(OfferRejection::InvalidMetadata);
        }

        let (tx, rx) = oneshot::channel();
        let pending = PendingOffer {
            offer: offer.clone(),
            responder: tx,
        };
        let mut guard = self.state.lock().await;
        let now = Instant::now();
        guard.seen_until.retain(|_, expires| *expires > now);
        if guard.blocked_peers.contains(&offer.sender_node_id) {
            return Err(OfferRejection::Blocked);
        }
        let replay_key = (offer.sender_node_id.clone(), offer.offer_id.clone());
        let peer_offers = guard
            .pending
            .values()
            .filter(|pending| pending.offer.sender_node_id == offer.sender_node_id)
            .count();
        let peer_seen = guard
            .seen_until
            .keys()
            .filter(|(peer_id, _)| peer_id == &offer.sender_node_id)
            .count();
        if guard.pending.len() >= MAX_PENDING_OFFERS
            || peer_offers >= MAX_PENDING_OFFERS_PER_PEER
            || guard.pending.contains_key(&offer.offer_id)
            || guard.seen_until.contains_key(&replay_key)
            || guard.seen_until.len() >= MAX_SEEN_OFFER_IDS
            || peer_seen >= MAX_SEEN_OFFER_IDS_PER_PEER
        {
            return Err(OfferRejection::CapacityOrDuplicate);
        }
        guard
            .seen_until
            .insert(replay_key, now + OFFER_REPLAY_WINDOW);
        guard.pending.insert(offer.offer_id.clone(), pending);
        Ok(rx)
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
            let mut guard = self.state.lock().await;
            guard.pending.remove(offer_id)
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
        let mut guard = self.state.lock().await;
        guard.pending.remove(offer_id);
    }

    /// Applies one peer's block state atomically with offer admission.
    pub async fn set_peer_blocked(&self, peer: EndpointId, blocked: bool) {
        let node_id = peer.to_string();
        let pending = {
            let mut guard = self.state.lock().await;
            if blocked {
                guard.blocked_peers.insert(node_id.clone());
            } else {
                guard.blocked_peers.remove(&node_id);
            }
            if blocked {
                if guard
                    .ready_to_catch
                    .as_ref()
                    .is_some_and(|session| session.peer_id == node_id)
                {
                    guard.ready_to_catch = None;
                }
                let ids = guard
                    .pending
                    .iter()
                    .filter(|(_, pending)| pending.offer.sender_node_id == node_id)
                    .map(|(offer_id, _)| offer_id.clone())
                    .collect::<Vec<_>>();
                ids.into_iter()
                    .filter_map(|offer_id| guard.pending.remove(&offer_id))
                    .collect::<Vec<_>>()
            } else {
                Vec::new()
            }
        };
        for pending_offer in pending {
            let _ = pending_offer.responder.send(OfferDecision::Rejected);
        }
    }

    /// Seeds persisted block identities before the nearby protocol starts.
    pub async fn load_blocked_peers(&self, peers: impl IntoIterator<Item = String>) {
        let mut guard = self.state.lock().await;
        guard.blocked_peers.extend(peers);
    }
}

fn ready_to_catch_matches(
    session: &mut Option<ReadyToCatchSession>,
    offer: &IncomingOffer,
) -> bool {
    let Some(active) = session.as_mut() else {
        return false;
    };
    if active.expires_at <= Instant::now() {
        *session = None;
        return false;
    }
    active.peer_id == offer.sender_node_id
        && active.claimed_offer_id.is_none()
        && offer.size <= READY_TO_CATCH_MAX_BYTES
        && is_single_file_offer(offer)
        && !is_risky_executable_label(&offer.label)
}

fn is_single_file_offer(offer: &IncomingOffer) -> bool {
    use super::nearby_protocol::WireBlobFormat::{HashSeq, Raw};

    match offer.blob_format {
        Raw => matches!(offer.file_count, None | Some(1)),
        HashSeq => offer.file_count == Some(1),
    }
}

pub(crate) fn is_risky_executable_label(label: &str) -> bool {
    let file_name = label.rsplit(['/', '\\']).next().unwrap_or_default();
    let extension = file_name.rsplit('.').next().unwrap_or_default();
    !matches!(
        extension.to_ascii_lowercase().as_str(),
        "csv"
            | "gif"
            | "jpeg"
            | "jpg"
            | "json"
            | "md"
            | "mp3"
            | "mp4"
            | "pdf"
            | "png"
            | "txt"
            | "wav"
            | "webp"
    )
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
    authenticated_sender: EndpointId,
    connection: &iroh::endpoint::Connection,
) -> Result<OfferResponseMessage> {
    let offer = IncomingOffer {
        offer_id: request.offer_id.clone(),
        // The node ID inside the message is untrusted. Bind all identity-sensitive
        // follow-up work to the peer authenticated by iroh's encrypted transport.
        sender_node_id: authenticated_sender.to_string(),
        sender_device_name: request.sender_device_name,
        label: request.label,
        size: request.size,
        blob_hash: request.blob_hash,
        blob_format: request.blob_format,
        file_count: request.file_count,
        received_at_unix: unix_timestamp(),
        ready_to_catch: false,
    };

    let receiver = match inbox.record(offer.clone()).await {
        Ok(receiver) => receiver,
        Err(reason) => {
            tracing::warn!("rejecting nearby offer from authenticated peer: {reason}");
            return Ok(OfferResponseMessage {
                offer_id: request.offer_id,
                decision: OfferDecision::Rejected,
            });
        }
    };
    let mut offer = offer;
    offer.ready_to_catch = inbox.is_ready_to_catch(&offer).await;
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

    let decision = tokio::select! {
        _ = connection.closed() => {
            inbox.drop_offer(&request.offer_id).await;
            emit_offer_closed(app_handle, request.offer_id.clone());
            OfferDecision::Rejected
        }
        result = tokio::time::timeout(OFFER_DECISION_TIMEOUT, receiver) => match result {
            Ok(Ok(decision)) => decision,
            Ok(Err(_)) => {
                emit_offer_closed(app_handle, request.offer_id.clone());
                OfferDecision::Rejected
            }
            Err(_) => {
                inbox.drop_offer(&request.offer_id).await;
                emit_offer_closed(app_handle, request.offer_id.clone());
                OfferDecision::Expired
            }
        }
    };

    Ok(OfferResponseMessage {
        offer_id: request.offer_id,
        decision,
    })
}

fn emit_offer_closed(app_handle: &AppHandle, offer_id: String) {
    if let Err(error) = app_handle.emit(NEARBY_OFFER_CLOSED_EVENT, OfferClosedEvent { offer_id }) {
        tracing::warn!("failed to emit nearby-offer-closed: {error}");
    }
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

    #[test]
    fn ready_to_catch_name_filter_checks_the_final_path_component() {
        assert!(is_risky_executable_label("folder/payload.EXE"));
        assert!(is_risky_executable_label("folder\\payload.msi"));
        assert!(!is_risky_executable_label("folder/notes.txt"));
        assert!(is_risky_executable_label("README"));
    }

    fn sample_offer(offer_id: &str) -> IncomingOffer {
        IncomingOffer {
            offer_id: offer_id.into(),
            sender_node_id: "sender-node".into(),
            sender_device_name: "Sender".into(),
            label: "demo.bin".into(),
            size: 42,
            blob_hash: "abc".into(),
            blob_format: super::super::nearby_protocol::WireBlobFormat::Raw,
            file_count: Some(1),
            received_at_unix: 0,
            ready_to_catch: false,
        }
    }

    #[tokio::test]
    async fn record_and_resolve_round_trips_decision() {
        let inbox = OfferInbox::new();
        let mut receiver = inbox
            .record(sample_offer("offer-1"))
            .await
            .expect("record offer");

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
        drop(
            inbox
                .record(sample_offer("offer-2"))
                .await
                .expect("record offer"),
        );
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

        drop(inbox.record(first).await.expect("record first offer"));
        drop(inbox.record(second).await.expect("record second offer"));

        let snapshot = inbox.snapshot().await;
        assert_eq!(snapshot.len(), 2);
        assert_eq!(snapshot[0].offer_id, "second");
        assert_eq!(snapshot[1].offer_id, "first");
    }

    #[tokio::test]
    async fn inbox_rejects_duplicate_ids_without_replacing_original() {
        let inbox = OfferInbox::new();
        let mut original = inbox
            .record(sample_offer("same-id"))
            .await
            .expect("first offer");
        let duplicate = inbox.record(sample_offer("same-id")).await;

        assert!(matches!(
            duplicate,
            Err(OfferRejection::CapacityOrDuplicate)
        ));
        assert_eq!(inbox.snapshot().await.len(), 1);
        inbox
            .resolve("same-id", OfferDecision::Accepted)
            .await
            .expect("resolve original");
        assert_eq!(
            original.try_recv().expect("decision arrives"),
            OfferDecision::Accepted
        );
    }

    #[tokio::test]
    async fn inbox_rejects_resolved_offer_replay_from_same_peer() {
        let inbox = OfferInbox::new();
        let mut decision = inbox
            .record(sample_offer("single-use"))
            .await
            .expect("record initial offer");
        inbox
            .resolve("single-use", OfferDecision::Accepted)
            .await
            .expect("resolve initial offer");
        assert_eq!(
            decision.try_recv().expect("decision delivered"),
            OfferDecision::Accepted
        );

        assert!(matches!(
            inbox.record(sample_offer("single-use")).await,
            Err(OfferRejection::CapacityOrDuplicate)
        ));
        assert!(inbox.snapshot().await.is_empty());
    }

    #[tokio::test]
    async fn inbox_enforces_global_and_per_peer_limits() {
        let inbox = OfferInbox::new();
        for index in 0..MAX_PENDING_OFFERS_PER_PEER {
            let mut offer = sample_offer(&format!("peer-a-{index}"));
            offer.sender_node_id = "peer-a".into();
            drop(inbox.record(offer).await.expect("within peer limit"));
        }
        let mut over_peer_limit = sample_offer("peer-a-over");
        over_peer_limit.sender_node_id = "peer-a".into();
        assert!(matches!(
            inbox.record(over_peer_limit).await,
            Err(OfferRejection::CapacityOrDuplicate)
        ));

        for index in 0..(MAX_PENDING_OFFERS - MAX_PENDING_OFFERS_PER_PEER) {
            let mut offer = sample_offer(&format!("peer-b-{index}"));
            offer.sender_node_id = format!("peer-b-{index}");
            drop(inbox.record(offer).await.expect("within global limit"));
        }
        let mut over_global_limit = sample_offer("peer-c");
        over_global_limit.sender_node_id = "peer-c".into();
        assert!(matches!(
            inbox.record(over_global_limit).await,
            Err(OfferRejection::CapacityOrDuplicate)
        ));
        assert_eq!(inbox.snapshot().await.len(), MAX_PENDING_OFFERS);
    }

    #[tokio::test]
    async fn inbox_rejects_empty_or_oversized_metadata() {
        let inbox = OfferInbox::new();
        let mut offer = sample_offer("");
        assert!(matches!(
            inbox.record(offer.clone()).await,
            Err(OfferRejection::InvalidMetadata)
        ));
        offer.offer_id = "valid".into();
        offer.label = "x".repeat(MAX_OFFER_LABEL_BYTES + 1);
        assert!(matches!(
            inbox.record(offer.clone()).await,
            Err(OfferRejection::InvalidMetadata)
        ));
        offer.offer_id = "too-many-files".into();
        offer.label = "okay.txt".into();
        offer.file_count = Some(MAX_OFFER_FILE_COUNT + 1);
        assert!(matches!(
            inbox.record(offer).await,
            Err(OfferRejection::InvalidMetadata)
        ));
        assert!(inbox.snapshot().await.is_empty());
    }

    #[tokio::test]
    async fn blocking_peer_rejects_pending_and_future_offers() {
        let inbox = OfferInbox::new();
        let peer = iroh::SecretKey::from_bytes(&[9; 32]).public();
        let mut offer = sample_offer("blocked-pending");
        offer.sender_node_id = peer.to_string();
        let mut decision = inbox.record(offer).await.expect("record offer");

        inbox.set_peer_blocked(peer, true).await;
        assert_eq!(
            decision.try_recv().expect("pending offer is rejected"),
            OfferDecision::Rejected
        );
        assert!(inbox.snapshot().await.is_empty());

        let mut future = sample_offer("blocked-future");
        future.sender_node_id = peer.to_string();
        assert!(matches!(
            inbox.record(future).await,
            Err(OfferRejection::Blocked)
        ));
    }

    #[tokio::test]
    async fn ready_to_catch_is_peer_bound_bounded_and_single_use() {
        let inbox = OfferInbox::new();
        let peer = iroh::SecretKey::from_bytes(&[11; 32]).public().to_string();
        let mut matching = sample_offer("catch-1");
        matching.sender_node_id = peer.clone();
        matching.label = "photo.png".into();
        matching.file_count = None;
        inbox.arm_ready_to_catch(peer).await;
        assert!(inbox.is_ready_to_catch(&matching).await);
        matching.ready_to_catch = true;
        assert!(inbox.claim_ready_to_catch(&matching).await);
        assert!(!inbox.is_ready_to_catch(&matching).await);

        let mut different_peer = sample_offer("catch-2");
        different_peer.sender_node_id = "another-peer".into();
        inbox
            .arm_ready_to_catch(matching.sender_node_id.clone())
            .await;
        assert!(!inbox.is_ready_to_catch(&different_peer).await);

        matching.label = "installer.exe".into();
        assert!(!inbox.is_ready_to_catch(&matching).await);
        matching.label = "photo.png".into();
        matching.size = READY_TO_CATCH_MAX_BYTES + 1;
        assert!(!inbox.is_ready_to_catch(&matching).await);
    }

    #[tokio::test]
    async fn ready_to_catch_accepts_only_known_single_file_collections() {
        let inbox = OfferInbox::new();
        let mut multi_file = sample_offer("multi-file");
        multi_file.blob_format = super::super::nearby_protocol::WireBlobFormat::HashSeq;
        multi_file.file_count = Some(2);
        inbox
            .arm_ready_to_catch(multi_file.sender_node_id.clone())
            .await;
        assert!(!inbox.is_ready_to_catch(&multi_file).await);

        let inbox = OfferInbox::new();
        let mut one_file = sample_offer("one-file");
        one_file.label = "demo.txt".into();
        one_file.blob_format = super::super::nearby_protocol::WireBlobFormat::HashSeq;
        one_file.file_count = Some(1);
        inbox
            .arm_ready_to_catch(one_file.sender_node_id.clone())
            .await;
        assert!(inbox.is_ready_to_catch(&one_file).await);
        one_file.ready_to_catch = true;
        assert!(inbox.claim_ready_to_catch(&one_file).await);
    }

    #[test]
    fn old_offer_payloads_decode_without_file_count() {
        let message = OfferShareMessage {
            offer_id: "offer".into(),
            sender_device_name: "Sender".into(),
            sender_node_id: "untrusted-field".into(),
            label: "file.txt".into(),
            size: 12,
            blob_hash: "hash".into(),
            blob_format: super::super::nearby_protocol::WireBlobFormat::Raw,
            file_count: None,
        };
        let mut legacy = serde_json::to_value(message).expect("serialize offer");
        legacy
            .as_object_mut()
            .expect("offer serializes as an object")
            .remove("file_count");

        let decoded: OfferShareMessage =
            serde_json::from_value(legacy).expect("decode legacy offer");
        assert_eq!(decoded.file_count, None);
    }

    #[tokio::test]
    async fn ready_to_catch_reserves_at_most_one_offer() {
        let inbox = OfferInbox::new();
        let peer = iroh::SecretKey::from_bytes(&[12; 32]).public().to_string();
        inbox.arm_ready_to_catch(peer.clone()).await;
        let mut first = sample_offer("first-catch");
        first.sender_node_id = peer.clone();
        first.label = "photo.png".into();
        let mut second = sample_offer("second-catch");
        second.sender_node_id = peer;
        second.label = "notes.txt".into();
        drop(inbox.record(first.clone()).await.expect("first offer"));
        drop(inbox.record(second.clone()).await.expect("second offer"));

        assert!(inbox.is_ready_to_catch(&first).await);
        first.ready_to_catch = true;
        assert!(!inbox.is_ready_to_catch(&second).await);
        assert!(inbox.claim_ready_to_catch(&first).await);
        assert!(!inbox.claim_ready_to_catch(&second).await);
    }
}
