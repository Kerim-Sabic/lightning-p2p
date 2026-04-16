//! Lightweight LAN protocol used to query nearby active shares.

use super::nearby::{ActiveShare, NearbyShareRegistry};
use crate::error::{FastDropError, Result};
use anyhow::Result as AnyhowResult;
use iroh::{
    endpoint::Connecting,
    protocol::ProtocolHandler,
    Endpoint, NodeAddr,
};
use iroh_blobs::{BlobFormat, Hash};
use n0_future::boxed::BoxFuture;
use serde::{Deserialize, Serialize};
use std::env;
use std::str::FromStr;

/// ALPN identifier for nearby share discovery on the local network.
pub const NEARBY_SHARE_ALPN: &[u8] = b"lightning-p2p/nearby-share/1";

const MAX_MESSAGE_BYTES: usize = 4 * 1024;
const PROTOCOL_VERSION: u8 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct NearbyShareRequest {
    protocol_version: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct NearbyShareResponse {
    protocol_version: u8,
    device_name: String,
    shares: Vec<RemoteAdvertisedShare>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WireBlobFormat {
    Raw,
    HashSeq,
}

/// Share metadata returned by a nearby peer over the custom ALPN protocol.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct RemoteAdvertisedShare {
    pub hash: String,
    pub label: String,
    pub size: u64,
    pub format: WireBlobFormat,
    pub published_at: u64,
}

/// Parsed nearby-share response envelope returned by a remote peer.
#[derive(Debug, Clone)]
pub(crate) struct RemoteShareEnvelope {
    pub device_name: String,
    pub shares: Vec<RemoteAdvertisedShare>,
}

/// Protocol handler that serves active-share metadata to nearby peers.
#[derive(Debug, Clone)]
pub struct NearbyShareProtocol {
    registry: NearbyShareRegistry,
}

impl NearbyShareProtocol {
    /// Creates a new nearby-share protocol handler.
    #[must_use]
    pub fn new(registry: NearbyShareRegistry) -> Self {
        Self { registry }
    }

    async fn response_bytes(&self, request_bytes: Vec<u8>) -> Result<Vec<u8>> {
        let request: NearbyShareRequest = serde_json::from_slice(&request_bytes)?;
        if request.protocol_version != PROTOCOL_VERSION {
            return Err(FastDropError::Other(
                "Unsupported nearby-share protocol version".into(),
            ));
        }

        let shares = if self.registry.local_discovery_enabled().await {
            self.registry
                .active_share()
                .await
                .into_iter()
                .map(RemoteAdvertisedShare::from)
                .collect()
        } else {
            Vec::new()
        };

        let response = NearbyShareResponse {
            protocol_version: PROTOCOL_VERSION,
            device_name: local_device_name(),
            shares,
        };
        serde_json::to_vec(&response).map_err(FastDropError::from)
    }
}

impl ProtocolHandler for NearbyShareProtocol {
    fn accept(&self, connecting: Connecting) -> BoxFuture<AnyhowResult<()>> {
        let this = self.clone();
        Box::pin(async move {
            let connection = connecting.await?;
            let (mut send, mut recv) = connection.accept_bi().await?;
            let request = recv.read_to_end(MAX_MESSAGE_BYTES).await?;
            let response = this.response_bytes(request).await?;
            send.write_all(&response).await?;
            send.finish()?;
            connection.closed().await;
            Ok(())
        })
    }
}

impl From<ActiveShare> for RemoteAdvertisedShare {
    fn from(share: ActiveShare) -> Self {
        Self {
            hash: share.hash.to_string(),
            label: share.label,
            size: share.total_size,
            format: WireBlobFormat::from(share.format),
            published_at: share.published_at,
        }
    }
}

impl From<BlobFormat> for WireBlobFormat {
    fn from(format: BlobFormat) -> Self {
        match format {
            BlobFormat::Raw => Self::Raw,
            BlobFormat::HashSeq => Self::HashSeq,
        }
    }
}

impl WireBlobFormat {
    fn blob_format(self) -> BlobFormat {
        match self {
            Self::Raw => BlobFormat::Raw,
            Self::HashSeq => BlobFormat::HashSeq,
        }
    }
}

impl RemoteAdvertisedShare {
    pub(crate) fn hash(&self) -> Result<Hash> {
        Hash::from_str(&self.hash).map_err(|error| FastDropError::Blob(error.to_string()))
    }

    pub(crate) fn blob_format(&self) -> BlobFormat {
        self.format.blob_format()
    }
}

/// Queries a nearby peer for active share metadata.
///
/// # Errors
///
/// Returns `FastDropError` if the peer cannot be reached or the response is invalid.
pub(crate) async fn fetch_remote_shares(
    endpoint: &Endpoint,
    node_addr: NodeAddr,
) -> Result<RemoteShareEnvelope> {
    let connection = endpoint
        .connect(node_addr, NEARBY_SHARE_ALPN)
        .await
        .map_err(|error| FastDropError::Other(error.to_string()))?;
    let (mut send, mut recv) = connection
        .open_bi()
        .await
        .map_err(|error| FastDropError::Other(error.to_string()))?;
    let request = serde_json::to_vec(&NearbyShareRequest {
        protocol_version: PROTOCOL_VERSION,
    })?;
    send.write_all(&request)
        .await
        .map_err(|error| FastDropError::Other(error.to_string()))?;
    send.finish()
        .map_err(|error| FastDropError::Other(error.to_string()))?;
    let response = recv
        .read_to_end(MAX_MESSAGE_BYTES)
        .await
        .map_err(|error| FastDropError::Other(error.to_string()))?;
    let parsed: NearbyShareResponse = serde_json::from_slice(&response)?;
    Ok(RemoteShareEnvelope {
        device_name: parsed.device_name,
        shares: parsed.shares,
    })
}

fn local_device_name() -> String {
    [
        env::var("COMPUTERNAME").ok(),
        env::var("HOSTNAME").ok(),
        env::var("USERDOMAIN").ok(),
    ]
    .into_iter()
    .flatten()
    .map(|value| value.trim().to_string())
    .find(|value| !value.is_empty())
    .unwrap_or_else(|| "Nearby device".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::StreamExt;
    use iroh::{protocol::Router, Endpoint};
    use tokio::time::{timeout, Duration};

    #[test]
    fn active_share_round_trips_to_wire_format() {
        let advertised = RemoteAdvertisedShare::from(ActiveShare {
            label: "demo".into(),
            hash: Hash::new(b"demo"),
            format: BlobFormat::HashSeq,
            total_size: 42,
            published_at: 10,
        });

        assert_eq!(advertised.label, "demo");
        assert_eq!(advertised.size, 42);
        assert_eq!(advertised.blob_format(), BlobFormat::HashSeq);
    }

    #[test]
    fn local_device_name_has_fallback() {
        assert!(!local_device_name().trim().is_empty());
    }

    #[tokio::test]
    async fn local_discovery_finds_sender_and_fetches_share_metadata() {
        let receiver_endpoint = Endpoint::builder()
            .discovery_local_network()
            .bind()
            .await
            .expect("receiver endpoint");
        let mut discovery_stream = receiver_endpoint
            .discovery()
            .and_then(iroh::discovery::Discovery::subscribe)
            .expect("discovery stream");

        let sender_registry = NearbyShareRegistry::new(true);
        sender_registry
            .publish_share(ActiveShare {
                label: "demo-share".into(),
                hash: Hash::new(b"demo-share"),
                format: BlobFormat::HashSeq,
                total_size: 128,
                published_at: 42,
            })
            .await;
        let sender_endpoint = Endpoint::builder()
            .discovery_local_network()
            .bind()
            .await
            .expect("sender endpoint");
        let sender_router = Router::builder(sender_endpoint.clone())
            .accept(
                NEARBY_SHARE_ALPN,
                NearbyShareProtocol::new(sender_registry.clone()),
            )
            .spawn()
            .await
            .expect("sender router");

        let sender_addr = timeout(Duration::from_secs(12), async {
            while let Some(item) = discovery_stream.next().await {
                if item.node_addr.node_id == sender_endpoint.node_id() {
                    return item.node_addr;
                }
            }
            panic!("discovery stream ended before sender appeared");
        })
        .await
        .expect("sender should be discovered");

        let envelope = timeout(
            Duration::from_secs(12),
            fetch_remote_shares(&receiver_endpoint, sender_addr),
        )
        .await
        .expect("share query should complete")
        .expect("share query should succeed");

        assert_eq!(envelope.shares.len(), 1);
        assert_eq!(envelope.shares[0].label, "demo-share");
        assert_eq!(envelope.shares[0].size, 128);
        assert_eq!(envelope.shares[0].published_at, 42);

        sender_router.shutdown().await.expect("router shutdown");
        sender_endpoint.close().await;
        receiver_endpoint.close().await;
    }
}
