#![allow(clippy::missing_errors_doc)]

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashSet;
use std::path::Path;

const TAG_BYTES: usize = 16;
const MAX_CIPHERTEXT_BYTES: usize = 16 * 1024;
const MAX_LIFETIME_MS: u64 = 24 * 60 * 60 * 1_000;
const CLOCK_SKEW_MS: u64 = 60 * 60 * 1_000;
const MAX_COPIES: u8 = 8;
const MAX_ENVELOPES: usize = 40;
const MAX_VERIFIED_ENVELOPES: usize = 20;
const MAX_FAVORITE_PER_DEPOSITOR: usize = 5;
const MAX_VERIFIED_PER_DEPOSITOR: usize = 2;
const RECIPIENT_TAG_CONTEXT: [u8; 22] = [
    98, 105, 116, 99, 104, 97, 116, 45, 99, 111, 117, 114, 105, 101, 114, 45, 116, 97, 103, 45,
    118, 49,
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CourierEnvelope {
    pub recipient_tag: [u8; TAG_BYTES],
    pub expiry_ms: u64,
    pub ciphertext: Vec<u8>,
    pub copies: u8,
    pub prekey_id: Option<u32>,
}

impl CourierEnvelope {
    /// Creates the daily rotating recipient tag used for opaque routing.
    ///
    /// # Errors
    ///
    /// Returns an error only if the HMAC key cannot be initialized.
    pub fn recipient_tag(static_public_key: &[u8], epoch_day: u32) -> Result<[u8; 16], String> {
        let mut mac =
            Hmac::<Sha256>::new_from_slice(static_public_key).map_err(|error| error.to_string())?;
        mac.update(&RECIPIENT_TAG_CONTEXT);
        mac.update(&epoch_day.to_be_bytes());
        mac.finalize().into_bytes()[..TAG_BYTES]
            .try_into()
            .map_err(|_| "recipient tag has an invalid size".into())
    }

    /// Encodes the bounded courier TLV payload.
    ///
    /// # Errors
    ///
    /// Returns an error when ciphertext or copy count exceeds protocol bounds.
    pub fn encode(&self) -> Result<Vec<u8>, String> {
        self.validate_shape()?;
        let mut out = Vec::with_capacity(self.ciphertext.len() + 64);
        put_tlv(&mut out, 0x01, &self.recipient_tag)?;
        put_tlv(&mut out, 0x02, &self.expiry_ms.to_be_bytes())?;
        put_tlv(&mut out, 0x03, &self.ciphertext)?;
        if self.copies > 1 {
            put_tlv(&mut out, 0x04, &[self.copies])?;
        }
        if let Some(prekey_id) = self.prekey_id {
            put_tlv(&mut out, 0x05, &prekey_id.to_be_bytes())?;
        }
        Ok(out)
    }

    /// Decodes a courier TLV payload while ignoring unknown extension fields.
    ///
    /// # Errors
    ///
    /// Returns an error for malformed lengths, missing required fields, or
    /// values outside resource limits.
    pub fn decode(data: &[u8]) -> Result<Self, String> {
        let mut recipient_tag = None;
        let mut expiry_ms = None;
        let mut ciphertext = None;
        let mut copies = None;
        let mut prekey_id = None;
        let mut offset = 0;
        while offset < data.len() {
            let field_type = *data
                .get(offset)
                .ok_or_else(|| "courier TLV type is missing".to_string())?;
            offset += 1;
            let length_bytes = data
                .get(offset..offset + 2)
                .ok_or_else(|| "courier TLV length is truncated".to_string())?;
            offset += 2;
            let length = usize::from(u16::from_be_bytes([length_bytes[0], length_bytes[1]]));
            let value = data
                .get(offset..offset + length)
                .ok_or_else(|| "courier TLV value is truncated".to_string())?;
            offset += length;
            match (field_type, value.len()) {
                (0x01, TAG_BYTES) => {
                    recipient_tag = Some(value.try_into().map_err(|_| "invalid recipient tag")?);
                }
                (0x02, 8) => {
                    expiry_ms = Some(u64::from_be_bytes(
                        value.try_into().map_err(|_| "invalid courier expiry")?,
                    ));
                }
                (0x03, _) => ciphertext = Some(value.to_vec()),
                (0x04, 1) => copies = value.first().copied(),
                (0x05, 4) => {
                    prekey_id = Some(u32::from_be_bytes(
                        value.try_into().map_err(|_| "invalid prekey id")?,
                    ));
                }
                _ => {}
            }
        }
        let envelope = Self {
            recipient_tag: recipient_tag
                .ok_or_else(|| "courier recipient tag is missing".to_string())?,
            expiry_ms: expiry_ms.ok_or_else(|| "courier expiry is missing".to_string())?,
            ciphertext: ciphertext.ok_or_else(|| "courier ciphertext is missing".to_string())?,
            copies: copies.unwrap_or(1),
            prekey_id,
        };
        envelope.validate_shape()?;
        Ok(envelope)
    }

    fn validate_shape(&self) -> Result<(), String> {
        if self.ciphertext.is_empty() || self.ciphertext.len() > MAX_CIPHERTEXT_BYTES {
            return Err("courier ciphertext exceeds the text-message limit".into());
        }
        if !(1..=MAX_COPIES).contains(&self.copies) {
            return Err("courier copy budget is invalid".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CourierDepositTier {
    Favorite,
    Verified,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredEnvelope {
    recipient_tag: [u8; TAG_BYTES],
    expiry_ms: u64,
    ciphertext: Vec<u8>,
    depositor_key: Vec<u8>,
    stored_at_ms: u64,
    tier: CourierDepositTier,
    copies: u8,
    sprayed_to: HashSet<Vec<u8>>,
    prekey_id: Option<u32>,
}

impl StoredEnvelope {
    fn envelope(&self) -> CourierEnvelope {
        CourierEnvelope {
            recipient_tag: self.recipient_tag,
            expiry_ms: self.expiry_ms,
            ciphertext: self.ciphertext.clone(),
            copies: self.copies,
            prekey_id: self.prekey_id,
        }
    }

    fn same_envelope(&self, envelope: &CourierEnvelope) -> bool {
        self.recipient_tag == envelope.recipient_tag
            && self.expiry_ms == envelope.expiry_ms
            && self.ciphertext == envelope.ciphertext
            && self.prekey_id == envelope.prekey_id
    }
}

#[derive(Debug, Default)]
pub struct CourierStore {
    envelopes: Vec<StoredEnvelope>,
}

impl CourierStore {
    #[must_use]
    pub fn len(&self) -> usize {
        self.envelopes.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.envelopes.is_empty()
    }

    pub fn deposit(
        &mut self,
        envelope: CourierEnvelope,
        depositor_key: Vec<u8>,
        tier: CourierDepositTier,
        now_ms: u64,
    ) -> bool {
        self.prune(now_ms);
        if envelope.validate_shape().is_err()
            || envelope.expiry_ms <= now_ms
            || envelope.expiry_ms > now_ms.saturating_add(MAX_LIFETIME_MS + CLOCK_SKEW_MS)
            || depositor_key.is_empty()
            || self
                .envelopes
                .iter()
                .any(|stored| stored.same_envelope(&envelope))
        {
            return false;
        }
        let per_depositor_limit = match tier {
            CourierDepositTier::Favorite => MAX_FAVORITE_PER_DEPOSITOR,
            CourierDepositTier::Verified => MAX_VERIFIED_PER_DEPOSITOR,
        };
        let depositor_count = self
            .envelopes
            .iter()
            .filter(|stored| stored.depositor_key == depositor_key)
            .count();
        if depositor_count >= per_depositor_limit {
            return false;
        }
        if tier == CourierDepositTier::Verified
            && self
                .envelopes
                .iter()
                .filter(|stored| stored.tier == CourierDepositTier::Verified)
                .count()
                >= MAX_VERIFIED_ENVELOPES
        {
            return false;
        }
        if self.envelopes.len() >= MAX_ENVELOPES && !self.evict_for(tier) {
            return false;
        }
        self.envelopes.push(StoredEnvelope {
            recipient_tag: envelope.recipient_tag,
            expiry_ms: envelope.expiry_ms,
            ciphertext: envelope.ciphertext,
            depositor_key,
            stored_at_ms: now_ms,
            tier,
            copies: envelope.copies,
            sprayed_to: HashSet::new(),
            prekey_id: envelope.prekey_id,
        });
        true
    }

    pub fn take_for_recipient(
        &mut self,
        current_tag: &[u8; TAG_BYTES],
        previous_tag: &[u8; TAG_BYTES],
        now_ms: u64,
    ) -> Vec<CourierEnvelope> {
        self.prune(now_ms);
        let mut delivered = Vec::new();
        self.envelopes.retain(|stored| {
            if &stored.recipient_tag == current_tag || &stored.recipient_tag == previous_tag {
                delivered.push(stored.envelope());
                false
            } else {
                true
            }
        });
        delivered
    }

    pub fn spray_to(
        &mut self,
        courier_key: &[u8],
        limit: usize,
        now_ms: u64,
    ) -> Vec<CourierEnvelope> {
        self.prune(now_ms);
        let mut sprayed = Vec::new();
        for stored in &mut self.envelopes {
            if sprayed.len() >= limit {
                break;
            }
            if stored.copies <= 1 || stored.sprayed_to.contains(courier_key) {
                continue;
            }
            let handed = stored.copies / 2;
            stored.copies -= handed;
            stored.sprayed_to.insert(courier_key.to_vec());
            let mut envelope = stored.envelope();
            envelope.copies = handed.max(1);
            sprayed.push(envelope);
        }
        sprayed
    }

    /// Loads a bounded courier store from disk.
    ///
    /// # Errors
    ///
    /// Returns an error when the file cannot be read or decoded.
    pub fn load(path: &Path, now_ms: u64) -> Result<Self, String> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
        let envelopes = serde_json::from_slice::<Vec<StoredEnvelope>>(&bytes)
            .map_err(|error| error.to_string())?;
        let mut store = Self { envelopes };
        store.prune(now_ms);
        store.envelopes.truncate(MAX_ENVELOPES);
        Ok(store)
    }

    /// Atomically saves carried opaque envelopes.
    ///
    /// # Errors
    ///
    /// Returns an error when the directory or archive cannot be written.
    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let tmp = path.with_extension("json.tmp");
        let bytes = serde_json::to_vec(&self.envelopes).map_err(|error| error.to_string())?;
        std::fs::write(&tmp, bytes).map_err(|error| error.to_string())?;
        std::fs::rename(tmp, path).map_err(|error| error.to_string())
    }

    pub fn wipe(path: &Path) -> Result<(), String> {
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }

    fn evict_for(&mut self, incoming_tier: CourierDepositTier) -> bool {
        let candidate = match incoming_tier {
            CourierDepositTier::Favorite => self
                .envelopes
                .iter()
                .enumerate()
                .filter(|(_, stored)| stored.tier == CourierDepositTier::Verified)
                .min_by_key(|(_, stored)| stored.stored_at_ms)
                .or_else(|| {
                    self.envelopes
                        .iter()
                        .enumerate()
                        .min_by_key(|(_, stored)| stored.stored_at_ms)
                }),
            CourierDepositTier::Verified => self
                .envelopes
                .iter()
                .enumerate()
                .filter(|(_, stored)| stored.tier == CourierDepositTier::Verified)
                .min_by_key(|(_, stored)| stored.stored_at_ms),
        };
        if let Some((index, _)) = candidate {
            self.envelopes.remove(index);
            true
        } else {
            false
        }
    }

    fn prune(&mut self, now_ms: u64) {
        self.envelopes.retain(|stored| {
            stored.expiry_ms > now_ms
                && now_ms.saturating_sub(stored.stored_at_ms) <= MAX_LIFETIME_MS + CLOCK_SKEW_MS
        });
    }
}

fn put_tlv(out: &mut Vec<u8>, field_type: u8, value: &[u8]) -> Result<(), String> {
    let length = u16::try_from(value.len()).map_err(|_| "courier TLV value is too large")?;
    out.push(field_type);
    out.extend(length.to_be_bytes());
    out.extend(value);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn envelope(expiry_ms: u64, marker: u8, copies: u8) -> CourierEnvelope {
        CourierEnvelope {
            recipient_tag: [marker; 16],
            expiry_ms,
            ciphertext: vec![marker; 64],
            copies,
            prekey_id: Some(u32::from(marker)),
        }
    }

    #[test]
    fn envelope_tlv_round_trips() {
        let envelope = envelope(50_000, 7, 4);
        let decoded = CourierEnvelope::decode(&envelope.encode().expect("encode")).expect("decode");
        assert_eq!(decoded, envelope);
    }

    #[test]
    fn store_delivers_for_current_or_previous_rotating_tag() {
        let mut store = CourierStore::default();
        assert!(store.deposit(
            envelope(50_000, 7, 2),
            vec![1; 32],
            CourierDepositTier::Favorite,
            1_000,
        ));
        let delivered = store.take_for_recipient(&[8; 16], &[7; 16], 2_000);

        assert_eq!(delivered.len(), 1);
        assert_eq!(store.len(), 0);
    }

    #[test]
    fn spray_uses_binary_copy_budget_once_per_courier() {
        let mut store = CourierStore::default();
        store.deposit(
            envelope(50_000, 7, 8),
            vec![1; 32],
            CourierDepositTier::Favorite,
            1_000,
        );
        let first = store.spray_to(&[9; 32], 10, 2_000);
        let second = store.spray_to(&[9; 32], 10, 2_001);

        assert_eq!(first[0].copies, 4);
        assert_eq!(second, Vec::new());
    }

    #[test]
    fn verified_quota_is_stricter_than_favorite_quota() {
        let mut store = CourierStore::default();
        assert!(store.deposit(
            envelope(50_000, 1, 1),
            vec![2; 32],
            CourierDepositTier::Verified,
            1_000,
        ));
        assert!(store.deposit(
            envelope(50_000, 2, 1),
            vec![2; 32],
            CourierDepositTier::Verified,
            1_001,
        ));
        assert!(!store.deposit(
            envelope(50_000, 3, 1),
            vec![2; 32],
            CourierDepositTier::Verified,
            1_002,
        ));
    }

    #[test]
    fn recipient_tag_matches_the_deployed_fixture() {
        assert_eq!(
            hex::encode(CourierEnvelope::recipient_tag(&[0x11; 32], 20_000).expect("tag")),
            "173d54ec4ce3de7b45d355eea6500dde"
        );
    }

    #[test]
    fn carry_only_envelopes_omit_the_copy_extension() {
        let encoded = envelope(1_720_000_000_000, 7, 1).encode().expect("encode");

        assert!(!encoded
            .windows(4)
            .any(|window| window == [0x04, 0x00, 0x01, 0x01]));
        assert_eq!(CourierEnvelope::decode(&encoded).expect("decode").copies, 1);
    }
}
