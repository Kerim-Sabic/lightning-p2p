//! Console entry point for the Lightning P2P CLI.
//!
//! A separate binary from the GUI on purpose: the GUI executable uses the
//! Windows GUI subsystem in release builds and cannot write to a console,
//! which would silently break `lightning-p2p-cli send | ...` piping.

use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn")),
        )
        .with_writer(std::io::stderr)
        .init();
    lightning_p2p_lib::cli::run().await
}
