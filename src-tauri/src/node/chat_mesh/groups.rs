#![allow(clippy::missing_errors_doc)]

use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    ChaCha20Poly1305, Nonce,
};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::RngCore;
use sha2::{Digest, Sha256};

const GROUP_ID_BYTES: usize = 16;
const GROUP_KEY_BYTES: usize = 32;
const MAX_GROUP_MEMBERS: usize = 64;
const MAX_GROUP_NAME_BYTES: usize = 64;
const MAX_NICKNAME_BYTES: usize = 64;
const MAX_MESSAGE_BYTES: usize = 8_000;
const STATE_SIGNING_DOMAIN: [u8; 18] = [
    108, 105, 103, 104, 116, 110, 105, 110, 103, 45, 103, 114, 111, 117, 112, 45, 118, 49,
];
const MESSAGE_SIGNING_DOMAIN: [u8; 22] = [
    108, 105, 103, 104, 116, 110, 105, 110, 103, 45, 103, 114, 111, 117, 112, 45, 109, 115,
    103, 45, 118, 49,
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupMember {
    pub fingerprint: [u8; 32],
    pub signing_key: [u8; 32],
    pub nickname: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrivateGroup {
    pub group_id: [u8; GROUP_ID_BYTES],
    pub name: String,
    pub epoch: u32,
    pub members: Vec<GroupMember>,
    pub creator_fingerprint: [u8; 32],
    key: [u8; GROUP_KEY_BYTES],
}

impl PrivateGroup {
    /// Creates a private group with a random group ID and epoch key.
    ///
    /// # Errors
    ///
    /// Returns an error for an empty/oversized roster, missing creator, or
    /// invalid UTF-8 byte limits.
    pub fn create(
        name: String,
        members: Vec<GroupMember>,
        creator_fingerprint: [u8; 32],
    ) -> Result<Self, String> {
        validate_group(&name, &members, &creator_fingerprint)?;
        let mut group_id = [0_u8; GROUP_ID_BYTES];
        let mut key = [0_u8; GROUP_KEY_BYTES];
        rand::thread_rng().fill_bytes(&mut group_id);
        rand::thread_rng().fill_bytes(&mut key);
        Ok(Self {
            group_id,
            name,
            epoch: 1,
            members,
            creator_fingerprint,
            key,
        })
    }

    /// Rotates the symmetric group key and advances the epoch.
    pub fn rotate_key(&mut self) {
        rand::thread_rng().fill_bytes(&mut self.key);
        self.epoch = self.epoch.saturating_add(1);
    }

    /// Encodes and creator-signs the complete group state used for invites
    /// and epoch updates.
    ///
    /// # Errors
    ///
    /// Returns an error when roster encoding or TLV sizing fails.
    pub fn encode_signed_state(&self, creator_signing_key: &SigningKey) -> Result<Vec<u8>, String> {
        let roster = encode_roster(&self.members)?;
        let signing_content =
            state_signing_content(&self.group_id, self.epoch, &self.key, &roster, &self.name);
        let signature = creator_signing_key.sign(&signing_content).to_bytes();
        let mut out = Vec::new();
        put_tlv(&mut out, 0x01, &self.group_id)?;
        put_tlv(&mut out, 0x02, self.name.as_bytes())?;
        put_tlv(&mut out, 0x03, &self.key)?;
        put_tlv(&mut out, 0x04, &self.epoch.to_be_bytes())?;
        put_tlv(&mut out, 0x05, &roster)?;
        put_tlv(&mut out, 0x06, &self.creator_fingerprint)?;
        put_tlv(&mut out, 0x07, &signature)?;
        Ok(out)
    }

    /// Decodes and verifies creator-signed group state.
    ///
    /// # Errors
    ///
    /// Returns an error for malformed TLVs, a creator absent from the roster,
    /// or an invalid state signature.
    pub fn decode_signed_state(data: &[u8]) -> Result<Self, String> {
        let fields = parse_tlvs(data)?;
        let group_id = required_array::<GROUP_ID_BYTES>(&fields, 0x01, "group id")?;
        let name = required_string(&fields, 0x02, "group name")?;
        let key = required_array::<GROUP_KEY_BYTES>(&fields, 0x03, "group key")?;
        let epoch = u32::from_be_bytes(required_array::<4>(&fields, 0x04, "group epoch")?);
        let roster_bytes = required_field(&fields, 0x05, "group roster")?;
        let members = decode_roster(roster_bytes)?;
        let creator_fingerprint = required_array::<32>(&fields, 0x06, "creator fingerprint")?;
        let signature =
            Signature::from_bytes(&required_array::<64>(&fields, 0x07, "state signature")?);
        validate_group(&name, &members, &creator_fingerprint)?;
        let creator = members
            .iter()
            .find(|member| member.fingerprint == creator_fingerprint)
            .ok_or_else(|| "group creator is missing from roster".to_string())?;
        let verifying_key =
            VerifyingKey::from_bytes(&creator.signing_key).map_err(|error| error.to_string())?;
        verifying_key
            .verify(
                &state_signing_content(&group_id, epoch, &key, roster_bytes, &name),
                &signature,
            )
            .map_err(|_| "group state signature is invalid".to_string())?;
        Ok(Self {
            group_id,
            name,
            epoch,
            members,
            creator_fingerprint,
            key,
        })
    }

    /// Encrypts and signs a group message for the current epoch.
    ///
    /// # Errors
    ///
    /// Returns an error for invalid sender membership, payload limits, TLV
    /// encoding, or authenticated encryption failure.
    pub fn seal_message(
        &self,
        message_id: &str,
        content: &str,
        sender_nickname: &str,
        sender_signing_key: &SigningKey,
        timestamp_ms: u64,
    ) -> Result<GroupEnvelope, String> {
        if message_id.is_empty() || message_id.len() > 255 {
            return Err("group message id is invalid".into());
        }
        if content.is_empty() || content.len() > MAX_MESSAGE_BYTES {
            return Err("group message content is outside limits".into());
        }
        if sender_nickname.len() > MAX_NICKNAME_BYTES {
            return Err("group sender nickname is too long".into());
        }
        let sender_key = sender_signing_key.verifying_key().to_bytes();
        if !self
            .members
            .iter()
            .any(|member| member.signing_key == sender_key)
        {
            return Err("group sender is not in the current roster".into());
        }
        let signature = sender_signing_key
            .sign(&message_signing_content(
                &self.group_id,
                self.epoch,
                message_id,
                timestamp_ms,
                content,
            ))
            .to_bytes();
        let mut inner = Vec::new();
        put_tlv(&mut inner, 0x01, message_id.as_bytes())?;
        put_tlv(&mut inner, 0x02, &sender_key)?;
        put_tlv(&mut inner, 0x03, sender_nickname.as_bytes())?;
        put_tlv(&mut inner, 0x04, &timestamp_ms.to_be_bytes())?;
        put_tlv(&mut inner, 0x05, content.as_bytes())?;
        put_tlv(&mut inner, 0x06, &signature)?;

        let mut nonce = [0_u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce);
        let aad = group_aad(&self.group_id, self.epoch);
        let cipher =
            ChaCha20Poly1305::new_from_slice(&self.key).map_err(|error| error.to_string())?;
        let ciphertext = cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &inner,
                    aad: &aad,
                },
            )
            .map_err(|_| "group message encryption failed".to_string())?;
        Ok(GroupEnvelope {
            group_id: self.group_id,
            epoch: self.epoch,
            nonce,
            ciphertext,
        })
    }

    /// Authenticates, decrypts, and roster-verifies a group message.
    ///
    /// # Errors
    ///
    /// Returns an error for another group/epoch, failed AEAD, malformed inner
    /// TLVs, a non-member sender, or an invalid sender signature.
    pub fn open_message(&self, envelope: &GroupEnvelope) -> Result<GroupMessage, String> {
        if envelope.group_id != self.group_id || envelope.epoch != self.epoch {
            return Err("group message targets a different group epoch".into());
        }
        let aad = group_aad(&self.group_id, self.epoch);
        let cipher =
            ChaCha20Poly1305::new_from_slice(&self.key).map_err(|error| error.to_string())?;
        let inner = cipher
            .decrypt(
                Nonce::from_slice(&envelope.nonce),
                Payload {
                    msg: &envelope.ciphertext,
                    aad: &aad,
                },
            )
            .map_err(|_| "group message decryption failed".to_string())?;
        let fields = parse_tlvs(&inner)?;
        let message_id = required_string(&fields, 0x01, "message id")?;
        let sender_signing_key = required_array::<32>(&fields, 0x02, "sender key")?;
        let sender_nickname = required_string(&fields, 0x03, "sender nickname")?;
        let timestamp_ms = u64::from_be_bytes(required_array::<8>(&fields, 0x04, "timestamp")?);
        let content = required_string(&fields, 0x05, "content")?;
        let signature =
            Signature::from_bytes(&required_array::<64>(&fields, 0x06, "message signature")?);
        if !self
            .members
            .iter()
            .any(|member| member.signing_key == sender_signing_key)
        {
            return Err("group message sender is not in the roster".into());
        }
        let verifying_key =
            VerifyingKey::from_bytes(&sender_signing_key).map_err(|error| error.to_string())?;
        verifying_key
            .verify(
                &message_signing_content(
                    &self.group_id,
                    self.epoch,
                    &message_id,
                    timestamp_ms,
                    &content,
                ),
                &signature,
            )
            .map_err(|_| "group message signature is invalid".to_string())?;
        Ok(GroupMessage {
            message_id,
            sender_signing_key,
            sender_nickname,
            timestamp_ms,
            content,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupEnvelope {
    pub group_id: [u8; GROUP_ID_BYTES],
    pub epoch: u32,
    pub nonce: [u8; 12],
    pub ciphertext: Vec<u8>,
}

impl GroupEnvelope {
    pub fn encode(&self) -> Result<Vec<u8>, String> {
        let mut out = Vec::new();
        put_tlv(&mut out, 0x01, &self.group_id)?;
        put_tlv(&mut out, 0x02, &self.epoch.to_be_bytes())?;
        put_tlv(&mut out, 0x03, &self.nonce)?;
        put_tlv(&mut out, 0x04, &self.ciphertext)?;
        Ok(out)
    }

    pub fn decode(data: &[u8]) -> Result<Self, String> {
        let fields = parse_tlvs(data)?;
        Ok(Self {
            group_id: required_array::<GROUP_ID_BYTES>(&fields, 0x01, "group id")?,
            epoch: u32::from_be_bytes(required_array::<4>(&fields, 0x02, "group epoch")?),
            nonce: required_array::<12>(&fields, 0x03, "group nonce")?,
            ciphertext: required_field(&fields, 0x04, "group ciphertext")?.to_vec(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupMessage {
    pub message_id: String,
    pub sender_signing_key: [u8; 32],
    pub sender_nickname: String,
    pub timestamp_ms: u64,
    pub content: String,
}

fn validate_group(
    name: &str,
    members: &[GroupMember],
    creator_fingerprint: &[u8; 32],
) -> Result<(), String> {
    if name.is_empty() || name.len() > MAX_GROUP_NAME_BYTES {
        return Err("group name is outside limits".into());
    }
    if members.is_empty() || members.len() > MAX_GROUP_MEMBERS {
        return Err("group roster is outside limits".into());
    }
    if !members
        .iter()
        .any(|member| &member.fingerprint == creator_fingerprint)
    {
        return Err("group creator is missing from roster".into());
    }
    if members
        .iter()
        .any(|member| member.nickname.len() > MAX_NICKNAME_BYTES)
    {
        return Err("group member nickname is too long".into());
    }
    Ok(())
}

fn encode_roster(members: &[GroupMember]) -> Result<Vec<u8>, String> {
    let count = u8::try_from(members.len()).map_err(|_| "group roster is too large")?;
    let mut out = vec![count];
    for member in members {
        let nickname = member.nickname.as_bytes();
        let nickname_len =
            u8::try_from(nickname.len()).map_err(|_| "group nickname is too long")?;
        out.extend(member.fingerprint);
        out.extend(member.signing_key);
        out.push(nickname_len);
        out.extend(nickname);
    }
    Ok(out)
}

fn decode_roster(data: &[u8]) -> Result<Vec<GroupMember>, String> {
    let count = usize::from(
        *data
            .first()
            .ok_or_else(|| "group roster is empty".to_string())?,
    );
    if count == 0 || count > MAX_GROUP_MEMBERS {
        return Err("group roster count is invalid".into());
    }
    let mut offset = 1;
    let mut members = Vec::with_capacity(count);
    for _ in 0..count {
        let fingerprint = take_array::<32>(data, &mut offset)?;
        let signing_key = take_array::<32>(data, &mut offset)?;
        let nickname_len = usize::from(
            *data
                .get(offset)
                .ok_or_else(|| "group nickname length is missing".to_string())?,
        );
        offset += 1;
        let nickname_bytes = take(data, &mut offset, nickname_len)?;
        let nickname = String::from_utf8(nickname_bytes.to_vec())
            .map_err(|_| "group nickname is not UTF-8")?;
        members.push(GroupMember {
            fingerprint,
            signing_key,
            nickname,
        });
    }
    if offset != data.len() {
        return Err("group roster has trailing bytes".into());
    }
    Ok(members)
}

fn state_signing_content(
    group_id: &[u8; 16],
    epoch: u32,
    key: &[u8; 32],
    roster: &[u8],
    name: &str,
) -> Vec<u8> {
    let mut out = STATE_SIGNING_DOMAIN.to_vec();
    out.extend(group_id);
    out.extend(epoch.to_be_bytes());
    out.extend(Sha256::digest(key));
    out.extend(Sha256::digest(roster));
    out.extend(Sha256::digest(name.as_bytes()));
    out
}

fn message_signing_content(
    group_id: &[u8; 16],
    epoch: u32,
    message_id: &str,
    timestamp_ms: u64,
    content: &str,
) -> Vec<u8> {
    let mut out = MESSAGE_SIGNING_DOMAIN.to_vec();
    out.extend(group_id);
    out.extend(epoch.to_be_bytes());
    out.extend(message_id.as_bytes());
    out.extend(timestamp_ms.to_be_bytes());
    out.extend(content.as_bytes());
    out
}

fn group_aad(group_id: &[u8; 16], epoch: u32) -> Vec<u8> {
    let mut out = group_id.to_vec();
    out.extend(epoch.to_be_bytes());
    out
}

fn put_tlv(out: &mut Vec<u8>, field_type: u8, value: &[u8]) -> Result<(), String> {
    let length = u16::try_from(value.len()).map_err(|_| "group TLV value is too large")?;
    out.push(field_type);
    out.extend(length.to_be_bytes());
    out.extend(value);
    Ok(())
}

fn parse_tlvs(data: &[u8]) -> Result<Vec<(u8, Vec<u8>)>, String> {
    let mut fields = Vec::new();
    let mut offset = 0;
    while offset < data.len() {
        let field_type = *data
            .get(offset)
            .ok_or_else(|| "group TLV type is missing".to_string())?;
        offset += 1;
        let length = usize::from(u16::from_be_bytes(take_array::<2>(data, &mut offset)?));
        fields.push((field_type, take(data, &mut offset, length)?.to_vec()));
    }
    Ok(fields)
}

fn required_field<'a>(
    fields: &'a [(u8, Vec<u8>)],
    field_type: u8,
    label: &str,
) -> Result<&'a [u8], String> {
    fields
        .iter()
        .find(|(candidate, _)| *candidate == field_type)
        .map(|(_, value)| value.as_slice())
        .ok_or_else(|| format!("{label} is missing"))
}

fn required_array<const N: usize>(
    fields: &[(u8, Vec<u8>)],
    field_type: u8,
    label: &str,
) -> Result<[u8; N], String> {
    required_field(fields, field_type, label)?
        .try_into()
        .map_err(|_| format!("{label} has an invalid size"))
}

fn required_string(
    fields: &[(u8, Vec<u8>)],
    field_type: u8,
    label: &str,
) -> Result<String, String> {
    String::from_utf8(required_field(fields, field_type, label)?.to_vec())
        .map_err(|_| format!("{label} is not UTF-8"))
}

fn take<'a>(data: &'a [u8], offset: &mut usize, length: usize) -> Result<&'a [u8], String> {
    let end = offset
        .checked_add(length)
        .ok_or_else(|| "group payload length overflow".to_string())?;
    let value = data
        .get(*offset..end)
        .ok_or_else(|| "group payload is truncated".to_string())?;
    *offset = end;
    Ok(value)
}

fn take_array<const N: usize>(data: &[u8], offset: &mut usize) -> Result<[u8; N], String> {
    take(data, offset, N)?
        .try_into()
        .map_err(|_| "group field has an invalid size".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn group() -> (PrivateGroup, SigningKey) {
        let creator_key = SigningKey::generate(&mut rand::rngs::OsRng);
        let creator_signing_key = creator_key.verifying_key().to_bytes();
        let creator_fingerprint = Sha256::digest(creator_signing_key).into();
        let member = GroupMember {
            fingerprint: creator_fingerprint,
            signing_key: creator_signing_key,
            nickname: "Alice".into(),
        };
        (
            PrivateGroup::create("Launch".into(), vec![member], creator_fingerprint)
                .expect("group"),
            creator_key,
        )
    }

    #[test]
    fn signed_group_state_round_trips() {
        let (group, creator) = group();
        let encoded = group.encode_signed_state(&creator).expect("encode state");
        let decoded = PrivateGroup::decode_signed_state(&encoded).expect("decode state");

        assert_eq!(decoded, group);
    }

    #[test]
    fn group_message_encrypts_and_verifies() {
        let (group, creator) = group();
        let envelope = group
            .seal_message(
                "message-1",
                "meet at the bridge",
                "Alice",
                &creator,
                1_720_000_000,
            )
            .expect("seal");
        let decoded_envelope = GroupEnvelope::decode(&envelope.encode().expect("encode envelope"))
            .expect("decode envelope");
        let message = group.open_message(&decoded_envelope).expect("open");

        assert_eq!(message.content, "meet at the bridge");
        assert_eq!(message.sender_nickname, "Alice");
    }

    #[test]
    fn tampered_group_message_is_rejected() {
        let (group, creator) = group();
        let mut envelope = group
            .seal_message("message-1", "secret", "Alice", &creator, 1)
            .expect("seal");
        envelope.ciphertext[0] ^= 1;

        assert!(group.open_message(&envelope).is_err());
    }
}
