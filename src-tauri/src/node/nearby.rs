//! Nearby-share discovery state and LAN polling.

use super::nearby_protocol::{fetch_remote_shares, RemoteAdvertisedShare};
use crate::error::{FastDropError, Result};
use futures_util::{stream, StreamExt};
use iroh::{
    discovery::{local_swarm_discovery, DiscoveryItem},
    endpoint::{ConnectionType, RemoteInfo, Source},
    Endpoint, NodeAddr, NodeId,
};
use iroh_blobs::{ticket::BlobTicket, BlobFormat, Hash};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use tokio::{
    sync::RwLock,
    time::{Instant, MissedTickBehavior},
};

const DISCOVERED_SHARES_UPDATED_EVENT: &str = "discovered-shares-updated";
const REFRESH_INTERVAL: Duration = Duration::from_secs(4);
const NODE_QUERY_TIMEOUT: Duration = Duration::from_millis(900);
const CANDIDATE_STALE_AFTER: Duration = Duration::from_secs(18);
const MAX_PARALLEL_QUERIES: usize = 8;

/// High-level reachability hint for a nearby share candidate.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NearbyRouteHint {
    /// No reliable route signal is available yet.
    Unknown,
    /// Direct local connectivity is available.
    Direct,
    /// Relay connectivity is available.
    Relay,
    /// Both direct and relay paths are visible.
    Mixed,
}

/// Public nearby-share payload mirrored into the frontend.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NearbyShare {
    /// Stable identifier used to start a receive from the cached descriptor.
    pub share_id: String,
    /// Human-readable name for the sending device.
    pub device_name: String,
    /// Remote iroh node identifier.
    pub node_id: String,
    /// User-visible label of the shared content.
    pub label: String,
    /// Total size of the share in bytes.
    pub size: u64,
    /// Root content hash exposed for debugging and support surfaces.
    pub hash: String,
    /// Route hint for this nearby candidate.
    pub route_hint: NearbyRouteHint,
    /// Known direct addresses currently attached to the candidate node.
    pub direct_address_count: usize,
    /// Seconds since the remote node was last seen on the local network.
    pub freshness_seconds: u64,
    /// Unix timestamp when the sender published the share.
    pub published_at: u64,
}

/// Active local share advertised to nearby peers while sharing is enabled.
#[derive(Debug, Clone)]
pub struct ActiveShare {
    /// User-visible label for the share.
    pub label: String,
    /// Root content hash.
    pub hash: Hash,
    /// Blob format used by the share ticket.
    pub format: BlobFormat,
    /// Total size of the share in bytes.
    pub total_size: u64,
    /// Unix timestamp when the share became active.
    pub published_at: u64,
}

impl ActiveShare {
    /// Creates a new active-share snapshot ready for LAN advertisement.
    #[must_use]
    pub fn new(label: String, hash: Hash, format: BlobFormat, total_size: u64) -> Self {
        Self {
            label,
            hash,
            format,
            total_size,
            published_at: unix_timestamp(),
        }
    }
}

#[derive(Debug, Clone)]
struct NearbyShareRecord {
    public: NearbyShare,
    node_addr: NodeAddr,
    hash: Hash,
    format: BlobFormat,
}

#[derive(Debug, Clone)]
struct RemoteCandidate {
    node_id: NodeId,
    node_addr: NodeAddr,
    route_hint: NearbyRouteHint,
    direct_address_count: usize,
    last_seen_at: Instant,
}

/// In-memory registry for the active local share and discovered nearby shares.
#[derive(Debug, Clone)]
pub struct NearbyShareRegistry {
    local_discovery_enabled: Arc<RwLock<bool>>,
    active_share: Arc<RwLock<Option<ActiveShare>>>,
    discovered_shares: Arc<RwLock<Vec<NearbyShareRecord>>>,
}

impl NearbyShareRegistry {
    /// Creates a new nearby-share registry.
    #[must_use]
    pub fn new(local_discovery_enabled: bool) -> Self {
        Self {
            local_discovery_enabled: Arc::new(RwLock::new(local_discovery_enabled)),
            active_share: Arc::new(RwLock::new(None)),
            discovered_shares: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Returns whether local discovery is enabled.
    pub async fn local_discovery_enabled(&self) -> bool {
        *self.local_discovery_enabled.read().await
    }

    /// Updates whether local discovery is enabled.
    pub async fn set_local_discovery_enabled(&self, enabled: bool) {
        let mut guard = self.local_discovery_enabled.write().await;
        *guard = enabled;
    }

    /// Publishes the current local share for nearby peers.
    pub async fn publish_share(&self, share: ActiveShare) {
        let mut guard = self.active_share.write().await;
        *guard = Some(share);
    }

    /// Clears any currently published local share.
    pub async fn clear_active_share(&self) {
        let mut guard = self.active_share.write().await;
        *guard = None;
    }

    /// Returns the currently published local share, if any.
    pub async fn active_share(&self) -> Option<ActiveShare> {
        self.active_share.read().await.clone()
    }

    /// Returns the current public snapshot of nearby shares.
    pub async fn snapshot(&self) -> Vec<NearbyShare> {
        self.discovered_shares
            .read()
            .await
            .iter()
            .map(|record| record.public.clone())
            .collect()
    }

    /// Clears the discovered-share cache and returns the new public snapshot if it changed.
    pub(crate) async fn clear_discovered_shares(&self) -> Option<Vec<NearbyShare>> {
        self.replace_discovered_shares(Vec::new()).await
    }

    /// Replaces the discovered-share cache and returns the public snapshot if it changed.
    async fn replace_discovered_shares(
        &self,
        shares: Vec<NearbyShareRecord>,
    ) -> Option<Vec<NearbyShare>> {
        let next = normalized_records(shares);
        let next_public = next.iter().map(|record| record.public.clone()).collect::<Vec<_>>();
        let mut guard = self.discovered_shares.write().await;
        let current_public = guard
            .iter()
            .map(|record| record.public.clone())
            .collect::<Vec<_>>();
        if current_public == next_public {
            return None;
        }
        *guard = next;
        Some(next_public)
    }

    /// Reconstructs a `BlobTicket` from a cached nearby share descriptor.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError` if the nearby share is no longer cached.
    pub async fn ticket_for_share(&self, share_id: &str) -> Result<BlobTicket> {
        let guard = self.discovered_shares.read().await;
        let Some(record) = guard.iter().find(|record| record.public.share_id == share_id) else {
            return Err(FastDropError::Other(
                "Nearby share is no longer available. Refresh and try again.".into(),
            ));
        };
        BlobTicket::new(record.node_addr.clone(), record.hash, record.format)
            .map_err(|error| FastDropError::Blob(error.to_string()))
    }
}

/// Starts the background LAN discovery loop for nearby shares.
pub fn spawn_nearby_discovery_loop(
    app_handle: AppHandle,
    endpoint: Endpoint,
    registry: NearbyShareRegistry,
) {
    let discovery_events = endpoint
        .discovery()
        .and_then(iroh::discovery::Discovery::subscribe);
    tauri::async_runtime::spawn(async move {
        let mut candidates = seed_candidates(&endpoint);
        let mut interval = tokio::time::interval(REFRESH_INTERVAL);
        interval.set_missed_tick_behavior(MissedTickBehavior::Delay);

        let mut discovery_events = discovery_events;
        let _ = refresh_nearby_shares(
            &app_handle,
            &endpoint,
            &registry,
            candidates.values().cloned().collect(),
        )
        .await;

        loop {
            if let Some(events) = discovery_events.as_mut() {
                tokio::select! {
                    _ = interval.tick() => {
                        if let Err(error) = refresh_candidates(&app_handle, &endpoint, &registry, &mut candidates).await {
                            tracing::debug!("nearby share refresh failed: {error}");
                        }
                    }
                    maybe_item = events.next() => {
                        match maybe_item {
                            Some(item) => {
                                if let Some(candidate) = candidate_from_discovery_item(item) {
                                    upsert_candidate(&mut candidates, candidate);
                                }
                                if let Err(error) = refresh_candidates(&app_handle, &endpoint, &registry, &mut candidates).await {
                                    tracing::debug!("nearby share refresh failed: {error}");
                                }
                            }
                            None => {
                                discovery_events = None;
                            }
                        }
                    }
                }
                continue;
            }

            interval.tick().await;
            if let Err(error) = refresh_candidates(&app_handle, &endpoint, &registry, &mut candidates).await {
                tracing::debug!("nearby share refresh failed: {error}");
            }
        }
    });
}

async fn refresh_candidates(
    app_handle: &AppHandle,
    endpoint: &Endpoint,
    registry: &NearbyShareRegistry,
    candidates: &mut BTreeMap<NodeId, RemoteCandidate>,
) -> Result<()> {
    merge_endpoint_candidates(endpoint, candidates);
    prune_stale_candidates(candidates);
    refresh_nearby_shares(
        app_handle,
        endpoint,
        registry,
        candidates.values().cloned().collect(),
    )
    .await
}

async fn refresh_nearby_shares(
    app_handle: &AppHandle,
    endpoint: &Endpoint,
    registry: &NearbyShareRegistry,
    candidates: Vec<RemoteCandidate>,
) -> Result<()> {
    if !registry.local_discovery_enabled().await {
        emit_if_changed(app_handle, registry.clear_discovered_shares().await)?;
        return Ok(());
    }

    if candidates.is_empty() {
        emit_if_changed(app_handle, registry.clear_discovered_shares().await)?;
        return Ok(());
    }

    let discovered = stream::iter(candidates.into_iter().map(|candidate| {
        let endpoint = endpoint.clone();
        async move { query_candidate(endpoint, candidate).await }
    }))
    .buffer_unordered(MAX_PARALLEL_QUERIES)
    .collect::<Vec<_>>()
    .await
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();

    let changed = registry.replace_discovered_shares(discovered).await;
    emit_if_changed(app_handle, changed)
}

fn emit_if_changed(app_handle: &AppHandle, shares: Option<Vec<NearbyShare>>) -> Result<()> {
    if let Some(shares) = shares {
        app_handle
            .emit(DISCOVERED_SHARES_UPDATED_EVENT, shares)
            .map_err(|error| FastDropError::Other(error.to_string()))?;
    }
    Ok(())
}

fn seed_candidates(endpoint: &Endpoint) -> BTreeMap<NodeId, RemoteCandidate> {
    local_candidates(endpoint)
        .into_iter()
        .map(|candidate| (candidate.node_id, candidate))
        .collect()
}

fn merge_endpoint_candidates(
    endpoint: &Endpoint,
    candidates: &mut BTreeMap<NodeId, RemoteCandidate>,
) {
    for candidate in local_candidates(endpoint) {
        upsert_candidate(candidates, candidate);
    }
}

fn upsert_candidate(
    candidates: &mut BTreeMap<NodeId, RemoteCandidate>,
    candidate: RemoteCandidate,
) {
    candidates
        .entry(candidate.node_id)
        .and_modify(|current| {
            current.node_addr = merge_node_addrs(&current.node_addr, &candidate.node_addr);
            current.route_hint = stronger_route_hint(current.route_hint, candidate.route_hint);
            current.direct_address_count = current.node_addr.direct_addresses.len();
            current.last_seen_at = candidate.last_seen_at;
        })
        .or_insert(candidate);
}

fn merge_node_addrs(current: &NodeAddr, next: &NodeAddr) -> NodeAddr {
    let relay_url = next.relay_url.clone().or_else(|| current.relay_url.clone());
    let direct_addresses = current
        .direct_addresses
        .union(&next.direct_addresses)
        .copied()
        .collect::<Vec<_>>();
    NodeAddr::from_parts(current.node_id, relay_url, direct_addresses)
}

fn prune_stale_candidates(candidates: &mut BTreeMap<NodeId, RemoteCandidate>) {
    candidates.retain(|_, candidate| candidate.last_seen_at.elapsed() <= CANDIDATE_STALE_AFTER);
}

fn local_candidates(endpoint: &Endpoint) -> Vec<RemoteCandidate> {
    let local_node_id = endpoint.node_id();
    endpoint
        .remote_info_iter()
        .filter(|remote| remote.node_id != local_node_id)
        .filter(RemoteInfo::has_send_address)
        .filter(is_local_network_candidate)
        .map(remote_candidate)
        .collect()
}

fn is_local_network_candidate(remote: &RemoteInfo) -> bool {
    remote.sources().into_iter().any(|(source, _age)| {
        matches!(
            source,
            Source::Discovery { name } if name == local_swarm_discovery::NAME
        )
    })
}

fn remote_candidate(remote: RemoteInfo) -> RemoteCandidate {
    let freshness = remote_freshness(&remote);
    let route_hint = route_hint(&remote.conn_type);
    let direct_address_count = remote.addrs.len();
    let node_id = remote.node_id;
    let node_addr = NodeAddr::from(remote);
    RemoteCandidate {
        node_id,
        node_addr,
        route_hint,
        direct_address_count,
        last_seen_at: instant_from_freshness(freshness),
    }
}

fn remote_freshness(remote: &RemoteInfo) -> Duration {
    remote
        .last_received()
        .or(remote.last_used)
        .or_else(|| {
            remote
                .sources()
                .into_iter()
                .filter_map(|(source, age)| match source {
                    Source::Discovery { name } if name == local_swarm_discovery::NAME => Some(age),
                    _ => None,
                })
                .min()
        })
        .unwrap_or_default()
}

fn instant_from_freshness(freshness: Duration) -> Instant {
    Instant::now()
        .checked_sub(freshness)
        .unwrap_or_else(Instant::now)
}

fn candidate_from_discovery_item(item: DiscoveryItem) -> Option<RemoteCandidate> {
    if item.provenance != local_swarm_discovery::NAME {
        return None;
    }

    let direct_address_count = item.node_addr.direct_addresses.len();
    let route_hint = if direct_address_count > 0 && item.node_addr.relay_url.is_some() {
        NearbyRouteHint::Mixed
    } else if direct_address_count > 0 {
        NearbyRouteHint::Direct
    } else if item.node_addr.relay_url.is_some() {
        NearbyRouteHint::Relay
    } else {
        NearbyRouteHint::Unknown
    };

    Some(RemoteCandidate {
        node_id: item.node_addr.node_id,
        node_addr: item.node_addr,
        route_hint,
        direct_address_count,
        last_seen_at: Instant::now(),
    })
}

async fn query_candidate(endpoint: Endpoint, candidate: RemoteCandidate) -> Vec<NearbyShareRecord> {
    let queried = tokio::time::timeout(
        NODE_QUERY_TIMEOUT,
        fetch_remote_shares(&endpoint, candidate.node_addr.clone()),
    )
    .await;
    match queried {
        Ok(Ok(envelope)) => envelope
            .shares
            .into_iter()
            .filter_map(|share| discovered_record(&candidate, &envelope.device_name, &share))
            .collect(),
        Ok(Err(error)) => {
            tracing::debug!(
                node_id = %candidate.node_id,
                "nearby share query failed: {error}"
            );
            Vec::new()
        }
        Err(_) => Vec::new(),
    }
}

fn discovered_record(
    candidate: &RemoteCandidate,
    device_name: &str,
    share: &RemoteAdvertisedShare,
) -> Option<NearbyShareRecord> {
    let hash = share.hash().ok()?;
    let share_id = format!("{}:{}", candidate.node_id, share.hash);
    Some(NearbyShareRecord {
        public: NearbyShare {
            share_id,
            device_name: device_name.to_string(),
            node_id: candidate.node_id.to_string(),
            label: share.label.clone(),
            size: share.size,
            hash: share.hash.clone(),
            route_hint: candidate.route_hint,
            direct_address_count: candidate.direct_address_count,
            freshness_seconds: candidate.last_seen_at.elapsed().as_secs(),
            published_at: share.published_at,
        },
        node_addr: candidate.node_addr.clone(),
        hash,
        format: share.blob_format(),
    })
}

fn normalized_records(shares: Vec<NearbyShareRecord>) -> Vec<NearbyShareRecord> {
    let mut deduped = shares
        .into_iter()
        .fold(BTreeMap::new(), |mut acc, share| {
            acc.insert(share.public.share_id.clone(), share);
            acc
        })
        .into_values()
        .collect::<Vec<_>>();
    deduped.sort_by(|left, right| {
        left.public
            .label
            .cmp(&right.public.label)
            .then(left.public.device_name.cmp(&right.public.device_name))
            .then(left.public.share_id.cmp(&right.public.share_id))
    });
    deduped
}

fn stronger_route_hint(current: NearbyRouteHint, next: NearbyRouteHint) -> NearbyRouteHint {
    if route_hint_score(next) >= route_hint_score(current) {
        next
    } else {
        current
    }
}

fn route_hint_score(route_hint: NearbyRouteHint) -> u8 {
    match route_hint {
        NearbyRouteHint::Unknown => 0,
        NearbyRouteHint::Relay => 1,
        NearbyRouteHint::Direct => 2,
        NearbyRouteHint::Mixed => 3,
    }
}

fn route_hint(connection_type: &ConnectionType) -> NearbyRouteHint {
    match connection_type {
        ConnectionType::Direct(_) => NearbyRouteHint::Direct,
        ConnectionType::Relay(_) => NearbyRouteHint::Relay,
        ConnectionType::Mixed(_, _) => NearbyRouteHint::Mixed,
        ConnectionType::None => NearbyRouteHint::Unknown,
    }
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;
    use iroh::{NodeAddr, PublicKey};
    use std::str::FromStr;

    fn sample_record(share_id: &str) -> NearbyShareRecord {
        NearbyShareRecord {
            public: NearbyShare {
                share_id: share_id.into(),
                device_name: "sender".into(),
                node_id: "node-1".into(),
                label: "demo".into(),
                size: 42,
                hash: Hash::new(share_id.as_bytes()).to_string(),
                route_hint: NearbyRouteHint::Direct,
                direct_address_count: 1,
                freshness_seconds: 1,
                published_at: 10,
            },
            node_addr: NodeAddr::new(
                PublicKey::from_str(
                    "ae58ff8833241ac82d6ff7611046ed67b5072d142c588d0063e942d9a75502b6",
                )
                .expect("public key"),
            ),
            hash: Hash::new(share_id.as_bytes()),
            format: BlobFormat::HashSeq,
        }
    }

    #[tokio::test]
    async fn replacing_records_clears_stale_entries() {
        let registry = NearbyShareRegistry::new(true);
        let changed = registry
            .replace_discovered_shares(vec![sample_record("share-1")])
            .await;
        assert!(changed.is_some());

        let changed = registry.clear_discovered_shares().await;
        assert_eq!(changed, Some(Vec::new()));
        assert!(registry.snapshot().await.is_empty());
    }

    #[tokio::test]
    async fn ticket_is_rebuilt_from_cached_share() {
        let registry = NearbyShareRegistry::new(true);
        registry
            .replace_discovered_shares(vec![sample_record("share-1")])
            .await;

        let ticket = registry
            .ticket_for_share("share-1")
            .await
            .expect("ticket should rebuild");
        assert_eq!(ticket.hash(), Hash::new(b"share-1"));
        assert_eq!(ticket.format(), BlobFormat::HashSeq);
    }

    #[test]
    fn route_hint_maps_all_connection_types() {
        let relay_url: iroh::RelayUrl = "https://relay.example.com".parse().expect("relay url");
        let direct_addr = "127.0.0.1:4433".parse().expect("direct addr");
        assert_eq!(
            route_hint(&ConnectionType::Direct(direct_addr)),
            NearbyRouteHint::Direct
        );
        assert_eq!(
            route_hint(&ConnectionType::Relay(relay_url.clone())),
            NearbyRouteHint::Relay
        );
        assert_eq!(
            route_hint(&ConnectionType::Mixed(direct_addr, relay_url)),
            NearbyRouteHint::Mixed
        );
    }

    #[test]
    fn stronger_route_hint_prefers_more_specific_state() {
        assert_eq!(
            stronger_route_hint(NearbyRouteHint::Unknown, NearbyRouteHint::Direct),
            NearbyRouteHint::Direct
        );
        assert_eq!(
            stronger_route_hint(NearbyRouteHint::Relay, NearbyRouteHint::Mixed),
            NearbyRouteHint::Mixed
        );
    }
}
