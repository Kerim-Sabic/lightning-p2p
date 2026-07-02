//! iroh endpoint and iroh-blobs protocol setup.
//!
//! This module boots the iroh QUIC endpoint with n0 discovery and wires up the
//! iroh-blobs protocol for content-addressed transfers.

use super::status::NodeRuntimeStatus;
use super::NearbyShareProtocol;
use crate::crypto::load_or_create_secret_key;
use crate::error::{LightningP2PError, Result};
use crate::storage::db::StorageDb;
use crate::transfer::metrics::RouteKind;
use crate::transfer::mode::{CongestionAlgorithm, TransferProfile};
use crate::transfer::TransferMode;
use iroh::endpoint::ConnectionType;
use iroh::endpoint::{ControllerFactory, MtuDiscoveryConfig, TransportConfig};
use iroh_quinn_proto::congestion::{BbrConfig, CubicConfig};
use iroh::protocol::Router;
use iroh::{Endpoint, NodeAddr, NodeId, RelayMap, RelayMode, RelayUrl};
use iroh_blobs::net_protocol::Blobs;
use iroh_blobs::rpc::client::blobs::MemClient;
use iroh_blobs::store::fs::Store as BlobStore;
#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
use socket2::{Domain, Protocol, Socket, Type};
use std::net::SocketAddr;
#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
use std::net::{Ipv4Addr, SocketAddrV4};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

const RELAY_WAIT_TIMEOUT: Duration = Duration::from_secs(6);
const DB_FILE_NAME: &str = "lightning-p2p.db";
const DEPRECATED_DB_FILE_NAME: &str = "fastdrop.db";
#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
const MDNS_MULTICAST_ADDR: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 251);
#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
const MDNS_PORT: u16 = 5353;

/// The running iroh node with blob transfer capability.
pub struct LightningP2PNode {
    endpoint: Endpoint,
    blobs: Blobs<BlobStore>,
    router: Router,
    /// Shared flag toggled by the LAN discovery loop when the subscription is live.
    lan_discovery_active: Arc<AtomicBool>,
    /// Local sled database.
    db: StorageDb,
}

impl LightningP2PNode {
    /// Starts the iroh node using explicit directories.
    ///
    /// Used by integration tests and benches that need isolated in-process
    /// nodes without a full Tauri runtime. No nearby protocol is registered in
    /// this variant since it requires a `tauri::AppHandle` for event emission.
    /// Uses the platform-default [`TransferProfile`] for QUIC transport tuning.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if endpoint binding, storage creation, or
    /// protocol startup fails.
    pub async fn start_with_dirs(data_dir: PathBuf, download_dir: PathBuf) -> Result<Self> {
        Self::start_with_dirs_and_relay(
            data_dir,
            download_dir,
            None,
            None,
            TransferMode::platform_default().profile(),
        )
        .await
    }

    /// Starts the iroh node with an optional custom relay URL.
    ///
    /// When `nearby_protocol` is `Some`, the nearby ALPN is registered on the
    /// router so peers can probe identity, list shares, and push offers.
    ///
    /// The provided [`TransferProfile`] supplies the QUIC transport tuning
    /// (windows, stream caps, keepalive) baked at endpoint bind time. Changing
    /// the mode after startup requires a node restart via the Supervisor.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if endpoint binding, storage creation, or
    /// protocol startup fails.
    pub async fn start_with_dirs_and_relay(
        data_dir: PathBuf,
        download_dir: PathBuf,
        relay_url: Option<RelayUrl>,
        nearby_protocol: Option<Arc<NearbyShareProtocol>>,
        profile: TransferProfile,
    ) -> Result<Self> {
        std::fs::create_dir_all(&data_dir)?;
        std::fs::create_dir_all(&download_dir)?;

        probe_mdns_socket();

        let endpoint = bind_endpoint(relay_url, &data_dir, profile).await?;
        tracing::info!(
            node_id = %endpoint.node_id(),
            local_network_discovery = local_network_discovery_label(),
            "iroh endpoint bound (n0-discovery=on)"
        );

        let blob_store = load_blob_store(&data_dir).await?;
        let blobs = Blobs::builder(blob_store).build(&endpoint);
        let mut router_builder =
            Router::builder(endpoint.clone()).accept(iroh_blobs::ALPN, blobs.clone());
        if let Some(protocol) = nearby_protocol {
            router_builder =
                router_builder.accept(super::nearby_protocol::NEARBY_PROTOCOL_ALPN, protocol);
        }
        let router = router_builder.spawn();
        let db = open_storage_db(&data_dir)?;

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

    /// Returns a reachable `NodeAddr` suitable for share tickets.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if neither direct addresses nor a home relay
    /// are ready in time.
    pub async fn ticket_addr(&self) -> Result<NodeAddr> {
        let direct_addresses = wait_for_ticket_direct_addresses(&self.endpoint).await;
        let relay_url = wait_for_optional_home_relay(&self.endpoint).await;
        if direct_addresses.is_empty() && relay_url.is_none() {
            return Err(LightningP2PError::Other(
                "No peer route is ready yet. Keep the app open and try again in a moment.".into(),
            ));
        }
        Ok(NodeAddr::from_parts(
            self.node_id(),
            relay_url,
            direct_addresses,
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

    /// Returns the local storage database handle.
    #[must_use]
    pub fn db(&self) -> &StorageDb {
        &self.db
    }

    /// Shuts the node down cleanly.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if the iroh router shutdown fails.
    pub async fn shutdown(&self) -> Result<()> {
        self.router
            .shutdown()
            .await
            .map_err(LightningP2PError::Network)
    }
}

async fn bind_endpoint(
    relay_url: Option<RelayUrl>,
    data_dir: &Path,
    profile: TransferProfile,
) -> Result<Endpoint> {
    let relay_mode = relay_url
        .map(RelayMap::from)
        .map_or(RelayMode::Default, RelayMode::Custom);
    let secret_key = load_or_create_secret_key(data_dir)?;

    let builder = Endpoint::builder().secret_key(secret_key).discovery_n0();

    #[cfg(not(target_os = "ios"))]
    let builder = builder.discovery_local_network();

    #[cfg(target_os = "ios")]
    tracing::warn!(
        "local-network discovery disabled on iOS until the multicast entitlement is granted"
    );

    builder
        .relay_mode(relay_mode)
        .transport_config(tuned_transport_config(profile))
        .bind()
        .await
        .map_err(LightningP2PError::Network)
}

fn local_network_discovery_label() -> &'static str {
    if cfg!(target_os = "ios") {
        "off-ios-entitlement-required"
    } else {
        "on"
    }
}

/// Best-effort probe that binds a UDP socket on the mDNS port and joins the
/// multicast group. If this fails (commonly: Windows Firewall, another mDNS
/// responder, or insufficient privileges), LAN discovery will silently stop
/// working — so we log a loud warning that explains exactly what to fix.
#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
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

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn probe_mdns_socket() {
    tracing::debug!("mDNS socket probe skipped on mobile");
}

fn tuned_transport_config(profile: TransferProfile) -> TransportConfig {
    let mut config = TransportConfig::default();
    config.keep_alive_interval(Some(profile.keep_alive_interval));
    config.max_concurrent_bidi_streams(profile.max_concurrent_streams.into());
    config.max_concurrent_uni_streams(profile.max_concurrent_streams.into());
    config.send_window(profile.quic_send_window_bytes);
    config.receive_window(profile.quic_recv_window_bytes.into());
    config.stream_receive_window(profile.quic_stream_recv_window_bytes.into());
    config.congestion_controller_factory(congestion_factory(profile));
    config.mtu_discovery_config(Some(mtu_discovery(profile)));
    config
}

/// Builds the congestion controller factory for the profile. BBR keeps the
/// pipe full through stray loss on real networks; CUBIC remains for the
/// conservative tiers (see `transfer::mode` honesty note for the evidence).
fn congestion_factory(profile: TransferProfile) -> Arc<dyn ControllerFactory + Send + Sync> {
    match profile.congestion {
        CongestionAlgorithm::Cubic => {
            let mut cubic = CubicConfig::default();
            cubic.initial_window(profile.initial_congestion_window);
            Arc::new(cubic)
        }
        CongestionAlgorithm::Bbr => {
            let mut bbr = BbrConfig::default();
            bbr.initial_window(profile.initial_congestion_window);
            Arc::new(bbr)
        }
    }
}

/// MTU discovery bounded by the profile's ceiling. quinn binary-searches the
/// path MTU and black-hole detection recovers if the network drops large
/// datagrams, so probing beyond the 1452-byte default is safe.
fn mtu_discovery(profile: TransferProfile) -> MtuDiscoveryConfig {
    let mut mtud = MtuDiscoveryConfig::default();
    mtud.upper_bound(profile.mtu_upper_bound);
    mtud
}

async fn load_blob_store(data_dir: &std::path::Path) -> Result<BlobStore> {
    BlobStore::load(data_dir.join("blobs"))
        .await
        .map_err(|err| LightningP2PError::Blob(err.to_string()))
}

fn open_storage_db(data_dir: &Path) -> Result<StorageDb> {
    let db_path = data_dir.join(DB_FILE_NAME);
    let deprecated_db_path = data_dir.join(DEPRECATED_DB_FILE_NAME);

    if deprecated_db_path.exists() && !db_path.exists() {
        std::fs::rename(&deprecated_db_path, &db_path)?;
    }

    StorageDb::open(&db_path)
}

async fn wait_for_ticket_direct_addresses(endpoint: &Endpoint) -> Vec<SocketAddr> {
    let mut watcher = endpoint.direct_addresses();
    match tokio::time::timeout(RELAY_WAIT_TIMEOUT, watcher.initialized()).await {
        Ok(Ok(addresses)) => addresses.into_iter().map(|addr| addr.addr).collect(),
        Ok(Err(error)) => {
            tracing::debug!(error = %error, "direct addresses not ready for ticket");
            Vec::new()
        }
        Err(_) => {
            tracing::debug!("timed out waiting for direct addresses for ticket");
            Vec::new()
        }
    }
}

async fn wait_for_optional_home_relay(endpoint: &Endpoint) -> Option<iroh::RelayUrl> {
    let mut watcher = endpoint.home_relay();
    match tokio::time::timeout(RELAY_WAIT_TIMEOUT, watcher.initialized()).await {
        Ok(Ok(relay_url)) => Some(relay_url),
        Ok(Err(error)) => {
            tracing::debug!(error = %error, "home relay not ready for ticket");
            None
        }
        Err(_) => {
            tracing::debug!("timed out waiting for home relay for ticket");
            None
        }
    }
}

fn map_connection_type(connection_type: &ConnectionType) -> RouteKind {
    match connection_type {
        ConnectionType::Direct(_) => RouteKind::Direct,
        ConnectionType::Relay(_) => RouteKind::Relay,
        ConnectionType::Mixed(_, _) => RouteKind::Mixed,
        ConnectionType::None => RouteKind::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::settings::default_download_dir;

    #[test]
    fn default_download_dir_prefers_lightning_p2p_subdirectory() {
        let data_dir = PathBuf::from("C:/tmp/lightning-p2p-test");
        let path = default_download_dir(&data_dir);
        assert!(path.ends_with("Lightning P2P") || path.ends_with("downloads"));
    }

    #[test]
    fn storage_db_migrates_from_deprecated_fastdrop_name() {
        let root = tempfile::tempdir().expect("tempdir");
        let old_db = root.path().join(DEPRECATED_DB_FILE_NAME);
        let new_db = root.path().join(DB_FILE_NAME);
        std::fs::create_dir(&old_db).expect("old db dir");

        let _db = open_storage_db(root.path()).expect("db opens");

        assert!(new_db.exists());
        assert!(!old_db.exists());
    }

    #[test]
    fn transport_config_for_standard_uses_high_bandwidth_windows() {
        // Sanity-check that Standard mode keeps the historical pre-v0.5.1 tuning
        // so existing deployments observe no behavior change after upgrade.
        let standard = TransferMode::Standard.profile();
        assert_eq!(standard.quic_recv_window_bytes, 268_435_456); // 256 MB
        assert_eq!(standard.quic_stream_recv_window_bytes, 67_108_864); // 64 MB
        assert_eq!(standard.max_concurrent_streams, 1024);

        // tuned_transport_config builds with these values without panicking.
        let _config = tuned_transport_config(standard);
    }

    #[test]
    fn transport_config_builds_for_every_mode() {
        for mode in [
            TransferMode::Standard,
            TransferMode::Fast,
            TransferMode::Extreme,
            TransferMode::LanBeast,
            TransferMode::Warp,
            TransferMode::BatterySafe,
        ] {
            // Exercises window/stream VarInt conversions, the congestion
            // factory, and MTU discovery bounds for each tier.
            let _config = tuned_transport_config(mode.profile());
        }
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
            RouteKind::Mixed
        );
    }
}
