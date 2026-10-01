//! Transfer management — sending, receiving, progress tracking, and queuing.

mod destination;
pub(crate) mod export;
pub(crate) mod lifecycle;
pub mod metrics;
pub mod mime;
pub mod mode;

pub mod progress;
pub mod queue;
pub mod receiver;
pub mod sender;
mod smart_auto;
pub(crate) mod swarm;
pub mod ticket;

pub use mode::{TransferMode, TransferProfile};
