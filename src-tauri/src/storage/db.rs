//! Thin wrapper around sled for local persistent storage.

use crate::error::Result;
use std::path::Path;

/// Wrapper around a sled database instance.
#[derive(Debug, Clone)]
pub struct StorageDb {
    db: sled::Db,
}

impl StorageDb {
    /// Opens (or creates) the sled database at the given path.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError::Storage` if sled cannot open the path.
    pub fn open(path: &Path) -> Result<Self> {
        let db = sled::open(path)?;
        Ok(Self { db })
    }

    /// Returns a reference to a named tree (key namespace).
    ///
    /// # Errors
    ///
    /// Returns `FastDropError::Storage` if the tree cannot be opened.
    pub fn tree(&self, name: &str) -> Result<sled::Tree> {
        let tree = self.db.open_tree(name)?;
        Ok(tree)
    }

    /// Flushes all pending writes to disk.
    ///
    /// # Errors
    ///
    /// Returns `FastDropError::Storage` on flush failure.
    pub fn flush(&self) -> Result<()> {
        self.db.flush()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> (StorageDb, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = StorageDb::open(&dir.path().join("test.db")).unwrap();
        (db, dir)
    }

    #[test]
    fn open_and_write() {
        let (db, _dir) = temp_db();
        let tree = db.tree("test").unwrap();
        tree.insert("key", "value").unwrap();
        let val = tree.get("key").unwrap().unwrap();
        assert_eq!(&*val, b"value");
    }
}
