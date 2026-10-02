#![allow(
    clippy::cast_possible_truncation,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::needless_pass_by_value,
    clippy::too_many_lines,
    clippy::trivially_copy_pass_by_ref,
    clippy::unused_self
)]

use super::sync::mesh_packet_id;
use crate::storage::bounded_json;
use super::{
    CourierDepositTier, CourierEnvelope, CourierStore, FragmentAssembler, FragmentResult,
    Fragmenter, GossipFilter, GossipStore, GroupEnvelope, GroupMember, MediaPacket, MeshIdentity,
    MeshMessageType, MeshPacket, NoiseHandshake, NoiseRole, NoiseTransport, PrivateGroup,
    TrustRecord,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_TEXT_BYTES: usize = 8_000;
const BLE_FRAME_BYTES: usize = 180;
const BLE_FRAGMENT_BYTES: usize = 128;
const MAX_PENDING_PER_PEER: usize = 16;
const MAX_GROUP_STORE_BYTES: usize = 4 * 1024 * 1024;
const MAX_TRUSTED_PEERS_STORE_BYTES: usize = 2 * 1024 * 1024;
const MAX_EVENT_MEDIA_BYTES: usize = 20 * 1024 * 1024;
const CAPABILITIES: [u8; 2] = [0x29, 0x03];

const NOISE_PRIVATE_MESSAGE: u8 = 0x01;
const NOISE_READ_RECEIPT: u8 = 0x02;
const NOISE_DELIVERED: u8 = 0x03;
const NOISE_GROUP_INVITE: u8 = 0x06;
const NOISE_GROUP_UPDATE: u8 = 0x07;
const NOISE_VOICE_FRAME: u8 = 0x08;
const NOISE_PRIVATE_FILE: u8 = 0x20;

type GroupMap = HashMap<[u8; 16], PrivateGroup>;
type GroupStateMap = HashMap<[u8; 16], Vec<u8>>;

#[derive(Debug, Clone, Serialize)]
pub struct MeshChatEvent {
    pub kind: String,
    pub id: String,
    pub sender_id: String,
    pub sender_name: String,
    pub content: Option<String>,
    pub timestamp_ms: u64,
    pub group_id: Option<String>,
    pub file_name: Option<String>,
    pub mime_type: Option<String>,
    pub data_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MeshPeer {
    pub id: String,
    pub nickname: String,
    pub fingerprint: String,
    pub capabilities: u64,
    pub last_seen_ms: u64,
    pub noise_ready: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct MeshGroup {
    pub id: String,
    pub name: String,
    pub epoch: u32,
    pub members: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MeshStatus {
    pub peer_id: String,
    pub fingerprint: String,
    pub connected_links: usize,
    pub peers: Vec<MeshPeer>,
    pub groups: Vec<MeshGroup>,
}

#[derive(Debug, Clone)]
pub struct MeshIngress {
    pub events: Vec<MeshChatEvent>,
    pub outbound_frames: Vec<Vec<u8>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PeerState {
    nickname: String,
    noise_key: [u8; 32],
    signing_key: [u8; 32],
    capabilities: u64,
    last_seen_ms: u64,
}

enum HandshakePhase {
    Initiator(NoiseHandshake),
    Responder(NoiseHandshake),
}

#[derive(Debug, Clone)]
struct PendingNoisePayload {
    payload: Vec<u8>,
}

pub struct ChatMeshRuntime {
    identity: MeshIdentity,
    nickname: String,
    fragments: FragmentAssembler,
    gossip: GossipStore,
    couriers: CourierStore,
    peers: HashMap<[u8; 8], PeerState>,
    handshakes: HashMap<[u8; 8], HandshakePhase>,
    transports: HashMap<[u8; 8], NoiseTransport>,
    pending: HashMap<[u8; 8], VecDeque<PendingNoisePayload>>,
    groups: GroupMap,
    group_states: GroupStateMap,
    seen: HashSet<[u8; 16]>,
    gossip_path: PathBuf,
    courier_path: PathBuf,
    groups_path: PathBuf,
    trusted_path: PathBuf,
}

impl ChatMeshRuntime {
    /// Opens the bounded durable mesh stores around a separately persisted
    /// cryptographic identity.
    pub fn load(data_dir: &Path, identity: MeshIdentity, nickname: String) -> Result<Self, String> {
        let chat_dir = data_dir.join("lightning-chat");
        let now = now_ms();
        let gossip_path = chat_dir.join("mesh-gossip.json");
        let courier_path = chat_dir.join("mesh-courier.json");
        let groups_path = chat_dir.join("mesh-groups.json");
        let trusted_path = chat_dir.join("mesh-trusted-peers.json");
        let gossip = GossipStore::load(&gossip_path, now)?;
        let couriers = CourierStore::load(&courier_path, now)?;
        let (groups, group_states) = load_groups(&groups_path)?;
        Ok(Self {
            identity,
            nickname: normalize_nickname(nickname),
            fragments: FragmentAssembler::default(),
            gossip,
            couriers,
            peers: load_json_or_default(&trusted_path)?,
            handshakes: HashMap::new(),
            transports: HashMap::new(),
            pending: HashMap::new(),
            groups,
            group_states,
            seen: HashSet::new(),
            gossip_path,
            courier_path,
            groups_path,
            trusted_path,
        })
    }

    pub fn set_nickname(&mut self, nickname: String) {
        self.nickname = normalize_nickname(nickname);
    }

    #[must_use]
    pub fn status(&self, connected_links: usize) -> MeshStatus {
        let mut peers = self
            .peers
            .iter()
            .map(|(id, peer)| MeshPeer {
                id: hex::encode(id),
                nickname: peer.nickname.clone(),
                fingerprint: hex::encode(Sha256::digest(peer.noise_key)),
                capabilities: peer.capabilities,
                last_seen_ms: peer.last_seen_ms,
                noise_ready: self.transports.contains_key(id),
            })
            .collect::<Vec<_>>();
        peers.sort_by_key(|peer| std::cmp::Reverse(peer.last_seen_ms));
        let mut groups = self
            .groups
            .values()
            .map(|group| MeshGroup {
                id: hex::encode(group.group_id),
                name: group.name.clone(),
                epoch: group.epoch,
                members: group
                    .members
                    .iter()
                    .map(|member| member.nickname.clone())
                    .collect(),
            })
            .collect::<Vec<_>>();
        groups.sort_by(|left, right| left.name.cmp(&right.name));
        MeshStatus {
            peer_id: hex::encode(self.identity.peer_id()),
            fingerprint: hex::encode(self.identity.fingerprint()),
            connected_links,
            peers,
            groups,
        }
    }

    pub fn announce_frames(&self) -> Result<Vec<Vec<u8>>, String> {
        let payload = encode_announcement(
            &self.nickname,
            &self.identity.noise_public_key(),
            &self.identity.signing_public_key(),
        )?;
        let packet = self.sign_packet(MeshPacket {
            message_type: MeshMessageType::Announce,
            ttl: MeshPacket::DEFAULT_TTL,
            timestamp_ms: now_ms(),
            sender_id: self.identity.peer_id(),
            recipient_id: None,
            payload,
            signature: None,
        })?;
        packet_frames(&packet)
    }

    pub fn sync_request_frames(&self) -> Result<Vec<Vec<u8>>, String> {
        let packet = self.sign_packet(MeshPacket {
            message_type: MeshMessageType::RequestSync,
            ttl: 1,
            timestamp_ms: now_ms(),
            sender_id: self.identity.peer_id(),
            recipient_id: None,
            payload: self.gossip.filter().encode(),
            signature: None,
        })?;
        packet_frames(&packet)
    }

    pub fn public_message_frames(
        &mut self,
        content: String,
        timestamp_ms: u64,
    ) -> Result<(MeshChatEvent, Vec<Vec<u8>>), String> {
        let content = normalize_text(content)?;
        let packet = self.sign_packet(MeshPacket {
            message_type: MeshMessageType::Message,
            ttl: MeshPacket::DEFAULT_TTL,
            timestamp_ms,
            sender_id: self.identity.peer_id(),
            recipient_id: None,
            payload: content.as_bytes().to_vec(),
            signature: None,
        })?;
        let bytes = packet.encode(true)?;
        let id = stable_message_id(&packet);
        self.seen.insert(mesh_packet_id(&packet));
        self.gossip.insert(bytes, timestamp_ms);
        self.persist_gossip()?;
        let event = MeshChatEvent {
            kind: "message".into(),
            id,
            sender_id: hex::encode(packet.sender_id),
            sender_name: self.nickname.clone(),
            content: Some(content),
            timestamp_ms,
            group_id: None,
            file_name: None,
            mime_type: None,
            data_base64: None,
        };
        Ok((event, packet_frames(&packet)?))
    }

    pub fn private_message_frames(
        &mut self,
        recipient: [u8; 8],
        content: String,
        message_id: String,
    ) -> Result<Vec<Vec<u8>>, String> {
        let content = normalize_text(content)?;
        let payload = encode_private_message(&message_id, &content)?;
        self.send_or_queue_noise(recipient, typed_noise(NOISE_PRIVATE_MESSAGE, payload))
    }

    pub fn media_frames(
        &mut self,
        recipient: Option<[u8; 8]>,
        file_name: Option<String>,
        mime_type: Option<String>,
        data: Vec<u8>,
        voice: bool,
    ) -> Result<Vec<Vec<u8>>, String> {
        let payload = MediaPacket {
            file_name,
            mime_type,
            content: data,
        }
        .encode()?;
        if let Some(recipient) = recipient {
            let noise_type = if voice {
                NOISE_VOICE_FRAME
            } else {
                NOISE_PRIVATE_FILE
            };
            return self.send_or_queue_noise(recipient, typed_noise(noise_type, payload));
        }
        let message_type = if voice {
            MeshMessageType::VoiceFrame
        } else {
            MeshMessageType::FileTransfer
        };
        let packet = self.sign_packet(MeshPacket {
            message_type,
            ttl: MeshPacket::DEFAULT_TTL,
            timestamp_ms: now_ms(),
            sender_id: self.identity.peer_id(),
            recipient_id: None,
            payload,
            signature: None,
        })?;
        packet_frames(&packet)
    }

    pub fn create_group(
        &mut self,
        name: String,
        member_ids: &[[u8; 8]],
    ) -> Result<(MeshGroup, Vec<Vec<u8>>), String> {
        let local = GroupMember {
            fingerprint: self.identity.fingerprint(),
            signing_key: self.identity.signing_public_key(),
            nickname: self.nickname.clone(),
        };
        let mut members = vec![local];
        for peer_id in member_ids {
            let peer = self
                .peers
                .get(peer_id)
                .ok_or_else(|| format!("mesh peer {} is not known", hex::encode(peer_id)))?;
            members.push(GroupMember {
                fingerprint: Sha256::digest(peer.noise_key).into(),
                signing_key: peer.signing_key,
                nickname: peer.nickname.clone(),
            });
        }
        members.sort_by_key(|member| member.fingerprint);
        members.dedup_by_key(|member| member.fingerprint);
        let group = PrivateGroup::create(name, members, self.identity.fingerprint())?;
        let state = group.encode_signed_state(self.identity.signing_key())?;
        let group_id = group.group_id;
        let summary = MeshGroup {
            id: hex::encode(group_id),
            name: group.name.clone(),
            epoch: group.epoch,
            members: group
                .members
                .iter()
                .map(|member| member.nickname.clone())
                .collect(),
        };
        self.groups.insert(group_id, group);
        self.group_states.insert(group_id, state.clone());
        self.persist_groups()?;
        let mut frames = Vec::new();
        for peer_id in member_ids {
            frames.extend(
                self.send_or_queue_noise(*peer_id, typed_noise(NOISE_GROUP_INVITE, state.clone()))?,
            );
        }
        Ok((summary, frames))
    }

    pub fn group_message_frames(
        &mut self,
        group_id: [u8; 16],
        content: String,
        message_id: String,
    ) -> Result<(MeshChatEvent, Vec<Vec<u8>>), String> {
        let timestamp_ms = now_ms();
        let group = self
            .groups
            .get(&group_id)
            .ok_or_else(|| "private group is not available".to_string())?;
        let envelope = group.seal_message(
            &message_id,
            &normalize_text(content)?,
            &self.nickname,
            self.identity.signing_key(),
            timestamp_ms,
        )?;
        let packet = MeshPacket {
            message_type: MeshMessageType::GroupMessage,
            ttl: MeshPacket::DEFAULT_TTL,
            timestamp_ms,
            sender_id: self.identity.peer_id(),
            recipient_id: None,
            payload: envelope.encode()?,
            signature: None,
        };
        let opened = group.open_message(&envelope)?;
        let event = MeshChatEvent {
            kind: "group_message".into(),
            id: opened.message_id,
            sender_id: hex::encode(packet.sender_id),
            sender_name: opened.sender_nickname,
            content: Some(opened.content),
            timestamp_ms,
            group_id: Some(hex::encode(group_id)),
            file_name: None,
            mime_type: None,
            data_base64: None,
        };
        Ok((event, packet_frames(&packet)?))
    }

    pub fn trust_url(&self, nickname: String, npub: Option<String>) -> Result<String, String> {
        self.identity
            .signed_trust_record(nickname, npub, now_seconds())?
            .to_url()
    }

    pub fn verify_trust_url(&mut self, value: &str) -> Result<MeshPeer, String> {
        let record = TrustRecord::from_url(value)?;
        record.verify(now_seconds())?;
        let id: [u8; 8] = Sha256::digest(record.noise_key)[..8]
            .try_into()
            .expect("SHA-256 prefix");
        let peer = MeshPeer {
            id: hex::encode(id),
            nickname: record.nickname.clone(),
            fingerprint: hex::encode(Sha256::digest(record.noise_key)),
            capabilities: 0,
            last_seen_ms: u64::try_from(record.timestamp_seconds)
                .unwrap_or_default()
                .saturating_mul(1_000),
            noise_ready: false,
        };
        self.peers.insert(
            id,
            PeerState {
                nickname: record.nickname,
                noise_key: record.noise_key,
                signing_key: record.signing_key,
                capabilities: 0,
                last_seen_ms: peer.last_seen_ms,
            },
        );
        save_json_atomic(
            &self.trusted_path,
            &self.peers,
            MAX_TRUSTED_PEERS_STORE_BYTES,
        )?;
        Ok(peer)
    }

    pub fn ingest_frame(&mut self, bytes: &[u8]) -> Result<MeshIngress, String> {
        let packet = MeshPacket::decode(bytes)?;
        if packet.sender_id == self.identity.peer_id() {
            return Ok(MeshIngress {
                events: Vec::new(),
                outbound_frames: Vec::new(),
            });
        }
        if packet.message_type == MeshMessageType::Fragment {
            return match self.fragments.push(&packet)? {
                FragmentResult::Complete { packet } => self.ingest_packet(packet),
                FragmentResult::Stored { .. } | FragmentResult::Duplicate { .. } => {
                    Ok(MeshIngress {
                        events: Vec::new(),
                        outbound_frames: Vec::new(),
                    })
                }
            };
        }
        self.ingest_packet(packet)
    }

    pub fn wipe(&mut self) -> Result<(), String> {
        GossipStore::wipe(&self.gossip_path)?;
        CourierStore::wipe(&self.courier_path)?;
        remove_file(&self.groups_path)?;
        remove_file(&self.trusted_path)?;
        self.gossip = GossipStore::default();
        self.couriers = CourierStore::default();
        self.groups.clear();
        self.group_states.clear();
        self.peers.clear();
        self.handshakes.clear();
        self.transports.clear();
        self.pending.clear();
        self.seen.clear();
        Ok(())
    }

    fn ingest_packet(&mut self, packet: MeshPacket) -> Result<MeshIngress, String> {
        if packet
            .recipient_id
            .is_some_and(|id| id != self.identity.peer_id())
            && packet.recipient_id != Some([0xff; 8])
        {
            return self.forward_only(packet);
        }
        let encoded = packet.encode(true)?;
        let id = mesh_packet_id(&packet);
        if !self.seen.insert(id) {
            return Ok(MeshIngress {
                events: Vec::new(),
                outbound_frames: Vec::new(),
            });
        }

        let mut events = Vec::new();
        let mut outbound_frames = Vec::new();
        match packet.message_type {
            MeshMessageType::Announce => {
                let announcement = decode_announcement(&packet.payload)?;
                if !MeshIdentity::verify(
                    &announcement.signing_key,
                    &packet.signing_bytes()?,
                    packet
                        .signature
                        .as_ref()
                        .ok_or_else(|| "mesh announcement is unsigned".to_string())?,
                ) {
                    return Err("mesh announcement signature is invalid".into());
                }
                let capabilities = announcement
                    .capabilities
                    .iter()
                    .enumerate()
                    .take(8)
                    .fold(0_u64, |value, (index, byte)| {
                        value | (u64::from(*byte) << (index * 8))
                    });
                if self.peers.get(&packet.sender_id).is_some_and(|known| {
                    known.noise_key != announcement.noise_key
                        || known.signing_key != announcement.signing_key
                }) {
                    return Err("mesh identity changed after trust-on-first-use pinning".into());
                }
                self.peers.insert(
                    packet.sender_id,
                    PeerState {
                        nickname: announcement.nickname.clone(),
                        noise_key: announcement.noise_key,
                        signing_key: announcement.signing_key,
                        capabilities,
                        last_seen_ms: now_ms(),
                    },
                );
                events.push(MeshChatEvent {
                    kind: "peer".into(),
                    id: hex::encode(packet.sender_id),
                    sender_id: hex::encode(packet.sender_id),
                    sender_name: announcement.nickname,
                    content: None,
                    timestamp_ms: packet.timestamp_ms,
                    group_id: None,
                    file_name: None,
                    mime_type: None,
                    data_base64: None,
                });
            }
            MeshMessageType::Message => {
                self.verify_known_signature(&packet)?;
                let content = String::from_utf8(packet.payload.clone())
                    .map_err(|_| "mesh message is not valid UTF-8")?;
                let nickname = self.peer_nickname(&packet.sender_id);
                events.push(MeshChatEvent {
                    kind: "message".into(),
                    id: stable_message_id(&packet),
                    sender_id: hex::encode(packet.sender_id),
                    sender_name: nickname,
                    content: Some(content),
                    timestamp_ms: packet.timestamp_ms,
                    group_id: None,
                    file_name: None,
                    mime_type: None,
                    data_base64: None,
                });
                self.gossip.insert(encoded.clone(), now_ms());
                self.persist_gossip()?;
            }
            MeshMessageType::NoiseHandshake => {
                outbound_frames.extend(self.handle_handshake(packet.sender_id, &packet.payload)?);
            }
            MeshMessageType::NoiseEncrypted => {
                let (received, responses) =
                    self.handle_encrypted(packet.sender_id, &packet.payload, packet.timestamp_ms)?;
                events.extend(received);
                outbound_frames.extend(responses);
            }
            MeshMessageType::GroupMessage => {
                let envelope = GroupEnvelope::decode(&packet.payload)?;
                if let Some(group) = self.groups.get(&envelope.group_id) {
                    let message = group.open_message(&envelope)?;
                    events.push(MeshChatEvent {
                        kind: "group_message".into(),
                        id: message.message_id,
                        sender_id: hex::encode(packet.sender_id),
                        sender_name: message.sender_nickname,
                        content: Some(message.content),
                        timestamp_ms: message.timestamp_ms,
                        group_id: Some(hex::encode(envelope.group_id)),
                        file_name: None,
                        mime_type: None,
                        data_base64: None,
                    });
                }
                self.gossip.insert(encoded.clone(), now_ms());
                self.persist_gossip()?;
            }
            MeshMessageType::FileTransfer | MeshMessageType::VoiceFrame => {
                self.verify_known_signature(&packet)?;
                if let Some(event) = self.media_event(
                    packet.sender_id,
                    packet.timestamp_ms,
                    packet.message_type == MeshMessageType::VoiceFrame,
                    &packet.payload,
                    None,
                )? {
                    events.push(event);
                }
            }
            MeshMessageType::RequestSync => {
                self.verify_known_signature(&packet)?;
                let filter = GossipFilter::decode(&packet.payload)?;
                for missing in self.gossip.packets_missing_from(&filter, 64) {
                    outbound_frames.push(missing);
                }
            }
            MeshMessageType::CourierEnvelope => {
                self.verify_known_signature(&packet)?;
                let envelope = CourierEnvelope::decode(&packet.payload)?;
                if self.couriers.deposit(
                    envelope,
                    packet.sender_id.to_vec(),
                    CourierDepositTier::Verified,
                    now_ms(),
                ) {
                    self.couriers.save(&self.courier_path)?;
                }
            }
            MeshMessageType::Ping => {
                let response = MeshPacket {
                    message_type: MeshMessageType::Pong,
                    ttl: 1,
                    timestamp_ms: now_ms(),
                    sender_id: self.identity.peer_id(),
                    recipient_id: Some(packet.sender_id),
                    payload: packet.payload.clone(),
                    signature: None,
                };
                outbound_frames.extend(packet_frames(&response)?);
            }
            MeshMessageType::Leave
            | MeshMessageType::Pong
            | MeshMessageType::BoardPost
            | MeshMessageType::PrekeyBundle
            | MeshMessageType::RelayCarrier
            | MeshMessageType::Fragment => {}
        }

        if packet.recipient_id.is_none() && packet.ttl > 1 {
            let mut forwarded = packet;
            forwarded.ttl -= 1;
            outbound_frames.extend(packet_frames(&forwarded)?);
        }
        Ok(MeshIngress {
            events,
            outbound_frames,
        })
    }

    fn forward_only(&self, mut packet: MeshPacket) -> Result<MeshIngress, String> {
        let outbound_frames = if packet.ttl > 1 {
            packet.ttl -= 1;
            packet_frames(&packet)?
        } else {
            Vec::new()
        };
        Ok(MeshIngress {
            events: Vec::new(),
            outbound_frames,
        })
    }

    fn sign_packet(&self, mut packet: MeshPacket) -> Result<MeshPacket, String> {
        packet.signature = Some(self.identity.sign(&packet.signing_bytes()?));
        Ok(packet)
    }

    fn verify_known_signature(&self, packet: &MeshPacket) -> Result<(), String> {
        let peer = self
            .peers
            .get(&packet.sender_id)
            .ok_or_else(|| "mesh sender has no verified announcement".to_string())?;
        let signature = packet
            .signature
            .as_ref()
            .ok_or_else(|| "mesh packet is unsigned".to_string())?;
        if !MeshIdentity::verify(&peer.signing_key, &packet.signing_bytes()?, signature) {
            return Err("mesh packet signature is invalid".into());
        }
        Ok(())
    }

    fn send_or_queue_noise(
        &mut self,
        recipient: [u8; 8],
        payload: Vec<u8>,
    ) -> Result<Vec<Vec<u8>>, String> {
        if self.transports.contains_key(&recipient) {
            return self.encrypt_noise(recipient, &payload);
        }
        if !self.peers.contains_key(&recipient) {
            return Err("mesh recipient has not announced a reachable identity".into());
        }
        let queue = self.pending.entry(recipient).or_default();
        if queue.len() >= MAX_PENDING_PER_PEER {
            queue.pop_front();
        }
        queue.push_back(PendingNoisePayload { payload });
        if self.handshakes.contains_key(&recipient) {
            return Ok(Vec::new());
        }
        let mut handshake =
            NoiseHandshake::new(NoiseRole::Initiator, &self.identity.noise_private_key())?;
        let first = handshake.write(&[])?;
        self.handshakes
            .insert(recipient, HandshakePhase::Initiator(handshake));
        self.handshake_packet_frames(recipient, first)
    }

    fn handle_handshake(
        &mut self,
        sender: [u8; 8],
        payload: &[u8],
    ) -> Result<Vec<Vec<u8>>, String> {
        let mut frames = Vec::new();
        if let Some(phase) = self.handshakes.remove(&sender) {
            match phase {
                HandshakePhase::Initiator(mut handshake) => {
                    handshake.read(payload)?;
                    let third = handshake.write(&[])?;
                    let transport = handshake.into_transport()?;
                    self.validate_noise_identity(sender, &transport)?;
                    self.transports.insert(sender, transport);
                    frames.extend(self.handshake_packet_frames(sender, third)?);
                    frames.extend(self.flush_pending(sender)?);
                }
                HandshakePhase::Responder(mut handshake) => {
                    handshake.read(payload)?;
                    let transport = handshake.into_transport()?;
                    self.validate_noise_identity(sender, &transport)?;
                    self.transports.insert(sender, transport);
                    frames.extend(self.flush_pending(sender)?);
                }
            }
            return Ok(frames);
        }
        let mut handshake =
            NoiseHandshake::new(NoiseRole::Responder, &self.identity.noise_private_key())?;
        handshake.read(payload)?;
        let response = handshake.write(&[])?;
        self.handshakes
            .insert(sender, HandshakePhase::Responder(handshake));
        self.handshake_packet_frames(sender, response)
    }

    fn validate_noise_identity(
        &self,
        sender: [u8; 8],
        transport: &NoiseTransport,
    ) -> Result<(), String> {
        let derived: [u8; 8] = Sha256::digest(transport.remote_static_key())[..8]
            .try_into()
            .expect("SHA-256 prefix");
        if derived != sender {
            return Err("Noise static key does not match the claimed peer ID".into());
        }
        if self
            .peers
            .get(&sender)
            .is_some_and(|peer| peer.noise_key != transport.remote_static_key())
        {
            return Err("Noise static key changed after announcement".into());
        }
        Ok(())
    }

    fn handshake_packet_frames(
        &self,
        recipient: [u8; 8],
        payload: Vec<u8>,
    ) -> Result<Vec<Vec<u8>>, String> {
        packet_frames(&MeshPacket {
            message_type: MeshMessageType::NoiseHandshake,
            ttl: 1,
            timestamp_ms: now_ms(),
            sender_id: self.identity.peer_id(),
            recipient_id: Some(recipient),
            payload,
            signature: None,
        })
    }

    fn encrypt_noise(
        &mut self,
        recipient: [u8; 8],
        payload: &[u8],
    ) -> Result<Vec<Vec<u8>>, String> {
        let encrypted = self
            .transports
            .get_mut(&recipient)
            .ok_or_else(|| "Noise session is not ready".to_string())?
            .encrypt(payload)?;
        packet_frames(&MeshPacket {
            message_type: MeshMessageType::NoiseEncrypted,
            ttl: 1,
            timestamp_ms: now_ms(),
            sender_id: self.identity.peer_id(),
            recipient_id: Some(recipient),
            payload: encrypted,
            signature: None,
        })
    }

    fn flush_pending(&mut self, recipient: [u8; 8]) -> Result<Vec<Vec<u8>>, String> {
        let pending = self.pending.remove(&recipient).unwrap_or_default();
        let mut frames = Vec::new();
        for payload in pending {
            frames.extend(self.encrypt_noise(recipient, &payload.payload)?);
        }
        Ok(frames)
    }

    fn handle_encrypted(
        &mut self,
        sender: [u8; 8],
        payload: &[u8],
        timestamp_ms: u64,
    ) -> Result<(Vec<MeshChatEvent>, Vec<Vec<u8>>), String> {
        let plaintext = self
            .transports
            .get_mut(&sender)
            .ok_or_else(|| "encrypted mesh packet arrived without a Noise session".to_string())?
            .decrypt(payload)?;
        let (&payload_type, body) = plaintext
            .split_first()
            .ok_or_else(|| "Noise payload is empty".to_string())?;
        let mut events = Vec::new();
        let mut responses = Vec::new();
        match payload_type {
            NOISE_PRIVATE_MESSAGE => {
                let (message_id, content) = decode_private_message(body)?;
                events.push(MeshChatEvent {
                    kind: "private_message".into(),
                    id: message_id.clone(),
                    sender_id: hex::encode(sender),
                    sender_name: self.peer_nickname(&sender),
                    content: Some(content),
                    timestamp_ms,
                    group_id: None,
                    file_name: None,
                    mime_type: None,
                    data_base64: None,
                });
                responses.extend(self.encrypt_noise(
                    sender,
                    &typed_noise(NOISE_DELIVERED, message_id.into_bytes()),
                )?);
            }
            NOISE_DELIVERED | NOISE_READ_RECEIPT => {
                events.push(MeshChatEvent {
                    kind: if payload_type == NOISE_READ_RECEIPT {
                        "read"
                    } else {
                        "delivered"
                    }
                    .into(),
                    id: String::from_utf8(body.to_vec())
                        .map_err(|_| "receipt message id is not UTF-8")?,
                    sender_id: hex::encode(sender),
                    sender_name: self.peer_nickname(&sender),
                    content: None,
                    timestamp_ms,
                    group_id: None,
                    file_name: None,
                    mime_type: None,
                    data_base64: None,
                });
            }
            NOISE_GROUP_INVITE | NOISE_GROUP_UPDATE => {
                let group = PrivateGroup::decode_signed_state(body)?;
                let group_id = group.group_id;
                let group_name = group.name.clone();
                self.groups.insert(group_id, group);
                self.group_states.insert(group_id, body.to_vec());
                self.persist_groups()?;
                events.push(MeshChatEvent {
                    kind: "group_update".into(),
                    id: hex::encode(group_id),
                    sender_id: hex::encode(sender),
                    sender_name: self.peer_nickname(&sender),
                    content: Some(group_name),
                    timestamp_ms,
                    group_id: Some(hex::encode(group_id)),
                    file_name: None,
                    mime_type: None,
                    data_base64: None,
                });
            }
            NOISE_PRIVATE_FILE | NOISE_VOICE_FRAME => {
                if let Some(event) = self.media_event(
                    sender,
                    timestamp_ms,
                    payload_type == NOISE_VOICE_FRAME,
                    body,
                    Some(sender),
                )? {
                    events.push(event);
                }
            }
            _ => {}
        }
        Ok((events, responses))
    }

    fn media_event(
        &self,
        sender: [u8; 8],
        timestamp_ms: u64,
        voice: bool,
        payload: &[u8],
        recipient: Option<[u8; 8]>,
    ) -> Result<Option<MeshChatEvent>, String> {
        let media = MediaPacket::decode(payload)?;
        if media.content.len() > MAX_EVENT_MEDIA_BYTES {
            return Ok(None);
        }
        let id = media
            .stable_message_id(
                &sender,
                &recipient.unwrap_or_else(|| self.identity.peer_id()),
            )
            .unwrap_or_else(|| format!("media-{}", hex::encode(digest_id(payload))));
        Ok(Some(MeshChatEvent {
            kind: match (voice, recipient.is_some()) {
                (true, true) => "private_voice",
                (false, true) => "private_media",
                (true, false) => "voice",
                (false, false) => "media",
            }
            .into(),
            id,
            sender_id: hex::encode(sender),
            sender_name: self.peer_nickname(&sender),
            content: None,
            timestamp_ms,
            group_id: None,
            file_name: media.file_name,
            mime_type: media.mime_type,
            data_base64: Some(STANDARD.encode(media.content)),
        }))
    }

    fn peer_nickname(&self, peer_id: &[u8; 8]) -> String {
        self.peers
            .get(peer_id)
            .map_or_else(|| hex::encode(peer_id), |peer| peer.nickname.clone())
    }

    fn persist_gossip(&self) -> Result<(), String> {
        self.gossip.save(&self.gossip_path)
    }

    fn persist_groups(&self) -> Result<(), String> {
        let states = self.group_states.values().cloned().collect::<Vec<_>>();
        save_json_atomic(&self.groups_path, &states, MAX_GROUP_STORE_BYTES)
    }
}

#[derive(Debug)]
struct Announcement {
    nickname: String,
    noise_key: [u8; 32],
    signing_key: [u8; 32],
    capabilities: Vec<u8>,
}

fn encode_announcement(
    nickname: &str,
    noise_key: &[u8; 32],
    signing_key: &[u8; 32],
) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    put_u8_tlv(&mut out, 0x01, nickname.as_bytes())?;
    put_u8_tlv(&mut out, 0x02, noise_key)?;
    put_u8_tlv(&mut out, 0x03, signing_key)?;
    put_u8_tlv(&mut out, 0x05, &CAPABILITIES)?;
    Ok(out)
}

fn decode_announcement(data: &[u8]) -> Result<Announcement, String> {
    let mut offset = 0;
    let mut nickname = None;
    let mut noise_key = None;
    let mut signing_key = None;
    let mut capabilities = Vec::new();
    while offset < data.len() {
        let field_type = *data
            .get(offset)
            .ok_or_else(|| "announcement TLV is truncated".to_string())?;
        let length = usize::from(
            *data
                .get(offset + 1)
                .ok_or_else(|| "announcement length is truncated".to_string())?,
        );
        offset += 2;
        let end = offset
            .checked_add(length)
            .ok_or_else(|| "announcement length overflow".to_string())?;
        let value = data
            .get(offset..end)
            .ok_or_else(|| "announcement value is truncated".to_string())?;
        offset = end;
        match field_type {
            0x01 => {
                nickname = Some(
                    String::from_utf8(value.to_vec())
                        .map_err(|_| "announcement nickname is not UTF-8")?,
                );
            }
            0x02 if value.len() == 32 => {
                noise_key = Some(value.try_into().map_err(|_| "invalid Noise key")?);
            }
            0x03 if value.len() == 32 => {
                signing_key = Some(value.try_into().map_err(|_| "invalid signing key")?);
            }
            0x05 => capabilities = value.to_vec(),
            _ => {}
        }
    }
    Ok(Announcement {
        nickname: normalize_nickname(
            nickname.ok_or_else(|| "announcement nickname is missing".to_string())?,
        ),
        noise_key: noise_key.ok_or_else(|| "announcement Noise key is missing".to_string())?,
        signing_key: signing_key
            .ok_or_else(|| "announcement signing key is missing".to_string())?,
        capabilities,
    })
}

fn encode_private_message(message_id: &str, content: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    put_u8_tlv(&mut out, 0x00, message_id.as_bytes())?;
    put_u8_tlv(&mut out, 0x01, content.as_bytes())?;
    Ok(out)
}

fn decode_private_message(data: &[u8]) -> Result<(String, String), String> {
    let mut offset = 0;
    let mut message_id = None;
    let mut content = None;
    while offset < data.len() {
        let field_type = *data
            .get(offset)
            .ok_or_else(|| "private message TLV is truncated".to_string())?;
        let length = usize::from(
            *data
                .get(offset + 1)
                .ok_or_else(|| "private message length is truncated".to_string())?,
        );
        offset += 2;
        let end = offset
            .checked_add(length)
            .ok_or_else(|| "private message length overflow".to_string())?;
        let value = data
            .get(offset..end)
            .ok_or_else(|| "private message value is truncated".to_string())?;
        offset = end;
        match field_type {
            0x00 => {
                message_id = Some(
                    String::from_utf8(value.to_vec())
                        .map_err(|_| "private message id is not UTF-8")?,
                );
            }
            0x01 => {
                content = Some(
                    String::from_utf8(value.to_vec())
                        .map_err(|_| "private message content is not UTF-8")?,
                );
            }
            _ => {}
        }
    }
    Ok((
        message_id.ok_or_else(|| "private message id is missing".to_string())?,
        content.ok_or_else(|| "private message content is missing".to_string())?,
    ))
}

fn typed_noise(payload_type: u8, payload: Vec<u8>) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() + 1);
    out.push(payload_type);
    out.extend(payload);
    out
}

fn put_u8_tlv(out: &mut Vec<u8>, field_type: u8, value: &[u8]) -> Result<(), String> {
    let length = u8::try_from(value.len()).map_err(|_| "TLV value exceeds 255 bytes")?;
    out.extend([field_type, length]);
    out.extend(value);
    Ok(())
}

fn packet_frames(packet: &MeshPacket) -> Result<Vec<Vec<u8>>, String> {
    let encoded = packet.encode(true)?;
    if encoded.len() <= BLE_FRAME_BYTES {
        return Ok(vec![encoded]);
    }
    Fragmenter::split(packet, Some(BLE_FRAGMENT_BYTES))?
        .iter()
        .map(|fragment| fragment.encode(false))
        .collect()
}

fn stable_message_id(packet: &MeshPacket) -> String {
    let mut digest = Sha256::new();
    digest.update(packet.sender_id);
    digest.update(packet.timestamp_ms.to_be_bytes());
    digest.update(&packet.payload);
    let encoded = hex::encode(digest.finalize());
    format!("mesh-{}", &encoded[..32])
}

fn digest_id(bytes: &[u8]) -> [u8; 16] {
    Sha256::digest(bytes)[..16]
        .try_into()
        .expect("SHA-256 always contains 16 bytes")
}

fn normalize_text(content: String) -> Result<String, String> {
    let content = content.trim().to_string();
    if content.is_empty() || content.len() > MAX_TEXT_BYTES {
        return Err("Messages must be between 1 and 8,000 bytes.".into());
    }
    Ok(content)
}

fn normalize_nickname(nickname: String) -> String {
    let nickname = nickname.trim();
    if nickname.is_empty() {
        "anonymous".into()
    } else {
        nickname.chars().take(32).collect()
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis() as u64)
}

fn now_seconds() -> i64 {
    i64::try_from(now_ms() / 1_000).unwrap_or(i64::MAX)
}

fn load_groups(path: &Path) -> Result<(GroupMap, GroupStateMap), String> {
    if !path.exists() {
        return Ok((HashMap::new(), HashMap::new()));
    }
    let states = bounded_json::read::<Vec<Vec<u8>>>(path, MAX_GROUP_STORE_BYTES)?;
    let mut groups = HashMap::new();
    let mut signed_states = HashMap::new();
    for state in states {
        let group = PrivateGroup::decode_signed_state(&state)?;
        signed_states.insert(group.group_id, state);
        groups.insert(group.group_id, group);
    }
    Ok((groups, signed_states))
}

fn save_json_atomic<T: Serialize>(path: &Path, value: &T, max_bytes: usize) -> Result<(), String> {
    bounded_json::write(path, value, max_bytes)
}

fn load_json_or_default<T>(path: &Path) -> Result<T, String>
where
    T: serde::de::DeserializeOwned + Default,
{
    if !path.exists() {
        return Ok(T::default());
    }
    bounded_json::read(path, MAX_TRUSTED_PEERS_STORE_BYTES)
}

fn remove_file(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn runtime(path: &Path, nickname: &str) -> ChatMeshRuntime {
        ChatMeshRuntime::load(
            path,
            MeshIdentity::generate().expect("identity"),
            nickname.into(),
        )
        .expect("runtime")
    }

    #[test]
    fn signed_public_message_round_trips_between_runtimes() {
        let directory = tempdir().expect("temp");
        let mut alice = runtime(&directory.path().join("alice"), "Alice");
        let mut bob = runtime(&directory.path().join("bob"), "Bob");
        for frame in alice.announce_frames().expect("announce") {
            bob.ingest_frame(&frame).expect("ingest announce");
        }
        let (_, frames) = alice
            .public_message_frames("hello mesh".into(), 1_720_000_000_000)
            .expect("message");
        let mut events = Vec::new();
        for frame in frames {
            events.extend(bob.ingest_frame(&frame).expect("ingest").events);
        }
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].content.as_deref(), Some("hello mesh"));
        assert_eq!(events[0].sender_name, "Alice");
    }

    #[test]
    fn noise_private_message_establishes_and_decrypts() {
        let directory = tempdir().expect("temp");
        let mut alice = runtime(&directory.path().join("alice"), "Alice");
        let mut bob = runtime(&directory.path().join("bob"), "Bob");
        for frame in alice.announce_frames().expect("announce") {
            bob.ingest_frame(&frame).expect("bob announce");
        }
        for frame in bob.announce_frames().expect("announce") {
            alice.ingest_frame(&frame).expect("alice announce");
        }
        let bob_id = bob.identity.peer_id();
        let mut to_bob = alice
            .private_message_frames(bob_id, "secret hello".into(), "m-1".into())
            .expect("queue");
        let mut events = Vec::new();
        while let Some(frame) = to_bob.pop() {
            let result = bob.ingest_frame(&frame).expect("bob ingest");
            for response in result.outbound_frames {
                let back = alice.ingest_frame(&response).expect("alice ingest");
                for final_frame in back.outbound_frames {
                    let final_result = bob.ingest_frame(&final_frame).expect("bob final");
                    events.extend(final_result.events);
                    to_bob.extend(final_result.outbound_frames);
                }
            }
            events.extend(result.events);
        }
        assert!(events
            .iter()
            .any(|event| event.content.as_deref() == Some("secret hello")));
    }
}
