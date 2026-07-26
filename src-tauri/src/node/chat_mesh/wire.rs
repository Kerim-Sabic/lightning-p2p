use flate2::{read::DeflateDecoder, write::DeflateEncoder, Compression};
use std::io::{Read, Write};

const VERSION_V1: u8 = 1;
const VERSION_V2: u8 = 2;
const V1_HEADER_BYTES: usize = 14;
const V2_HEADER_BYTES: usize = 16;
const PEER_ID_BYTES: usize = 8;
const SIGNATURE_BYTES: usize = 64;
const FLAG_RECIPIENT: u8 = 0x01;
const FLAG_SIGNATURE: u8 = 0x02;
const FLAG_COMPRESSED: u8 = 0x04;
const MAX_V1_PAYLOAD_BYTES: usize = u16::MAX as usize;
const MAX_PAYLOAD_BYTES: usize = 100 * 1024 * 1024 + 128 * 1024;
const MAX_DECOMPRESSED_BYTES: usize = MAX_PAYLOAD_BYTES;
const PADDING_BLOCKS: [usize; 4] = [256, 512, 1_024, 2_048];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum MeshMessageType {
    Announce = 0x01,
    Message = 0x02,
    Leave = 0x03,
    CourierEnvelope = 0x04,
    NoiseHandshake = 0x10,
    NoiseEncrypted = 0x11,
    Fragment = 0x20,
    RequestSync = 0x21,
    FileTransfer = 0x22,
    BoardPost = 0x23,
    PrekeyBundle = 0x24,
    GroupMessage = 0x25,
    Ping = 0x26,
    Pong = 0x27,
    RelayCarrier = 0x28,
    VoiceFrame = 0x29,
}

impl TryFrom<u8> for MeshMessageType {
    type Error = String;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0x01 => Ok(Self::Announce),
            0x02 => Ok(Self::Message),
            0x03 => Ok(Self::Leave),
            0x04 => Ok(Self::CourierEnvelope),
            0x10 => Ok(Self::NoiseHandshake),
            0x11 => Ok(Self::NoiseEncrypted),
            0x20 => Ok(Self::Fragment),
            0x21 => Ok(Self::RequestSync),
            0x22 => Ok(Self::FileTransfer),
            0x23 => Ok(Self::BoardPost),
            0x24 => Ok(Self::PrekeyBundle),
            0x25 => Ok(Self::GroupMessage),
            0x26 => Ok(Self::Ping),
            0x27 => Ok(Self::Pong),
            0x28 => Ok(Self::RelayCarrier),
            0x29 => Ok(Self::VoiceFrame),
            other => Err(format!("unsupported mesh message type {other:#04x}")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MeshPacket {
    pub message_type: MeshMessageType,
    pub ttl: u8,
    pub timestamp_ms: u64,
    pub sender_id: [u8; PEER_ID_BYTES],
    pub recipient_id: Option<[u8; PEER_ID_BYTES]>,
    pub payload: Vec<u8>,
    pub signature: Option<[u8; SIGNATURE_BYTES]>,
}

impl MeshPacket {
    pub const DEFAULT_TTL: u8 = 7;

    /// Encodes the deployed v1/v2 BLE packet and applies compatible
    /// size-bucket padding. V2 is selected for file payloads and whenever the
    /// four-byte length field is required.
    ///
    /// # Errors
    ///
    /// Returns an error when the payload exceeds the framed-media safety limit
    /// or compression fails.
    pub fn encode(&self, padding: bool) -> Result<Vec<u8>, String> {
        let version = if self.message_type == MeshMessageType::FileTransfer
            || self.payload.len() > MAX_V1_PAYLOAD_BYTES
        {
            VERSION_V2
        } else {
            VERSION_V1
        };
        let length_field_bytes = if version == VERSION_V2 { 4 } else { 2 };
        let compressed = compress_payload(&self.payload)?;
        let (wire_payload, original_size) = match compressed {
            Some(value) => (value, Some(self.payload.len())),
            None => (self.payload.clone(), None),
        };
        let payload_len = wire_payload.len() + original_size.map_or(0, |_| length_field_bytes);
        if payload_len > MAX_PAYLOAD_BYTES
            || (version == VERSION_V1 && payload_len > MAX_V1_PAYLOAD_BYTES)
        {
            return Err("mesh payload exceeds its framed-media safety limit".into());
        }

        let mut flags = 0;
        if self.recipient_id.is_some() {
            flags |= FLAG_RECIPIENT;
        }
        if self.signature.is_some() {
            flags |= FLAG_SIGNATURE;
        }
        if original_size.is_some() {
            flags |= FLAG_COMPRESSED;
        }

        let header_bytes = if version == VERSION_V2 {
            V2_HEADER_BYTES
        } else {
            V1_HEADER_BYTES
        };
        let mut out = Vec::with_capacity(
            header_bytes
                + PEER_ID_BYTES
                + self.recipient_id.map_or(0, |_| PEER_ID_BYTES)
                + payload_len
                + self.signature.map_or(0, |_| SIGNATURE_BYTES),
        );
        out.extend([version, self.message_type as u8, self.ttl]);
        out.extend(self.timestamp_ms.to_be_bytes());
        out.push(flags);
        if version == VERSION_V2 {
            out.extend(
                u32::try_from(payload_len)
                    .map_err(|error| error.to_string())?
                    .to_be_bytes(),
            );
        } else {
            out.extend(
                u16::try_from(payload_len)
                    .map_err(|error| error.to_string())?
                    .to_be_bytes(),
            );
        }
        out.extend(self.sender_id);
        if let Some(recipient) = self.recipient_id {
            out.extend(recipient);
        }
        if let Some(size) = original_size {
            if version == VERSION_V2 {
                out.extend(
                    u32::try_from(size)
                        .map_err(|error| error.to_string())?
                        .to_be_bytes(),
                );
            } else {
                out.extend(
                    u16::try_from(size)
                        .map_err(|error| error.to_string())?
                        .to_be_bytes(),
                );
            }
        }
        out.extend(wire_payload);
        if let Some(signature) = self.signature {
            out.extend(signature);
        }

        if padding {
            apply_padding(&mut out);
        }
        Ok(out)
    }

    /// Returns the canonical bytes authenticated by packet signatures.
    ///
    /// TTL is fixed to zero because relays decrement it, and the signature
    /// field is omitted. Padding remains enabled to match deployed clients.
    ///
    /// # Errors
    ///
    /// Returns an error when canonical packet encoding fails.
    pub fn signing_bytes(&self) -> Result<Vec<u8>, String> {
        let mut unsigned = self.clone();
        unsigned.ttl = 0;
        unsigned.signature = None;
        unsigned.encode(true)
    }

    /// Decodes a v1 or v2 packet. Bucket padding after the declared fields is
    /// intentionally ignored.
    ///
    /// # Errors
    ///
    /// Returns an error for malformed lengths, unsupported versions/types, or
    /// decompression that violates the output bound.
    pub fn decode(data: &[u8]) -> Result<Self, String> {
        if data.len() < V1_HEADER_BYTES + PEER_ID_BYTES {
            return Err("mesh packet is truncated".into());
        }
        let version = data[0];
        if version != VERSION_V1 && version != VERSION_V2 {
            return Err(format!("unsupported mesh packet version {}", data[0]));
        }
        let header_bytes = if version == VERSION_V2 {
            V2_HEADER_BYTES
        } else {
            V1_HEADER_BYTES
        };
        if data.len() < header_bytes + PEER_ID_BYTES {
            return Err("mesh packet is truncated".into());
        }
        let message_type = MeshMessageType::try_from(data[1])?;
        let ttl = data[2];
        let timestamp_ms = u64::from_be_bytes(
            data[3..11]
                .try_into()
                .map_err(|_| "invalid timestamp field")?,
        );
        let flags = data[11];
        let payload_len = if version == VERSION_V2 {
            usize::try_from(u32::from_be_bytes(
                data[12..16]
                    .try_into()
                    .map_err(|_| "invalid v2 payload length")?,
            ))
            .map_err(|error| error.to_string())?
        } else {
            usize::from(u16::from_be_bytes([data[12], data[13]]))
        };
        if payload_len > MAX_PAYLOAD_BYTES {
            return Err("mesh payload exceeds its framed-media safety limit".into());
        }
        let mut offset = header_bytes;
        let sender_id = take_array::<PEER_ID_BYTES>(data, &mut offset)?;
        let recipient_id = if flags & FLAG_RECIPIENT != 0 {
            Some(take_array::<PEER_ID_BYTES>(data, &mut offset)?)
        } else {
            None
        };
        let wire_payload = take(data, &mut offset, payload_len)?;
        let payload = if flags & FLAG_COMPRESSED != 0 {
            decompress_payload(wire_payload, version)?
        } else {
            wire_payload.to_vec()
        };
        let signature = if flags & FLAG_SIGNATURE != 0 {
            Some(take_array::<SIGNATURE_BYTES>(data, &mut offset)?)
        } else {
            None
        };

        Ok(Self {
            message_type,
            ttl,
            timestamp_ms,
            sender_id,
            recipient_id,
            payload,
            signature,
        })
    }
}

fn compress_payload(payload: &[u8]) -> Result<Option<Vec<u8>>, String> {
    if payload.len() < 100 || payload.len() > MAX_PAYLOAD_BYTES {
        return Ok(None);
    }
    let sample_len = payload.len().min(256);
    let mut seen = [false; 256];
    let unique = payload[..sample_len]
        .iter()
        .filter(|byte| {
            let index = usize::from(**byte);
            let was_new = !seen[index];
            seen[index] = true;
            was_new
        })
        .count();
    if unique.saturating_mul(10) >= sample_len.saturating_mul(9) {
        return Ok(None);
    }

    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(payload)
        .map_err(|error| error.to_string())?;
    let compressed = encoder.finish().map_err(|error| error.to_string())?;
    Ok((compressed.len() < payload.len()).then_some(compressed))
}

fn decompress_payload(payload: &[u8], version: u8) -> Result<Vec<u8>, String> {
    let length_bytes = if version == VERSION_V2 { 4 } else { 2 };
    if payload.len() <= length_bytes {
        return Err("compressed mesh payload is truncated".into());
    }
    let expected = if version == VERSION_V2 {
        usize::try_from(u32::from_be_bytes(
            payload[..4]
                .try_into()
                .map_err(|_| "invalid compressed v2 size")?,
        ))
        .map_err(|error| error.to_string())?
    } else {
        usize::from(u16::from_be_bytes([payload[0], payload[1]]))
    };
    if expected > MAX_DECOMPRESSED_BYTES {
        return Err("compressed mesh payload exceeds safety limits".into());
    }
    let decoder = DeflateDecoder::new(&payload[length_bytes..]);
    let mut out = Vec::with_capacity(expected);
    decoder
        .take((MAX_DECOMPRESSED_BYTES + 1) as u64)
        .read_to_end(&mut out)
        .map_err(|error| error.to_string())?;
    if out.len() != expected {
        return Err("compressed mesh payload has an invalid decoded size".into());
    }
    Ok(out)
}

fn apply_padding(data: &mut Vec<u8>) {
    let Some(target) = PADDING_BLOCKS
        .into_iter()
        .find(|block| data.len() + 16 <= *block)
    else {
        return;
    };
    let padding_len = target - data.len();
    let Ok(padding_byte) = u8::try_from(padding_len) else {
        return;
    };
    data.resize(target, padding_byte);
}

fn take<'a>(data: &'a [u8], offset: &mut usize, length: usize) -> Result<&'a [u8], String> {
    let end = offset
        .checked_add(length)
        .ok_or_else(|| "mesh packet length overflow".to_string())?;
    let value = data
        .get(*offset..end)
        .ok_or_else(|| "mesh packet field is truncated".to_string())?;
    *offset = end;
    Ok(value)
}

fn take_array<const N: usize>(data: &[u8], offset: &mut usize) -> Result<[u8; N], String> {
    take(data, offset, N)?
        .try_into()
        .map_err(|_| "mesh packet field has an invalid size".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packet(payload: Vec<u8>) -> MeshPacket {
        MeshPacket {
            message_type: MeshMessageType::Message,
            ttl: MeshPacket::DEFAULT_TTL,
            timestamp_ms: 1_720_000_000_123,
            sender_id: [0x11; 8],
            recipient_id: Some([0x22; 8]),
            payload,
            signature: Some([0x33; 64]),
        }
    }

    #[test]
    fn packet_round_trips_with_padding() {
        let packet = packet(b"hello mesh".to_vec());
        let encoded = packet.encode(true).expect("encode");
        let decoded = MeshPacket::decode(&encoded).expect("decode");

        assert_eq!(decoded, packet);
        assert_eq!(encoded.len(), 256);
    }

    #[test]
    fn compressible_payload_round_trips() {
        let packet = packet(vec![b'a'; 1_000]);
        let encoded = packet.encode(false).expect("encode");
        let decoded = MeshPacket::decode(&encoded).expect("decode");

        assert_eq!(decoded.payload, packet.payload);
        assert_ne!(encoded[11] & FLAG_COMPRESSED, 0);
    }

    #[test]
    fn rejects_truncated_packet() {
        let error = MeshPacket::decode(&[1, 2, 3]).expect_err("reject");
        assert!(error.contains("truncated"));
    }

    #[test]
    fn v2_large_payload_round_trips() {
        let mut large = Vec::with_capacity(80_000);
        for index in 0..80_000_u32 {
            large.push(index.wrapping_mul(31).to_le_bytes()[0]);
        }
        let packet = packet(large);
        let encoded = packet.encode(false).expect("encode v2");
        assert_eq!(encoded[0], VERSION_V2);
        assert_eq!(MeshPacket::decode(&encoded).expect("decode v2"), packet);
    }
}
