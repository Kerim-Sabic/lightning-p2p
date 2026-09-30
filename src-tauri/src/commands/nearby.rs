//! Commands for nearby device discovery and the push-style share offer flow.

use crate::commands::{command_error, CommandResult};
use crate::node::nearby_offer::{emit_offer_resolved, OfferDecision, OfferShareMessage};
use crate::node::nearby_protocol::{local_device_name, send_offer, WireBlobFormat};
use crate::node::NearbyDevice;
use crate::storage::peers;
use crate::AppState;
use iroh::{EndpointAddr, EndpointId};
use iroh_blobs::BlobFormat;
use std::path::PathBuf;
use std::str::FromStr;
use tauri::{Emitter, State};

/// Returns the current list of nearby devices visible to this node.
///
/// # Errors
///
/// Returns an error string if the registry snapshot cannot be read.
#[tauri::command]
pub async fn get_nearby_devices(state: State<'_, AppState>) -> Result<Vec<NearbyDevice>, String> {
    Ok(state.nearby_shares.devices_snapshot().await)
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
    };

    // The user's explicit recipient selection is the sender-side grant.
    // Bound it to this identity and content, and revoke it if the recipient
    // declines or the offer cannot be delivered.
    node.authorize_private_peer(target_node_id, outcome.hash)
        .await
        .map_err(String::from)?;
    let decision = match send_offer(node.endpoint(), target_addr, message).await {
        Ok(decision) => decision,
        Err(error) => {
            node.revoke_private_peer(target_node_id, outcome.hash).await;
            return Err(String::from(error));
        }
    };
    if decision != OfferDecision::Accepted {
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
    accept: bool,
    auto_catch: bool,
) -> CommandResult<Option<String>> {
    // Snapshot the offer payload before resolving so we still have it after
    // the inbox releases its lock.
    let snapshot = state.offer_inbox.snapshot().await;
    let offer = snapshot
        .into_iter()
        .find(|offer| offer.offer_id == offer_id)
        .ok_or_else(|| command_error("Offer is no longer pending."))?;

    if auto_catch && !accept {
        let _ = state
            .offer_inbox
            .resolve(&offer_id, OfferDecision::Rejected)
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
            .resolve(&offer_id, OfferDecision::Rejected)
            .await;
        return Err(command_error(
            "Ready to Catch expired or no longer matches this offer.",
        ));
    }

    let inbox = state.offer_inbox.clone();
    if !accept {
        inbox
            .resolve(&offer_id, OfferDecision::Rejected)
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

        let ticket = iroh_blobs::ticket::BlobTicket::new(node_addr, hash, blob_format);
        crate::commands::transfer::start_receive_from_offer(state, window, ticket).await
    }
    .await;

    match start_result {
        Ok(transfer_id) => {
            if let Err(error) = inbox.resolve(&offer_id, OfferDecision::Accepted).await {
                let _ = transfer_queue.cancel(&transfer_id).await;
                return Err(command_error(error.to_string()));
            }
            Ok(Some(transfer_id))
        }
        Err(error) => {
            // A malformed ticket or local setup failure must never be reported
            // as an accepted offer. Best-effort rejection also releases the
            // sender's temporary peer-bound blob grant.
            let _ = inbox.resolve(&offer_id, OfferDecision::Rejected).await;
            Err(error)
        }
    }
}

fn generate_offer_id() -> String {
    format!("offer-{}", uuid::Uuid::new_v4())
}
