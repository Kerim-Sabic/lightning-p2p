//! Structured logging and tracing setup.

use tracing_subscriber::EnvFilter;

/// Initializes the `tracing` subscriber with env-filter support.
///
/// Set `RUST_LOG=fastdrop=debug` for verbose output.
/// Defaults to `info` level.
pub fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("fastdrop=info,iroh=warn"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_thread_ids(false)
        .with_file(false)
        .init();

    tracing::info!("FastDrop tracing initialized");
}
