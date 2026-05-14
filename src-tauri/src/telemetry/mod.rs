//! Structured logging and local diagnostics setup.

use std::io::{self, Write};
use std::path::{Path, PathBuf};
use tracing_subscriber::{fmt::MakeWriter, EnvFilter};

const APP_IDENTIFIER: &str = "com.lightningp2p.app";
const DIAGNOSTICS_DIR_NAME: &str = "diagnostics";
const RUST_LOG_FILE_NAME: &str = "rust.log";

/// Initializes the `tracing` subscriber with env-filter support and a local log file.
///
/// Set `RUST_LOG=lightning_p2p=debug` for verbose output. Android defaults to
/// info-level app logs so launch failures have useful local context.
pub fn init_tracing() {
    let log_path = diagnostic_log_path();
    install_panic_hook(log_path.clone());

    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_filter()));
    let writer = DiagnosticMakeWriter { path: log_path };
    let init_result = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_thread_ids(false)
        .with_file(false)
        .with_ansi(false)
        .with_writer(writer)
        .try_init();

    if let Err(error) = init_result {
        let message =
            format!("Lightning P2P tracing already initialized or unavailable: {error}\n");
        if let Some(path) = diagnostic_log_path() {
            let _ = append_bytes(&path, message.as_bytes());
        }
        let _ = io::stderr().write_all(message.as_bytes());
    }

    tracing::info!("Lightning P2P tracing initialized");
}

/// Returns the diagnostics directory under the resolved app data directory.
#[must_use]
pub fn diagnostics_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(DIAGNOSTICS_DIR_NAME)
}

/// Returns the Rust diagnostics log path under the resolved app data directory.
#[must_use]
pub fn rust_log_path(data_dir: &Path) -> PathBuf {
    diagnostics_dir(data_dir).join(RUST_LOG_FILE_NAME)
}

fn diagnostic_log_path() -> Option<PathBuf> {
    default_data_dir().map(|data_dir| rust_log_path(&data_dir))
}

fn default_data_dir() -> Option<PathBuf> {
    dirs::data_local_dir()
        .or_else(|| std::env::current_dir().ok())
        .map(|dir| dir.join(APP_IDENTIFIER))
}

#[derive(Clone)]
struct DiagnosticMakeWriter {
    path: Option<PathBuf>,
}

struct DiagnosticLogWriter {
    path: Option<PathBuf>,
}

impl<'a> MakeWriter<'a> for DiagnosticMakeWriter {
    type Writer = DiagnosticLogWriter;

    fn make_writer(&'a self) -> Self::Writer {
        DiagnosticLogWriter {
            path: self.path.clone(),
        }
    }
}

impl Write for DiagnosticLogWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        io::stderr().write_all(buf)?;
        if let Some(path) = &self.path {
            append_bytes(path, buf)?;
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        io::stderr().flush()
    }
}

fn append_bytes(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    file.write_all(bytes)?;
    Ok(())
}

fn install_panic_hook(log_path: Option<PathBuf>) {
    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        let message = format!("Rust panic: {}\n", panic_summary(panic_info));
        if let Some(path) = &log_path {
            let _ = append_bytes(path, message.as_bytes());
        }
        let _ = io::stderr().write_all(message.as_bytes());
        previous_hook(panic_info);
    }));
}

fn panic_summary(panic_info: &std::panic::PanicHookInfo<'_>) -> String {
    let payload = panic_info
        .payload()
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| {
            panic_info
                .payload()
                .downcast_ref::<String>()
                .map(String::as_str)
        })
        .unwrap_or("unknown panic payload");
    let location = panic_info.location().map_or_else(
        || "unknown location".to_string(),
        |location| format!("{}:{}", location.file(), location.line()),
    );
    format!("{payload} at {location}")
}

fn default_filter() -> &'static str {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        "lightning_p2p=info,iroh=warn,iroh_blobs=warn"
    } else {
        "lightning_p2p=info,iroh=warn"
    }
}
