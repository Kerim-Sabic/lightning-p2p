//! Peer cache - remembers previously seen peers for faster reconnection.

use crate::error::Result;
use crate::storage::db::StorageDb;
use serde::{Deserialize, Serialize};

const TREE_NAME: &str = "peers";

/// Cached information about a known peer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PeerRecord {
    /// The peer's iroh `NodeId` string.
    pub node_id: String,
    /// Human-readable nickname (if set).
    pub nickname: Option<String>,
    /// Unix timestamp of the last successful sighting.
    pub last_seen: u64,
}

/// Saves or updates a peer record and flushes to disk.
///
/// # Errors
///
/// Returns `FastDropError` if serialization or storage fails.
pub fn save_peer(db: &StorageDb, peer: &PeerRecord) -> Result<()> {
    save_peer_no_flush(db, peer)?;
    db.flush()?;
    Ok(())
}

/// Saves or updates a peer record without flushing to disk.
///
/// Use this when batching multiple writes before a single flush.
///
/// # Errors
///
/// Returns `FastDropError` if serialization or storage fails.
pub fn save_peer_no_flush(db: &StorageDb, peer: &PeerRecord) -> Result<()> {
    let tree = db.tree(TREE_NAME)?;
    let value = serde_json::to_vec(peer)?;
    tree.insert(peer.node_id.as_bytes(), value)?;
    Ok(())
}

/// Loads all cached peer records.
///
/// # Errors
///
/// Returns `FastDropError` if deserialization fails.
pub fn load_all(db: &StorageDb) -> Result<Vec<PeerRecord>> {
    let tree = db.tree(TREE_NAME)?;
    let mut peers = Vec::new();
    for entry in &tree {
        let (_, value) = entry?;
        let peer: PeerRecord = serde_json::from_slice(&value)?;
        peers.push(peer);
    }
    peers.sort_by_key(|peer| std::cmp::Reverse(peer.last_seen));
    Ok(peers)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> (StorageDb, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir should be created");
        let db = StorageDb::open(&dir.path().join("test.db")).expect("db should open");
        (db, dir)
    }

    #[test]
    fn save_and_load_peer() {
        let (db, _dir) = temp_db();
        let peer = PeerRecord {
            node_id: "node123".into(),
            nickname: Some("Alice".into()),
            last_seen: 1_700_000_000,
        };
        save_peer(&db, &peer).expect("peer should save");
        let peers = load_all(&db).expect("peers should load");
        assert_eq!(peers.len(), 1);
        assert_eq!(peers[0].nickname, Some("Alice".into()));
    }
}
