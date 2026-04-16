//! iroh node management — endpoint setup, blob protocol, and discovery.

mod discovery;
mod endpoint;
mod nearby;
mod nearby_protocol;
mod status;

pub use endpoint::FastDropNode;
pub use nearby::{spawn_nearby_discovery_loop, ActiveShare, NearbyShare, NearbyShareRegistry};
pub use nearby_protocol::NearbyShareProtocol;
pub use status::{NodeOnlineState, NodeRuntimeStatus};
