//! Structured logging and tracing setup.

use tracing_subscriber::EnvFilter;

/// Initializes the `tracing` subscriber with env-filter support.
///
/// Set `RUST_LOG=lightning_p2p=debug` for verbose output.
/// Defaults to `info` level.
pub fn init_tracing() {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_filter()));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_thread_ids(false)
        .with_file(false)
        .init();

    tracing::info!("Lightning P2P tracing initialized");
}

fn default_filter() -> &'static str {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        "lightning_p2p=warn,iroh=warn"
    } else {
        "lightning_p2p=info,iroh=warn"
    }
}
