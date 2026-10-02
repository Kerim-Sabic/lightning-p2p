//! Commands for receiving files and querying transfer state.

use crate::commands::{command_error, CommandResult};
use crate::error::AppErrorPayload;
use crate::storage::history::{self, TransferRecord};
use crate::storage::resumable_receives::{PendingOfferReceipt, ResumableReceive};
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
    let ticket = ShareTicket::parse(&ticket)
        .map_err(|_err| command_error(AppErrorPayload::invalid_ticket()))?;
    start_receive_ticket(
        state,
        window,
        ticket,
        crate::transfer::receiver::ReceiveLimits::default(),
        None,
        None,
        None,
    )
    .await
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
                    tracing::debug!("prewarm: peer path established");
                    tokio::time::sleep(PREWARM_HOLD).await;
                    drop(connection);
                }
                Ok(Err(_error)) => {
                    tracing::debug!("prewarm: dial failed");
                }
                Err(_) => {
                    tracing::debug!("prewarm: dial timed out");
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
    let ticket = state
        .nearby_shares
        .ticket_for_share(&share_id)
        .await
        .map_err(command_error)?;
    start_receive_ticket(
        state,
        window,
        ShareTicket::from_blob_ticket(ticket),
        crate::transfer::receiver::ReceiveLimits::default(),
        None,
        None,
        None,
    )
    .await
}

/// Cancels an in-progress transfer.
///
/// # Errors
///
/// Returns an error string if the transfer cannot be found.
#[tauri::command]
pub async fn cancel_transfer(state: State<'_, AppState>, transfer_id: String) -> CommandResult<()> {
    let active = state.transfers.get(&transfer_id).await.is_some();
    let recoverable = state
        .resumable_receives
        .list()
        .iter()
        .any(|record| record.transfer.transfer_id == transfer_id);
    if !active && !recoverable {
        return Err(command_error("Transfer not found"));
    }
    if recoverable {
        if crate::crypto::delete_receive_resume_ticket(&state.data_dir, &transfer_id).is_err() {
            tracing::warn!("could not remove receive resume credential");
        }
        if state.resumable_receives.remove(&transfer_id).is_err() {
            tracing::warn!("could not remove receive recovery metadata");
        }
    }
    if active && !state.transfers.cancel(&transfer_id).await {
        return Err(command_error("Transfer is no longer active"));
    }
    Ok(())
}

/// Stops an active receive while keeping its secure resume state.
///
/// # Errors
///
/// Returns an error when the transfer is not an active, recoverable receive.
#[tauri::command]
pub async fn pause_transfer(state: State<'_, AppState>, transfer_id: String) -> CommandResult<()> {
    let mut record = state
        .resumable_receives
        .list()
        .into_iter()
        .find(|record| record.transfer.transfer_id == transfer_id)
        .ok_or_else(|| command_error("This receive cannot be paused safely"))?;
    let active = state
        .transfers
        .get(&transfer_id)
        .await
        .ok_or_else(|| command_error("Transfer is no longer active"))?;
    if active.direction != TransferDirection::Receive || !active.can_resume {
        return Err(command_error("This receive cannot be paused safely"));
    }
    record.transfer = active;
    record.transfer.phase = TransferPhase::Paused;
    record.transfer.speed_bps = 0;
    record.transfer.can_resume = true;
    state
        .resumable_receives
        .save(record)
        .map_err(command_error)?;
    if !state.transfers.cancel(&transfer_id).await {
        return Err(command_error("Transfer is no longer active"));
    }
    let stopped = tokio::time::timeout(Duration::from_secs(5), async {
        while state.transfers.get(&transfer_id).await.is_some() {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .is_ok();
    if !stopped {
        return Err(command_error("Receive did not pause in time"));
    }
    Ok(())
}

/// Resumes a persisted receive using its OS-keyring capability.
///
/// # Errors
///
/// Returns an error if secure credentials are unavailable or the receive
/// cannot be restarted.
#[tauri::command]
pub async fn resume_transfer(
    window: tauri::Window,
    state: State<'_, AppState>,
    transfer_id: String,
) -> CommandResult<String> {
    if state.transfers.get(&transfer_id).await.is_some() {
        return Err(command_error("Transfer is already active"));
    }
    ensure_receive_not_completed(&state, &transfer_id).await?;
    let record = state
        .resumable_receives
        .list()
        .into_iter()
        .find(|record| record.transfer.transfer_id == transfer_id)
        .ok_or_else(|| command_error("Recoverable receive not found"))?;
    let Some(secret) = crate::crypto::load_receive_resume_ticket(&state.data_dir, &transfer_id)
        .map_err(command_error)?
    else {
        state
            .resumable_receives
            .remove(&transfer_id)
            .map_err(command_error)?;
        return Err(command_error("Secure resume credential is unavailable"));
    };
    let ticket = match ShareTicket::parse(&secret) {
        Ok(ticket) => ticket,
        Err(_error) => {
            let _ = crate::crypto::delete_receive_resume_ticket(&state.data_dir, &transfer_id);
            state
                .resumable_receives
                .remove(&transfer_id)
                .map_err(command_error)?;
            return Err(command_error(AppErrorPayload::invalid_ticket()));
        }
    };
    let save_receipt = pending_offer_save_context(record.pending_offer_receipt.as_ref());
    start_receive_ticket(
        state,
        window,
        ticket,
        record.limits,
        record.fallback_file_name.clone(),
        Some(record),
        save_receipt,
    )
    .await
}

async fn ensure_receive_not_completed(state: &AppState, transfer_id: &str) -> CommandResult<()> {
    let node = state.get_node().await.map_err(command_error)?;
    let history_transfer_id = transfer_id.to_string();
    let history_node = node.clone();
    let completed = tokio::task::spawn_blocking(move || {
        history::receive_by_transfer_id(history_node.db(), &history_transfer_id)
    })
    .await
    .map_err(|error| command_error(error.to_string()))?
    .map_err(command_error)?;
    if completed.is_some() {
        let pending_receipt = state
            .resumable_receives
            .get(transfer_id)
            .and_then(|record| pending_offer_save_context(record.pending_offer_receipt.as_ref()));
        let receipt_acknowledged = if let Some(receipt) = pending_receipt {
            let wire_receipt = crate::node::nearby_offer::OfferSavedReceipt {
                offer_id: receipt.offer_id,
                blob_hash: receipt.blob_hash.to_string(),
            };
            match crate::node::nearby_protocol::send_offer_saved_receipt(
                node.endpoint(),
                receipt.sender_addr,
                wire_receipt,
            )
            .await
            {
                Ok(()) => true,
                Err(error) => {
                    tracing::warn!(%error, "verified receive is saved; nearby receipt remains pending");
                    false
                }
            }
        } else {
            true
        };
        if receipt_acknowledged {
            let _ = crate::crypto::delete_receive_resume_ticket(&state.data_dir, transfer_id);
            state
                .resumable_receives
                .remove(transfer_id)
                .map_err(command_error)?;
        }
        return Err(command_error(
            "This receive is already saved. Find it in Activity instead of receiving it again.",
        ));
    }
    Ok(())
}

/// Returns a snapshot of all active transfers.
///
/// # Errors
///
/// Returns an error string if transfer state cannot be read.
#[tauri::command]
pub async fn get_active_transfers(state: State<'_, AppState>) -> Result<Vec<TransferInfo>, String> {
    let mut active = state.transfers.list().await;
    let active_ids = active
        .iter()
        .map(|transfer| transfer.transfer_id.clone())
        .collect::<HashSet<_>>();
    for record in state.resumable_receives.list() {
        let mut transfer = record.transfer;
        if active_ids.contains(&transfer.transfer_id) {
            if transfer.phase == TransferPhase::Paused {
                if let Some(existing) = active
                    .iter_mut()
                    .find(|current| current.transfer_id == transfer.transfer_id)
                {
                    existing.phase = TransferPhase::Paused;
                    existing.speed_bps = 0;
                    existing.can_resume = true;
                }
            }
            continue;
        }
        transfer.phase = TransferPhase::Paused;
        transfer.speed_bps = 0;
        transfer.can_resume = true;
        active.push(transfer);
    }
    active.sort_by(|left, right| left.transfer_id.cmp(&right.transfer_id));
    Ok(active)
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
    tokio::task::spawn_blocking(move || history::load_all(node.db()))
        .await
        .map_err(|error| error.to_string())?
        .map_err(String::from)
}

/// Clears persisted transfer history.
///
/// # Errors
///
/// Returns an error string if the node is unavailable or history clearing fails.
#[tauri::command]
pub async fn clear_transfer_history(state: State<'_, AppState>) -> Result<(), String> {
    let node = state.get_node().await.map_err(String::from)?;
    tokio::task::spawn_blocking(move || history::clear_all(node.db()))
        .await
        .map_err(|error| error.to_string())?
        .map_err(String::from)
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
    ticket: BlobTicket,
    auto_catch: bool,
    offer_label: String,
    save_receipt: crate::node::nearby_offer::OfferSaveContext,
) -> CommandResult<String> {
    let limits = if auto_catch {
        crate::transfer::receiver::ReceiveLimits::ready_to_catch()
    } else {
        crate::transfer::receiver::ReceiveLimits::default()
    };
    start_receive_ticket(
        state,
        window,
        ShareTicket::from_blob_ticket(ticket),
        limits,
        Some(offer_label),
        None,
        Some(save_receipt),
    )
    .await
}

async fn start_receive_ticket(
    state: State<'_, AppState>,
    window: tauri::Window,
    ticket: ShareTicket,
    limits: crate::transfer::receiver::ReceiveLimits,
    fallback_file_name: Option<String>,
    resume: Option<ResumableReceive>,
    save_receipt: Option<crate::node::nearby_offer::OfferSaveContext>,
) -> CommandResult<String> {
    let activity = state.node_supervisor.begin_transfer_activity().await;
    let node = state.get_node().await.map_err(command_error)?;
    let settings = state.settings.snapshot().await;
    let destination = settings.download_dir.clone();
    let profile = settings.transfer_mode.profile();
    export::preflight_destination(&destination).map_err(command_error)?;

    let transfer_id = resume.as_ref().map_or_else(
        || uuid::Uuid::new_v4().to_string(),
        |record| record.transfer.transfer_id.clone(),
    );
    let (cancel_tx, cancel_rx) = watch::channel(false);
    let mut info = receive_transfer_info(&transfer_id, &ticket);
    let save_receipt = save_receipt.or_else(|| {
        resume
            .as_ref()
            .and_then(|record| pending_offer_save_context(record.pending_offer_receipt.as_ref()))
    });
    if let Some(mut record) = resume {
        info.can_resume = true;
        record.transfer = info.clone();
        state
            .resumable_receives
            .save(record)
            .map_err(command_error)?;
    } else if let Ok(encoded_ticket) = ticket.encode_for_resume() {
        if crate::crypto::store_receive_resume_ticket(
            &state.data_dir,
            &transfer_id,
            &encoded_ticket,
        )
        .is_ok()
        {
            info.can_resume = true;
            let record = ResumableReceive {
                transfer: info.clone(),
                limits,
                fallback_file_name: fallback_file_name.clone(),
                finalization: None,
                pending_offer_receipt: save_receipt.as_ref().map(|receipt| PendingOfferReceipt {
                    offer_id: receipt.offer_id.clone(),
                    sender_node_id: receipt.sender_addr.id.to_string(),
                    blob_hash: receipt.blob_hash.to_string(),
                }),
            };
            if state.resumable_receives.save(record).is_err() {
                info.can_resume = false;
                let _ = crate::crypto::delete_receive_resume_ticket(&state.data_dir, &transfer_id);
            }
        }
    }
    if !state.transfers.try_add(info, Some(cancel_tx)).await {
        return Err(command_error("Transfer is already active"));
    }

    spawn_receive_task(ReceiveLaunch {
        activity,
        node,
        queue: state.transfers.clone(),
        window,
        transfer_id: transfer_id.clone(),
        cancel_rx,
        ticket,
        destination,
        profile,
        swarm_enabled: settings.experimental_swarm_receive || profile.swarm_receive_default,
        limits,
        fallback_file_name,
        data_dir: state.data_dir.clone(),
        resume_store: state.resumable_receives.clone(),
        save_receipt,
    });

    Ok(transfer_id)
}

fn pending_offer_save_context(
    receipt: Option<&PendingOfferReceipt>,
) -> Option<crate::node::nearby_offer::OfferSaveContext> {
    use std::str::FromStr;
    let receipt = receipt?;
    let sender = iroh::EndpointId::from_str(&receipt.sender_node_id).ok()?;
    let blob_hash = iroh_blobs::Hash::from_str(&receipt.blob_hash).ok()?;
    Some(crate::node::nearby_offer::OfferSaveContext {
        offer_id: receipt.offer_id.clone(),
        sender_addr: iroh::EndpointAddr::new(sender),
        blob_hash,
    })
}

fn receive_transfer_info(transfer_id: &str, ticket: &ShareTicket) -> TransferInfo {
    let topology = ticket.topology();
    TransferInfo {
        transfer_id: transfer_id.to_string(),
        direction: TransferDirection::Receive,
        name: ticket
            .label()
            .map_or_else(|| ticket.primary().hash().to_string(), str::to_string),
        peer: Some(ticket.primary().addr().id.to_string()),
        bytes: 0,
        total: 0,
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
        strategy: if topology.provider_count > 1 {
            TransferStrategy::QueuedMultiProvider
        } else {
            TransferStrategy::QueuedSingleProvider
        },
        first_byte_ms: 0,
        effective_mbps: 0,
        can_resume: false,
    }
}

struct ReceiveLaunch {
    activity: tokio::sync::OwnedRwLockReadGuard<()>,
    node: std::sync::Arc<crate::node::LightningP2PNode>,
    queue: crate::transfer::queue::TransferQueue,
    window: tauri::Window,
    transfer_id: String,
    cancel_rx: watch::Receiver<bool>,
    ticket: ShareTicket,
    destination: std::path::PathBuf,
    profile: crate::transfer::mode::TransferProfile,
    swarm_enabled: bool,
    limits: crate::transfer::receiver::ReceiveLimits,
    fallback_file_name: Option<String>,
    data_dir: std::path::PathBuf,
    resume_store: crate::storage::resumable_receives::ResumableReceiveStore,
    save_receipt: Option<crate::node::nearby_offer::OfferSaveContext>,
}

fn spawn_receive_task(launch: ReceiveLaunch) {
    let ReceiveLaunch {
        activity,
        node,
        queue,
        window,
        transfer_id,
        cancel_rx,
        ticket,
        destination,
        profile,
        swarm_enabled,
        limits,
        fallback_file_name,
        data_dir,
        resume_store,
        save_receipt,
    } = launch;
    let context = crate::transfer::receiver::ReceiveContext {
        queue,
        window,
        transfer_id: transfer_id.clone(),
        cancel_rx,
        swarm_enabled,
        limits,
        fallback_file_name,
        resume_store: resume_store.clone(),
    };
    tauri::async_runtime::spawn(async move {
        let _activity = activity;
        if crate::transfer::receiver::receive_blob(
            node.as_ref(),
            context,
            ticket,
            destination,
            profile,
        )
        .await
        .is_ok()
        {
            let mut receipt_acknowledged = true;
            if let Some(receipt) = save_receipt {
                let wire_receipt = crate::node::nearby_offer::OfferSavedReceipt {
                    offer_id: receipt.offer_id.clone(),
                    blob_hash: receipt.blob_hash.to_string(),
                };
                if let Err(error) = crate::node::nearby_protocol::send_offer_saved_receipt(
                    node.endpoint(),
                    receipt.sender_addr,
                    wire_receipt,
                )
                .await
                {
                    receipt_acknowledged = false;
                    tracing::warn!(%error, "could not deliver verified nearby save receipt");
                }
            }
            if receipt_acknowledged {
                if crate::crypto::delete_receive_resume_ticket(&data_dir, &transfer_id).is_err() {
                    tracing::warn!("could not remove completed receive credential");
                }
                if resume_store.remove(&transfer_id).is_err() {
                    tracing::warn!("could not remove completed receive metadata");
                }
            }
        }
    });
}
