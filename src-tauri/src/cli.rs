//! Terminal client: send and receive without the GUI.
//!
//! `lightning-p2p-cli send <paths...>` prints the receive ticket to stdout
//! (pipe-friendly; everything else goes to stderr) and stays online until
//! Ctrl+C. `lightning-p2p-cli receive <ticket>` pulls verified bytes into a
//! directory. Both reuse the exact GUI engine paths — `create_share` and
//! `receive_ticket` — so CLI tickets are byte-identical to app tickets and
//! interoperate with every Lightning P2P client.
//!
//! The CLI keeps its own node identity and stores under `<app-data>/cli`
//! (override with `--data-dir`) so it never contends with a running GUI's
//! sled database or blob-store locks.

use crate::error::{LightningP2PError, Result};
use crate::node::LightningP2PNode;
use crate::storage::settings::resolve_app_data_dir;
use crate::transfer::receiver::receive_ticket;
use crate::transfer::sender::create_share;
use crate::transfer::ticket::{encode_fd2_ticket, ShareTicket};
use clap::{Parser, Subcommand};
use qrcode::render::unicode::Dense1x2;
use qrcode::QrCode;
use std::path::PathBuf;
use std::process::ExitCode;

/// Direct peer-to-peer file transfer from the terminal.
#[derive(Parser)]
#[command(
    name = "lightning-p2p-cli",
    version,
    about = "Direct P2P file transfer: BLAKE3-verified bytes over iroh QUIC, no cloud, no account.",
    after_help = "The ticket goes to stdout and everything else to stderr, so\n\
                  `lightning-p2p-cli send big.iso | <anything>` stays clean.\n\
                  Tickets are capability tokens - share them like secrets."
)]
pub struct Cli {
    /// Directory for the CLI node's keys, blob store, and database.
    /// Defaults to a `cli` profile inside the app data directory so a
    /// running GUI is never disturbed.
    #[arg(long, global = true)]
    data_dir: Option<PathBuf>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Share files or folders and print the receive ticket to stdout.
    /// Stays online (the receiver pulls from this process) until Ctrl+C.
    Send {
        /// Files or directories to share.
        #[arg(required = true)]
        paths: Vec<PathBuf>,
        /// Also render the ticket as a terminal QR code (to stderr) for the
        /// Android app's scanner.
        #[arg(long)]
        qr: bool,
    },
    /// Receive a ticket into a directory (BLAKE3-verified as it lands).
    Receive {
        /// Receive link or raw ticket produced by any Lightning P2P client.
        ticket: String,
        /// Destination directory for the verified files.
        #[arg(short, long, default_value = ".")]
        output: PathBuf,
    },
}

/// Parses arguments and runs the requested command.
pub async fn run() -> ExitCode {
    let cli = Cli::parse();
    match execute(cli).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn execute(cli: Cli) -> Result<()> {
    let data_dir = match cli.data_dir {
        Some(dir) => dir,
        None => resolve_app_data_dir()?.join("cli"),
    };
    match cli.command {
        Command::Send { paths, qr } => send(data_dir, paths, qr).await,
        Command::Receive { ticket, output } => receive(data_dir, &ticket, output).await,
    }
}

async fn send(data_dir: PathBuf, paths: Vec<PathBuf>, qr: bool) -> Result<()> {
    let node = start_node(&data_dir).await?;
    eprintln!("importing {} path(s) into the local store...", paths.len());
    let outcome = create_share(&node, paths).await?;
    let ticket = encode_fd2_ticket(&outcome.ticket, &outcome.label, outcome.total_size)?;

    eprintln!(
        "sharing \"{}\" ({}) - BLAKE3 root {}",
        outcome.label,
        format_bytes(outcome.total_size),
        outcome.hash
    );
    if qr {
        print_qr(&ticket);
    }
    println!("{ticket}");
    eprintln!("sender online - receivers pull directly from this process. Ctrl+C to stop.");

    tokio::signal::ctrl_c()
        .await
        .map_err(LightningP2PError::from)?;
    eprintln!("stopping sender...");
    node.shutdown().await
}

async fn receive(data_dir: PathBuf, ticket: &str, output: PathBuf) -> Result<()> {
    let parsed = ShareTicket::parse(ticket)?;
    std::fs::create_dir_all(&output)?;
    let node = start_node(&data_dir).await?;

    eprintln!("connecting to sender and pulling verified bytes...");
    let outcome = receive_ticket(&node, parsed, output).await?;

    eprintln!(
        "received \"{}\" ({}) via {:?} route in {} ms ({} Mbps effective)",
        outcome.label,
        format_bytes(outcome.size),
        outcome.route_kind,
        outcome.download_ms,
        effective_mbps(outcome.size, outcome.download_ms),
    );
    println!("{}", outcome.output_path.display());
    node.shutdown().await
}

async fn start_node(data_dir: &std::path::Path) -> Result<LightningP2PNode> {
    let download_dir = data_dir.join("downloads");
    eprintln!("starting iroh node (data dir: {})...", data_dir.display());
    LightningP2PNode::start_with_dirs(data_dir.to_path_buf(), download_dir).await
}

/// Renders the ticket as a scannable QR block on stderr.
fn print_qr(ticket: &str) {
    match QrCode::new(ticket.as_bytes()) {
        Ok(code) => {
            let rendered = code.render::<Dense1x2>().quiet_zone(true).build();
            eprintln!("{rendered}");
        }
        Err(error) => eprintln!("could not render QR code: {error}"),
    }
}

fn format_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    #[allow(clippy::cast_precision_loss)]
    let value = bytes as f64;
    if value >= GB {
        format!("{:.2} GB", value / GB)
    } else if value >= MB {
        format!("{:.1} MB", value / MB)
    } else if value >= KB {
        format!("{:.1} KB", value / KB)
    } else {
        format!("{bytes} B")
    }
}

fn effective_mbps(bytes: u64, duration_ms: u64) -> u64 {
    if duration_ms == 0 {
        return 0;
    }
    let mbps = u128::from(bytes).saturating_mul(8) / u128::from(duration_ms) / 1000;
    u64::try_from(mbps).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_format_scales_units() {
        assert_eq!(format_bytes(512), "512 B");
        assert_eq!(format_bytes(2048), "2.0 KB");
        assert_eq!(format_bytes(5 * 1024 * 1024), "5.0 MB");
        assert_eq!(format_bytes(3 * 1024 * 1024 * 1024), "3.00 GB");
    }

    #[test]
    fn mbps_handles_zero_duration() {
        assert_eq!(effective_mbps(1_000_000, 0), 0);
        assert_eq!(effective_mbps(125_000_000, 1_000), 1000);
    }

    #[test]
    fn cli_arguments_parse() {
        use clap::CommandFactory;
        Cli::command().debug_assert();
    }
}
