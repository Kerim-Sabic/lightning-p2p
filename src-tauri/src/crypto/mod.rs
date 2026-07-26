//! Ed25519 identity management.
//!
//! iroh generates and manages the Ed25519 keypair for the QUIC endpoint.
//! This module provides optional secure storage of the secret key in the
//! OS keychain via the `keyring` crate. If the platform keychain is
//! unavailable, the module falls back to a profile-scoped key file in the app
//! data directory so endpoint identity remains stable in development, CI, and
//! mobile alpha environments.

use crate::error::{LightningP2PError, Result};
use iroh::SecretKey;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};

const SERVICE_NAME: &str = "com.lightningp2p.app";
const APP_IDENTIFIER: &str = "com.lightningp2p.app";
const KEY_NAME: &str = "iroh-secret-key";
const FALLBACK_KEY_FILE_NAME: &str = "iroh-secret-key.hex";
const CHAT_KEY_NAME: &str = "lightning-chat-nsec";
const CHAT_FALLBACK_KEY_FILE_NAME: &str = "lightning-chat-nsec";

/// Loads the persisted iroh identity key, or creates and persists one.
///
/// The OS keychain is preferred. If it is unavailable, Lightning P2P falls
/// back to an app-private key file under the configured data directory so the
/// node identity remains stable on CI, development machines, and mobile alpha
/// environments where the desktop keychain may not exist.
///
/// # Errors
///
/// Returns `LightningP2PError::Key` if a stored key cannot be parsed, or an IO
/// error if the fallback key file cannot be read or written.
pub fn load_or_create_secret_key(data_dir: &Path) -> Result<SecretKey> {
    let keychain_available = match load_secret_key(data_dir) {
        Ok(Some(bytes)) => return secret_key_from_bytes(&bytes),
        Ok(None) => true,
        Err(error) => {
            tracing::warn!(
                error = %error,
                "OS keychain unavailable for iroh identity; using app-data fallback"
            );
            false
        }
    };

    if let Some(bytes) = load_legacy_secret_key_for_default_profile(data_dir) {
        if let Err(error) = store_secret_key(data_dir, &bytes) {
            tracing::warn!(
                error = %error,
                "could not migrate legacy iroh identity to profile-scoped keychain entry"
            );
        }
        return secret_key_from_bytes(&bytes);
    }

    if let Some(bytes) = load_fallback_secret_key(data_dir)? {
        if keychain_available {
            if let Err(error) = store_secret_key(data_dir, &bytes) {
                tracing::warn!(
                    error = %error,
                    "could not migrate fallback iroh identity to OS keychain"
                );
            }
        }
        return secret_key_from_bytes(&bytes);
    }

    let key = SecretKey::generate();
    let bytes = key.to_bytes();
    if let Err(error) = store_secret_key(data_dir, &bytes) {
        tracing::warn!(
            error = %error,
            "could not store iroh identity in OS keychain; writing app-data fallback"
        );
        store_fallback_secret_key(data_dir, &bytes)?;
    }
    Ok(key)
}

/// Stores the iroh secret key bytes in the OS keychain.
///
/// # Errors
///
/// Returns `LightningP2PError::Key` if the keychain is unavailable.
pub fn store_secret_key(data_dir: &Path, key_bytes: &[u8]) -> Result<()> {
    let encoded = hex::encode(key_bytes);
    let account = keyring_account(data_dir);
    let entry = keyring::Entry::new(SERVICE_NAME, &account)
        .map_err(|e| LightningP2PError::Key(e.to_string()))?;
    entry
        .set_password(&encoded)
        .map_err(|e| LightningP2PError::Key(e.to_string()))?;
    Ok(())
}

/// Loads the iroh secret key bytes from the OS keychain.
///
/// Returns `None` if no key is stored yet.
///
/// # Errors
///
/// Returns `LightningP2PError::Key` if the keychain is unavailable
/// (not if the key simply doesn't exist).
pub fn load_secret_key(data_dir: &Path) -> Result<Option<Vec<u8>>> {
    let account = keyring_account(data_dir);
    let entry = keyring::Entry::new(SERVICE_NAME, &account)
        .map_err(|e| LightningP2PError::Key(e.to_string()))?;
    match entry.get_password() {
        Ok(encoded) => {
            let bytes = hex::decode(encoded).map_err(|e| LightningP2PError::Key(e.to_string()))?;
            Ok(Some(bytes))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(LightningP2PError::Key(e.to_string())),
    }
}

/// Loads the Nostr secret used by the isolated Lightning Chat feature.
///
/// # Errors
///
/// Returns `LightningP2PError::Key` when neither the OS keychain nor the
/// profile-scoped fallback can be read.
pub fn load_chat_secret(data_dir: &Path) -> Result<Option<String>> {
    let entry = chat_keyring_entry(data_dir)?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => load_chat_fallback(data_dir),
        Err(error) => {
            tracing::warn!(%error, "Lightning Chat keychain lookup failed; trying fallback");
            load_chat_fallback(data_dir)
        }
    }
}

/// Persists the Lightning Chat Nostr secret in the OS keychain, with an
/// app-private fallback for runtimes that do not expose a compatible keychain.
///
/// # Errors
///
/// Returns an error if the secret is malformed or no storage path succeeds.
pub fn store_chat_secret(data_dir: &Path, secret: &str) -> Result<()> {
    if !valid_chat_secret(secret) {
        return Err(LightningP2PError::Key(
            "Lightning Chat secret must be a valid nsec value".into(),
        ));
    }
    match chat_keyring_entry(data_dir)?.set_password(secret) {
        Ok(()) => {
            remove_chat_fallback(data_dir)?;
            Ok(())
        }
        Err(error) => {
            tracing::warn!(%error, "Lightning Chat keychain write failed; using fallback");
            store_chat_fallback(data_dir, secret)
        }
    }
}

/// Removes the Lightning Chat identity from all local storage locations.
///
/// # Errors
///
/// Returns an error if a stored fallback cannot be removed.
pub fn delete_chat_secret(data_dir: &Path) -> Result<()> {
    match chat_keyring_entry(data_dir)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(error) => {
            tracing::warn!(%error, "Lightning Chat keychain delete failed");
        }
    }
    remove_chat_fallback(data_dir)
}

fn load_legacy_secret_key_for_default_profile(data_dir: &Path) -> Option<Vec<u8>> {
    if !is_default_data_dir(data_dir) {
        return None;
    }

    let entry = keyring::Entry::new(SERVICE_NAME, KEY_NAME).ok()?;
    match entry.get_password() {
        Ok(encoded) => match hex::decode(encoded) {
            Ok(bytes) => {
                tracing::info!(
                    "migrating legacy global iroh identity to profile-scoped keychain entry"
                );
                Some(bytes)
            }
            Err(error) => {
                tracing::warn!(error = %error, "legacy iroh identity could not be decoded");
                None
            }
        },
        Err(keyring::Error::NoEntry) => None,
        Err(error) => {
            tracing::warn!(error = %error, "legacy iroh identity lookup failed");
            None
        }
    }
}

fn keyring_account(data_dir: &Path) -> String {
    format!("{KEY_NAME}:{}", data_dir_fingerprint(data_dir))
}

fn chat_keyring_entry(data_dir: &Path) -> Result<keyring::Entry> {
    let account = format!("{CHAT_KEY_NAME}:{}", data_dir_fingerprint(data_dir));
    keyring::Entry::new(SERVICE_NAME, &account)
        .map_err(|error| LightningP2PError::Key(error.to_string()))
}

fn chat_fallback_path(data_dir: &Path) -> PathBuf {
    data_dir.join(CHAT_FALLBACK_KEY_FILE_NAME)
}

fn load_chat_fallback(data_dir: &Path) -> Result<Option<String>> {
    let path = chat_fallback_path(data_dir);
    if !path.exists() {
        return Ok(None);
    }
    let secret = std::fs::read_to_string(path)?.trim().to_string();
    if !valid_chat_secret(&secret) {
        return Err(LightningP2PError::Key(
            "stored Lightning Chat identity is malformed".into(),
        ));
    }
    Ok(Some(secret))
}

fn store_chat_fallback(data_dir: &Path, secret: &str) -> Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let path = chat_fallback_path(data_dir);
    let mut options = std::fs::OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(secret.as_bytes())?;
    file.sync_all()?;
    Ok(())
}

fn remove_chat_fallback(data_dir: &Path) -> Result<()> {
    let path = chat_fallback_path(data_dir);
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn valid_chat_secret(secret: &str) -> bool {
    secret.starts_with("nsec1")
        && (50..=80).contains(&secret.len())
        && secret
            .chars()
            .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
}

fn data_dir_fingerprint(data_dir: &Path) -> String {
    let normalized = normalized_data_dir_namespace(data_dir);
    let digest = Sha256::digest(normalized.as_bytes());
    hex::encode(digest)
}

fn normalized_data_dir_namespace(data_dir: &Path) -> String {
    let path = std::fs::canonicalize(data_dir).unwrap_or_else(|_| data_dir.to_path_buf());
    let normalized = path.to_string_lossy().replace('\\', "/");
    #[cfg(windows)]
    {
        let mut normalized = normalized;
        normalized.make_ascii_lowercase();
        normalized
    }
    #[cfg(not(windows))]
    normalized
}

fn is_default_data_dir(data_dir: &Path) -> bool {
    let Some(default_dir) = default_data_dir() else {
        return false;
    };
    normalized_data_dir_namespace(data_dir) == normalized_data_dir_namespace(&default_dir)
}

fn default_data_dir() -> Option<PathBuf> {
    dirs::data_local_dir()
        .or_else(|| std::env::current_dir().ok())
        .map(|dir| dir.join(APP_IDENTIFIER))
}

fn secret_key_from_bytes(key_bytes: &[u8]) -> Result<SecretKey> {
    let bytes: [u8; 32] = key_bytes
        .try_into()
        .map_err(|_| LightningP2PError::Key("iroh secret key must be 32 bytes".into()))?;
    Ok(SecretKey::from_bytes(&bytes))
}

fn fallback_key_path(data_dir: &Path) -> PathBuf {
    data_dir.join(FALLBACK_KEY_FILE_NAME)
}

fn load_fallback_secret_key(data_dir: &Path) -> Result<Option<Vec<u8>>> {
    let path = fallback_key_path(data_dir);
    if !path.exists() {
        return Ok(None);
    }
    let encoded = std::fs::read_to_string(path)?;
    let bytes = hex::decode(encoded.trim()).map_err(|error| {
        LightningP2PError::Key(format!("invalid fallback iroh secret key: {error}"))
    })?;
    Ok(Some(bytes))
}

fn store_fallback_secret_key(data_dir: &Path, key_bytes: &[u8]) -> Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let path = fallback_key_path(data_dir);
    let tmp_path = path.with_extension("hex.tmp");
    let mut options = std::fs::OpenOptions::new();
    options.create(true).truncate(true).write(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    let mut file = options.open(&tmp_path)?;
    file.write_all(hex::encode(key_bytes).as_bytes())?;
    file.sync_all()?;
    std::fs::rename(tmp_path, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_secret_key_bytes() {
        let bytes = [7_u8; 32];
        let key = secret_key_from_bytes(&bytes).expect("valid key bytes");

        assert_eq!(key.to_bytes(), bytes);
    }

    #[test]
    fn rejects_invalid_secret_key_length() {
        let error = secret_key_from_bytes(&[1, 2, 3]).expect_err("invalid key length");

        assert!(error.to_string().contains("32 bytes"));
    }

    #[test]
    fn fallback_secret_key_round_trips() {
        let dir = tempfile::tempdir().expect("tempdir");
        let bytes = [11_u8; 32];

        store_fallback_secret_key(dir.path(), &bytes).expect("store fallback key");
        let loaded = load_fallback_secret_key(dir.path())
            .expect("load fallback key")
            .expect("fallback key");

        assert_eq!(loaded, bytes);
    }

    #[test]
    fn keyring_accounts_are_scoped_by_data_dir() {
        let first = tempfile::tempdir().expect("first tempdir");
        let second = tempfile::tempdir().expect("second tempdir");

        assert_eq!(keyring_account(first.path()), keyring_account(first.path()));
        assert_ne!(
            keyring_account(first.path()),
            keyring_account(second.path())
        );
    }

    #[test]
    fn chat_fallback_round_trips_and_deletes() {
        let dir = tempfile::tempdir().expect("tempdir");
        let secret = format!("nsec1{}", "q".repeat(58));

        store_chat_fallback(dir.path(), &secret).expect("store chat fallback");
        assert_eq!(
            load_chat_fallback(dir.path()).expect("load chat fallback"),
            Some(secret)
        );
        remove_chat_fallback(dir.path()).expect("remove chat fallback");
        assert_eq!(
            load_chat_fallback(dir.path()).expect("load removed fallback"),
            None
        );
    }

    #[test]
    fn rejects_malformed_chat_fallback() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(chat_fallback_path(dir.path()), "not-a-secret")
            .expect("write malformed fallback");

        let error = load_chat_fallback(dir.path()).expect_err("reject malformed fallback");

        assert!(error.to_string().contains("malformed"));
    }
}
