//! Persistent bearer-link authorization for locally stored share roots.

use crate::error::Result;
use crate::storage::db::StorageDb;
use iroh_blobs::Hash;
use std::str::FromStr;

const TREE_NAME: &str = "public_share_access";
const MAX_PUBLIC_HASHES: usize = 100_000;

/// Records that a user explicitly created a bearer ticket for this hash.
///
/// # Errors
///
/// Returns an error if the database cannot be updated or the share limit is
/// reached.
pub fn authorize_public_hashes(db: &StorageDb, hashes: &[Hash]) -> Result<()> {
    let tree = db.tree(TREE_NAME)?;
    let mut additional = 0;
    for hash in hashes {
        if tree.get(hash.to_string().as_bytes())?.is_none() {
            additional += 1;
        }
    }
    if tree.len().saturating_add(additional) > MAX_PUBLIC_HASHES {
        return Err(crate::error::LightningP2PError::Other(
            "Too many public share links are active on this device.".into(),
        ));
    }
    for hash in hashes {
        tree.insert(hash.to_string().as_bytes(), &[])?;
    }
    db.flush()?;
    Ok(())
}

/// Loads previously authorized bearer-ticket hashes.
///
/// # Errors
///
/// Returns an error if the database is unavailable, contains malformed keys,
/// or exceeds the supported share limit.
pub fn load_public_hashes(db: &StorageDb) -> Result<Vec<Hash>> {
    let tree = db.tree(TREE_NAME)?;
    if tree.len() > MAX_PUBLIC_HASHES {
        return Err(crate::error::LightningP2PError::Other(
            "The saved public share list exceeds the supported limit.".into(),
        ));
    }
    let mut hashes = Vec::with_capacity(tree.len());
    for entry in &tree {
        let (key, _value) = entry?;
        let text = std::str::from_utf8(&key)
            .map_err(|error| crate::error::LightningP2PError::Other(error.to_string()))?;
        hashes.push(
            Hash::from_str(text)
                .map_err(|error| crate::error::LightningP2PError::Other(error.to_string()))?,
        );
    }
    Ok(hashes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_public_hashes_survive_reload() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = StorageDb::open(&dir.path().join("test.db")).expect("db");
        let hashes = [Hash::from([1; 32]), Hash::from([2; 32])];

        authorize_public_hashes(&db, &hashes).expect("authorize");

        let mut loaded = load_public_hashes(&db).expect("load");
        loaded.sort();
        let mut expected = hashes.to_vec();
        expected.sort();
        assert_eq!(loaded, expected);
    }
}
