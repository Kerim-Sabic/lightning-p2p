//! Commands for nearby device discovery and the push-style share offer flow.

use crate::commands::{command_error, CommandResult};
use crate::node::nearby_offer::{
    emit_offer_resolved, FlickDirection, OfferDecision, OfferReceiptLedger, OfferShareMessage,
};
use crate::node::nearby_protocol::{local_device_name, send_offer, WireBlobFormat};
use crate::node::{IncomingOffer, NearbyDevice};
use crate::storage::peers;
use crate::AppState;
use futures_util::{stream, StreamExt};
use iroh::{EndpointAddr, EndpointId};
use iroh_blobs::BlobFormat;
use serde::Serialize;
use std::path::PathBuf;
use std::str::FromStr;
use tauri::{Emitter, State};

const MAX_BATCH_OFFER_RECIPIENTS: usize = 8;
const BATCH_OFFER_CONCURRENCY: usize = 2;

/// The result for one recipient in an explicit multi-device offer.
#[derive(Debug, Clone, Serialize)]
pub struct NearbyOfferAttempt {
    /// Receiver's authenticated iroh identity.
    pub receiver_node_id: String,
    /// Unique offer identifier, when the offer was prepared.
    pub offer_id: Option<String>,
    /// Receiver's decision when an offer reached the peer.
    pub outcome: Option<OfferDecision>,
    /// A recipient-specific setup or delivery error.
    pub error: Option<String>,
}

/// Returns the current list of nearby devices visible to this node.
///
/// # Errors
///
/// Returns an error string if the registry snapshot cannot be read.
#[tauri::command]
pub async fn get_nearby_devices(state: State<'_, AppState>) -> Result<Vec<NearbyDevice>, String> {
    Ok(state.nearby_shares.devices_snapshot().await)
}

/// Returns offers that are still waiting for a user decision.
///
/// This snapshot reconciles offers received before the frontend's async event
/// listeners were registered during app startup.
///
/// # Errors
///
/// Returns an error if application state cannot be accessed.
#[tauri::command]
pub async fn get_pending_incoming_offers(
    state: State<'_, AppState>,
) -> Result<Vec<IncomingOffer>, String> {
    Ok(state.offer_inbox.snapshot().await)
}

/// Clears persisted and in-memory nearby peer caches.
///
/// # Errors
///
/// Returns an error string if storage clearing or event emission fails.
#[tauri::command]
pub async fn clear_peer_cache(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let node = state.get_node().await.map_err(command_error)?;
    peers::clear_all(node.db()).map_err(command_error)?;

    if let Some(shares) = state.nearby_shares.clear_discovered_shares().await {
        app_handle
            .emit("discovered-shares-updated", shares)
            .map_err(|error| command_error(error.to_string()))?;
    }
    if let Some(devices) = state.nearby_shares.clear_devices().await {
        app_handle
            .emit("nearby-devices-updated", devices)
            .map_err(|error| command_error(error.to_string()))?;
    }

    Ok(())
}

/// Pushes a share offer to a previously discovered nearby device.
///
/// Imports the selected paths into iroh-blobs, opens a nearby ALPN connection
/// to the target peer, and sends an offer carrying the resulting hash. The
/// receiver's UI prompts the user; on accept they pull the bytes via the
/// existing blob-receive path. Emits `nearby-offer-resolved` with the outcome.
///
/// # Errors
///
/// Returns an error string if the share cannot be built, the peer cannot be
/// reached, or the receiver returns a non-accepted decision.
#[tauri::command]
pub async fn offer_share_to_peer(
    window: tauri::Window,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    node_id: String,
    paths: Vec<String>,
    flick_direction: Option<FlickDirection>,
) -> Result<String, String> {
    if paths.is_empty() {
        return Err("Select at least one file to send.".into());
    }

    let _activity = state.node_supervisor.begin_transfer_activity().await;
    let node = state.get_node().await.map_err(String::from)?;
    let target_node_id =
        EndpointId::from_str(&node_id).map_err(|err| format!("Invalid target node id: {err}"))?;

    let profile = state.settings.snapshot().await.transfer_mode.profile();
    let path_bufs = paths.into_iter().map(PathBuf::from).collect::<Vec<_>>();
    let outcome = crate::transfer::sender::send_files(
        node.as_ref(),
        window,
        path_bufs,
        profile,
        state.transfers.clone(),
    )
    .await
    .map_err(String::from)?;

    let offer_id = generate_offer_id();
    let sender_node_id = node.node_id();

    let target_addr = state
        .nearby_shares
        .node_addr_for_device(&target_node_id)
        .await
        .unwrap_or_else(|| EndpointAddr::new(target_node_id));

    let message = OfferShareMessage {
        offer_id: offer_id.clone(),
        sender_device_name: local_device_name(),
        sender_node_id: sender_node_id.to_string(),
        label: outcome.label,
        size: outcome.total_size,
        blob_hash: outcome.hash.to_string(),
        blob_format: WireBlobFormat::HashSeq,
        file_count: Some(outcome.file_count),
        flick_direction,
    };

    // The user's explicit recipient selection is the sender-side grant.
    // Bound it to this identity and content, and revoke it if the recipient
    // declines or the offer cannot be delivered.
    node.authorize_private_peer(target_node_id, outcome.hash)
        .await
        .map_err(String::from)?;
    if let Err(error) = state
        .offer_receipts
        .register(offer_id.clone(), target_node_id, outcome.hash)
        .await
    {
        node.revoke_private_peer(target_node_id, outcome.hash).await;
        return Err(String::from(error));
    }
    let decision = match send_offer(node.endpoint(), target_addr, message).await {
        Ok(decision) => decision,
        Err(error) => {
            state.offer_receipts.remove(&offer_id).await;
            node.revoke_private_peer(target_node_id, outcome.hash).await;
            return Err(String::from(error));
        }
    };
    if decision != OfferDecision::Accepted {
        state.offer_receipts.remove(&offer_id).await;
        node.revoke_private_peer(target_node_id, outcome.hash).await;
    }

    emit_offer_resolved(&app_handle, offer_id.clone(), target_node_id, decision)
        .map_err(String::from)?;

    match decision {
        OfferDecision::Accepted => Ok(offer_id),
        OfferDecision::Rejected => Err("The receiver declined the offer.".into()),
        OfferDecision::Expired => {
            Err("The receiver did not respond before the offer expired.".into())
        }
    }
}

/// Prepares one local share and offers it to a bounded set of nearby peers.
/// Each recipient gets an independent offer and private blob authorization.
///
/// # Errors
///
/// Returns an error if the share cannot be prepared or the recipient list is
/// empty, duplicated, invalid, includes this device, or exceeds the safety cap.
#[tauri::command]
pub async fn offer_share_to_peers(
    window: tauri::Window,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    node_ids: Vec<String>,
    paths: Vec<String>,
) -> Result<Vec<NearbyOfferAttempt>, String> {
    if paths.is_empty() {
        return Err("Select at least one file to send.".into());
    }
    let _activity = state.node_supervisor.begin_transfer_activity().await;
    let node = state.get_node().await.map_err(String::from)?;
    let recipients = validate_batch_recipients(node_ids, node.node_id())?;
    let profile = state.settings.snapshot().await.transfer_mode.profile();
    let paths = paths.into_iter().map(PathBuf::from).collect::<Vec<_>>();
    let share = crate::transfer::sender::send_files(
        node.as_ref(),
        window,
        paths,
        profile,
        state.transfers.clone(),
    )
    .await
    .map_err(String::from)?;

    Ok(send_prepared_share_to_recipients(
        app_handle,
        node,
        state.nearby_shares.clone(),
        state.offer_receipts.clone(),
        recipients,
        share,
    )
    .await)
}

async fn send_prepared_share_to_recipients(
    app_handle: tauri::AppHandle,
    node: std::sync::Arc<crate::node::LightningP2PNode>,
    nearby_shares: crate::node::NearbyShareRegistry,
    receipts: OfferReceiptLedger,
    recipients: Vec<EndpointId>,
    share: crate::transfer::sender::ShareOutcome,
) -> Vec<NearbyOfferAttempt> {
    stream::iter(recipients.into_iter().map(|recipient| {
        let app_handle = app_handle.clone();
        let node = node.clone();
        let nearby_shares = nearby_shares.clone();
        let receipts = receipts.clone();
        let share = share.clone();
        async move {
            send_prepared_share_to_recipient(
                app_handle,
                node,
                nearby_shares,
                receipts,
                recipient,
                share,
            )
            .await
        }
    }))
    .buffer_unordered(BATCH_OFFER_CONCURRENCY)
    .collect()
    .await
}

async fn send_prepared_share_to_recipient(
    app_handle: tauri::AppHandle,
    node: std::sync::Arc<crate::node::LightningP2PNode>,
    nearby_shares: crate::node::NearbyShareRegistry,
    receipts: OfferReceiptLedger,
    recipient: EndpointId,
    share: crate::transfer::sender::ShareOutcome,
) -> NearbyOfferAttempt {
    let offer_id = generate_offer_id();
    let target_addr = nearby_shares
        .node_addr_for_device(&recipient)
        .await
        .unwrap_or_else(|| EndpointAddr::new(recipient));
    let message = OfferShareMessage {
        offer_id: offer_id.clone(),
        sender_device_name: local_device_name(),
        sender_node_id: node.node_id().to_string(),
        label: share.label,
        size: share.total_size,
        blob_hash: share.hash.to_string(),
        blob_format: WireBlobFormat::HashSeq,
        file_count: Some(share.file_count),
        flick_direction: None,
    };

    let attempt = async {
        node.authorize_private_peer(recipient, share.hash)
            .await
            .map_err(String::from)?;
        if let Err(error) = receipts
            .register(offer_id.clone(), recipient, share.hash)
            .await
        {
            node.revoke_private_peer(recipient, share.hash).await;
            return Err(String::from(error));
        }
        match send_offer(node.endpoint(), target_addr, message).await {
            Ok(decision) => Ok(decision),
            Err(error) => {
                receipts.remove(&offer_id).await;
                node.revoke_private_peer(recipient, share.hash).await;
                Err(String::from(error))
            }
        }
    }
    .await;

    match attempt {
        Ok(outcome) => {
            if outcome != OfferDecision::Accepted {
                receipts.remove(&offer_id).await;
                node.revoke_private_peer(recipient, share.hash).await;
            }
            if let Err(error) =
                emit_offer_resolved(&app_handle, offer_id.clone(), recipient, outcome)
            {
                tracing::warn!(error = %error, "could not publish nearby offer outcome");
            }
            NearbyOfferAttempt {
                receiver_node_id: recipient.to_string(),
                offer_id: Some(offer_id),
                outcome: Some(outcome),
                error: None,
            }
        }
        Err(error) => {
            receipts.remove(&offer_id).await;
            NearbyOfferAttempt {
                receiver_node_id: recipient.to_string(),
                offer_id: Some(offer_id),
                outcome: None,
                error: Some(error),
            }
        }
    }
}

fn validate_batch_recipients(
    node_ids: Vec<String>,
    local_node_id: EndpointId,
) -> Result<Vec<EndpointId>, String> {
    if node_ids.len() < 2 {
        return Err("Choose at least two nearby devices.".into());
    }
    if node_ids.len() > MAX_BATCH_OFFER_RECIPIENTS {
        return Err(format!(
            "Choose no more than {MAX_BATCH_OFFER_RECIPIENTS} nearby devices at once."
        ));
    }
    let mut seen = std::collections::HashSet::with_capacity(node_ids.len());
    let mut recipients = Vec::with_capacity(node_ids.len());
    for node_id in node_ids {
        let recipient = EndpointId::from_str(&node_id)
            .map_err(|_| "One selected device has an invalid identity.".to_string())?;
        if recipient == local_node_id {
            return Err("This device cannot be a recipient.".into());
        }
        if !seen.insert(recipient) {
            return Err("A nearby device was selected more than once.".into());
        }
        recipients.push(recipient);
    }
    Ok(recipients)
}

/// Returns endpoint identities blocked from sending nearby offers.
///
/// # Errors
///
/// Returns an error if application state cannot be accessed.
#[tauri::command]
pub async fn get_blocked_nearby_peers(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    Ok(state.blocked_peers.list().await)
}

/// Arms or revokes a 30-second, one-file receive session for a verified device.
///
/// # Errors
///
/// Returns an error if the device identity is invalid or is not paired.
#[tauri::command]
pub async fn set_ready_to_catch(
    state: State<'_, AppState>,
    node_id: String,
    enabled: bool,
) -> CommandResult<Option<u64>> {
    let peer =
        EndpointId::from_str(&node_id).map_err(|_| command_error("Invalid device identity."))?;
    let peer_id = peer.to_string();
    if enabled {
        if !state.paired_devices.contains(&peer_id).await {
            return Err(command_error(
                "Verify this device before enabling Ready to Catch.",
            ));
        }
        Ok(Some(state.offer_inbox.arm_ready_to_catch(peer_id).await))
    } else {
        state
            .offer_inbox
            .cancel_ready_to_catch(&peer.to_string())
            .await;
        Ok(None)
    }
}

/// Blocks or unblocks a nearby sender by its authenticated endpoint identity.
/// Blocking immediately rejects that peer's pending offers as well.
///
/// # Errors
///
/// Returns an error if the identity is invalid or the updated block list cannot be saved.
#[tauri::command]
pub async fn set_nearby_peer_blocked(
    state: State<'_, AppState>,
    node_id: String,
    blocked: bool,
) -> CommandResult<Vec<String>> {
    let peer =
        EndpointId::from_str(&node_id).map_err(|_| command_error("Invalid device identity."))?;
    let blocked_peers = state
        .blocked_peers
        .set_blocked(&node_id, blocked)
        .await
        .map_err(command_error)?;
    state.offer_inbox.set_peer_blocked(peer, blocked).await;
    Ok(blocked_peers)
}

/// Resolves a pending inbound offer with the user's decision.
///
/// On `accept = true` the receiver immediately starts a blob receive against
/// the sender using the previously parked offer payload, returning the new
/// transfer id. On reject, returns `None`.
///
/// # Errors
///
/// Returns an error string if the offer is no longer pending, the connection
/// has dropped, or the subsequent receive cannot be started.
#[tauri::command]
pub async fn respond_to_offer(
    window: tauri::Window,
    state: State<'_, AppState>,
    offer_id: String,
    sender_node_id: String,
    accept: bool,
    auto_catch: bool,
) -> CommandResult<Option<String>> {
    let sender_node_id = EndpointId::from_str(&sender_node_id)
        .map_err(|err| command_error(format!("Invalid sender node id: {err}")))?
        .to_string();
    // Snapshot the offer payload before resolving so we still have it after
    // the inbox releases its lock.
    let snapshot = state.offer_inbox.snapshot().await;
    let offer = snapshot
        .into_iter()
        .find(|offer| offer.offer_id == offer_id && offer.sender_node_id == sender_node_id)
        .ok_or_else(|| command_error("Offer is no longer pending."))?;

    if auto_catch && !accept {
        let _ = state
            .offer_inbox
            .resolve(&offer.sender_node_id, &offer_id, OfferDecision::Rejected)
            .await;
        return Err(command_error(
            "Ready to Catch can only accept an authorized offer.",
        ));
    }
    if auto_catch
        && (!state.paired_devices.contains(&offer.sender_node_id).await
            || !offer.ready_to_catch
            || !state.offer_inbox.claim_ready_to_catch(&offer).await)
    {
        let _ = state
            .offer_inbox
            .resolve(&offer.sender_node_id, &offer_id, OfferDecision::Rejected)
            .await;
        return Err(command_error(
            "Ready to Catch expired or no longer matches this offer.",
        ));
    }

    let inbox = state.offer_inbox.clone();
    if !accept {
        inbox
            .resolve(&offer.sender_node_id, &offer_id, OfferDecision::Rejected)
            .await
            .map_err(|err| command_error(err.to_string()))?;
        return Ok(None);
    }

    let transfer_queue = state.transfers.clone();
    let start_result = async {
        let sender_node_id = EndpointId::from_str(&offer.sender_node_id)
            .map_err(|err| command_error(format!("Invalid sender node id: {err}")))?;
        let hash = iroh_blobs::Hash::from_str(&offer.blob_hash)
            .map_err(|err| command_error(format!("Invalid blob hash: {err}")))?;
        let blob_format: BlobFormat = offer.blob_format.blob_format();

        let node_addr = state
            .nearby_shares
            .node_addr_for_device(&sender_node_id)
            .await
            .unwrap_or_else(|| EndpointAddr::new(sender_node_id));

        let ticket = iroh_blobs::ticket::BlobTicket::new(node_addr.clone(), hash, blob_format);
        crate::commands::transfer::start_receive_from_offer(
            state,
            window,
            ticket,
            auto_catch,
            offer.label.clone(),
            crate::node::nearby_offer::OfferSaveContext {
                offer_id: offer.offer_id.clone(),
                sender_addr: node_addr,
                blob_hash: hash,
            },
        )
        .await
    }
    .await;

    match start_result {
        Ok(transfer_id) => {
            if let Err(error) = inbox
                .resolve(&offer.sender_node_id, &offer_id, OfferDecision::Accepted)
                .await
            {
                let _ = transfer_queue.cancel(&transfer_id).await;
                return Err(command_error(error.to_string()));
            }
            Ok(Some(transfer_id))
        }
        Err(error) => {
            // A malformed ticket or local setup failure must never be reported
            // as an accepted offer. Best-effort rejection also releases the
            // sender's temporary peer-bound blob grant.
            let _ = inbox
                .resolve(&offer.sender_node_id, &offer_id, OfferDecision::Rejected)
                .await;
            Err(error)
        }
    }
}

fn generate_offer_id() -> String {
    format!("offer-{}", uuid::Uuid::new_v4())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn endpoint_id(seed: u8) -> EndpointId {
        iroh::SecretKey::from_bytes(&[seed; 32]).public()
    }

    #[test]
    fn batch_recipient_validation_requires_distinct_remote_peers() {
        let local = endpoint_id(1);
        let first = endpoint_id(2);
        let second = endpoint_id(3);
        assert_eq!(
            validate_batch_recipients(vec![first.to_string(), second.to_string()], local)
                .expect("valid batch"),
            vec![first, second]
        );
        assert!(validate_batch_recipients(vec![], local).is_err());
        assert!(validate_batch_recipients(vec![first.to_string()], local).is_err());
        assert!(validate_batch_recipients(vec![first.to_string(); 9], local).is_err());
        assert!(
            validate_batch_recipients(vec![first.to_string(), first.to_string()], local).is_err()
        );
        assert!(validate_batch_recipients(vec![local.to_string()], local).is_err());
        assert!(validate_batch_recipients(vec!["invalid".into()], local).is_err());
    }

    #[test]
    fn nearby_offer_attempt_serializes_independent_recipient_result() {
        let attempt = NearbyOfferAttempt {
            receiver_node_id: endpoint_id(2).to_string(),
            offer_id: Some("offer-1".into()),
            outcome: Some(OfferDecision::Accepted),
            error: None,
        };
        let value = serde_json::to_value(attempt).expect("serialize attempt");
        assert_eq!(value["offer_id"], "offer-1");
        assert_eq!(value["outcome"], "accepted");
        assert!(value["error"].is_null());
    }
}
