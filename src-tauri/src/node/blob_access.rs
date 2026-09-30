//! Explicit authorization for content served from the persistent blob store.
//!
//! Share tickets remain bearer capabilities, while nearby push offers grant
//! temporary access only to the accepting peer. Unknown stored hashes are not
//! served merely because they are present in the local store.

use iroh::endpoint::Connection;
use iroh::{protocol::AcceptError, EndpointId};
use iroh_blobs::api::Store;
use iroh_blobs::provider::{self, events::EventSender, StreamPair};
use iroh_blobs::{protocol::Request, Hash};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

const PRIVATE_GRANT_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_AUTHORIZED_HASHES: usize = 100_000;

#[derive(Debug, Default)]
struct AccessRules {
    public_hashes: HashSet<Hash>,
    private_grants: HashMap<(EndpointId, Hash), PrivateGrant>,
}

#[derive(Debug, Clone, Copy)]
struct PrivateGrant {
    expires_at: Instant,
    references: u32,
}

/// Shared access rules for the node's blob provider.
#[derive(Debug, Clone, Default)]
pub(crate) struct BlobAccessController(Arc<RwLock<AccessRules>>);

impl BlobAccessController {
    /// Allows a bearer ticket for this hash to be served to any peer.
    pub(crate) fn publish_public(&self, hashes: &[Hash]) -> bool {
        let mut rules = self.write();
        let additional = hashes
            .iter()
            .filter(|hash| !rules.public_hashes.contains(*hash))
            .count();
        if rules.public_hashes.len().saturating_add(additional) > MAX_AUTHORIZED_HASHES {
            return false;
        }
        rules.public_hashes.extend(hashes.iter().copied());
        true
    }

    pub(crate) fn can_publish_public(&self, hashes: &[Hash]) -> bool {
        let rules = self.read();
        let additional = hashes
            .iter()
            .filter(|hash| !rules.public_hashes.contains(*hash))
            .count();
        rules.public_hashes.len().saturating_add(additional) <= MAX_AUTHORIZED_HASHES
    }

    /// Grants a nearby peer temporary access to one explicitly offered root.
    pub(crate) fn authorize_peer(&self, peer: EndpointId, hashes: &[Hash]) -> bool {
        let now = Instant::now();
        let mut rules = self.write();
        rules
            .private_grants
            .retain(|_, grant| grant.expires_at > now);
        let additional = hashes
            .iter()
            .filter(|hash| !rules.private_grants.contains_key(&(peer, **hash)))
            .count();
        if rules.private_grants.len().saturating_add(additional) > MAX_AUTHORIZED_HASHES {
            return false;
        }
        let expires_at = now + PRIVATE_GRANT_TTL;
        for hash in hashes {
            let grant = rules
                .private_grants
                .entry((peer, *hash))
                .or_insert(PrivateGrant {
                    expires_at,
                    references: 0,
                });
            grant.expires_at = expires_at;
            grant.references = grant.references.saturating_add(1);
        }
        true
    }

    pub(crate) fn revoke_peer(&self, peer: EndpointId, hashes: &[Hash]) {
        let mut rules = self.write();
        for hash in hashes {
            let key = (peer, *hash);
            if let Some(grant) = rules.private_grants.get_mut(&key) {
                grant.references = grant.references.saturating_sub(1);
                if grant.references == 0 {
                    rules.private_grants.remove(&key);
                }
            }
        }
    }

    fn allows(&self, peer: EndpointId, hash: Hash) -> bool {
        let now = Instant::now();
        let mut rules = self.write();
        rules
            .private_grants
            .retain(|_, grant| grant.expires_at > now);
        rules.public_hashes.contains(&hash) || rules.private_grants.contains_key(&(peer, hash))
    }

    pub(crate) fn with_public_hashes(hashes: impl IntoIterator<Item = Hash>) -> Self {
        let controller = Self::default();
        controller.write().public_hashes.extend(hashes);
        controller
    }

    fn write(&self) -> std::sync::RwLockWriteGuard<'_, AccessRules> {
        self.0
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn read(&self) -> std::sync::RwLockReadGuard<'_, AccessRules> {
        self.0
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// Blob protocol adapter that enforces explicit public or peer-bound access.
#[derive(Debug, Clone)]
pub(crate) struct AuthorizedBlobsProtocol {
    store: Store,
    access: BlobAccessController,
}

impl AuthorizedBlobsProtocol {
    pub(crate) fn new(store: &Store, access: BlobAccessController) -> Self {
        Self {
            store: store.clone(),
            access,
        }
    }
}

impl iroh::protocol::ProtocolHandler for AuthorizedBlobsProtocol {
    async fn accept(&self, connection: Connection) -> Result<(), AcceptError> {
        let connection_id = connection.stable_id() as u64;
        let peer = connection.remote_id();
        while let Ok((writer, reader)) = connection.accept_bi().await {
            let pair = StreamPair::new(connection_id, reader, writer, EventSender::DEFAULT);
            let store = self.store.clone();
            let access = self.access.clone();
            tokio::spawn(async move {
                let mut pair = pair;
                let Ok(request) = pair.read_request().await else {
                    return;
                };
                match request {
                    Request::Get(request) if access.allows(peer, request.hash) => {
                        if let Err(error) = provider::handle_get(pair, store, request).await {
                            tracing::debug!(%error, %peer, "authorized blob request failed");
                        }
                    }
                    Request::GetMany(request)
                        if request.hashes.iter().all(|hash| access.allows(peer, *hash)) =>
                    {
                        if let Err(error) = provider::handle_get_many(pair, store, request).await {
                            tracing::debug!(%error, %peer, "authorized multi-blob request failed");
                        }
                    }
                    Request::Observe(request) if access.allows(peer, request.hash) => {
                        if let Err(error) = provider::handle_observe(pair, store, request).await {
                            tracing::debug!(%error, %peer, "authorized blob observation failed");
                        }
                    }
                    // Push, unknown hashes, and all other operations are
                    // denied by dropping the stream before the provider can
                    // reveal store contents or accept data.
                    _ => {}
                }
            });
        }
        Ok(())
    }

    async fn shutdown(&self) {
        if let Err(error) = self.store.shutdown().await {
            tracing::error!(%error, "failed to shut down blob store");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use iroh::{
        address_lookup::memory::MemoryLookup, endpoint::presets, protocol::Router, Endpoint,
        SecretKey,
    };
    use iroh_blobs::store::mem::MemStore;
    use std::time::Duration;

    fn test_peer(value: u8) -> EndpointId {
        SecretKey::from_bytes(&[value; 32]).public()
    }

    #[test]
    fn public_hashes_are_available_to_any_peer() {
        let controller = BlobAccessController::default();
        let hash = Hash::from([9; 32]);
        assert!(controller.publish_public(&[hash]));

        assert!(controller.allows(test_peer(1), hash));
        assert!(controller.allows(test_peer(2), hash));
    }

    #[test]
    fn private_hashes_are_bound_to_one_peer() {
        let controller = BlobAccessController::default();
        let hash = Hash::from([9; 32]);
        let authorized = test_peer(1);
        assert!(controller.authorize_peer(authorized, &[hash]));

        assert!(controller.allows(authorized, hash));
        assert!(!controller.allows(test_peer(2), hash));
        assert!(!controller.allows(authorized, Hash::from([8; 32])));
    }

    #[test]
    fn multi_blob_authorization_requires_every_hash() {
        let controller = BlobAccessController::default();
        let peer = test_peer(1);
        let public = Hash::from([1; 32]);
        let private = Hash::from([2; 32]);
        controller.publish_public(&[public]);
        controller.authorize_peer(peer, &[private]);

        assert!(controller.allows(peer, public));
        assert!(controller.allows(peer, private));
        assert!(!controller.allows(test_peer(2), private));
        assert!(!controller.allows(peer, Hash::from([3; 32])));
    }

    #[test]
    fn revoking_one_overlapping_offer_keeps_the_other_grant() {
        let controller = BlobAccessController::default();
        let peer = test_peer(1);
        let hash = Hash::from([7; 32]);
        controller.authorize_peer(peer, &[hash]);
        controller.authorize_peer(peer, &[hash]);

        controller.revoke_peer(peer, &[hash]);
        assert!(controller.allows(peer, hash));
        controller.revoke_peer(peer, &[hash]);
        assert!(!controller.allows(peer, hash));
    }

    #[test]
    fn expired_private_grants_are_pruned_before_authorization() {
        let controller = BlobAccessController::default();
        let peer = test_peer(1);
        let hash = Hash::from([7; 32]);
        controller.authorize_peer(peer, &[hash]);
        controller.write().private_grants.insert(
            (peer, hash),
            PrivateGrant {
                expires_at: Instant::now()
                    .checked_sub(Duration::from_secs(1))
                    .expect("one second before now"),
                references: 1,
            },
        );

        assert!(!controller.allows(peer, hash));
        assert!(controller.read().private_grants.is_empty());
    }

    #[tokio::test]
    async fn provider_serves_only_public_or_peer_authorized_content(
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let source = MemStore::new();
        let public_hash = source.add_bytes(b"public bytes".to_vec()).await?.hash;
        let private_hash = source.add_bytes(b"private bytes".to_vec()).await?.hash;
        let access = BlobAccessController::default();
        assert!(access.publish_public(&[public_hash]));

        let server = Endpoint::builder(presets::Minimal).bind().await?;
        let router = Router::builder(server.clone())
            .accept(
                iroh_blobs::ALPN,
                AuthorizedBlobsProtocol::new(source.as_ref(), access.clone()),
            )
            .spawn();
        let server_addr = router.endpoint().addr();

        let authorized_store = MemStore::new();
        let authorized_lookup = MemoryLookup::new();
        authorized_lookup.add_endpoint_info(server_addr.clone());
        let authorized_peer = Endpoint::builder(presets::Minimal)
            .address_lookup(authorized_lookup)
            .bind()
            .await?;
        assert!(access.authorize_peer(authorized_peer.id(), &[private_hash]));

        let denied_store = MemStore::new();
        let denied_lookup = MemoryLookup::new();
        denied_lookup.add_endpoint_info(server_addr.clone());
        let denied_peer = Endpoint::builder(presets::Minimal)
            .address_lookup(denied_lookup)
            .bind()
            .await?;

        assert!(
            fetch(
                &authorized_peer,
                &authorized_store,
                server_addr.clone(),
                private_hash
            )
            .await?
        );
        assert!(
            !fetch(
                &denied_peer,
                &denied_store,
                server_addr.clone(),
                private_hash
            )
            .await?
        );
        assert!(fetch(&denied_peer, &denied_store, server_addr, public_hash).await?);
        assert_eq!(
            authorized_store.get_bytes(private_hash).await?.as_ref(),
            b"private bytes"
        );
        assert_eq!(
            denied_store.get_bytes(public_hash).await?.as_ref(),
            b"public bytes"
        );

        router.shutdown().await?;
        authorized_peer.close().await;
        denied_peer.close().await;
        Ok(())
    }

    async fn fetch(
        peer: &Endpoint,
        store: &MemStore,
        server_addr: iroh::EndpointAddr,
        hash: Hash,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let connection = peer.connect(server_addr, iroh_blobs::ALPN).await?;
        let result = tokio::time::timeout(
            Duration::from_secs(5),
            store.remote().fetch(connection, hash),
        )
        .await;
        Ok(matches!(result, Ok(Ok(_))))
    }
}
