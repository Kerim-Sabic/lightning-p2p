use sha2::{Digest, Sha256};

const MAX_MEDIA_BYTES: usize = 100 * 1024 * 1024;
const MAX_NAME_BYTES: usize = 255;
const MAX_MIME_BYTES: usize = 127;
const PRIVATE_MEDIA_ID_DOMAIN: [u8; 32] = [
    98, 105, 116, 99, 104, 97, 116, 45, 112, 114, 105, 118, 97, 116, 101, 45, 109, 101, 100, 105,
    97, 45, 109, 101, 115, 115, 97, 103, 101, 45, 118, 49,
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaPacket {
    pub file_name: Option<String>,
    pub mime_type: Option<String>,
    pub content: Vec<u8>,
}

impl MediaPacket {
    /// Encodes canonical media TLVs. The same packet carries images, voice
    /// notes, and generic files.
    ///
    /// # Errors
    ///
    /// Returns an error for payload or metadata outside protocol bounds.
    pub fn encode(&self) -> Result<Vec<u8>, String> {
        self.validate()?;
        let mut out = Vec::with_capacity(self.content.len() + 128);
        if let Some(name) = &self.file_name {
            put_u16_tlv(&mut out, 0x01, name.as_bytes())?;
        }
        put_u16_tlv(
            &mut out,
            0x02,
            &u32::try_from(self.content.len())
                .map_err(|error| error.to_string())?
                .to_be_bytes(),
        )?;
        if let Some(mime_type) = &self.mime_type {
            put_u16_tlv(&mut out, 0x03, mime_type.as_bytes())?;
        }
        out.push(0x04);
        out.extend(
            u32::try_from(self.content.len())
                .map_err(|error| error.to_string())?
                .to_be_bytes(),
        );
        out.extend(&self.content);
        Ok(out)
    }

    /// Decodes canonical media TLVs and the deployed legacy content/file-size
    /// length variants.
    ///
    /// # Errors
    ///
    /// Returns an error for malformed fields, missing content, or resource
    /// limits.
    pub fn decode(data: &[u8]) -> Result<Self, String> {
        let mut offset = 0;
        let mut file_name = None;
        let mut declared_size = None;
        let mut mime_type = None;
        let mut content = Vec::new();
        while offset < data.len() {
            let field_type = *data
                .get(offset)
                .ok_or_else(|| "media TLV type is missing".to_string())?;
            offset += 1;
            let length = if field_type == 0x04 {
                read_content_length(data, &mut offset)?
            } else {
                usize::from(u16::from_be_bytes(take_array::<2>(data, &mut offset)?))
            };
            let value = take(data, &mut offset, length)?;
            match field_type {
                0x01 => {
                    file_name = Some(
                        String::from_utf8(value.to_vec())
                            .map_err(|_| "media filename is not UTF-8")?,
                    );
                }
                0x02 if value.len() == 4 || value.len() == 8 => {
                    let mut size = 0_u64;
                    for byte in value {
                        size = (size << 8) | u64::from(*byte);
                    }
                    declared_size = Some(size);
                }
                0x03 => {
                    mime_type = Some(
                        String::from_utf8(value.to_vec())
                            .map_err(|_| "media MIME type is not UTF-8")?,
                    );
                }
                0x04 => {
                    if content.len().saturating_add(value.len()) > MAX_MEDIA_BYTES {
                        return Err("media payload exceeds its safety limit".into());
                    }
                    content.extend(value);
                }
                _ => {}
            }
        }
        if content.is_empty() {
            return Err("media packet has no content".into());
        }
        if declared_size.is_some_and(|size| size != content.len() as u64) {
            return Err("media packet size does not match content".into());
        }
        let packet = Self {
            file_name,
            mime_type,
            content,
        };
        packet.validate()?;
        Ok(packet)
    }

    #[must_use]
    pub fn stable_message_id(&self, sender_id: &[u8; 8], recipient_id: &[u8; 8]) -> Option<String> {
        let file_name = self.file_name.as_ref()?;
        if file_name.contains('/') || file_name.contains('\\') {
            return None;
        }
        let path = std::path::Path::new(file_name);
        let stem = path.file_stem()?.to_str()?;
        let extension = path
            .extension()
            .and_then(|value| value.to_str())?
            .to_ascii_lowercase();
        let entropy = stem.rsplit('_').next()?;
        let has_uuid_entropy = is_uuid(entropy);
        let voice_entropy = stem.strip_prefix("voice_").is_some_and(|value| {
            value.len() == 16 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
        });
        let supported_name = (stem.starts_with("img_")
            && matches!(extension.as_str(), "jpg" | "jpeg")
            && has_uuid_entropy)
            || (stem.starts_with("voice_")
                && extension == "m4a"
                && (has_uuid_entropy || voice_entropy));
        if !supported_name {
            return None;
        }
        let sender = hex::encode(sender_id);
        let recipient = hex::encode(recipient_id);
        let mut input = PRIVATE_MEDIA_ID_DOMAIN.to_vec();
        for field in [
            sender.as_bytes(),
            recipient.as_bytes(),
            file_name.as_bytes(),
        ] {
            input.extend(u32::try_from(field.len()).ok()?.to_be_bytes());
            input.extend(field);
        }
        let digest = hex::encode(Sha256::digest(input));
        Some(format!("media-{}", &digest[..32]))
    }

    fn validate(&self) -> Result<(), String> {
        if self.content.is_empty() || self.content.len() > MAX_MEDIA_BYTES {
            return Err("media payload is outside limits".into());
        }
        if self
            .file_name
            .as_ref()
            .is_some_and(|name| name.len() > MAX_NAME_BYTES)
        {
            return Err("media filename is too long".into());
        }
        if self
            .mime_type
            .as_ref()
            .is_some_and(|mime| mime.len() > MAX_MIME_BYTES)
        {
            return Err("media MIME type is too long".into());
        }
        Ok(())
    }
}

fn put_u16_tlv(out: &mut Vec<u8>, field_type: u8, value: &[u8]) -> Result<(), String> {
    let length = u16::try_from(value.len()).map_err(|_| "media TLV value is too large")?;
    out.push(field_type);
    out.extend(length.to_be_bytes());
    out.extend(value);
    Ok(())
}

fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

fn read_content_length(data: &[u8], offset: &mut usize) -> Result<usize, String> {
    let snapshot = *offset;
    if let Ok(bytes) = take_array::<4>(data, offset) {
        let canonical =
            usize::try_from(u32::from_be_bytes(bytes)).map_err(|error| error.to_string())?;
        if canonical <= data.len().saturating_sub(*offset) {
            return Ok(canonical);
        }
    }
    *offset = snapshot;
    Ok(usize::from(u16::from_be_bytes(take_array::<2>(
        data, offset,
    )?)))
}

fn take<'a>(data: &'a [u8], offset: &mut usize, length: usize) -> Result<&'a [u8], String> {
    let end = offset
        .checked_add(length)
        .ok_or_else(|| "media packet length overflow".to_string())?;
    let value = data
        .get(*offset..end)
        .ok_or_else(|| "media packet is truncated".to_string())?;
    *offset = end;
    Ok(value)
}

fn take_array<const N: usize>(data: &[u8], offset: &mut usize) -> Result<[u8; N], String> {
    take(data, offset, N)?
        .try_into()
        .map_err(|_| "media field has an invalid size".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_packet_round_trips() {
        let packet = MediaPacket {
            file_name: Some("voice_0123456789abcdef.m4a".into()),
            mime_type: Some("audio/mp4".into()),
            content: vec![7; 4_096],
        };
        let decoded = MediaPacket::decode(&packet.encode().expect("encode")).expect("decode");

        assert_eq!(decoded, packet);
        assert!(packet.stable_message_id(&[1; 8], &[2; 8]).is_some());
    }

    #[test]
    fn stable_media_identity_matches_the_deployed_fixture() {
        let packet = MediaPacket {
            file_name: Some("img_123e4567-e89b-12d3-a456-426614174000.jpg".into()),
            mime_type: Some("image/jpeg".into()),
            content: vec![1, 2, 3],
        };

        assert_eq!(
            packet.stable_message_id(&[0x01; 8], &[0x02; 8]),
            Some("media-efcd94ea37dd207573cee9a9e9837187".into())
        );
    }

    #[test]
    fn stable_media_identity_requires_filename_entropy() {
        let packet = MediaPacket {
            file_name: Some("img_20260728_031500.jpg".into()),
            mime_type: Some("image/jpeg".into()),
            content: vec![1],
        };

        assert_eq!(packet.stable_message_id(&[1; 8], &[2; 8]), None);
    }

    #[test]
    fn media_packet_rejects_declared_size_mismatch() {
        let packet = MediaPacket {
            file_name: None,
            mime_type: None,
            content: vec![1; 32],
        };
        let mut encoded = packet.encode().expect("encode");
        encoded[3..7].copy_from_slice(&31_u32.to_be_bytes());

        assert!(MediaPacket::decode(&encoded).is_err());
    }
}
