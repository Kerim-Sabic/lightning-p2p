//! Transfer history - records of past sends and receives.

use crate::error::Result;
use crate::storage::db::StorageDb;
use crate::transfer::progress::TransferDirection;
use serde::{Deserialize, Serialize};

const TREE_NAME: &str = "transfer_history";

/// A record of a completed transfer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransferRecord {
    /// BLAKE3 hash of the transferred blob.
    pub hash: String,
    /// Original file or bundle name.
    pub filename: String,
    /// Size in bytes.
    pub size: u64,
    /// Remote peer identifier when known.
    pub peer: Option<String>,
    /// Unix timestamp (seconds) of completion.
    pub timestamp: u64,
    /// Transfer direction.
    pub direction: TransferDirection,
}

/// Saves a transfer record to history and flushes to disk.
///
/// # Errors
///
/// Returns `FastDropError` if serialization or storage fails.
pub fn save_record(db: &StorageDb, record: &TransferRecord) -> Result<()> {
    save_record_no_flush(db, record)?;
    db.flush()?;
    Ok(())
}

/// Saves a transfer record to history without flushing to disk.
///
/// Use this when batching multiple writes before a single flush.
///
/// # Errors
///
/// Returns `FastDropError` if serialization or storage fails.
pub fn save_record_no_flush(db: &StorageDb, record: &TransferRecord) -> Result<()> {
    let tree = db.tree(TREE_NAME)?;
    let value = serde_json::to_vec(record)?;
    tree.insert(history_key(record), value)?;
    Ok(())
}

/// Loads all transfer records from history.
///
/// # Errors
///
/// Returns `FastDropError` if deserialization fails.
pub fn load_all(db: &StorageDb) -> Result<Vec<TransferRecord>> {
    let tree = db.tree(TREE_NAME)?;
    let mut records = Vec::new();
    for entry in &tree {
        let (_, value) = entry?;
        let record: TransferRecord = serde_json::from_slice(&value)?;
        records.push(record);
    }
    records.sort_by(|left, right| right.timestamp.cmp(&left.timestamp));
    Ok(records)
}

fn history_key(record: &TransferRecord) -> Vec<u8> {
    format!(
        "{:020}-{:?}-{}",
        record.timestamp, record.direction, record.hash
    )
    .into_bytes()
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
    fn save_and_load_record() {
        let (db, _dir) = temp_db();
        let record = TransferRecord {
            hash: "abc123".into(),
            filename: "test.txt".into(),
            size: 1024,
            peer: Some("peer-1".into()),
            timestamp: 1_700_000_000,
            direction: TransferDirection::Send,
        };
        save_record(&db, &record).expect("record should save");
        let records = load_all(&db).expect("records should load");
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].filename, "test.txt");
    }
}
