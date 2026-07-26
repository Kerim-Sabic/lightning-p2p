//! Commands for direct Lightning P2P chat.

use crate::node::chat_protocol::{self, ChatMessage};
use crate::node::nearby_protocol::local_device_name;
use crate::AppState;
use iroh::{EndpointAddr, EndpointId};
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, State};

/// Loads the isolated Lightning Chat Nostr identity from secure local storage.
///
/// # Errors
///
/// Returns an error when the platform credential store is unavailable and no
/// profile fallback can be read.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn load_lightning_chat_secret(state: State<'_, AppState>) -> Result<Option<String>, String> {
    crate::crypto::load_chat_secret(&state.data_dir).map_err(String::from)
}

/// Stores a newly generated Lightning Chat Nostr identity.
///
/// # Errors
///
/// Returns an error when the secret is malformed or cannot be persisted.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn store_lightning_chat_secret(
    state: State<'_, AppState>,
    secret: String,
) -> Result<(), String> {
    crate::crypto::store_chat_secret(&state.data_dir, &secret).map_err(String::from)
}

/// Erases the Lightning Chat identity. Relay-side events cannot be recalled.
///
/// # Errors
///
/// Returns an error when local credential cleanup fails.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn panic_wipe_lightning_chat(state: State<'_, AppState>) -> Result<(), String> {
    crate::crypto::delete_chat_secret(&state.data_dir).map_err(String::from)
}

/// Sends one encrypted direct message through the isolated iroh chat protocol.
///
/// # Errors
///
/// Returns an error when the recipient is invalid, the message is outside the
/// accepted size bounds, the native node is unavailable, or delivery fails.
#[tauri::command]
pub async fn send_chat_message(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    node_id: String,
    body: String,
) -> Result<ChatMessage, String> {
    let body = body.trim().to_string();
    if body.is_empty() || body.len() > 8_000 {
        return Err("Messages must be between 1 and 8,000 characters.".into());
    }
    let target = EndpointId::from_str(&node_id)
        .map_err(|error| format!("Invalid chat recipient: {error}"))?;
    let node = state.get_node().await.map_err(String::from)?;
    let sent_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |value| value.as_secs());
    let message = ChatMessage {
        id: format!(
            "chat-{:x}",
            sent_at.saturating_mul(1_000_000) + u64::from(rand::random::<u16>())
        ),
        sender_node_id: node.node_id().to_string(),
        sender_name: local_device_name(),
        body,
        sent_at,
    };
    let addr = state
        .nearby_shares
        .node_addr_for_device(&target)
        .await
        .unwrap_or_else(|| EndpointAddr::new(target));
    chat_protocol::send_message(node.endpoint(), addr, &message)
        .await
        .map_err(String::from)?;
    app_handle
        .emit("chat-message-sent", &message)
        .map_err(|error| error.to_string())?;
    Ok(message)
}
