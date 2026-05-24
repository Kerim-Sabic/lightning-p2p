//! Commands for nearby device discovery and the push-style share offer flow.

use crate::commands::{command_error, CommandResult};
use crate::node::nearby_offer::{emit_offer_resolved, OfferDecision, OfferShareMessage};
use crate::node::nearby_protocol::{local_device_name, send_offer, WireBlobFormat};
use crate::node::{ActiveShare, NearbyDevice};
use crate::storage::peers;
use crate::AppState;
use iroh::{NodeAddr, NodeId};
use iroh_blobs::BlobFormat;
use std::path::PathBuf;
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};
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

    let node = state.get_node().await.map_err(String::from)?;
    let target_node_id =
        NodeId::from_str(&node_id).map_err(|err| format!("Invalid target node id: {err}"))?;

    let path_bufs = paths.into_iter().map(PathBuf::from).collect::<Vec<_>>();
    let outcome = crate::transfer::sender::send_files(node.as_ref(), window, path_bufs)
        .await
        .map_err(String::from)?;

    // Mirror the new share into the active-share registry so any other peer
    // can also pull it via the standard list flow.
    state
        .nearby_shares
        .publish_share(ActiveShare::new(
            outcome.label.clone(),
            outcome.hash,
            BlobFormat::HashSeq,
            outcome.total_size,
        ))
        .await;

    let offer_id = generate_offer_id();
    let sender_node_id = node.node_id();

    let target_addr = state
        .nearby_shares
        .node_addr_for_device(&target_node_id)
        .await
        .unwrap_or_else(|| NodeAddr::new(target_node_id));

    let message = OfferShareMessage {
        offer_id: offer_id.clone(),
        sender_device_name: local_device_name(),
        sender_node_id: sender_node_id.to_string(),
        label: outcome.label,
        size: outcome.total_size,
        blob_hash: outcome.hash.to_string(),
        blob_format: WireBlobFormat::HashSeq,
    };

    let decision = send_offer(node.endpoint(), target_addr, message)
        .await
        .map_err(String::from)?;

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
) -> CommandResult<Option<String>> {
    // Snapshot the offer payload before resolving so we still have it after
    // the inbox releases its lock.
    let snapshot = state.offer_inbox.snapshot().await;
    let offer = snapshot
        .into_iter()
        .find(|offer| offer.offer_id == offer_id)
        .ok_or_else(|| command_error("Offer is no longer pending."))?;

    let decision = if accept {
        OfferDecision::Accepted
    } else {
        OfferDecision::Rejected
    };

    state
        .offer_inbox
        .resolve(&offer_id, decision)
        .await
        .map_err(|err| command_error(err.to_string()))?;

    if !accept {
        return Ok(None);
    }

    let sender_node_id = NodeId::from_str(&offer.sender_node_id)
        .map_err(|err| command_error(format!("Invalid sender node id: {err}")))?;
    let hash = iroh_blobs::Hash::from_str(&offer.blob_hash)
        .map_err(|err| command_error(format!("Invalid blob hash: {err}")))?;
    let blob_format: BlobFormat = offer.blob_format.blob_format();

    let node = state.get_node().await.map_err(command_error)?;
    let node_addr = state
        .nearby_shares
        .node_addr_for_device(&sender_node_id)
        .await
        .unwrap_or_else(|| NodeAddr::new(sender_node_id));

    let ticket = iroh_blobs::ticket::BlobTicket::new(node_addr, hash, blob_format)
        .map_err(|err| command_error(format!("Could not build ticket from offer: {err}")))?;

    let transfer_id =
        crate::commands::transfer::start_receive_from_offer(state, window, node, ticket).await?;

    Ok(Some(transfer_id))
}

fn generate_offer_id() -> String {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_micros());
    format!("offer-{stamp:x}")
}
