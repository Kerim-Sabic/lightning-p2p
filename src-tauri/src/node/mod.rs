//! iroh node management — endpoint setup, blob protocol, and discovery.

mod blob_access;
mod blob_request_limiter;
pub mod chat_mesh;
pub mod chat_protocol;
mod discovery;
mod endpoint;
mod nearby;
pub mod nearby_offer;
pub mod nearby_protocol;
mod status;
mod supervisor;

pub use endpoint::LightningP2PNode;
pub use nearby::{
    spawn_nearby_discovery_loop, ActiveShare, NearbyDevice, NearbyDiagnosticState, NearbyRouteHint,
    NearbyShare, NearbyShareRegistry, NearbyTransport,
};
pub use nearby_offer::{IncomingOffer, OfferInbox, OfferRejection, PendingOffer};
pub use nearby_protocol::NearbyShareProtocol;
pub use status::{NodeOnlineState, NodeRuntimeStatus};
pub(crate) use supervisor::NearbyServices;
pub use supervisor::{NodeSupervisor, NodeSupervisorPhase, NodeSupervisorStatus};
