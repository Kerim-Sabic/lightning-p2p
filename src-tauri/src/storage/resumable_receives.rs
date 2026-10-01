//! Restart-safe receive metadata. Capability tickets live only in the OS keyring.

use crate::crypto::fallback_permissions::restrict_private_file;
use crate::error::{LightningP2PError, Result};
use crate::transfer::progress::TransferInfo;
use crate::transfer::receiver::ReceiveLimits;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

const STORE_FILE: &str = "resumable-receives.json";
const MAX_RECOVERABLE_RECEIVES: usize = 32;
const MAX_METADATA_BYTES: u64 = 256 * 1024;

/// Non-secret data needed to reconstruct a paused receive.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResumableReceive {
    /// User-visible transfer information, never including a capability ticket.
    pub transfer: TransferInfo,
    /// Limits originally applied to an auto-catch receive.
    pub limits: ReceiveLimits,
    /// Sender-provided fallback filename for a single-file offer.
    pub fallback_file_name: Option<String>,
    /// Verified single-file output expected to be published when interrupted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finalization: Option<ReceiveFinalization>,
}

/// Minimal journal entry for recovering a file published before history flush.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReceiveFinalization {
    /// Expected BLAKE3 digest of the verified file.
    pub hash: String,
    /// Expected byte length.
    pub size: u64,
    /// Sanitized basename used for the published file.
    pub file_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedStore {
    schema_version: u8,
    receives: Vec<ResumableReceive>,
}

/// Stores bounded receive metadata in an owner-only app-data file.
#[derive(Debug, Clone)]
pub struct ResumableReceiveStore {
    path: Option<PathBuf>,
    records: Arc<Mutex<HashMap<String, ResumableReceive>>>,
}

impl ResumableReceiveStore {
    /// Loads persisted receive metadata from the application data directory.
    ///
    /// # Errors
    ///
    /// Returns an error if the metadata file cannot be read or decoded.
    pub fn load(data_dir: &Path) -> Result<Self> {
        let path = data_dir.join(STORE_FILE);
        let records = if path.exists() {
            restrict_private_file(&path)?;
            if std::fs::metadata(&path)?.len() > MAX_METADATA_BYTES {
                return Err(LightningP2PError::Other(
                    "Receive recovery metadata exceeds its size limit".into(),
                ));
            }
            let bytes = std::fs::read(&path)?;
            let persisted: PersistedStore = serde_json::from_slice(&bytes)?;
            if persisted.schema_version != 1 || persisted.receives.len() > MAX_RECOVERABLE_RECEIVES
            {
                return Err(LightningP2PError::Other(
                    "Unsupported receive recovery metadata".into(),
                ));
            }
            persisted
                .receives
                .into_iter()
                .filter(|record| uuid::Uuid::parse_str(&record.transfer.transfer_id).is_ok())
                .map(|record| (record.transfer.transfer_id.clone(), record))
                .collect()
        } else {
            HashMap::new()
        };
        Ok(Self {
            path: Some(path),
            records: Arc::new(Mutex::new(records)),
        })
    }

    /// Creates a process-only store when durable metadata cannot be opened.
    #[must_use]
    pub fn in_memory() -> Self {
        Self {
            path: None,
            records: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Returns all recoverable receive records.
    #[must_use]
    pub fn list(&self) -> Vec<ResumableReceive> {
        let records = self.records.lock().unwrap_or_else(PoisonError::into_inner);
        records.values().cloned().collect()
    }

    /// Returns one recoverable receive record by its stable transfer ID.
    #[must_use]
    pub fn get(&self, transfer_id: &str) -> Option<ResumableReceive> {
        self.records
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(transfer_id)
            .cloned()
    }

    /// Persists one receive record without any ticket or other capability.
    ///
    /// # Errors
    ///
    /// Returns an error if durable storage is unavailable or the bounded
    /// recovery store is full.
    pub fn save(&self, record: ResumableReceive) -> Result<()> {
        let id = &record.transfer.transfer_id;
        if uuid::Uuid::parse_str(id).is_err() {
            return Err(LightningP2PError::Other(
                "Invalid receive recovery identifier".into(),
            ));
        }
        let mut records = self.records.lock().unwrap_or_else(PoisonError::into_inner);
        let mut next = records.clone();
        if !next.contains_key(id) && next.len() >= MAX_RECOVERABLE_RECEIVES {
            return Err(LightningP2PError::Other(
                "Receive recovery limit reached".into(),
            ));
        }
        next.insert(id.clone(), record);
        self.persist(&next)?;
        *records = next;
        Ok(())
    }

    /// Removes metadata for a completed or explicitly discarded receive.
    ///
    /// # Errors
    ///
    /// Returns an error if durable metadata cannot be updated.
    pub fn remove(&self, transfer_id: &str) -> Result<()> {
        let mut records = self.records.lock().unwrap_or_else(PoisonError::into_inner);
        let mut next = records.clone();
        next.remove(transfer_id);
        self.persist(&next)?;
        *records = next;
        Ok(())
    }

    fn persist(&self, records: &HashMap<String, ResumableReceive>) -> Result<()> {
        let Some(path) = &self.path else {
            return Err(LightningP2PError::Other(
                "Receive recovery storage unavailable".into(),
            ));
        };
        let parent = path
            .parent()
            .ok_or_else(|| LightningP2PError::Other("Invalid app data path".into()))?;
        std::fs::create_dir_all(parent)?;
        let persisted = PersistedStore {
            schema_version: 1,
            receives: records.values().cloned().collect(),
        };
        let bytes = serde_json::to_vec(&persisted)?;
        if bytes.len() as u64 > MAX_METADATA_BYTES {
            return Err(LightningP2PError::Other(
                "Receive recovery metadata exceeds its size limit".into(),
            ));
        }
        let temp = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp)?;
        restrict_private_file(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        if let Err(error) = replace_file(&temp, path) {
            let _ = std::fs::remove_file(&temp);
            return Err(error.into());
        }
        restrict_private_file(path)?;
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::rename(source, destination)
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING};

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let replaced = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING,
        )
    };
    if replaced == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transfer::metrics::{RouteKind, TransferStrategy};
    use crate::transfer::progress::{TransferDirection, TransferPhase};

    fn sample_record(id: String) -> ResumableReceive {
        ResumableReceive {
            transfer: TransferInfo {
                transfer_id: id,
                direction: TransferDirection::Receive,
                name: "photo.jpg".into(),
                peer: None,
                bytes: 512,
                total: 1024,
                speed_bps: 0,
                route_kind: RouteKind::Unknown,
                phase: TransferPhase::Paused,
                failure_category: None,
                output_path: None,
                connect_ms: 0,
                download_ms: 0,
                export_ms: 0,
                provider_count: 1,
                direct_provider_count: 0,
                relay_provider_count: 0,
                strategy: TransferStrategy::QueuedSingleProvider,
                first_byte_ms: 0,
                effective_mbps: 0,
                can_resume: true,
            },
            limits: ReceiveLimits::default(),
            fallback_file_name: None,
            finalization: None,
        }
    }

    #[test]
    fn records_round_trip_without_capability_tickets() {
        let directory = tempfile::tempdir().expect("temporary app data directory");
        let store = ResumableReceiveStore::load(directory.path()).expect("open store");
        let record = sample_record(uuid::Uuid::new_v4().to_string());
        store.save(record.clone()).expect("save record");
        drop(store);

        let restored = ResumableReceiveStore::load(directory.path()).expect("reload store");
        assert_eq!(restored.list(), vec![record]);
        let contents =
            std::fs::read_to_string(directory.path().join(STORE_FILE)).expect("read metadata");
        assert!(!contents.contains("ticket"));
        assert!(!contents.contains("capability"));
    }

    #[test]
    fn remove_persists_discarded_receive() {
        let directory = tempfile::tempdir().expect("temporary app data directory");
        let store = ResumableReceiveStore::load(directory.path()).expect("open store");
        let record = sample_record(uuid::Uuid::new_v4().to_string());
        let id = record.transfer.transfer_id.clone();
        store.save(record).expect("save record");
        store.remove(&id).expect("remove record");
        assert!(ResumableReceiveStore::load(directory.path())
            .expect("reload store")
            .list()
            .is_empty());
    }
}
