//! Ed25519 identity management.
//!
//! iroh generates and manages the Ed25519 keypair for the QUIC endpoint.
//! This module provides optional secure storage of the secret key in the
//! OS keychain via the `keyring` crate, so the identity persists across
//! app restarts without storing raw keys on disk.

use crate::error::{FastDropError, Result};

const SERVICE_NAME: &str = "com.lightningp2p.app";
const KEY_NAME: &str = "iroh-secret-key";

/// Stores the iroh secret key bytes in the OS keychain.
///
/// # Errors
///
/// Returns `FastDropError::Key` if the keychain is unavailable.
pub fn store_secret_key(key_bytes: &[u8]) -> Result<()> {
    let encoded = hex::encode(key_bytes);
    let entry = keyring::Entry::new(SERVICE_NAME, KEY_NAME)
        .map_err(|e| FastDropError::Key(e.to_string()))?;
    entry
        .set_password(&encoded)
        .map_err(|e| FastDropError::Key(e.to_string()))?;
    Ok(())
}

/// Loads the iroh secret key bytes from the OS keychain.
///
/// Returns `None` if no key is stored yet.
///
/// # Errors
///
/// Returns `FastDropError::Key` if the keychain is unavailable
/// (not if the key simply doesn't exist).
pub fn load_secret_key() -> Result<Option<Vec<u8>>> {
    let entry = keyring::Entry::new(SERVICE_NAME, KEY_NAME)
        .map_err(|e| FastDropError::Key(e.to_string()))?;
    match entry.get_password() {
        Ok(encoded) => {
            let bytes = hex::decode(encoded).map_err(|e| FastDropError::Key(e.to_string()))?;
            Ok(Some(bytes))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(FastDropError::Key(e.to_string())),
    }
}
