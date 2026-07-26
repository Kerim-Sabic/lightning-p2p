use super::{MeshMessageType, MeshPacket};
use rand::RngCore;
use std::collections::HashMap;
use std::time::{Duration, Instant};

const HEADER_BYTES: usize = 13;
const DEFAULT_CHUNK_BYTES: usize = 180;
const MIN_CHUNK_BYTES: usize = 64;
const MAX_FRAGMENTS: usize = 10_000;
const MAX_IN_FLIGHT: usize = 64;
const STANDARD_ASSEMBLY_LIMIT: usize = 16 * 1024 * 1024;
const MEDIA_ASSEMBLY_LIMIT: usize = 100 * 1024 * 1024 + 64 * 1024;
const ASSEMBLY_TTL: Duration = Duration::from_secs(45);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct FragmentKey {
    sender_id: [u8; 8],
    fragment_id: [u8; 8],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FragmentHeader {
    pub fragment_id: [u8; 8],
    pub index: usize,
    pub total: usize,
    pub original_type: MeshMessageType,
    pub data: Vec<u8>,
    pub is_broadcast: bool,
}

impl FragmentHeader {
    /// Parses the deployed 13-byte fragment header.
    ///
    /// # Errors
    ///
    /// Returns an error for malformed IDs, indices, counts, or message types.
    pub fn from_packet(packet: &MeshPacket) -> Result<Self, String> {
        if packet.message_type != MeshMessageType::Fragment {
            return Err("packet is not a fragment".into());
        }
        if packet.payload.len() < HEADER_BYTES {
            return Err("fragment header is truncated".into());
        }
        let fragment_id = packet.payload[..8]
            .try_into()
            .map_err(|_| "invalid fragment id")?;
        let index = usize::from(u16::from_be_bytes([packet.payload[8], packet.payload[9]]));
        let total = usize::from(u16::from_be_bytes([packet.payload[10], packet.payload[11]]));
        if total == 0 || total > MAX_FRAGMENTS || index >= total {
            return Err("fragment index or total is invalid".into());
        }
        let original_type = MeshMessageType::try_from(packet.payload[12])?;
        let is_broadcast = packet
            .recipient_id
            .is_none_or(|recipient| recipient == [0xff; 8]);
        Ok(Self {
            fragment_id,
            index,
            total,
            original_type,
            data: packet.payload[HEADER_BYTES..].to_vec(),
            is_broadcast,
        })
    }
}

pub struct Fragmenter;

impl Fragmenter {
    /// Splits a complete encoded packet into BLE-sized fragment packets.
    ///
    /// # Errors
    ///
    /// Returns an error if the original packet cannot be encoded or would
    /// exceed the fragment-count contract.
    pub fn split(
        packet: &MeshPacket,
        chunk_bytes: Option<usize>,
    ) -> Result<Vec<MeshPacket>, String> {
        let full_data = packet.encode(true)?;
        let chunk_size = chunk_bytes
            .unwrap_or(DEFAULT_CHUNK_BYTES)
            .max(MIN_CHUNK_BYTES);
        let total = full_data.len().div_ceil(chunk_size);
        if total == 0 || total > MAX_FRAGMENTS || total > usize::from(u16::MAX) {
            return Err("packet exceeds the BLE fragment-count limit".into());
        }
        let mut fragment_id = [0_u8; 8];
        rand::thread_rng().fill_bytes(&mut fragment_id);
        let total_bytes = u16::try_from(total)
            .map_err(|error| error.to_string())?
            .to_be_bytes();

        full_data
            .chunks(chunk_size)
            .enumerate()
            .map(|(index, chunk)| {
                let mut payload = Vec::with_capacity(HEADER_BYTES + chunk.len());
                payload.extend(fragment_id);
                payload.extend(
                    u16::try_from(index)
                        .map_err(|error| error.to_string())?
                        .to_be_bytes(),
                );
                payload.extend(total_bytes);
                payload.push(packet.message_type as u8);
                payload.extend(chunk);
                Ok(MeshPacket {
                    message_type: MeshMessageType::Fragment,
                    ttl: packet.ttl,
                    timestamp_ms: packet.timestamp_ms,
                    sender_id: packet.sender_id,
                    recipient_id: packet.recipient_id,
                    payload,
                    signature: None,
                })
            })
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FragmentResult {
    Stored { received: usize, total: usize },
    Complete { packet: MeshPacket },
    Duplicate { received: usize, total: usize },
}

struct Assembly {
    original_type: MeshMessageType,
    total: usize,
    chunks: HashMap<usize, Vec<u8>>,
    total_bytes: usize,
    created_at: Instant,
    last_progress_at: Instant,
    is_broadcast: bool,
}

#[derive(Default)]
pub struct FragmentAssembler {
    assemblies: HashMap<FragmentKey, Assembly>,
}

impl FragmentAssembler {
    /// Adds one fragment and returns a completed decoded packet when all
    /// indices are present.
    ///
    /// # Errors
    ///
    /// Returns an error for malformed fragments, conflicting streams,
    /// oversized assemblies, or a completed packet that fails decoding.
    pub fn push(&mut self, packet: &MeshPacket) -> Result<FragmentResult, String> {
        self.remove_expired();
        let header = FragmentHeader::from_packet(packet)?;
        let key = FragmentKey {
            sender_id: packet.sender_id,
            fragment_id: header.fragment_id,
        };
        self.start_if_needed(key, &header);
        let assembly = self
            .assemblies
            .get_mut(&key)
            .ok_or_else(|| "fragment assembly was not created".to_string())?;
        if assembly.total != header.total || assembly.original_type != header.original_type {
            self.assemblies.remove(&key);
            return Err("fragment stream metadata changed mid-flight".into());
        }
        if assembly.chunks.contains_key(&header.index) {
            return Ok(FragmentResult::Duplicate {
                received: assembly.chunks.len(),
                total: assembly.total,
            });
        }

        let limit = assembly_limit(assembly.original_type);
        let projected = assembly
            .total_bytes
            .checked_add(header.data.len())
            .ok_or_else(|| "fragment assembly size overflow".to_string())?;
        if projected > limit {
            self.assemblies.remove(&key);
            return Err(format!(
                "fragment assembly exceeds its {limit}-byte safety limit"
            ));
        }
        assembly.total_bytes = projected;
        assembly.last_progress_at = Instant::now();
        assembly.chunks.insert(header.index, header.data);
        if assembly.chunks.len() != assembly.total {
            return Ok(FragmentResult::Stored {
                received: assembly.chunks.len(),
                total: assembly.total,
            });
        }

        let complete = self
            .assemblies
            .remove(&key)
            .ok_or_else(|| "completed fragment assembly disappeared".to_string())?;
        let mut bytes = Vec::with_capacity(complete.total_bytes);
        for index in 0..complete.total {
            let chunk = complete
                .chunks
                .get(&index)
                .ok_or_else(|| "fragment assembly is missing an index".to_string())?;
            bytes.extend(chunk);
        }
        let decoded = MeshPacket::decode(&bytes)?;
        if decoded.message_type != complete.original_type {
            return Err("reassembled packet type does not match fragment header".into());
        }
        Ok(FragmentResult::Complete { packet: decoded })
    }

    #[must_use]
    pub fn stalled_broadcast_ids(&self, stalled_for: Duration) -> Vec<[u8; 8]> {
        let now = Instant::now();
        let mut stalled = self
            .assemblies
            .iter()
            .filter(|(_, assembly)| {
                assembly.is_broadcast
                    && assembly.chunks.len() < assembly.total
                    && now.duration_since(assembly.last_progress_at) >= stalled_for
            })
            .map(|(key, assembly)| (key.fragment_id, assembly.last_progress_at))
            .collect::<Vec<_>>();
        stalled.sort_by_key(|(_, last_progress)| *last_progress);
        stalled
            .into_iter()
            .take(32)
            .map(|(fragment_id, _)| fragment_id)
            .collect()
    }

    fn start_if_needed(&mut self, key: FragmentKey, header: &FragmentHeader) {
        if self.assemblies.contains_key(&key) {
            return;
        }
        if self.assemblies.len() >= MAX_IN_FLIGHT {
            let oldest = self
                .assemblies
                .iter()
                .min_by_key(|(_, assembly)| assembly.created_at)
                .map(|(key, _)| *key);
            if let Some(oldest) = oldest {
                self.assemblies.remove(&oldest);
            }
        }
        let now = Instant::now();
        self.assemblies.insert(
            key,
            Assembly {
                original_type: header.original_type,
                total: header.total,
                chunks: HashMap::new(),
                total_bytes: 0,
                created_at: now,
                last_progress_at: now,
                is_broadcast: header.is_broadcast,
            },
        );
    }

    fn remove_expired(&mut self) {
        let now = Instant::now();
        self.assemblies
            .retain(|_, assembly| now.duration_since(assembly.created_at) < ASSEMBLY_TTL);
    }
}

fn assembly_limit(message_type: MeshMessageType) -> usize {
    if matches!(
        message_type,
        MeshMessageType::FileTransfer
            | MeshMessageType::NoiseEncrypted
            | MeshMessageType::VoiceFrame
    ) {
        MEDIA_ASSEMBLY_LIMIT
    } else {
        STANDARD_ASSEMBLY_LIMIT
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn original(payload_len: usize) -> MeshPacket {
        MeshPacket {
            message_type: MeshMessageType::FileTransfer,
            ttl: 7,
            timestamp_ms: 1_720_000_000,
            sender_id: [1; 8],
            recipient_id: Some([2; 8]),
            payload: (0_u8..=u8::MAX).cycle().take(payload_len).collect(),
            signature: None,
        }
    }

    #[test]
    fn fragments_reassemble_out_of_order() {
        let original = original(2_400);
        let mut fragments = Fragmenter::split(&original, Some(128)).expect("split");
        fragments.reverse();
        let mut assembler = FragmentAssembler::default();
        let mut complete = None;
        for fragment in fragments {
            if let FragmentResult::Complete { packet } = assembler.push(&fragment).expect("push") {
                complete = Some(packet);
            }
        }

        assert_eq!(complete, Some(original));
    }

    #[test]
    fn duplicate_fragment_does_not_advance_progress() {
        let fragments = Fragmenter::split(&original(1_000), Some(128)).expect("split");
        let mut assembler = FragmentAssembler::default();
        let first = assembler.push(&fragments[0]).expect("first");
        let duplicate = assembler.push(&fragments[0]).expect("duplicate");

        assert!(matches!(first, FragmentResult::Stored { received: 1, .. }));
        assert!(matches!(
            duplicate,
            FragmentResult::Duplicate { received: 1, .. }
        ));
    }
}
