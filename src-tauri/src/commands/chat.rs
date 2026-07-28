//! Commands for direct Lightning P2P chat.
#![allow(clippy::missing_errors_doc)]

use crate::node::chat_mesh::{MeshChatEvent, MeshGroup, MeshPeer, MeshStatus};
use crate::node::chat_protocol::{self, ChatMessage};
use crate::node::nearby_protocol::local_device_name;
use crate::AppState;
use base64::{engine::general_purpose::STANDARD, Engine};
use iroh::{EndpointAddr, EndpointId};
use qrcode::{render::svg, QrCode};
use serde::Serialize;
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, State};

const MAX_MESH_MEDIA_BYTES: usize = 512 * 1024;

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
pub async fn panic_wipe_lightning_chat(state: State<'_, AppState>) -> Result<(), String> {
    #[cfg(windows)]
    {
        state
            .chat_mesh_polling_active
            .store(false, std::sync::atomic::Ordering::SeqCst);
        let _ = crate::proximity::chat_ble::stop();
    }
    state.chat_mesh.lock().await.wipe()?;
    crate::crypto::delete_chat_mesh_identity(&state.data_dir).map_err(String::from)?;
    crate::crypto::delete_chat_secret(&state.data_dir).map_err(String::from)
}

/// Returns the native Bluetooth mesh identity, peers, groups, and link count.
#[tauri::command]
pub async fn get_chat_mesh_status(state: State<'_, AppState>) -> Result<MeshStatus, String> {
    #[cfg(windows)]
    let connected = crate::proximity::chat_ble::connected_peer_count();
    #[cfg(not(windows))]
    let connected = 0;
    Ok(state.chat_mesh.lock().await.status(connected))
}

/// Updates the nickname announced on the local radio mesh.
#[tauri::command]
pub async fn set_chat_mesh_nickname(
    state: State<'_, AppState>,
    nickname: String,
) -> Result<(), String> {
    let frames = {
        let mut mesh = state.chat_mesh.lock().await;
        mesh.set_nickname(nickname);
        mesh.announce_frames()?
    };
    send_mesh_frames(&frames)
}

/// Broadcasts one signed public message over the Bluetooth multi-hop mesh.
#[tauri::command]
pub async fn send_chat_mesh_message(
    state: State<'_, AppState>,
    body: String,
) -> Result<MeshChatEvent, String> {
    let (event, frames) = state
        .chat_mesh
        .lock()
        .await
        .public_message_frames(body, epoch_ms())?;
    send_mesh_frames(&frames)?;
    Ok(event)
}

/// Sends a private message after an authenticated Noise XX handshake.
#[tauri::command]
pub async fn send_chat_mesh_private_message(
    state: State<'_, AppState>,
    peer_id: String,
    body: String,
    message_id: String,
) -> Result<(), String> {
    let peer = decode_hex_array::<8>(&peer_id, "mesh peer ID")?;
    let frames = state
        .chat_mesh
        .lock()
        .await
        .private_message_frames(peer, body, message_id)?;
    send_mesh_frames(&frames)
}

/// Sends an image, file, or voice note over public mesh or private Noise.
#[tauri::command]
pub async fn send_chat_mesh_media(
    state: State<'_, AppState>,
    peer_id: Option<String>,
    file_name: Option<String>,
    mime_type: Option<String>,
    data_base64: String,
    voice: bool,
) -> Result<(), String> {
    let peer = peer_id
        .as_deref()
        .map(|value| decode_hex_array::<8>(value, "mesh peer ID"))
        .transpose()?;
    let data = STANDARD
        .decode(data_base64)
        .map_err(|error| format!("Media payload is not valid base64: {error}"))?;
    if data.len() > MAX_MESH_MEDIA_BYTES {
        return Err(
            "Nearby chat attachments are limited to 512 KiB; use Lightning Transfer for larger files."
                .into(),
        );
    }
    let frames = state
        .chat_mesh
        .lock()
        .await
        .media_frames(peer, file_name, mime_type, data, voice)?;
    send_mesh_frames(&frames)
}

/// Creates a creator-signed private group and securely invites its members.
#[tauri::command]
pub async fn create_chat_mesh_group(
    state: State<'_, AppState>,
    name: String,
    member_ids: Vec<String>,
) -> Result<MeshGroup, String> {
    let member_ids = member_ids
        .iter()
        .map(|value| decode_hex_array::<8>(value, "mesh peer ID"))
        .collect::<Result<Vec<_>, _>>()?;
    let (group, frames) = state
        .chat_mesh
        .lock()
        .await
        .create_group(name, &member_ids)?;
    send_mesh_frames(&frames)?;
    Ok(group)
}

/// Encrypts, signs, and broadcasts a private-group message.
#[tauri::command]
pub async fn send_chat_mesh_group_message(
    state: State<'_, AppState>,
    group_id: String,
    body: String,
    message_id: String,
) -> Result<MeshChatEvent, String> {
    let group_id = decode_hex_array::<16>(&group_id, "mesh group ID")?;
    let (event, frames) = state
        .chat_mesh
        .lock()
        .await
        .group_message_frames(group_id, body, message_id)?;
    send_mesh_frames(&frames)?;
    Ok(event)
}

#[derive(Debug, Serialize)]
pub struct ChatTrustQr {
    pub url: String,
    pub svg: String,
}

/// Creates a fresh signed QR identity proof and renders it as SVG.
#[tauri::command]
pub async fn render_chat_trust_qr(
    state: State<'_, AppState>,
    nickname: String,
    npub: Option<String>,
) -> Result<ChatTrustQr, String> {
    let url = state.chat_mesh.lock().await.trust_url(nickname, npub)?;
    let code = QrCode::new(url.as_bytes()).map_err(|error| error.to_string())?;
    let svg = code
        .render::<svg::Color<'_>>()
        .min_dimensions(280, 280)
        .dark_color(svg::Color("#07101B"))
        .light_color(svg::Color("#FFFFFF"))
        .build();
    Ok(ChatTrustQr { url, svg })
}

/// Verifies a scanned QR proof without trusting its embedded public keys.
#[tauri::command]
pub async fn verify_chat_trust_qr(
    state: State<'_, AppState>,
    value: String,
) -> Result<MeshPeer, String> {
    state.chat_mesh.lock().await.verify_trust_url(&value)
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

fn decode_hex_array<const N: usize>(value: &str, label: &str) -> Result<[u8; N], String> {
    hex::decode(value)
        .map_err(|error| format!("Invalid {label}: {error}"))?
        .try_into()
        .map_err(|_| format!("{label} must contain exactly {N} bytes"))
}

fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |value| {
            u64::try_from(value.as_millis()).unwrap_or(u64::MAX)
        })
}

#[cfg(windows)]
fn send_mesh_frames(frames: &[Vec<u8>]) -> Result<(), String> {
    for frame in frames {
        crate::proximity::chat_ble::send_packet(frame)?;
    }
    Ok(())
}

#[cfg(target_os = "android")]
fn send_mesh_frames(frames: &[Vec<u8>]) -> Result<(), String> {
    for frame in frames {
        if !super::mobile::android::chat_mesh_send(frame)? {
            return Err("The Android Bluetooth chat transport is not active.".into());
        }
    }
    Ok(())
}

#[cfg(not(any(windows, target_os = "android")))]
fn send_mesh_frames(_frames: &[Vec<u8>]) -> Result<(), String> {
    Err("The native Bluetooth chat mesh is available on Windows and Android.".into())
}
