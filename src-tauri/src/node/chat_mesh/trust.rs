#![allow(
    clippy::cast_possible_truncation,
    clippy::missing_panics_doc,
    clippy::struct_field_names
)]

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;
use x25519_dalek::{PublicKey as NoisePublicKey, StaticSecret};

const MAX_QR_AGE_SECONDS: i64 = 5 * 60;
const MAX_CLOCK_SKEW_SECONDS: i64 = 60;
const MAX_NICKNAME_BYTES: usize = 64;
const VERIFY_CONTEXT: [u8; 17] = [
    98, 105, 116, 99, 104, 97, 116, 45, 118, 101, 114, 105, 102, 121, 45, 118, 49,
];
const URI_SCHEME: [u8; 7] = [98, 105, 116, 99, 104, 97, 116];

pub struct MeshIdentity {
    noise_private_key: [u8; 32],
    noise_public_key: [u8; 32],
    signing_key: SigningKey,
}

impl MeshIdentity {
    /// Generates separate static Noise and Ed25519 signing identities.
    ///
    /// # Errors
    ///
    /// Returns an error when the Noise provider cannot generate a keypair.
    pub fn generate() -> Result<Self, String> {
        let mut noise_private_key = [0_u8; 32];
        rand::thread_rng().fill_bytes(&mut noise_private_key);
        let noise_secret = StaticSecret::from(noise_private_key);
        let noise_public_key = NoisePublicKey::from(&noise_secret).to_bytes();
        let signing_key = SigningKey::generate(&mut rand::rngs::OsRng);
        Ok(Self {
            noise_private_key,
            noise_public_key,
            signing_key,
        })
    }

    /// Reconstructs a stored mesh identity.
    ///
    /// # Errors
    ///
    /// Returns an error when the Noise secret cannot produce a public key.
    pub fn from_secrets(
        noise_private_key: [u8; 32],
        signing_private_key: [u8; 32],
    ) -> Result<Self, String> {
        let noise_secret = StaticSecret::from(noise_private_key);
        let noise_public_key = NoisePublicKey::from(&noise_secret).to_bytes();
        Ok(Self {
            noise_private_key,
            noise_public_key,
            signing_key: SigningKey::from_bytes(&signing_private_key),
        })
    }

    #[must_use]
    pub const fn noise_private_key(&self) -> [u8; 32] {
        self.noise_private_key
    }

    #[must_use]
    pub const fn noise_public_key(&self) -> [u8; 32] {
        self.noise_public_key
    }

    #[must_use]
    pub fn signing_public_key(&self) -> [u8; 32] {
        self.signing_key.verifying_key().to_bytes()
    }

    #[must_use]
    pub fn secret_bytes(&self) -> ([u8; 32], [u8; 32]) {
        (self.noise_private_key, self.signing_key.to_bytes())
    }

    #[must_use]
    pub fn peer_id(&self) -> [u8; 8] {
        Sha256::digest(self.noise_public_key)[..8]
            .try_into()
            .expect("SHA-256 always contains eight bytes")
    }

    #[must_use]
    pub fn fingerprint(&self) -> [u8; 32] {
        Sha256::digest(self.noise_public_key).into()
    }

    #[must_use]
    pub fn sign(&self, bytes: &[u8]) -> [u8; 64] {
        self.signing_key.sign(bytes).to_bytes()
    }

    #[must_use]
    pub fn verify(signing_key: &[u8; 32], bytes: &[u8], signature: &[u8; 64]) -> bool {
        VerifyingKey::from_bytes(signing_key)
            .is_ok_and(|key| key.verify(bytes, &Signature::from_bytes(signature)).is_ok())
    }

    pub(crate) fn signing_key(&self) -> &SigningKey {
        &self.signing_key
    }

    pub(crate) fn encode_secret(&self) -> Result<String, String> {
        serde_json::to_string(&StoredMeshIdentity::from(self)).map_err(|error| error.to_string())
    }

    pub(crate) fn decode_secret(value: &str) -> Result<Self, String> {
        let stored =
            serde_json::from_str::<StoredMeshIdentity>(value).map_err(|error| error.to_string())?;
        stored.try_into()
    }

    /// Builds a signed, short-lived QR trust record.
    ///
    /// # Errors
    ///
    /// Returns an error for invalid nickname size or URL construction.
    pub fn signed_trust_record(
        &self,
        nickname: String,
        npub: Option<String>,
        timestamp_seconds: i64,
    ) -> Result<TrustRecord, String> {
        if nickname.is_empty() || nickname.len() > MAX_NICKNAME_BYTES {
            return Err("trust nickname is outside limits".into());
        }
        let mut nonce = [0_u8; 16];
        rand::thread_rng().fill_bytes(&mut nonce);
        let mut record = TrustRecord {
            version: 1,
            noise_key: self.noise_public_key,
            signing_key: self.signing_public_key(),
            npub,
            nickname,
            timestamp_seconds,
            nonce,
            signature: [0_u8; 64],
        };
        record.signature = self.signing_key.sign(&record.canonical_bytes()).to_bytes();
        Ok(record)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrustRecord {
    pub version: u8,
    pub noise_key: [u8; 32],
    pub signing_key: [u8; 32],
    pub npub: Option<String>,
    pub nickname: String,
    pub timestamp_seconds: i64,
    pub nonce: [u8; 16],
    pub signature: [u8; 64],
}

impl TrustRecord {
    #[must_use]
    pub fn canonical_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        for field in [
            String::from_utf8_lossy(&VERIFY_CONTEXT).into_owned(),
            self.version.to_string(),
            hex::encode(self.noise_key),
            hex::encode(self.signing_key),
            self.npub.clone().unwrap_or_default(),
            self.nickname.clone(),
            self.timestamp_seconds.to_string(),
            URL_SAFE_NO_PAD.encode(self.nonce),
        ] {
            let bytes = field.as_bytes();
            let length = bytes.len().min(255);
            out.push(length as u8);
            out.extend(&bytes[..length]);
        }
        out
    }

    /// Encodes the trust record as the deployed verification URL form.
    ///
    /// # Errors
    ///
    /// Returns an error if the scheme cannot be constructed.
    pub fn to_url(&self) -> Result<String, String> {
        let scheme = String::from_utf8(URI_SCHEME.to_vec()).map_err(|error| error.to_string())?;
        let mut url =
            Url::parse(&format!("{scheme}://verify")).map_err(|error| error.to_string())?;
        url.query_pairs_mut()
            .append_pair("v", &self.version.to_string())
            .append_pair("noise", &hex::encode(self.noise_key))
            .append_pair("sign", &hex::encode(self.signing_key))
            .append_pair("nick", &self.nickname)
            .append_pair("ts", &self.timestamp_seconds.to_string())
            .append_pair("nonce", &URL_SAFE_NO_PAD.encode(self.nonce))
            .append_pair("sig", &hex::encode(self.signature));
        if let Some(npub) = &self.npub {
            url.query_pairs_mut().append_pair("npub", npub);
        }
        Ok(url.into())
    }

    /// Parses a verification URL without trusting its embedded keys.
    ///
    /// # Errors
    ///
    /// Returns an error for the wrong scheme/host or malformed fields.
    pub fn from_url(value: &str) -> Result<Self, String> {
        let url = Url::parse(value).map_err(|error| error.to_string())?;
        let scheme = String::from_utf8(URI_SCHEME.to_vec()).map_err(|error| error.to_string())?;
        if url.scheme() != scheme || url.host_str() != Some("verify") {
            return Err("not a Lightning Chat verification URL".into());
        }
        let values = url
            .query_pairs()
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect::<std::collections::HashMap<_, _>>();
        let get = |key: &str| {
            values
                .get(key)
                .cloned()
                .ok_or_else(|| format!("trust field {key} is missing"))
        };
        let version = get("v")?.parse::<u8>().map_err(|error| error.to_string())?;
        let noise_key = decode_hex_array::<32>(&get("noise")?)?;
        let signing_key = decode_hex_array::<32>(&get("sign")?)?;
        let nickname = get("nick")?;
        if nickname.is_empty() || nickname.len() > MAX_NICKNAME_BYTES {
            return Err("trust nickname is outside limits".into());
        }
        let timestamp_seconds = get("ts")?
            .parse::<i64>()
            .map_err(|error| error.to_string())?;
        let nonce = URL_SAFE_NO_PAD
            .decode(get("nonce")?)
            .map_err(|error| error.to_string())?
            .try_into()
            .map_err(|_| "trust nonce has an invalid size")?;
        let signature = decode_hex_array::<64>(&get("sig")?)?;
        Ok(Self {
            version,
            noise_key,
            signing_key,
            npub: values.get("npub").cloned(),
            nickname,
            timestamp_seconds,
            nonce,
            signature,
        })
    }

    /// Verifies signature and freshness.
    ///
    /// # Errors
    ///
    /// Returns an error when the record is expired, from too far in the
    /// future, uses another version, or has an invalid signature.
    pub fn verify(&self, now_seconds: i64) -> Result<(), String> {
        if self.version != 1 {
            return Err("unsupported trust record version".into());
        }
        let age = now_seconds.saturating_sub(self.timestamp_seconds);
        if age > MAX_QR_AGE_SECONDS {
            return Err("trust record has expired".into());
        }
        if age < -MAX_CLOCK_SKEW_SECONDS {
            return Err("trust record timestamp is too far in the future".into());
        }
        let key = VerifyingKey::from_bytes(&self.signing_key).map_err(|error| error.to_string())?;
        key.verify(
            &self.canonical_bytes(),
            &Signature::from_bytes(&self.signature),
        )
        .map_err(|_| "trust record signature is invalid".into())
    }
}

fn decode_hex_array<const N: usize>(value: &str) -> Result<[u8; N], String> {
    hex::decode(value)
        .map_err(|error| error.to_string())?
        .try_into()
        .map_err(|_| format!("trust field must contain {N} bytes"))
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct StoredMeshIdentity {
    pub noise_private_key: String,
    pub signing_private_key: String,
}

impl From<&MeshIdentity> for StoredMeshIdentity {
    fn from(identity: &MeshIdentity) -> Self {
        let (noise, signing) = identity.secret_bytes();
        Self {
            noise_private_key: hex::encode(noise),
            signing_private_key: hex::encode(signing),
        }
    }
}

impl TryFrom<StoredMeshIdentity> for MeshIdentity {
    type Error = String;

    fn try_from(value: StoredMeshIdentity) -> Result<Self, Self::Error> {
        Self::from_secrets(
            decode_hex_array(&value.noise_private_key)?,
            decode_hex_array(&value.signing_private_key)?,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signed_trust_record_round_trips_and_verifies() {
        let identity = MeshIdentity::generate().expect("identity");
        let record = identity
            .signed_trust_record("Alice".into(), Some("npub1example".into()), 1_000)
            .expect("record");
        let decoded = TrustRecord::from_url(&record.to_url().expect("url")).expect("decode");

        assert_eq!(decoded, record);
        decoded.verify(1_030).expect("verify");
    }

    #[test]
    fn expired_or_tampered_record_is_rejected() {
        let identity = MeshIdentity::generate().expect("identity");
        let record = identity
            .signed_trust_record("Alice".into(), None, 1_000)
            .expect("record");
        assert!(record.verify(2_000).is_err());

        let mut tampered = record;
        tampered.nickname = "Mallory".into();
        assert!(tampered.verify(1_030).is_err());
    }

    #[test]
    fn stored_identity_restores_public_keys() {
        let identity = MeshIdentity::generate().expect("identity");
        let restored =
            MeshIdentity::try_from(StoredMeshIdentity::from(&identity)).expect("restore");

        assert_eq!(restored.noise_public_key(), identity.noise_public_key());
        assert_eq!(restored.signing_public_key(), identity.signing_public_key());
    }
}
