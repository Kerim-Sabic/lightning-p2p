//! Direct-message protocol for Lightning P2P chat.
//!
//! Iroh authenticates and encrypts the connection; this protocol carries a
//! deliberately small JSON envelope.  Mesh and Nostr adapters feed the same
//! message model in later layers.

use crate::error::{LightningP2PError, Result};
use iroh::{
    endpoint::Connection,
    protocol::{AcceptError, ProtocolHandler},
    Endpoint, EndpointAddr,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

pub const CHAT_PROTOCOL_ALPN: &[u8] = b"lightning-p2p/chat/1";
const MAX_MESSAGE_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub sender_node_id: String,
    pub sender_name: String,
    pub body: String,
    pub sent_at: u64,
}

#[derive(Debug, Clone)]
pub struct ChatProtocol {
    app_handle: AppHandle,
}

impl ChatProtocol {
    #[must_use]
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

impl ProtocolHandler for ChatProtocol {
    async fn accept(&self, connection: Connection) -> std::result::Result<(), AcceptError> {
        let (_send, mut recv) = connection
            .accept_bi()
            .await
            .map_err(AcceptError::from_err)?;
        let bytes = recv
            .read_to_end(MAX_MESSAGE_BYTES)
            .await
            .map_err(AcceptError::from_err)?;
        let message: ChatMessage = serde_json::from_slice(&bytes).map_err(AcceptError::from_err)?;
        if message.body.trim().is_empty() || message.body.len() > 8_000 {
            return Err(AcceptError::from_err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "invalid chat message",
            )));
        }
        self.app_handle
            .emit("chat-message-received", message)
            .map_err(AcceptError::from_err)?;
        Ok(())
    }
}

/// Sends a single chat envelope over an authenticated iroh connection.
///
/// # Errors
///
/// Returns an error when the connection cannot be opened, the message cannot
/// be serialized, or the remote stream rejects the write.
pub async fn send_message(
    endpoint: &Endpoint,
    addr: EndpointAddr,
    message: &ChatMessage,
) -> Result<()> {
    let connection = endpoint
        .connect(addr, CHAT_PROTOCOL_ALPN)
        .await
        .map_err(|error| LightningP2PError::Other(error.to_string()))?;
    let (mut send, _recv) = connection
        .open_bi()
        .await
        .map_err(|error| LightningP2PError::Other(error.to_string()))?;
    let bytes = serde_json::to_vec(message)?;
    send.write_all(&bytes)
        .await
        .map_err(|error| LightningP2PError::Other(error.to_string()))?;
    send.finish()
        .map_err(|error| LightningP2PError::Other(error.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_message_json_round_trips() {
        let message = ChatMessage {
            id: "message-1".into(),
            sender_node_id: "node-1".into(),
            sender_name: "alice".into(),
            body: "hello".into(),
            sent_at: 1_720_000_000,
        };

        let encoded = serde_json::to_vec(&message).expect("serialize chat message");
        let decoded: ChatMessage =
            serde_json::from_slice(&encoded).expect("deserialize chat message");

        assert_eq!(decoded.id, message.id);
        assert_eq!(decoded.body, message.body);
        assert_eq!(decoded.sent_at, message.sent_at);
    }
}
