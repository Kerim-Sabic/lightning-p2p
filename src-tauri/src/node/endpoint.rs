//! iroh endpoint and iroh-blobs protocol setup (iroh 1.0 line).
//!
//! Boots the iroh QUIC endpoint with n0 discovery plus LAN mDNS address
//! lookup, and wires up the iroh-blobs 0.103 protocol + persistent store for
//! content-addressed transfers.

use super::blob_access::{AuthorizedBlobsProtocol, BlobAccessController};
use super::chat_protocol::ChatProtocol;
use super::status::NodeRuntimeStatus;
use super::NearbyShareProtocol;
use crate::crypto::load_or_create_secret_key;
use crate::error::{LightningP2PError, Result};
use crate::storage::db::StorageDb;
use crate::storage::share_access;
use crate::transfer::metrics::RouteKind;
use crate::transfer::mode::{CongestionAlgorithm, TransferProfile};
use crate::transfer::TransferMode;
use iroh::address_lookup::memory::MemoryLookup;
use iroh::endpoint::{ControllerFactory, MtuDiscoveryConfig, QuicTransportConfig, VarInt};
use iroh::protocol::Router;
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayMap, RelayMode, RelayUrl, TransportAddr};
use iroh_blobs::api::Store;
use iroh_blobs::format::collection::Collection;
use iroh_blobs::hashseq::HashSeq;
use iroh_blobs::store::fs::FsStore;
use iroh_blobs::Hash;
#[cfg(not(target_os = "ios"))]
use iroh_mdns_address_lookup::MdnsAddressLookup;
use noq_proto::congestion::{Bbr3Config, CubicConfig};
#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
use socket2::{Domain, Protocol, Socket, Type};
#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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
    blob_access: BlobAccessController,
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
        chat_protocol: Option<Arc<ChatProtocol>>,
        profile: TransferProfile,
    ) -> Result<Self> {
        std::fs::create_dir_all(&data_dir)?;
        std::fs::create_dir_all(&download_dir)?;

        // Finish local storage initialization before binding network resources.
        // Besides making startup ordering clearer, this prevents a slow or
        // incompatible transfer store from leaving a partially started QUIC
        // endpoint behind while the supervisor is waiting on storage.
        tracing::info!("opening local blob store");
        preserve_incompatible_blob_store(&data_dir)?;
        let store = load_blob_store(&data_dir).await?;
        tracing::info!("local blob store ready");
        let db = open_storage_db(&data_dir)?;
        tracing::info!("local metadata database ready");
        let public_hashes = share_access::load_public_hashes(&db)?;
        tracing::info!(
            public_hash_count = public_hashes.len(),
            "loaded share access metadata"
        );
        let blob_access = BlobAccessController::with_public_hashes(public_hashes);

        probe_mdns_socket();
        let lookup = MemoryLookup::new();
        let endpoint = bind_endpoint(relay_url, &data_dir, profile, &lookup).await?;
        let mdns = setup_mdns(&endpoint);
        tracing::info!(
            endpoint_id = %endpoint.id(),
            local_network_discovery = local_network_discovery_label(),
            "iroh endpoint bound (n0-discovery + mDNS)"
        );

        let blobs = AuthorizedBlobsProtocol::new(store.as_ref(), blob_access.clone());
        let mut router_builder = Router::builder(endpoint.clone()).accept(iroh_blobs::ALPN, blobs);
        if let Some(protocol) = nearby_protocol {
            router_builder =
                router_builder.accept(super::nearby_protocol::NEARBY_PROTOCOL_ALPN, protocol);
        }
        if let Some(protocol) = chat_protocol {
            router_builder =
                router_builder.accept(super::chat_protocol::CHAT_PROTOCOL_ALPN, protocol);
        }
        tracing::info!("starting transfer protocol router");
        let router = router_builder.spawn();
        Ok(Self {
            endpoint,
            store,
            router,
            lookup,
            mdns,
            lan_discovery_active: Arc::new(AtomicBool::new(false)),
            db,
            blob_access,
        })
    }

    /// Teaches the endpoint how to reach the given peers (relay + direct
    /// addresses from a received ticket), so the downloader can dial them.
    pub fn register_ticket_addrs(&self, addrs: impl IntoIterator<Item = EndpointAddr>) {
        for addr in addrs {
            self.lookup.add_endpoint_info(addr);
        }
    }

    /// Grants a bearer ticket to a share the user explicitly published.
    pub(crate) async fn authorize_public_share(&self, root: Hash) -> Result<()> {
        let hashes = self.share_hashes(root).await?;
        if !self.blob_access.can_publish_public(&hashes) {
            return Err(LightningP2PError::Other(
                "Too many public shares are active on this device. Clear old app data before sharing more.".into(),
            ));
        }
        share_access::authorize_public_hashes(&self.db, &hashes)?;
        if !self.blob_access.publish_public(&hashes) {
            return Err(LightningP2PError::Other(
                "Too many public shares are active on this device.".into(),
            ));
        }
        Ok(())
    }

    /// Grants a nearby receiver temporary access to an accepted share.
    pub(crate) async fn authorize_private_peer(&self, peer: EndpointId, root: Hash) -> Result<()> {
        let hashes = self.share_hashes(root).await?;
        if !self.blob_access.authorize_peer(peer, &hashes) {
            return Err(LightningP2PError::Other(
                "Too many nearby transfers are pending. Try again shortly.".into(),
            ));
        }
        Ok(())
    }

    pub(crate) async fn revoke_private_peer(&self, peer: EndpointId, root: Hash) {
        if let Ok(hashes) = self.share_hashes(root).await {
            self.blob_access.revoke_peer(peer, &hashes);
        }
    }

    async fn share_hashes(&self, root: Hash) -> Result<Vec<Hash>> {
        Collection::load(root, self.blobs_client())
            .await
            .map_err(|error| LightningP2PError::Blob(error.to_string()))?;
        let root_bytes = self
            .blobs_client()
            .blobs()
            .get_bytes(root)
            .await
            .map_err(|error| LightningP2PError::Blob(error.to_string()))?;
        let links = HashSeq::try_from(root_bytes)
            .map_err(|error| LightningP2PError::Blob(error.to_string()))?;
        Ok(hashes_for_collection(root, links))
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
        let relay_url = addr.addrs.iter().find_map(|a| match a {
            TransportAddr::Relay(url) => Some(url.to_string()),
            _ => None,
        });
        let direct_address_count = addr.addrs.iter().filter(|a| a.is_ip()).count();
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

fn hashes_for_collection(root: Hash, links: impl IntoIterator<Item = Hash>) -> Vec<Hash> {
    let mut hashes = Vec::new();
    hashes.push(root);
    // HashSeq includes the CollectionMeta blob first, followed by each file.
    // Both are needed by remote receivers to enumerate and fetch the share.
    hashes.extend(links);
    hashes.sort_unstable();
    hashes.dedup();
    hashes
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
        Err(_error) => {
            tracing::warn!("could not start mDNS LAN discovery");
            return None;
        }
    };
    match endpoint.address_lookup() {
        Ok(services) => {
            services.add(mdns.clone());
            Some(mdns)
        }
        Err(_error) => {
            tracing::warn!("endpoint has no address-lookup registry for mDNS");
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
        Err(_error) => {
            tracing::warn!(
                "mDNS probe: could not create UDP socket — LAN discovery may be unavailable"
            );
            return;
        }
    };

    if let Err(_error) = socket.set_reuse_address(true) {
        tracing::warn!("mDNS probe: SO_REUSEADDR failed");
    }

    let addr: SocketAddr = SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, MDNS_PORT).into();
    if let Err(_error) = socket.bind(&addr.into()) {
        tracing::warn!(
            port = MDNS_PORT,
            "mDNS probe: bind failed — LAN peer discovery will not work. \
             On Windows this usually means the firewall is blocking the app; \
             add an inbound/outbound rule for the Lightning P2P executable, \
             or ensure no other process is holding UDP {}.",
            MDNS_PORT,
        );
        return;
    }

    if let Err(_error) = socket.join_multicast_v4(&MDNS_MULTICAST_ADDR, &Ipv4Addr::UNSPECIFIED) {
        tracing::warn!("mDNS probe: multicast group join failed — LAN discovery may be degraded");
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

/// Keeps an older iroh-blobs database intact when the current redb version
/// cannot open it, then lets the node create a fresh store for new transfers.
fn preserve_incompatible_blob_store(data_dir: &Path) -> Result<()> {
    let store_dir = data_dir.join("blobs");
    let database_path = store_dir.join("blobs.db");
    if !database_path.exists() {
        return Ok(());
    }

    match redb::Database::open(&database_path) {
        Ok(database) => drop(database),
        Err(redb::DatabaseError::UpgradeRequired(version)) => {
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |duration| duration.as_secs());
            let backup_stem = format!("blobs-legacy-redb-v{version}-{timestamp}");
            let mut backup_dir = data_dir.join(&backup_stem);
            let mut suffix = 1_u32;
            while backup_dir.exists() {
                backup_dir = data_dir.join(format!("{backup_stem}-{suffix}"));
                suffix += 1;
            }
            std::fs::rename(&store_dir, &backup_dir)?;
            tracing::warn!(
                legacy_version = version,
                backup_path = %backup_dir.display(),
                "preserved incompatible transfer store; a fresh store will be created"
            );
        }
        Err(error) => {
            return Err(LightningP2PError::Blob(format!(
                "Could not inspect the local transfer store: {error}"
            )));
        }
    }
    Ok(())
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
            TransferMode::SmartAuto,
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

    #[test]
    fn collection_authorization_includes_metadata_and_file_links() {
        let root = Hash::from([1; 32]);
        let metadata = Hash::from([2; 32]);
        let file = Hash::from([3; 32]);

        let hashes = hashes_for_collection(root, [metadata, file, metadata]);

        assert_eq!(hashes.len(), 3);
        assert!(hashes.contains(&root));
        assert!(hashes.contains(&metadata));
        assert!(hashes.contains(&file));
    }
}
