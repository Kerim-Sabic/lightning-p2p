#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::missing_errors_doc
)]

use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::path::Path;

const MAX_FILTER_P: u8 = 32;
const DEFAULT_FILTER_BYTES: usize = 384;
const DEFAULT_FALSE_POSITIVE_RATE: f64 = 0.001;
const MAX_ARCHIVE_PACKETS: usize = 2_048;
const ARCHIVE_RETENTION_MS: u64 = 24 * 60 * 60 * 1_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GossipFilter {
    pub p: u8,
    pub modulus: u32,
    pub data: Vec<u8>,
    pub included_count: usize,
}

impl GossipFilter {
    #[must_use]
    pub fn build(ids: &[[u8; 16]]) -> Self {
        Self::build_with_budget(ids, DEFAULT_FILTER_BYTES, DEFAULT_FALSE_POSITIVE_RATE)
    }

    #[must_use]
    pub fn build_with_budget(ids: &[[u8; 16]], max_bytes: usize, target_fpr: f64) -> Self {
        let p = derive_p(target_fpr);
        if ids.is_empty() {
            return Self {
                p,
                modulus: 1,
                data: Vec::new(),
                included_count: 0,
            };
        }
        let cap = estimate_max_elements(max_bytes, p);
        let candidate_count = ids.len().min(cap);
        let modulus = hash_range(candidate_count, p);

        let encode_first = |count: usize| {
            let mut values = ids[..count]
                .iter()
                .map(hash_id)
                .map(|hash| map_hash(hash, u64::from(modulus)))
                .collect::<Vec<_>>();
            values.sort_unstable();
            values.dedup();
            encode_values(&values, p)
        };

        let mut count = candidate_count;
        let mut data = encode_first(count);
        while data.len() > max_bytes && count > 1 {
            count = (count * 9 / 10).max(1);
            data = encode_first(count);
        }
        if data.len() > max_bytes {
            data.clear();
            count = 0;
        }
        Self {
            p,
            modulus,
            included_count: if data.is_empty() { 0 } else { count },
            data,
        }
    }

    #[must_use]
    pub fn contains(&self, id: &[u8; 16]) -> bool {
        if self.p == 0 || self.p > MAX_FILTER_P || self.modulus <= 1 || self.data.is_empty() {
            return false;
        }
        let target = map_hash(hash_id(id), u64::from(self.modulus));
        decode_values(self.p, self.modulus, &self.data)
            .binary_search(&target)
            .is_ok()
    }

    #[must_use]
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(5 + self.data.len());
        out.push(self.p);
        out.extend(self.modulus.to_be_bytes());
        out.extend(&self.data);
        out
    }

    /// Decodes the compact GCS request body.
    ///
    /// # Errors
    ///
    /// Returns an error when parameters exceed protocol bounds.
    pub fn decode(data: &[u8]) -> Result<Self, String> {
        if data.len() < 5 {
            return Err("gossip filter is truncated".into());
        }
        let p = data[0];
        let modulus = u32::from_be_bytes(
            data[1..5]
                .try_into()
                .map_err(|_| "invalid gossip modulus")?,
        );
        if p == 0 || p > MAX_FILTER_P || modulus <= 1 {
            return Err("gossip filter parameters are invalid".into());
        }
        Ok(Self {
            p,
            modulus,
            data: data[5..].to_vec(),
            included_count: 0,
        })
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct ArchivedPacket {
    id: [u8; 16],
    received_at_ms: u64,
    bytes: Vec<u8>,
}

#[derive(Debug, Default)]
pub struct GossipStore {
    packets: VecDeque<ArchivedPacket>,
}

impl GossipStore {
    pub fn insert(&mut self, bytes: Vec<u8>, received_at_ms: u64) -> [u8; 16] {
        self.prune(received_at_ms);
        let id = packet_id(&bytes);
        if self.packets.iter().any(|packet| packet.id == id) {
            return id;
        }
        self.packets.push_front(ArchivedPacket {
            id,
            received_at_ms,
            bytes,
        });
        self.packets.truncate(MAX_ARCHIVE_PACKETS);
        id
    }

    #[must_use]
    pub fn filter(&self) -> GossipFilter {
        let ids = self
            .packets
            .iter()
            .map(|packet| packet.id)
            .collect::<Vec<_>>();
        GossipFilter::build(&ids)
    }

    #[must_use]
    pub fn packets_missing_from(&self, peer_filter: &GossipFilter, limit: usize) -> Vec<Vec<u8>> {
        self.packets
            .iter()
            .filter(|packet| !peer_filter.contains(&packet.id))
            .take(limit)
            .map(|packet| packet.bytes.clone())
            .collect()
    }

    /// Loads a persisted public-message archive.
    ///
    /// # Errors
    ///
    /// Returns an error when the file cannot be read or decoded.
    pub fn load(path: &Path, now_ms: u64) -> Result<Self, String> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
        let packets = serde_json::from_slice::<VecDeque<ArchivedPacket>>(&bytes)
            .map_err(|error| error.to_string())?;
        let mut store = Self { packets };
        store.prune(now_ms);
        store.packets.truncate(MAX_ARCHIVE_PACKETS);
        Ok(store)
    }

    /// Atomically persists the bounded public-message archive.
    ///
    /// # Errors
    ///
    /// Returns an error when the parent directory or archive cannot be
    /// written.
    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let tmp = path.with_extension("json.tmp");
        let bytes = serde_json::to_vec(&self.packets).map_err(|error| error.to_string())?;
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

    fn prune(&mut self, now_ms: u64) {
        self.packets
            .retain(|packet| now_ms.saturating_sub(packet.received_at_ms) <= ARCHIVE_RETENTION_MS);
    }
}

fn packet_id(bytes: &[u8]) -> [u8; 16] {
    Sha256::digest(bytes)[..16]
        .try_into()
        .expect("SHA-256 always contains 16 bytes")
}

fn derive_p(target_fpr: f64) -> u8 {
    let clamped = target_fpr.clamp(0.000_001, 0.25);
    (1.0 / clamped)
        .log2()
        .ceil()
        .clamp(1.0, f64::from(MAX_FILTER_P)) as u8
}

fn estimate_max_elements(size_bytes: usize, p: u8) -> usize {
    (size_bytes.saturating_mul(8).max(8) / (usize::from(p) + 2).max(3)).max(1)
}

fn hash_range(count: usize, p: u8) -> u32 {
    let multiplier = 1_u64.checked_shl(u32::from(p)).unwrap_or(u64::MAX);
    u64::try_from(count)
        .unwrap_or(u64::MAX)
        .saturating_mul(multiplier)
        .clamp(1, u64::from(u32::MAX)) as u32
}

fn hash_id(id: &[u8; 16]) -> u64 {
    let digest = Sha256::digest(id);
    u64::from_be_bytes(digest[..8].try_into().expect("digest length")) & 0x7fff_ffff_ffff_ffff
}

fn map_hash(hash: u64, modulus: u64) -> u64 {
    if modulus <= 1 {
        return 0;
    }
    let value = hash % modulus;
    if value == 0 {
        1
    } else {
        value
    }
}

fn encode_values(values: &[u64], p: u8) -> Vec<u8> {
    let mut writer = BitWriter::default();
    let mask = (1_u64 << p) - 1;
    let mut previous = 0_u64;
    for value in values {
        let delta = value.saturating_sub(previous);
        previous = *value;
        if delta == 0 {
            continue;
        }
        let adjusted = delta - 1;
        let quotient = adjusted >> p;
        let remainder = adjusted & mask;
        writer.write_ones(usize::try_from(quotient).unwrap_or(usize::MAX));
        writer.write_bit(false);
        writer.write_bits(remainder, p);
    }
    writer.finish()
}

fn decode_values(p: u8, modulus: u32, data: &[u8]) -> Vec<u64> {
    let mut reader = BitReader::new(data);
    let mut values = Vec::new();
    let mut accumulator = 0_u64;
    while let Some(quotient) = reader.read_unary() {
        let Some(remainder) = reader.read_bits(p) else {
            break;
        };
        let Some(delta) = quotient
            .checked_shl(u32::from(p))
            .and_then(|value| value.checked_add(remainder))
            .and_then(|value| value.checked_add(1))
        else {
            break;
        };
        accumulator = accumulator.saturating_add(delta);
        if accumulator >= u64::from(modulus) {
            break;
        }
        values.push(accumulator);
    }
    values
}

#[derive(Default)]
struct BitWriter {
    bytes: Vec<u8>,
    current: u8,
    bits: u8,
}

impl BitWriter {
    fn write_bit(&mut self, bit: bool) {
        self.current = (self.current << 1) | u8::from(bit);
        self.bits += 1;
        if self.bits == 8 {
            self.bytes.push(self.current);
            self.current = 0;
            self.bits = 0;
        }
    }

    fn write_ones(&mut self, count: usize) {
        for _ in 0..count {
            self.write_bit(true);
        }
    }

    fn write_bits(&mut self, value: u64, count: u8) {
        for index in (0..count).rev() {
            self.write_bit((value >> index) & 1 == 1);
        }
    }

    fn finish(mut self) -> Vec<u8> {
        if self.bits > 0 {
            self.current <<= 8 - self.bits;
            self.bytes.push(self.current);
        }
        self.bytes
    }
}

struct BitReader<'a> {
    data: &'a [u8],
    byte_index: usize,
    bit_index: u8,
}

impl<'a> BitReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self {
            data,
            byte_index: 0,
            bit_index: 0,
        }
    }

    fn read_bit(&mut self) -> Option<bool> {
        let byte = *self.data.get(self.byte_index)?;
        let bit = byte & (1 << (7 - self.bit_index)) != 0;
        self.bit_index += 1;
        if self.bit_index == 8 {
            self.byte_index += 1;
            self.bit_index = 0;
        }
        Some(bit)
    }

    fn read_unary(&mut self) -> Option<u64> {
        let mut value = 0_u64;
        loop {
            if !self.read_bit()? {
                return Some(value);
            }
            value = value.checked_add(1)?;
        }
    }

    fn read_bits(&mut self, count: u8) -> Option<u64> {
        let mut value = 0_u64;
        for _ in 0..count {
            value = (value << 1) | u64::from(self.read_bit()?);
        }
        Some(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_contains_inserted_ids_and_rejects_most_unknown_ids() {
        let ids = (0..120)
            .map(|index| {
                let mut id = [0_u8; 16];
                id[..8].copy_from_slice(&(index as u64).to_be_bytes());
                id
            })
            .collect::<Vec<_>>();
        let filter = GossipFilter::build(&ids);

        assert!(ids.iter().all(|id| filter.contains(id)));
        let false_positives = (500..700)
            .filter(|index| {
                let mut id = [0_u8; 16];
                id[..8].copy_from_slice(&(*index as u64).to_be_bytes());
                filter.contains(&id)
            })
            .count();
        assert!(false_positives < 10);
        assert!(filter.data.len() <= DEFAULT_FILTER_BYTES);
    }

    #[test]
    fn filter_wire_round_trips() {
        let ids = [[7_u8; 16], [8_u8; 16], [9_u8; 16]];
        let filter = GossipFilter::build(&ids);
        let decoded = GossipFilter::decode(&filter.encode()).expect("decode");

        assert!(ids.iter().all(|id| decoded.contains(id)));
    }

    #[test]
    fn archive_returns_only_packets_peer_is_missing() {
        let mut local = GossipStore::default();
        let first = local.insert(vec![1], 1_000);
        local.insert(vec![2], 1_001);
        let peer = GossipFilter::build(&[first]);

        assert_eq!(local.packets_missing_from(&peer, 10), vec![vec![2]]);
    }

    #[test]
    fn archive_persists_and_prunes_old_packets() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("gossip.json");
        let mut store = GossipStore::default();
        store.insert(vec![1], 1_000);
        store.insert(vec![2], ARCHIVE_RETENTION_MS + 2_000);
        store.save(&path).expect("save");

        let loaded = GossipStore::load(&path, ARCHIVE_RETENTION_MS + 2_000).expect("load");
        assert_eq!(loaded.packets.len(), 1);
    }
}
