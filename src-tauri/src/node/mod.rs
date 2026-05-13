//! iroh node management — endpoint setup, blob protocol, and discovery.

mod discovery;
mod endpoint;
mod nearby;
pub mod nearby_offer;
pub mod nearby_protocol;
mod status;

pub use endpoint::LightningP2PNode;
pub use nearby::{
    spawn_nearby_discovery_loop, ActiveShare, NearbyDevice, NearbyDiagnosticState, NearbyShare,
    NearbyShareRegistry, NearbyTransport,
};
pub use nearby_offer::{IncomingOffer, OfferInbox, OfferRejection, PendingOffer};
pub use nearby_protocol::NearbyShareProtocol;
pub use status::{NodeOnlineState, NodeRuntimeStatus};
