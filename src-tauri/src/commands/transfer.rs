//! Commands for receiving files and querying transfer state.

use crate::storage::history::{self, TransferRecord};
use crate::transfer::metrics::RouteKind;
use crate::transfer::progress::{TransferDirection, TransferInfo};
use crate::AppState;
use iroh_blobs::ticket::BlobTicket;
use std::path::PathBuf;
use std::str::FromStr;
use tauri::State;
use tokio::sync::watch;

/// Starts downloading shared content from a `BlobTicket` string.
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
    destination: String,
) -> Result<String, String> {
    let node = state.get_node().await.map_err(String::from)?;
    let ticket = BlobTicket::from_str(&ticket)
        .map_err(|_err| "Invalid ticket. Check the share code and try again.".to_string())?;
    let transfer_id = state.transfers.next_transfer_id("recv");
    let (cancel_tx, cancel_rx) = watch::channel(false);

    state
        .transfers
        .add(
            TransferInfo {
                transfer_id: transfer_id.clone(),
                direction: TransferDirection::Receive,
                name: ticket.hash().to_string(),
                peer: Some(ticket.node_addr().node_id.to_string()),
                bytes: 0,
                total: 0,
                speed_bps: 0,
                route_kind: RouteKind::Unknown,
                connect_ms: 0,
                download_ms: 0,
                export_ms: 0,
            },
            Some(cancel_tx),
        )
        .await;

    let queue = state.transfers.clone();
    let window_clone = window.clone();
    let destination = PathBuf::from(destination);
    let transfer_id_for_task = transfer_id.clone();

    tauri::async_runtime::spawn(async move {
        if let Err(err) = crate::transfer::receiver::receive_blob(
            node.as_ref(),
            queue,
            window_clone,
            transfer_id_for_task.clone(),
            ticket,
            destination,
            cancel_rx,
        )
        .await
        {
            tracing::error!(transfer_id = %transfer_id_for_task, "receive failed: {err}");
        }
    });

    Ok(transfer_id)
}

/// Cancels an in-progress transfer.
///
/// # Errors
///
/// Returns an error string if the transfer cannot be found.
#[tauri::command]
pub async fn cancel_transfer(
    state: State<'_, AppState>,
    transfer_id: String,
) -> Result<(), String> {
    if state.transfers.cancel(&transfer_id).await {
        Ok(())
    } else {
        Err("Transfer not found".into())
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
    history::load_all(&node.db).map_err(String::from)
}
