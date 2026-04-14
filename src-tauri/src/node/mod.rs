//! iroh node management — endpoint setup, blob protocol, and discovery.

mod discovery;
mod endpoint;
mod status;

pub use endpoint::FastDropNode;
pub use status::{NodeOnlineState, NodeRuntimeStatus};
