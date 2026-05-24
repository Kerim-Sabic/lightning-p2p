//! Centralized error types for `Lightning P2P`.

use serde::{Deserialize, Serialize};
use thiserror::Error;

const SCHEMA_VERSION: u16 = 1;

/// Stable error category used by the frontend for recovery UI.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppErrorCategory {
    /// Ticket parsing or ticket capability problems.
    Ticket,
    /// Peer reachability or transport failures.
    Network,
    /// Relay configuration or relay reachability failures.
    Relay,
    /// Nearby discovery failures.
    Discovery,
    /// OS permission failures.
    Permission,
    /// Local storage or destination failures.
    Storage,
    /// Disk capacity failures.
    Disk,
    /// Verification or integrity failures.
    Verification,
    /// Platform bridge or runtime failures.
    Platform,
    /// User-initiated cancellation.
    Cancellation,
    /// Invalid user or app configuration.
    Configuration,
    /// Unclassified failures.
    Unknown,
}

/// Stable machine-readable error code.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppErrorCode {
    /// The receive ticket could not be parsed or used.
    InvalidTicket,
    /// The sender could not be reached.
    SenderOffline,
    /// A connection attempt or transfer stalled.
    ConnectionTimeout,
    /// Relay connectivity is unavailable.
    RelayUnavailable,
    /// The OS denied access to a requested resource.
    PermissionDenied,
    /// The configured destination cannot be used.
    DestinationUnavailable,
    /// The destination volume does not have enough free space.
    DiskFull,
    /// Downloaded bytes failed verification.
    VerificationFailed,
    /// Verified bytes could not be exported.
    ExportFailed,
    /// The user cancelled the transfer.
    TransferCancelled,
    /// Android content URI staging or publishing failed.
    AndroidContentUriFailed,
    /// A receive link could not be understood by the app.
    MalformedReceiveLink,
    /// The native node is not ready yet.
    NodeNotReady,
    /// A nearby share disappeared before receiving started.
    NearbyShareUnavailable,
    /// The custom relay setting is invalid.
    CustomRelayInvalid,
    /// The selected share input is invalid.
    ShareSelectionInvalid,
    /// The failure is not yet classified.
    Unknown,
}

/// User-visible severity for error presentation.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppErrorSeverity {
    /// Informational status.
    Info,
    /// Warning that usually allows retry or another path.
    Warning,
    /// Actionable error.
    Error,
    /// Critical error that likely needs diagnostics or restart.
    Critical,
}

/// Structured error payload returned by migrated Tauri commands.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct AppErrorPayload {
    /// Schema version for this payload.
    pub schema_version: u16,
    /// Stable machine-readable code.
    pub code: AppErrorCode,
    /// Stable high-level category.
    pub category: AppErrorCategory,
    /// UI severity.
    pub severity: AppErrorSeverity,
    /// Short title for user-facing error cards.
    pub title: String,
    /// Plain-language user message.
    pub message: String,
    /// Recovery hint when a useful next step exists.
    pub hint: Option<String>,
    /// Whether retrying the same action can plausibly help.
    pub retryable: bool,
    /// Short privacy-safe diagnostics summary.
    pub redacted_diagnostics: Option<String>,
    /// Optional docs slug for contextual help.
    pub docs_slug: Option<String>,
}

impl AppErrorPayload {
    /// Creates a new structured app error payload.
    #[must_use]
    pub fn new(
        code: AppErrorCode,
        category: AppErrorCategory,
        severity: AppErrorSeverity,
        title: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            code,
            category,
            severity,
            title: title.into(),
            message: message.into(),
            hint: None,
            retryable: false,
            redacted_diagnostics: None,
            docs_slug: None,
        }
    }

    /// Adds a recovery hint.
    #[must_use]
    pub fn with_hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    /// Sets whether the same action can be retried.
    #[must_use]
    pub const fn retryable(mut self, retryable: bool) -> Self {
        self.retryable = retryable;
        self
    }

    /// Adds a short privacy-safe diagnostics summary.
    #[must_use]
    pub fn with_redacted_diagnostics(mut self, diagnostics: impl Into<String>) -> Self {
        self.redacted_diagnostics = Some(diagnostics.into());
        self
    }

    /// Adds an optional help docs slug.
    #[must_use]
    pub fn with_docs_slug(mut self, docs_slug: impl Into<String>) -> Self {
        self.docs_slug = Some(docs_slug.into());
        self
    }

    /// Creates an invalid-ticket payload.
    #[must_use]
    pub fn invalid_ticket() -> Self {
        Self::new(
            AppErrorCode::InvalidTicket,
            AppErrorCategory::Ticket,
            AppErrorSeverity::Error,
            "Invalid receive ticket",
            "This receive link or ticket could not be read.",
        )
        .with_hint("Ask the sender for a fresh link, or scan the QR code again.")
        .with_docs_slug("receive-tickets")
    }

    /// Creates a sender-offline payload.
    #[must_use]
    pub fn sender_offline() -> Self {
        Self::new(
            AppErrorCode::SenderOffline,
            AppErrorCategory::Network,
            AppErrorSeverity::Error,
            "Sender is not reachable",
            "Lightning P2P could not reach the sender for this transfer.",
        )
        .with_hint(
            "Keep both apps open, confirm the sender still has the share active, then retry.",
        )
        .retryable(true)
        .with_docs_slug("sender-online")
    }

    /// Creates a connection-timeout payload.
    #[must_use]
    pub fn connection_timeout() -> Self {
        Self::new(
            AppErrorCode::ConnectionTimeout,
            AppErrorCategory::Network,
            AppErrorSeverity::Error,
            "Connection timed out",
            "The transfer stalled before it could complete.",
        )
        .with_hint(
            "Retry with both devices awake. If it repeats, check firewall, VPN, or relay settings.",
        )
        .retryable(true)
        .with_docs_slug("network-troubleshooting")
    }

    /// Creates a destination-unavailable payload from a user-safe message.
    #[must_use]
    pub fn destination_unavailable(message: impl Into<String>) -> Self {
        Self::new(
            AppErrorCode::DestinationUnavailable,
            AppErrorCategory::Storage,
            AppErrorSeverity::Error,
            "Save location is unavailable",
            message,
        )
        .with_hint("Choose a writable receive folder in Settings, then retry.")
        .retryable(true)
        .with_docs_slug("receive-destination")
    }

    /// Creates a disk-full payload.
    #[must_use]
    pub fn disk_full() -> Self {
        Self::new(
            AppErrorCode::DiskFull,
            AppErrorCategory::Disk,
            AppErrorSeverity::Error,
            "Not enough free space",
            "The receive folder does not have enough free disk space for this transfer.",
        )
        .with_hint("Free space on the destination drive, then retry.")
        .retryable(true)
    }

    /// Creates an export-failed payload.
    #[must_use]
    pub fn export_failed(message: impl Into<String>) -> Self {
        Self::new(
            AppErrorCode::ExportFailed,
            AppErrorCategory::Storage,
            AppErrorSeverity::Error,
            "Could not save verified files",
            message,
        )
        .with_hint("The download was verified, but saving to the destination failed. Check folder access and retry.")
        .retryable(true)
    }

    /// Creates a transfer-cancelled payload.
    #[must_use]
    pub fn transfer_cancelled() -> Self {
        Self::new(
            AppErrorCode::TransferCancelled,
            AppErrorCategory::Cancellation,
            AppErrorSeverity::Info,
            "Transfer cancelled",
            "The transfer was cancelled before it completed.",
        )
        .with_hint("Start the transfer again when both devices are ready.")
        .retryable(true)
    }

    /// Creates an Android content URI payload.
    #[must_use]
    pub fn android_content_uri_failed(message: impl Into<String>) -> Self {
        Self::new(
            AppErrorCode::AndroidContentUriFailed,
            AppErrorCategory::Platform,
            AppErrorSeverity::Error,
            "Android file access failed",
            message,
        )
        .with_hint(
            "Try the system file picker again, or copy the file into local device storage first.",
        )
        .retryable(true)
        .with_docs_slug("android-file-access")
    }

    /// Creates an unknown payload from a user-safe message.
    #[must_use]
    pub fn unknown(message: impl Into<String>) -> Self {
        Self::new(
            AppErrorCode::Unknown,
            AppErrorCategory::Unknown,
            AppErrorSeverity::Error,
            "Something went wrong",
            message,
        )
        .with_hint("Retry the action. If it repeats, copy diagnostics from Settings.")
    }

    /// Builds the best structured payload from an existing user-facing message.
    #[must_use]
    pub fn from_legacy_message(message: impl Into<String>) -> Self {
        let message = message.into();
        let normalized = message.to_ascii_lowercase();
        if let Some(payload) = Self::legacy_ticket_or_startup_payload(&message, &normalized) {
            return payload;
        }
        if let Some(payload) = Self::legacy_network_payload(&message, &normalized) {
            return payload;
        }
        if let Some(payload) = Self::legacy_storage_payload(&message, &normalized) {
            return payload;
        }
        if let Some(payload) = Self::legacy_platform_payload(&message, &normalized) {
            return payload;
        }
        Self::unknown(message)
    }

    fn legacy_ticket_or_startup_payload(message: &str, normalized: &str) -> Option<Self> {
        if normalized.contains("invalid ticket") {
            return Some(Self::invalid_ticket());
        }
        if normalized.contains("node not initialized") {
            return Some(
                Self::new(
                    AppErrorCode::NodeNotReady,
                    AppErrorCategory::Configuration,
                    AppErrorSeverity::Info,
                    "Node is still starting",
                    "Lightning P2P is still bringing the transfer engine online.",
                )
                .with_hint("Wait a moment, then try again.")
                .retryable(true),
            );
        }
        if normalized.contains("nearby share is no longer available") {
            return Some(
                Self::new(
                    AppErrorCode::NearbyShareUnavailable,
                    AppErrorCategory::Discovery,
                    AppErrorSeverity::Warning,
                    "Nearby share expired",
                    message,
                )
                .with_hint("Refresh nearby shares or ask the sender for a receive link.")
                .retryable(true),
            );
        }
        None
    }

    fn legacy_network_payload(message: &str, normalized: &str) -> Option<Self> {
        if normalized.contains("peer not reachable") || normalized.contains("sender offline") {
            return Some(Self::sender_offline());
        }
        if normalized.contains("transfer interrupted") || normalized.contains("timed out") {
            return Some(Self::connection_timeout());
        }
        if normalized.contains("relay") && normalized.contains("invalid") {
            return Some(
                Self::new(
                    AppErrorCode::CustomRelayInvalid,
                    AppErrorCategory::Configuration,
                    AppErrorSeverity::Error,
                    "Relay setting is invalid",
                    message,
                )
                .with_hint("Check the relay URL and save it again.")
                .retryable(true),
            );
        }
        if normalized.contains("no peer route") || normalized.contains("relay unavailable") {
            return Some(
                Self::new(
                    AppErrorCode::RelayUnavailable,
                    AppErrorCategory::Relay,
                    AppErrorSeverity::Warning,
                    "Route is not ready",
                    message,
                )
                .with_hint("Keep the app open while direct addresses and relay fallback warm up.")
                .retryable(true),
            );
        }
        None
    }

    fn legacy_storage_payload(message: &str, normalized: &str) -> Option<Self> {
        if normalized.contains("not enough free disk space") {
            return Some(Self::disk_full());
        }
        if normalized.contains("permission denied") || normalized.contains("access denied") {
            return Some(
                Self::new(
                    AppErrorCode::PermissionDenied,
                    AppErrorCategory::Permission,
                    AppErrorSeverity::Error,
                    "Permission denied",
                    message,
                )
                .with_hint("Grant access in the operating system prompt or choose a different file or folder.")
                .retryable(true),
            );
        }
        if normalized.contains("download folder")
            || normalized.contains("download destination")
            || normalized.contains("not writable")
        {
            return Some(Self::destination_unavailable(message));
        }
        if normalized.contains("no files selected")
            || normalized.contains("empty directory")
            || normalized.contains("duplicate share path")
        {
            return Some(
                Self::new(
                    AppErrorCode::ShareSelectionInvalid,
                    AppErrorCategory::Storage,
                    AppErrorSeverity::Warning,
                    "Share selection needs attention",
                    message,
                )
                .with_hint("Choose a readable file or folder and try again.")
                .retryable(true),
            );
        }
        if normalized.contains("export") {
            return Some(Self::export_failed(message));
        }
        None
    }

    fn legacy_platform_payload(message: &str, normalized: &str) -> Option<Self> {
        if normalized.contains("cancelled") || normalized.contains("canceled") {
            return Some(Self::transfer_cancelled());
        }
        if normalized.contains("content://") || normalized.contains("system picker") {
            return Some(Self::android_content_uri_failed(message));
        }
        if normalized.contains("verification") || normalized.contains("hash mismatch") {
            return Some(
                Self::new(
                    AppErrorCode::VerificationFailed,
                    AppErrorCategory::Verification,
                    AppErrorSeverity::Critical,
                    "Verification failed",
                    "The received data did not pass integrity verification.",
                )
                .with_hint("Do not use the partial output. Ask the sender to send it again."),
            );
        }
        None
    }
}

/// Top-level error type for the `Lightning P2P` application.
#[derive(Debug, Error)]
pub enum LightningP2PError {
    /// iroh endpoint or networking error.
    #[error("Network error: {0}")]
    Network(#[from] anyhow::Error),

    /// Blob store or transfer error.
    #[error("Blob error: {0}")]
    Blob(String),

    /// Local storage (sled) error.
    #[error("Storage error: {0}")]
    Storage(#[from] sled::Error),

    /// Serialization / deserialization error.
    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    /// IO error.
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// Ticket parsing error.
    #[error("Invalid ticket: {0}")]
    InvalidTicket(String),

    /// Key management error.
    #[error("Key error: {0}")]
    Key(String),

    /// Generic application error.
    #[error("{0}")]
    Other(String),
}

impl LightningP2PError {
    /// Converts this error to a structured frontend-safe payload.
    #[must_use]
    pub fn to_payload(&self) -> AppErrorPayload {
        match self {
            Self::InvalidTicket(_) => AppErrorPayload::invalid_ticket(),
            Self::Io(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                AppErrorPayload::from_legacy_message(error.to_string())
            }
            Self::Other(message) | Self::Blob(message) | Self::Key(message) => {
                AppErrorPayload::from_legacy_message(message.clone())
            }
            Self::Network(error) => AppErrorPayload::from_legacy_message(error.to_string()),
            Self::Io(error) => AppErrorPayload::from_legacy_message(error.to_string()),
            Self::Storage(error) => AppErrorPayload::from_legacy_message(error.to_string()),
            Self::Serde(error) => AppErrorPayload::from_legacy_message(error.to_string()),
        }
    }
}

/// Converts `LightningP2PError` into a string for Tauri command results.
impl From<LightningP2PError> for String {
    fn from(err: LightningP2PError) -> Self {
        err.to_string()
    }
}

impl From<LightningP2PError> for AppErrorPayload {
    fn from(err: LightningP2PError) -> Self {
        err.to_payload()
    }
}

impl From<String> for AppErrorPayload {
    fn from(message: String) -> Self {
        Self::from_legacy_message(message)
    }
}

impl From<&str> for AppErrorPayload {
    fn from(message: &str) -> Self {
        Self::from_legacy_message(message)
    }
}

/// Convenience alias used throughout the crate.
pub type Result<T> = std::result::Result<T, LightningP2PError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display() {
        let err = LightningP2PError::Other("test error".into());
        assert_eq!(err.to_string(), "test error");
    }

    #[test]
    fn error_converts_to_string() {
        let err = LightningP2PError::Blob("chunk failed".into());
        let s: String = err.into();
        assert_eq!(s, "Blob error: chunk failed");
    }

    #[test]
    fn error_payload_serializes_with_snake_case() {
        let payload = LightningP2PError::InvalidTicket("bad".into()).to_payload();
        let json = serde_json::to_string(&payload).expect("payload should serialize");
        assert!(json.contains("\"schema_version\":1"));
        assert!(json.contains("\"code\":\"invalid_ticket\""));
        assert!(json.contains("\"category\":\"ticket\""));
        assert!(json.contains("\"severity\":\"error\""));
        assert!(json.contains("\"retryable\":false"));
    }

    #[test]
    fn permission_io_maps_to_permission_error() {
        let error = LightningP2PError::Io(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "access denied",
        ));
        let payload = error.to_payload();
        assert_eq!(payload.code, AppErrorCode::PermissionDenied);
        assert_eq!(payload.category, AppErrorCategory::Permission);
    }

    #[test]
    fn legacy_messages_map_to_stable_codes() {
        assert_eq!(
            AppErrorPayload::from_legacy_message("Peer not reachable").code,
            AppErrorCode::SenderOffline
        );
        assert_eq!(
            AppErrorPayload::from_legacy_message("Not enough free disk space").code,
            AppErrorCode::DiskFull
        );
        assert_eq!(
            AppErrorPayload::from_legacy_message("Cancelled").code,
            AppErrorCode::TransferCancelled
        );
    }

    #[test]
    fn stable_payloads_keep_expected_categories_and_retryability() {
        let cases = [
            (
                AppErrorPayload::invalid_ticket(),
                AppErrorCode::InvalidTicket,
                AppErrorCategory::Ticket,
                AppErrorSeverity::Error,
                false,
            ),
            (
                AppErrorPayload::sender_offline(),
                AppErrorCode::SenderOffline,
                AppErrorCategory::Network,
                AppErrorSeverity::Error,
                true,
            ),
            (
                AppErrorPayload::connection_timeout(),
                AppErrorCode::ConnectionTimeout,
                AppErrorCategory::Network,
                AppErrorSeverity::Error,
                true,
            ),
            (
                AppErrorPayload::disk_full(),
                AppErrorCode::DiskFull,
                AppErrorCategory::Disk,
                AppErrorSeverity::Error,
                true,
            ),
            (
                AppErrorPayload::transfer_cancelled(),
                AppErrorCode::TransferCancelled,
                AppErrorCategory::Cancellation,
                AppErrorSeverity::Info,
                true,
            ),
        ];

        for (payload, code, category, severity, retryable) in cases {
            assert_eq!(payload.schema_version, SCHEMA_VERSION);
            assert_eq!(payload.code, code);
            assert_eq!(payload.category, category);
            assert_eq!(payload.severity, severity);
            assert_eq!(payload.retryable, retryable);
            assert!(payload.message.len() > 8);
        }
    }

    #[test]
    fn legacy_messages_cover_storage_platform_and_integrity_codes() {
        let cases = [
            (
                "custom relay URL is invalid",
                AppErrorCode::CustomRelayInvalid,
                AppErrorCategory::Configuration,
            ),
            (
                "relay unavailable for this peer",
                AppErrorCode::RelayUnavailable,
                AppErrorCategory::Relay,
            ),
            (
                "download destination is not writable",
                AppErrorCode::DestinationUnavailable,
                AppErrorCategory::Storage,
            ),
            (
                "export failed after verification",
                AppErrorCode::ExportFailed,
                AppErrorCategory::Storage,
            ),
            (
                "content:// provider failed from system picker",
                AppErrorCode::AndroidContentUriFailed,
                AppErrorCategory::Platform,
            ),
            (
                "hash mismatch during verification",
                AppErrorCode::VerificationFailed,
                AppErrorCategory::Verification,
            ),
        ];

        for (message, code, category) in cases {
            let payload = AppErrorPayload::from_legacy_message(message);
            assert_eq!(payload.code, code);
            assert_eq!(payload.category, category);
        }
    }
}
