//! Native Lightning Chat mesh protocol.
//!
//! The mesh is intentionally isolated from file transfer. This module owns
//! the BLE wire packet, Noise sessions, bounded fragmentation, gossip state,
//! courier mail, private groups, media packets, and QR trust records.

mod courier;
mod fragment;
mod groups;
mod media;
mod noise;
mod runtime;
mod sync;
mod trust;
mod wire;

pub use courier::{CourierDepositTier, CourierEnvelope, CourierStore};
pub use fragment::{FragmentAssembler, FragmentHeader, FragmentResult, Fragmenter};
pub use groups::{GroupEnvelope, GroupMember, GroupMessage, PrivateGroup};
pub use media::MediaPacket;
pub use noise::{NoiseHandshake, NoiseRole, NoiseTransport};
pub use runtime::{ChatMeshRuntime, MeshChatEvent, MeshGroup, MeshIngress, MeshPeer, MeshStatus};
pub use sync::{GossipFilter, GossipStore};
pub use trust::{MeshIdentity, TrustRecord};
pub use wire::{MeshMessageType, MeshPacket};
