//! Commands for receiving files and querying transfer state.

use crate::commands::{command_error, CommandResult};
use crate::error::AppErrorPayload;
use crate::storage::history::{self, TransferRecord};
use crate::transfer::export;
use crate::transfer::metrics::{RouteKind, TransferStrategy};
use crate::transfer::progress::{TransferDirection, TransferInfo, TransferPhase};
use crate::transfer::ticket::ShareTicket;
use crate::AppState;
use iroh_blobs::ticket::BlobTicket;
use std::collections::HashSet;
use std::sync::{LazyLock, Mutex, PoisonError};
use std::time::Duration;
use tauri::State;
use tokio::sync::watch;

/// Ceiling on how long a pre-warm dial may spend on discovery, holepunching,
/// and the QUIC handshake before giving up. Generous because relay-assisted
/// paths legitimately take several seconds to negotiate.
const PREWARM_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// How long an established pre-warm connection is held open. Keepalives on
/// the connection keep NAT bindings and the direct path hot until the user
/// actually presses Receive.
const PREWARM_HOLD: Duration = Duration::from_secs(45);

/// Node ids with a pre-warm dial currently in flight, so repeated keystrokes
/// in the ticket field cannot stack duplicate dials to the same sender.
static PREWARM_INFLIGHT: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// Starts downloading shared content from a legacy or Lightning P2P ticket string.
///
/// # Errors
///
/// Returns an error string if the ticket is invalid or the transfer cannot be
/// started.
#[tauri::command]
pub async fn start_receive(
    window: tauri::Window,
    state: State<'_, AppState>,
    ticket: String,
) -> CommandResult<String> {
    let node = state.get_node().await.map_err(command_error)?;
    let ticket = ShareTicket::parse(&ticket)
        .map_err(|_err| command_error(AppErrorPayload::invalid_ticket()))?;
    start_receive_ticket(state, window, node, ticket).await
}

/// Pre-dials the providers named in a ticket so discovery, NAT holepunching,
/// and the QUIC handshake complete while the user is still looking at the
/// confirm button. By the time `start_receive` runs, the endpoint already
/// knows a working path to the sender, cutting time-to-first-byte.
///
/// Best-effort by design: invalid tickets, a node that is still starting, or
/// unreachable peers all return `Ok(false)` rather than surfacing an error,
/// because nothing user-visible has been asked for yet.
///
/// # Errors
///
/// Never returns an error; the `Result` shape is required by Tauri IPC.
#[tauri::command]
pub async fn prewarm_ticket(state: State<'_, AppState>, ticket: String) -> CommandResult<bool> {
    let Ok(parsed) = ShareTicket::parse(&ticket) else {
        return Ok(false);
    };
    let Ok(node) = state.get_node().await else {
        return Ok(false);
    };
    Ok(spawn_prewarm(&node, &parsed))
}

/// Spawns one background dial per provider that is not already being warmed.
/// Returns whether at least one new dial was started.
fn spawn_prewarm(
    node: &std::sync::Arc<crate::node::LightningP2PNode>,
    ticket: &ShareTicket,
) -> bool {
    let mut started = false;
    for addr in ticket.provider_node_addrs() {
        let node_id = addr.id.to_string();
        {
            let mut inflight = PREWARM_INFLIGHT
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            if !inflight.insert(node_id.clone()) {
                continue;
            }
        }
        started = true;
        let node = node.clone();
        tauri::async_runtime::spawn(async move {
            let dial = node.endpoint().connect(addr, iroh_blobs::ALPN);
            match tokio::time::timeout(PREWARM_CONNECT_TIMEOUT, dial).await {
                Ok(Ok(connection)) => {
                    tracing::debug!(node_id = %node_id, "prewarm: peer path established");
                    tokio::time::sleep(PREWARM_HOLD).await;
                    drop(connection);
                }
                Ok(Err(error)) => {
                    tracing::debug!(node_id = %node_id, %error, "prewarm: dial failed");
                }
                Err(_) => {
                    tracing::debug!(node_id = %node_id, "prewarm: dial timed out");
                }
            }
            PREWARM_INFLIGHT
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .remove(&node_id);
        });
    }
    started
}

/// Returns the current LAN-discovered nearby shares.
///
/// # Errors
///
/// Returns an error string if the nearby-share cache cannot be read.
#[tauri::command]
pub async fn get_discovered_shares(
    state: State<'_, AppState>,
) -> Result<Vec<crate::node::NearbyShare>, String> {
    Ok(state.nearby_shares.snapshot().await)
}

/// Starts receiving from a LAN-discovered nearby share descriptor.
///
/// # Errors
///
/// Returns an error string if the nearby share is stale or the transfer cannot start.
#[tauri::command]
pub async fn start_receive_discovered_share(
    window: tauri::Window,
    state: State<'_, AppState>,
    share_id: String,
) -> CommandResult<String> {
    let node = state.get_node().await.map_err(command_error)?;
    let ticket = state
        .nearby_shares
        .ticket_for_share(&share_id)
        .await
        .map_err(command_error)?;
    start_receive_ticket(state, window, node, ShareTicket::from_blob_ticket(ticket)).await
}

/// Cancels an in-progress transfer.
///
/// # Errors
///
/// Returns an error string if the transfer cannot be found.
#[tauri::command]
pub async fn cancel_transfer(state: State<'_, AppState>, transfer_id: String) -> CommandResult<()> {
    if state.transfers.cancel(&transfer_id).await {
        Ok(())
    } else {
        Err(command_error("Transfer not found"))
    }
}

/// Returns a snapshot of all active transfers.
///
/// # Errors
///
/// Returns an error string if transfer state cannot be read.
#[tauri::command]
pub async fn get_active_transfers(state: State<'_, AppState>) -> Result<Vec<TransferInfo>, String> {
    Ok(state.transfers.list().await)
}

/// Returns persisted transfer history.
///
/// # Errors
///
/// Returns an error string if the node is unavailable or history loading fails.
#[tauri::command]
pub async fn get_transfer_history(
    state: State<'_, AppState>,
) -> Result<Vec<TransferRecord>, String> {
    let node = state.get_node().await.map_err(String::from)?;
    history::load_all(node.db()).map_err(String::from)
}

/// Clears persisted transfer history.
///
/// # Errors
///
/// Returns an error string if the node is unavailable or history clearing fails.
#[tauri::command]
pub async fn clear_transfer_history(state: State<'_, AppState>) -> Result<(), String> {
    let node = state.get_node().await.map_err(String::from)?;
    history::clear_all(node.db()).map_err(String::from)
}

/// Shared helper that powers both the regular ticket-receive path and the
/// accept-an-offer path, so the queue + progress + cancellation wiring lives
/// in one place.
///
/// # Errors
///
/// Returns an error string if the destination is invalid or the transfer
/// cannot be queued.
pub(crate) async fn start_receive_from_offer(
    state: State<'_, AppState>,
    window: tauri::Window,
    node: std::sync::Arc<crate::node::LightningP2PNode>,
    ticket: BlobTicket,
) -> CommandResult<String> {
    start_receive_ticket(state, window, node, ShareTicket::from_blob_ticket(ticket)).await
}

async fn start_receive_ticket(
    state: State<'_, AppState>,
    window: tauri::Window,
    node: std::sync::Arc<crate::node::LightningP2PNode>,
    ticket: ShareTicket,
) -> CommandResult<String> {
    let settings = state.settings.snapshot().await;
    let destination = settings.download_dir.clone();
    let profile = settings.transfer_mode.profile();
    export::preflight_destination(&destination).map_err(command_error)?;

    let transfer_id = state.transfers.next_transfer_id("recv");
    let (cancel_tx, cancel_rx) = watch::channel(false);
    let topology = ticket.topology();
    let strategy = if topology.provider_count > 1 {
        TransferStrategy::QueuedMultiProvider
    } else {
        TransferStrategy::QueuedSingleProvider
    };

    state
        .transfers
        .add(
            TransferInfo {
                transfer_id: transfer_id.clone(),
                direction: TransferDirection::Receive,
                name: ticket
                    .label()
                    .map_or_else(|| ticket.primary().hash().to_string(), str::to_string),
                peer: Some(ticket.primary().addr().id.to_string()),
                bytes: 0,
                total: ticket.size().unwrap_or(0),
                speed_bps: 0,
                route_kind: RouteKind::Unknown,
                phase: TransferPhase::Connecting,
                failure_category: None,
                output_path: None,
                connect_ms: 0,
                download_ms: 0,
                export_ms: 0,
                provider_count: topology.provider_count,
                direct_provider_count: topology.direct_provider_count,
                relay_provider_count: topology.relay_provider_count,
                strategy,
                first_byte_ms: 0,
                effective_mbps: 0,
            },
            Some(cancel_tx),
        )
        .await;

    let queue = state.transfers.clone();
    let window_clone = window.clone();
    let transfer_id_for_task = transfer_id.clone();

    let ctx = crate::transfer::receiver::ReceiveContext {
        queue,
        window: window_clone,
        transfer_id: transfer_id_for_task.clone(),
        cancel_rx,
        // Swarm receive runs when the user forced it on in Settings, or by
        // default on the performance tiers (Extreme, LAN Beast, Warp). The
        // swarm path auto-falls-back to the sequential download on failure.
        swarm_enabled: settings.experimental_swarm_receive || profile.swarm_receive_default,
    };

    tauri::async_runtime::spawn(async move {
        if let Err(err) = crate::transfer::receiver::receive_blob(
            node.as_ref(),
            ctx,
            ticket,
            destination,
            profile,
        )
        .await
        {
            tracing::error!(transfer_id = %transfer_id_for_task, "receive failed: {err}");
        }
    });

    Ok(transfer_id)
}
