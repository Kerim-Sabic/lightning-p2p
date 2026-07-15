//! Parses the Lightning P2P `fd2:` ticket envelope.
//!
//! The envelope is `fd2:` + URL-safe-no-pad base64 of a JSON document whose
//! `providers[].ticket` fields carry iroh `BlobTicket` strings. The desktop
//! and CLI apps produce these; the browser receiver consumes them. The label
//! and size are surfaced to the UI before any bytes are fetched so an oversize
//! transfer can be refused up front.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use iroh_blobs::ticket::BlobTicket;
use serde::Deserialize;
use std::str::FromStr;

const FD2_PREFIX: &str = "fd2:";

#[derive(Debug, Deserialize)]
struct ProviderV2 {
    ticket: String,
}

#[derive(Debug, Deserialize)]
struct TicketV2 {
    version: u8,
    providers: Vec<ProviderV2>,
    #[serde(default)]
    label: String,
    #[serde(default)]
    size: u64,
}

/// A parsed ticket: the metadata to display plus the provider `BlobTicket`s
/// the downloader can dial.
#[derive(Debug, Clone)]
pub struct ParsedTicket {
    pub label: String,
    pub size: u64,
    pub providers: Vec<BlobTicket>,
}

impl ParsedTicket {
    /// The first provider, used as the primary dial target.
    pub fn primary(&self) -> &BlobTicket {
        &self.providers[0]
    }
}

/// Parses an `fd2:` envelope (with or without a surrounding receive URL).
///
/// # Errors
///
/// Returns a message when the envelope, base64, JSON, version, or any inner
/// `BlobTicket` string is invalid, or when no providers are present. A 1.0
/// receiver cannot parse a 0.35-era ticket string, so that surfaces here as a
/// clear "sender is on an older version" style error to the caller.
pub fn parse(input: &str) -> Result<ParsedTicket, String> {
    let payload = extract_fd2_payload(input).ok_or("not a Lightning P2P fd2 ticket")?;
    let bytes = URL_SAFE_NO_PAD
        .decode(payload.as_bytes())
        .map_err(|e| format!("ticket base64 invalid: {e}"))?;
    let decoded: TicketV2 =
        serde_json::from_slice(&bytes).map_err(|e| format!("ticket JSON invalid: {e}"))?;
    if decoded.version != 2 {
        return Err(format!("unsupported ticket version {}", decoded.version));
    }
    let providers = decoded
        .providers
        .iter()
        .map(|p| {
            BlobTicket::from_str(&p.ticket).map_err(|e| {
                format!("this ticket is from an incompatible Lightning P2P version ({e})")
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    if providers.is_empty() {
        return Err("ticket carries no providers".to_owned());
    }
    Ok(ParsedTicket {
        label: decoded.label,
        size: decoded.size,
        providers,
    })
}

/// Pulls the `fd2:...` token out of a raw ticket or a receive URL fragment.
fn extract_fd2_payload(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if let Some(rest) = trimmed.strip_prefix(FD2_PREFIX) {
        return Some(rest.split_whitespace().next().unwrap_or(rest).to_owned());
    }
    // Receive links carry the ticket in the fragment: .../receive#t=fd2:...
    if let Some(idx) = trimmed.find(FD2_PREFIX) {
        let tail = &trimmed[idx + FD2_PREFIX.len()..];
        let end = tail
            .find(|c: char| c == '&' || c.is_whitespace())
            .unwrap_or(tail.len());
        return Some(tail[..end].to_owned());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_fd2() {
        assert!(parse("hello world").is_err());
        assert!(parse("blobabc123").is_err());
    }

    #[test]
    fn extracts_payload_from_url_fragment() {
        let got = extract_fd2_payload("https://x.app/receive#t=fd2:ABC&z=1");
        assert_eq!(got.as_deref(), Some("ABC"));
    }

    #[test]
    fn extracts_bare_payload() {
        assert_eq!(extract_fd2_payload("fd2:ZZZ").as_deref(), Some("ZZZ"));
    }
}
