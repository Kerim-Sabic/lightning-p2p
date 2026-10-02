//! Persisted block list for nearby file-offer senders.

use crate::error::{LightningP2PError, Result};
use crate::storage::bounded_json;
use iroh::EndpointId;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    str::FromStr,
    sync::Arc,
};
use tokio::sync::RwLock;

const FILE_NAME: &str = "blocked-nearby-peers.json";
const MAX_BLOCKED_PEERS: usize = 4096;
const MAX_BLOCKED_FILE_BYTES: usize = 512 * 1024;

/// Locally blocked cryptographic peer identities for nearby transfer offers.
#[derive(Debug, Clone)]
pub struct BlockedPeers {
    path: Option<PathBuf>,
    ids: Arc<RwLock<HashSet<String>>>,
}

impl BlockedPeers {
    /// Loads the saved block list, rejecting malformed or oversized data.
    ///
    /// # Errors
    ///
    /// Returns an error if the file cannot be read or contains invalid identities.
    pub fn load(data_dir: &Path) -> Result<Self> {
        let path = data_dir.join(FILE_NAME);
        let ids = if path.exists() {
            let bytes = bounded_json::read_bytes(&path, MAX_BLOCKED_FILE_BYTES)
                .map_err(LightningP2PError::Other)?;
            let stored: Vec<String> = serde_json::from_slice(&bytes)?;
            if stored.len() > MAX_BLOCKED_PEERS {
                return Err(LightningP2PError::Other(
                    "The saved nearby block list exceeds its safety limit.".into(),
                ));
            }
            stored
                .into_iter()
                .map(|id| EndpointId::from_str(&id).map(|parsed| parsed.to_string()))
                .collect::<std::result::Result<HashSet<_>, _>>()
                .map_err(|_| {
                    LightningP2PError::Other(
                        "The saved nearby block list contains an invalid device identity.".into(),
                    )
                })?
        } else {
            HashSet::new()
        };
        Ok(Self {
            path: Some(path),
            ids: Arc::new(RwLock::new(ids)),
        })
    }

    /// Creates an in-memory block list for recovery when persisted state is unreadable.
    #[must_use]
    pub fn in_memory() -> Self {
        Self {
            path: None,
            ids: Arc::new(RwLock::new(HashSet::new())),
        }
    }

    /// Returns whether the authenticated endpoint identity is blocked.
    pub async fn contains(&self, peer: EndpointId) -> bool {
        self.ids.read().await.contains(&peer.to_string())
    }

    /// Lists blocked endpoint identities in stable order.
    pub async fn list(&self) -> Vec<String> {
        let mut ids = self.ids.read().await.iter().cloned().collect::<Vec<_>>();
        ids.sort();
        ids
    }

    /// Adds or removes a blocked endpoint identity and persists the result.
    ///
    /// # Errors
    ///
    /// Returns an error if the identity is invalid, the list is full, or persistence fails.
    pub async fn set_blocked(&self, node_id: &str, blocked: bool) -> Result<Vec<String>> {
        let peer = EndpointId::from_str(node_id)
            .map_err(|_| LightningP2PError::Other("Invalid device identity.".into()))?
            .to_string();
        let mut guard = self.ids.write().await;
        let mut next = guard.clone();
        if blocked {
            if !next.contains(&peer) && next.len() >= MAX_BLOCKED_PEERS {
                return Err(LightningP2PError::Other(
                    "The nearby block list is full.".into(),
                ));
            }
            next.insert(peer);
        } else {
            next.remove(&peer);
        }

        if next != *guard {
            self.persist(&next).await?;
            *guard = next;
        }
        let mut snapshot = guard.iter().cloned().collect::<Vec<_>>();
        snapshot.sort();
        Ok(snapshot)
    }

    async fn persist(&self, ids: &HashSet<String>) -> Result<()> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let mut sorted = ids.iter().cloned().collect::<Vec<_>>();
        sorted.sort();
        let bytes = serde_json::to_vec(&sorted)?;
        let temporary = path.with_extension(format!("json.{}.tmp", uuid::Uuid::new_v4()));
        tokio::fs::write(&temporary, bytes).await?;
        if let Err(error) = tokio::fs::rename(&temporary, path).await {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(LightningP2PError::from(error));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(seed: u8) -> String {
        iroh::SecretKey::from_bytes(&[seed; 32])
            .public()
            .to_string()
    }

    #[tokio::test]
    async fn block_list_persists_and_can_be_revoked() {
        let dir = tempfile::tempdir().expect("tempdir");
        let peer = identity(5);
        let blocks = BlockedPeers::load(dir.path()).expect("load");
        let ids = blocks.set_blocked(&peer, true).await.expect("block peer");
        assert_eq!(ids, vec![peer.clone()]);
        assert!(
            blocks
                .contains(EndpointId::from_str(&peer).expect("valid identity"))
                .await
        );

        let reloaded = BlockedPeers::load(dir.path()).expect("reload");
        assert_eq!(reloaded.list().await, vec![peer.clone()]);
        assert_eq!(
            reloaded
                .set_blocked(&peer, false)
                .await
                .expect("unblock peer"),
            Vec::<String>::new()
        );
        assert_eq!(
            BlockedPeers::load(dir.path())
                .expect("load after revoke")
                .list()
                .await,
            Vec::<String>::new()
        );
    }

    #[tokio::test]
    async fn invalid_identity_does_not_change_the_block_list() {
        let dir = tempfile::tempdir().expect("tempdir");
        let blocks = BlockedPeers::load(dir.path()).expect("load");
        assert!(blocks
            .set_blocked("not-an-endpoint-id", true)
            .await
            .is_err());
        assert_eq!(blocks.list().await.len(), 0);
    }
}
