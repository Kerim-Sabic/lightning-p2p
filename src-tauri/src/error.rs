//! Centralized error types for `Lightning P2P`.

use thiserror::Error;

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

/// Converts `LightningP2PError` into a string for Tauri command results.
impl From<LightningP2PError> for String {
    fn from(err: LightningP2PError) -> Self {
        err.to_string()
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
}
