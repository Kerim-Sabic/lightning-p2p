//! iroh endpoint and iroh-blobs protocol setup.
//!
//! This module boots the iroh QUIC endpoint with n0 discovery and wires up the
//! iroh-blobs protocol for content-addressed transfers.

use super::status::NodeRuntimeStatus;
use super::NearbyShareProtocol;
use crate::error::{FastDropError, Result};
use crate::storage::db::StorageDb;
use crate::transfer::metrics::RouteKind;
use iroh::endpoint::ConnectionType;
use iroh::endpoint::TransportConfig;
use iroh::protocol::Router;
use iroh::{Endpoint, NodeAddr, NodeId, RelayMap, RelayMode, RelayUrl};
use iroh_blobs::net_protocol::Blobs;
use iroh_blobs::rpc::client::blobs::MemClient;
use iroh_blobs::store::fs::Store as BlobStore;
use socket2::{Domain, Protocol, Socket, Type};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

const RELAY_WAIT_TIMEOUT: Duration = Duration::from_secs(6);
const MAX_CONCURRENT_STREAMS: u32 = 1024;
const CONNECTION_WINDOW_BYTES: u32 = 268_435_456; // 256 MB
const STREAM_WINDOW_BYTES: u32 = 67_108_864; // 64 MB
const MDNS_MULTICAST_ADDR: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 251);
const MDNS_PORT: u16 = 5353;

/// The running iroh node with blob transfer capability.
pub struct FastDropNode {
    endpoint: Endpoint,
    blobs: Blobs<BlobStore>,
    router: Router,
    /// Shared flag toggled by the LAN discovery loop when the subscription is live.
    lan_discovery_active: Arc<AtomicBool>,
    /// Local sled database.
    pub db: StorageDb,
}

impl FastDropNode {
    /// Starts the iroh node using explicit directories.
    ///
    /// This is used by the app and by integration tests that need isolated
    /// in-process nodes.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError` if endpoint binding, storage creation, or
    /// protocol startup fails.
    pub async fn start_with_dirs(data_dir: PathBuf, download_dir: PathBuf) -> Result<Self> {
        let nearby_protocol = Arc::new(NearbyShareProtocol::new(
            super::NearbyShareRegistry::new(false),
        ));
        Self::start_with_dirs_and_relay(data_dir, download_dir, None, nearby_protocol).await
    }

    /// Starts the iroh node with an optional custom relay URL.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError` if endpoint binding, storage creation, or
    /// protocol startup fails.
    pub async fn start_with_dirs_and_relay(
        data_dir: PathBuf,
        download_dir: PathBuf,
        relay_url: Option<RelayUrl>,
        nearby_protocol: Arc<NearbyShareProtocol>,
    ) -> Result<Self> {
        std::fs::create_dir_all(&data_dir)?;
        std::fs::create_dir_all(&download_dir)?;

        probe_mdns_socket();

        let endpoint = bind_endpoint(relay_url).await?;
        tracing::info!(
            node_id = %endpoint.node_id(),
            "iroh endpoint bound (n0-discovery=on, local-network-discovery=on)"
        );

        let blob_store = load_blob_store(&data_dir).await?;
        let blobs = Blobs::builder(blob_store).build(&endpoint);
        let router = Router::builder(endpoint.clone())
            .accept(iroh_blobs::ALPN, blobs.clone())
            .accept(super::nearby_protocol::NEARBY_SHARE_ALPN, nearby_protocol)
            .spawn()
            .await
            .map_err(FastDropError::Network)?;
        let db = StorageDb::open(&data_dir.join("fastdrop.db"))?;

        Ok(Self {
            endpoint,
            blobs,
            router,
            lan_discovery_active: Arc::new(AtomicBool::new(false)),
            db,
        })
    }

    /// Returns the shared LAN-discovery activity flag.
    ///
    /// The flag is flipped to `true` by the nearby-discovery loop once the
    /// local-network discovery subscription is established, and back to `false`
    /// if the stream ends.
    #[must_use]
    pub fn lan_discovery_flag(&self) -> Arc<AtomicBool> {
        self.lan_discovery_active.clone()
    }

    /// Returns this node's unique `NodeId`.
    #[must_use]
    pub fn node_id(&self) -> NodeId {
        self.endpoint.node_id()
    }

    /// Returns a relay-backed `NodeAddr` suitable for share tickets.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError` if direct addresses or the home relay are not
    /// ready in time.
    pub async fn ticket_addr(&self) -> Result<NodeAddr> {
        let direct_addresses = self
            .endpoint
            .direct_addresses()
            .initialized()
            .await
            .map_err(|err| FastDropError::Other(err.to_string()))?;
        let relay_url = wait_for_home_relay(&self.endpoint).await?;
        Ok(NodeAddr::from_parts(
            self.node_id(),
            Some(relay_url),
            direct_addresses.into_iter().map(|addr| addr.addr),
        ))
    }

    /// Returns a snapshot of the node's current reachability status.
    #[must_use]
    pub fn runtime_status(&self) -> NodeRuntimeStatus {
        let relay_url = self
            .endpoint
            .home_relay()
            .get()
            .ok()
            .flatten()
            .map(|url| url.to_string());
        let direct_address_count = self
            .endpoint
            .direct_addresses()
            .get()
            .ok()
            .flatten()
            .map_or(0, |addresses| addresses.len());
        let lan_discovery_active = self.lan_discovery_active.load(Ordering::Relaxed);

        NodeRuntimeStatus::from_network(
            self.node_id().to_string(),
            relay_url,
            direct_address_count,
            lan_discovery_active,
        )
    }

    /// Returns the best-known route kind for a remote peer.
    #[must_use]
    pub fn route_kind(&self, node_id: NodeId) -> RouteKind {
        self.endpoint
            .conn_type(node_id)
            .ok()
            .and_then(|watcher| watcher.get().ok())
            .map_or(RouteKind::Unknown, |connection_type| {
                map_connection_type(&connection_type)
            })
    }

    /// Returns a reference to the iroh endpoint.
    #[must_use]
    pub fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }

    /// Returns a reference to the blobs protocol handle.
    #[must_use]
    pub fn blobs(&self) -> &Blobs<BlobStore> {
        &self.blobs
    }

    /// Returns the RPC-style blobs client used for local store operations.
    #[must_use]
    pub fn blobs_client(&self) -> &MemClient {
        self.blobs.client()
    }

    /// Shuts the node down cleanly.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError` if the iroh router shutdown fails.
    pub async fn shutdown(&self) -> Result<()> {
        self.router.shutdown().await.map_err(FastDropError::Network)
    }
}

async fn bind_endpoint(relay_url: Option<RelayUrl>) -> Result<Endpoint> {
    let relay_mode = relay_url
        .map(RelayMap::from_url)
        .map_or(RelayMode::Default, RelayMode::Custom);

    Endpoint::builder()
        .discovery_n0()
        .discovery_local_network()
        .relay_mode(relay_mode)
        .transport_config(tuned_transport_config())
        .bind()
        .await
        .map_err(FastDropError::Network)
}

/// Best-effort probe that binds a UDP socket on the mDNS port and joins the
/// multicast group. If this fails (commonly: Windows Firewall, another mDNS
/// responder, or insufficient privileges), LAN discovery will silently stop
/// working — so we log a loud warning that explains exactly what to fix.
fn probe_mdns_socket() {
    let socket = match Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP)) {
        Ok(socket) => socket,
        Err(error) => {
            tracing::warn!(
                error = %error,
                "mDNS probe: could not create UDP socket — LAN discovery may be unavailable"
            );
            return;
        }
    };

    if let Err(error) = socket.set_reuse_address(true) {
        tracing::warn!(error = %error, "mDNS probe: SO_REUSEADDR failed");
    }

    let addr: SocketAddr = SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, MDNS_PORT).into();
    if let Err(error) = socket.bind(&addr.into()) {
        tracing::warn!(
            error = %error,
            port = MDNS_PORT,
            "mDNS probe: bind failed — LAN peer discovery will not work. \
             On Windows this usually means the firewall is blocking the app; \
             add an inbound/outbound rule for the Lightning P2P executable, \
             or ensure no other process is holding UDP {}.",
            MDNS_PORT,
        );
        return;
    }

    if let Err(error) = socket.join_multicast_v4(&MDNS_MULTICAST_ADDR, &Ipv4Addr::UNSPECIFIED) {
        tracing::warn!(
            error = %error,
            group = %MDNS_MULTICAST_ADDR,
            "mDNS probe: multicast group join failed — LAN discovery may be degraded"
        );
        return;
    }

    tracing::info!(
        port = MDNS_PORT,
        group = %MDNS_MULTICAST_ADDR,
        "mDNS probe: OK (multicast join succeeded)"
    );
}

fn tuned_transport_config() -> TransportConfig {
    let mut config = TransportConfig::default();
    config.keep_alive_interval(Some(Duration::from_secs(5)));
    config.max_concurrent_bidi_streams(MAX_CONCURRENT_STREAMS.into());
    config.max_concurrent_uni_streams(MAX_CONCURRENT_STREAMS.into());
    config.send_window(u64::from(CONNECTION_WINDOW_BYTES));
    config.receive_window(CONNECTION_WINDOW_BYTES.into());
    config.stream_receive_window(STREAM_WINDOW_BYTES.into());
    config
}

async fn load_blob_store(data_dir: &std::path::Path) -> Result<BlobStore> {
    BlobStore::load(data_dir.join("blobs"))
        .await
        .map_err(|err| FastDropError::Blob(err.to_string()))
}

async fn wait_for_home_relay(endpoint: &Endpoint) -> Result<iroh::RelayUrl> {
    let mut watcher = endpoint.home_relay();
    tokio::time::timeout(RELAY_WAIT_TIMEOUT, watcher.initialized())
        .await
        .map_err(|_| FastDropError::Other("Home relay not ready yet".into()))?
        .map_err(|err| FastDropError::Other(err.to_string()))
}

fn map_connection_type(connection_type: &ConnectionType) -> RouteKind {
    match connection_type {
        ConnectionType::Direct(_) => RouteKind::Direct,
        ConnectionType::Relay(_) => RouteKind::Relay,
        ConnectionType::Mixed(_, _) | ConnectionType::None => RouteKind::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::settings::default_download_dir;

    #[test]
    fn default_download_dir_prefers_lightning_p2p_subdirectory() {
        let data_dir = PathBuf::from("C:/tmp/fastdrop-test");
        let path = default_download_dir(&data_dir);
        assert!(path.ends_with("Lightning P2P") || path.ends_with("downloads"));
    }

    #[test]
    fn transport_config_uses_high_bandwidth_windows() {
        let _config = tuned_transport_config();
        assert_eq!(MAX_CONCURRENT_STREAMS, 1024);
        assert_eq!(CONNECTION_WINDOW_BYTES, 268_435_456);
        assert_eq!(STREAM_WINDOW_BYTES, 67_108_864);
    }

    #[test]
    fn connection_type_maps_to_route_kind() {
        let relay_url: RelayUrl = "https://relay.example.com".parse().expect("relay url");
        let direct_addr = "127.0.0.1:4433".parse().expect("direct addr");
        assert_eq!(
            map_connection_type(&ConnectionType::Direct(direct_addr)),
            RouteKind::Direct
        );
        assert_eq!(
            map_connection_type(&ConnectionType::Relay(relay_url.clone())),
            RouteKind::Relay
        );
        assert_eq!(
            map_connection_type(&ConnectionType::Mixed(direct_addr, relay_url)),
            RouteKind::Unknown
        );
    }
}
