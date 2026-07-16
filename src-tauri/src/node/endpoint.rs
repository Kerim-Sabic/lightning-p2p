//! iroh endpoint and iroh-blobs protocol setup (iroh 1.0 line).
//!
//! Boots the iroh QUIC endpoint with n0 discovery plus LAN mDNS address
//! lookup, and wires up the iroh-blobs 0.103 protocol + persistent store for
//! content-addressed transfers.

use super::status::NodeRuntimeStatus;
use super::NearbyShareProtocol;
use crate::crypto::load_or_create_secret_key;
use crate::error::{LightningP2PError, Result};
use crate::storage::db::StorageDb;
use crate::transfer::metrics::RouteKind;
use crate::transfer::mode::{CongestionAlgorithm, TransferProfile};
use crate::transfer::TransferMode;
use iroh::address_lookup::memory::MemoryLookup;
use iroh::endpoint::{
    ControllerFactory, MtuDiscoveryConfig, QuicTransportConfig, VarInt,
};
use iroh::protocol::Router;
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayMap, RelayMode, RelayUrl, TransportAddr};
use iroh_blobs::api::Store;
use iroh_blobs::store::fs::FsStore;
use iroh_blobs::BlobsProtocol;
#[cfg(not(target_os = "ios"))]
use iroh_mdns_address_lookup::MdnsAddressLookup;
use noq_proto::congestion::{Bbr3Config, CubicConfig};
#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
use socket2::{Domain, Protocol, Socket, Type};
use std::net::SocketAddr;
#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
use std::net::{Ipv4Addr, SocketAddrV4};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

const ONLINE_WAIT_TIMEOUT: Duration = Duration::from_secs(6);
const DB_FILE_NAME: &str = "lightning-p2p.db";
const DEPRECATED_DB_FILE_NAME: &str = "fastdrop.db";
#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
const MDNS_MULTICAST_ADDR: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 251);
#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
const MDNS_PORT: u16 = 5353;

/// The running iroh node with blob transfer capability.
pub struct LightningP2PNode {
    endpoint: Endpoint,
    /// Persistent iroh-blobs store. Derefs to [`iroh_blobs::api::Store`].
    store: FsStore,
    router: Router,
    /// Out-of-band address lookup used to teach the endpoint how to reach the
    /// peers named in a received ticket (relay + direct addresses).
    lookup: MemoryLookup,
    /// LAN mDNS address lookup, subscribed by the nearby-discovery loop.
    /// `None` on platforms without mDNS (iOS).
    mdns: Option<iroh_mdns_address_lookup::MdnsAddressLookup>,
    /// Shared flag toggled by the LAN discovery loop when the subscription is live.
    lan_discovery_active: Arc<AtomicBool>,
    /// Local sled database.
    db: StorageDb,
}

impl LightningP2PNode {
    /// Starts the iroh node using explicit directories.
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

        let lookup = MemoryLookup::new();
        let endpoint = bind_endpoint(relay_url, &data_dir, profile, &lookup).await?;
        let mdns = setup_mdns(&endpoint);
        tracing::info!(
            endpoint_id = %endpoint.id(),
            local_network_discovery = local_network_discovery_label(),
            "iroh endpoint bound (n0-discovery + mDNS)"
        );

        let store = load_blob_store(&data_dir).await?;
        let blobs = BlobsProtocol::new(&store, None);
        let mut router_builder =
            Router::builder(endpoint.clone()).accept(iroh_blobs::ALPN, blobs);
        if let Some(protocol) = nearby_protocol {
            router_builder =
                router_builder.accept(super::nearby_protocol::NEARBY_PROTOCOL_ALPN, protocol);
        }
        let router = router_builder.spawn();
        let db = open_storage_db(&data_dir)?;

        Ok(Self {
            endpoint,
            store,
            router,
            lookup,
            mdns,
            lan_discovery_active: Arc::new(AtomicBool::new(false)),
            db,
        })
    }

    /// Teaches the endpoint how to reach the given peers (relay + direct
    /// addresses from a received ticket), so the downloader can dial them.
    pub fn register_ticket_addrs(&self, addrs: impl IntoIterator<Item = EndpointAddr>) {
        for addr in addrs {
            self.lookup.add_endpoint_info(addr);
        }
    }

    /// Returns a clone of the LAN mDNS address lookup for the discovery loop
    /// to subscribe to, if mDNS is available on this platform.
    #[must_use]
    pub fn mdns_lookup(&self) -> Option<iroh_mdns_address_lookup::MdnsAddressLookup> {
        self.mdns.clone()
    }

    /// Returns the shared LAN-discovery activity flag.
    #[must_use]
    pub fn lan_discovery_flag(&self) -> Arc<AtomicBool> {
        self.lan_discovery_active.clone()
    }

    /// Returns this node's unique `EndpointId`.
    #[must_use]
    pub fn node_id(&self) -> EndpointId {
        self.endpoint.id()
    }

    /// Returns a reachable `EndpointAddr` suitable for share tickets.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError` if no route is ready in time.
    pub async fn ticket_addr(&self) -> Result<EndpointAddr> {
        let _ = tokio::time::timeout(ONLINE_WAIT_TIMEOUT, self.endpoint.online()).await;
        let addr = self.endpoint.addr();
        if addr.addrs.is_empty() {
            return Err(LightningP2PError::Other(
                "No peer route is ready yet. Keep the app open and try again in a moment.".into(),
            ));
        }
        Ok(addr)
    }

    /// Returns a snapshot of the node's current reachability status.
    #[must_use]
    pub fn runtime_status(&self) -> NodeRuntimeStatus {
        let addr = self.endpoint.addr();
        let relay_url = addr
            .addrs
            .iter()
            .find_map(|a| match a {
                TransportAddr::Relay(url) => Some(url.to_string()),
                _ => None,
            });
        let direct_address_count = addr
            .addrs
            .iter()
            .filter(|a| a.is_ip())
            .count();
        let lan_discovery_active = self.lan_discovery_active.load(Ordering::Relaxed);

        NodeRuntimeStatus::from_network(
            self.node_id().to_string(),
            relay_url,
            direct_address_count,
            lan_discovery_active,
        )
    }

    /// Returns the best-known route kind for a remote peer.
    ///
    /// iroh 1.0 uses multipath connections without a stable per-remote
    /// direct/relay classification, so this returns `Unknown` and callers fall
    /// back to inferring the route from the ticket's provider addresses.
    #[must_use]
    pub fn route_kind(&self, _endpoint_id: EndpointId) -> RouteKind {
        RouteKind::Unknown
    }

    /// Returns a reference to the iroh endpoint.
    #[must_use]
    pub fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }

    /// Returns the iroh-blobs store handle used for local blob operations.
    #[must_use]
    pub fn blobs_client(&self) -> &Store {
        &self.store
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
            .map_err(|error| LightningP2PError::Network(error.into()))
    }
}

async fn bind_endpoint(
    relay_url: Option<RelayUrl>,
    data_dir: &Path,
    profile: TransferProfile,
    lookup: &MemoryLookup,
) -> Result<Endpoint> {
    let secret_key = load_or_create_secret_key(data_dir)?;

    let mut builder = Endpoint::builder(iroh::endpoint::presets::N0)
        .secret_key(secret_key)
        .address_lookup(lookup.clone())
        .transport_config(tuned_transport_config(profile));

    // Custom relay overrides the n0 default relay mode from the preset.
    if let Some(url) = relay_url {
        builder = builder.relay_mode(RelayMode::Custom(RelayMap::from(url)));
    }

    builder
        .bind()
        .await
        .map_err(|error| LightningP2PError::Network(error.into()))
}

/// Builds a LAN mDNS address lookup and registers it on the bound endpoint,
/// returning a handle the nearby-discovery loop subscribes to. Skipped on iOS
/// pending the multicast entitlement.
#[cfg(not(target_os = "ios"))]
fn setup_mdns(endpoint: &Endpoint) -> Option<MdnsAddressLookup> {
    let mdns = match MdnsAddressLookup::builder().build(endpoint.id()) {
        Ok(mdns) => mdns,
        Err(error) => {
            tracing::warn!(%error, "could not start mDNS LAN discovery");
            return None;
        }
    };
    match endpoint.address_lookup() {
        Ok(services) => {
            services.add(mdns.clone());
            Some(mdns)
        }
        Err(error) => {
            tracing::warn!(%error, "endpoint has no address-lookup registry for mDNS");
            None
        }
    }
}

#[cfg(target_os = "ios")]
fn setup_mdns(_endpoint: &Endpoint) -> Option<iroh_mdns_address_lookup::MdnsAddressLookup> {
    tracing::warn!(
        "local-network discovery disabled on iOS until the multicast entitlement is granted"
    );
    None
}

fn local_network_discovery_label() -> &'static str {
    if cfg!(target_os = "ios") {
        "off-ios-entitlement-required"
    } else {
        "on"
    }
}

/// Best-effort probe that binds a UDP socket on the mDNS port and joins the
/// multicast group, logging a loud warning when it fails.
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

fn tuned_transport_config(profile: TransferProfile) -> QuicTransportConfig {
    let streams = VarInt::from_u32(profile.max_concurrent_streams);
    QuicTransportConfig::builder()
        .keep_alive_interval(profile.keep_alive_interval)
        .max_concurrent_bidi_streams(streams)
        .max_concurrent_uni_streams(streams)
        .send_window(profile.quic_send_window_bytes)
        .receive_window(VarInt::from_u32(profile.quic_recv_window_bytes))
        .stream_receive_window(VarInt::from_u32(profile.quic_stream_recv_window_bytes))
        .congestion_controller_factory(congestion_factory(profile))
        .mtu_discovery_config(Some(mtu_discovery(profile)))
        .build()
}

/// Builds the congestion controller factory for the profile.
fn congestion_factory(profile: TransferProfile) -> Arc<dyn ControllerFactory + Send + Sync> {
    match profile.congestion {
        CongestionAlgorithm::Cubic => {
            let mut cubic = CubicConfig::default();
            cubic.initial_window(profile.initial_congestion_window);
            Arc::new(cubic)
        }
        CongestionAlgorithm::Bbr => {
            let mut bbr = Bbr3Config::default();
            bbr.initial_window(profile.initial_congestion_window);
            Arc::new(bbr)
        }
    }
}

/// MTU discovery bounded by the profile's ceiling.
fn mtu_discovery(profile: TransferProfile) -> MtuDiscoveryConfig {
    let mut mtud = MtuDiscoveryConfig::default();
    mtud.upper_bound(profile.mtu_upper_bound);
    mtud
}

async fn load_blob_store(data_dir: &Path) -> Result<FsStore> {
    FsStore::load(data_dir.join("blobs"))
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
    fn transport_config_builds_for_every_mode() {
        for mode in [
            TransferMode::Standard,
            TransferMode::Fast,
            TransferMode::Extreme,
            TransferMode::LanBeast,
            TransferMode::Warp,
            TransferMode::BatterySafe,
        ] {
            let _config = tuned_transport_config(mode.profile());
        }
    }
}
