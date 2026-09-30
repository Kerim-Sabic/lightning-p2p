//! User-confirmed device identities for the My Devices surface.

use crate::error::{LightningP2PError, Result};
use iroh::EndpointId;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    str::FromStr,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::RwLock;

const FILE_NAME: &str = "paired-devices.json";
const MAX_PAIRED_DEVICES: usize = 256;
const MAX_DEVICE_NAME_CHARS: usize = 64;

/// A locally saved public peer identity that the user explicitly verified.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PairedDevice {
    /// Cryptographic iroh endpoint identity, used for comparison on every connection.
    pub node_id: String,
    /// User-controlled local label.
    pub name: String,
    /// Unix timestamp when the user confirmed the comparison code.
    pub verified_at: u64,
}

/// Persistent user-confirmed device identities. These records contain public keys and labels only.
#[derive(Debug, Clone)]
pub struct PairedDevices {
    path: PathBuf,
    devices: Arc<RwLock<Vec<PairedDevice>>>,
}

impl PairedDevices {
    /// Creates an empty store that reports persistence errors on later writes.
    #[must_use]
    pub fn in_memory(data_dir: &std::path::Path) -> Self {
        Self {
            path: data_dir.join(FILE_NAME),
            devices: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Loads the persisted device list, recovering to an empty list if the file is malformed.
    ///
    /// # Errors
    ///
    /// Returns an error if the data directory cannot be inspected or a damaged file cannot be preserved.
    pub fn load(data_dir: &std::path::Path) -> Result<Self> {
        let path = data_dir.join(FILE_NAME);
        let devices = if path.exists() {
            match std::fs::read(&path).and_then(|bytes| {
                serde_json::from_slice::<Vec<PairedDevice>>(&bytes).map_err(std::io::Error::other)
            }) {
                Ok(devices) => devices,
                Err(_error) => {
                    tracing::warn!("could not read saved devices; preserving the damaged file");
                    let backup = path.with_extension(format!("json.corrupt-{}", unix_timestamp()));
                    std::fs::rename(&path, backup)?;
                    Vec::new()
                }
            }
        } else {
            Vec::new()
        };
        Ok(Self {
            path,
            devices: Arc::new(RwLock::new(devices)),
        })
    }

    /// Returns a stable, sorted snapshot of verified public identities.
    pub async fn list(&self) -> Vec<PairedDevice> {
        let mut devices = self.devices.read().await.clone();
        devices.sort_by_key(|device| device.name.to_lowercase());
        devices
    }

    /// Returns whether a public peer identity has been explicitly verified.
    pub async fn contains(&self, node_id: &str) -> bool {
        self.devices
            .read()
            .await
            .iter()
            .any(|device| device.node_id == node_id)
    }

    /// Saves a peer after the user has compared the short code in person.
    ///
    /// # Errors
    ///
    /// Returns an error if the identity/name is invalid, the list is full, or persistence fails.
    pub async fn pair(&self, node_id: &str, name: &str) -> Result<Vec<PairedDevice>> {
        validate_node_id(node_id)?;
        let name = normalize_name(name)?;
        let mut guard = self.devices.write().await;
        let mut next = guard.clone();
        if let Some(existing) = next.iter_mut().find(|device| device.node_id == node_id) {
            existing.name = name;
            existing.verified_at = unix_timestamp();
        } else {
            if next.len() >= MAX_PAIRED_DEVICES {
                return Err(LightningP2PError::Other(
                    "The saved device limit has been reached.".into(),
                ));
            }
            next.push(PairedDevice {
                node_id: node_id.to_owned(),
                name,
                verified_at: unix_timestamp(),
            });
        }
        self.persist(&next)?;
        *guard = next;
        let mut snapshot = guard.clone();
        snapshot.sort_by_key(|device| device.name.to_lowercase());
        Ok(snapshot)
    }

    /// Renames a saved peer without changing its verified cryptographic identity.
    ///
    /// # Errors
    ///
    /// Returns an error if the name is invalid, the identity is unknown, or persistence fails.
    pub async fn rename(&self, node_id: &str, name: &str) -> Result<Vec<PairedDevice>> {
        let name = normalize_name(name)?;
        let mut guard = self.devices.write().await;
        let mut next = guard.clone();
        let device = next
            .iter_mut()
            .find(|device| device.node_id == node_id)
            .ok_or_else(|| {
                LightningP2PError::Other("That saved device could not be found.".into())
            })?;
        device.name = name;
        self.persist(&next)?;
        *guard = next;
        let mut snapshot = guard.clone();
        snapshot.sort_by_key(|device| device.name.to_lowercase());
        Ok(snapshot)
    }

    /// Revokes a saved identity from the local device list.
    ///
    /// # Errors
    ///
    /// Returns an error if the updated list cannot be persisted.
    pub async fn remove(&self, node_id: &str) -> Result<Vec<PairedDevice>> {
        let mut guard = self.devices.write().await;
        let mut next = guard.clone();
        next.retain(|device| device.node_id != node_id);
        self.persist(&next)?;
        *guard = next;
        let mut snapshot = guard.clone();
        snapshot.sort_by_key(|device| device.name.to_lowercase());
        Ok(snapshot)
    }

    fn persist(&self, devices: &[PairedDevice]) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let bytes = serde_json::to_vec_pretty(devices)?;
        let temporary = self.path.with_extension("json.tmp");
        std::fs::write(&temporary, bytes)?;
        std::fs::rename(temporary, &self.path)?;
        Ok(())
    }
}

/// Computes the same short verification code on both devices from their public endpoint identities.
///
/// # Errors
///
/// Returns an error if either identity is invalid or both identities refer to the same device.
pub fn comparison_code(local_node_id: &str, remote_node_id: &str) -> Result<String> {
    validate_node_id(local_node_id)?;
    validate_node_id(remote_node_id)?;
    if local_node_id == remote_node_id {
        return Err(LightningP2PError::Other(
            "A device cannot be paired with itself.".into(),
        ));
    }
    let (first, second) = if local_node_id < remote_node_id {
        (local_node_id, remote_node_id)
    } else {
        (remote_node_id, local_node_id)
    };
    let mut hasher = Sha256::new();
    hasher.update(b"lightning-p2p/device-pair/v1\0");
    hasher.update(first.as_bytes());
    hasher.update([0]);
    hasher.update(second.as_bytes());
    let digest = hasher.finalize();
    let code = hex::encode(&digest[..8]);
    Ok(format!(
        "{}-{}-{}-{}",
        &code[..4],
        &code[4..8],
        &code[8..12],
        &code[12..16]
    ))
}

fn validate_node_id(node_id: &str) -> Result<()> {
    EndpointId::from_str(node_id)
        .map(|_| ())
        .map_err(|_| LightningP2PError::Other("The device identity is not valid.".into()))
}

fn normalize_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_DEVICE_NAME_CHARS {
        return Err(LightningP2PError::Other(
            "Use a device name from 1 to 64 characters.".into(),
        ));
    }
    Ok(name.to_owned())
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(seed: u8) -> String {
        iroh::SecretKey::from_bytes(&[seed; 32])
            .public()
            .to_string()
    }

    #[test]
    fn comparison_code_is_symmetric_and_bound_to_both_identities() {
        let first = identity(1);
        let second = identity(2);
        assert_eq!(
            comparison_code(&first, &second).unwrap(),
            comparison_code(&second, &first).unwrap()
        );
        assert_ne!(
            comparison_code(&first, &second).unwrap(),
            comparison_code(&first, &identity(3)).unwrap()
        );
    }

    #[tokio::test]
    async fn paired_devices_persist_rename_and_revoke() {
        let directory = tempfile::tempdir().unwrap();
        let store = PairedDevices::load(directory.path()).unwrap();
        let node_id = identity(9);
        assert!(!store.contains(&node_id).await);
        let devices = store.pair(&node_id, "  Desk PC  ").await.unwrap();
        assert_eq!(devices[0].name, "Desk PC");
        assert!(store.contains(&node_id).await);
        let reloaded = PairedDevices::load(directory.path()).unwrap();
        assert_eq!(reloaded.list().await, devices);
        reloaded.rename(&node_id, "Workstation").await.unwrap();
        assert_eq!(reloaded.list().await[0].name, "Workstation");
        assert!(reloaded.remove(&node_id).await.unwrap().is_empty());
        assert!(!reloaded.contains(&node_id).await);
    }

    #[tokio::test]
    async fn failed_persistence_does_not_mutate_the_live_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let occupied_path = directory.path().join("not-a-directory");
        std::fs::write(&occupied_path, b"occupied").unwrap();
        let store = PairedDevices::in_memory(&occupied_path);
        assert!(store.pair(&identity(7), "Laptop").await.is_err());
        assert!(store.list().await.is_empty());
    }

    #[test]
    fn comparison_code_rejects_invalid_and_self_identities() {
        assert!(comparison_code("bad", "also-bad").is_err());
        let node_id = identity(1);
        assert!(comparison_code(&node_id, &node_id).is_err());
    }
}
