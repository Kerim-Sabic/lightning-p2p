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
use iroh_blobs::BlobFormat;
use serde::{Deserialize, Serialize};
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

/// Wire form of a provider entry, mirroring the app's `LightningP2PProviderV2`
/// field-for-field so app/CLI receivers accept browser-made tickets.
#[derive(Debug, Serialize)]
struct ProviderV2Out {
    ticket: String,
    node_id: String,
    direct_address_count: usize,
    relay: bool,
}

/// Wire form of the envelope, mirroring the app's `LightningP2PTicketV2`.
#[derive(Debug, Serialize)]
struct TicketV2Out {
    version: u8,
    hash: String,
    format: &'static str,
    providers: Vec<ProviderV2Out>,
    label: String,
    size: u64,
    features: Vec<&'static str>,
}

/// Encodes a browser share as the app's `fd2:` envelope (schema v2). The
/// feature list matches what the desktop sender advertises so receivers make
/// the same capability decisions either way.
#[must_use]
pub fn fd2_encode(ticket: &BlobTicket, label: &str, size: u64) -> String {
    let addr = ticket.addr();
    let payload = TicketV2Out {
        version: 2,
        hash: ticket.hash().to_string(),
        format: match ticket.format() {
            BlobFormat::Raw => "raw",
            BlobFormat::HashSeq => "hash_seq",
        },
        providers: vec![ProviderV2Out {
            ticket: ticket.to_string(),
            node_id: addr.id.to_string(),
            direct_address_count: addr.addrs.iter().filter(|a| a.is_ip()).count(),
            relay: addr.addrs.iter().any(iroh::TransportAddr::is_relay),
        }],
        label: label.to_owned(),
        size,
        features: vec!["legacy_blob_ticket", "multi_provider", "queued_downloader"],
    };
    let json = serde_json::to_vec(&payload).unwrap_or_default();
    format!("{FD2_PREFIX}{}", URL_SAFE_NO_PAD.encode(json))
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
    use iroh::{EndpointAddr, RelayUrl, SecretKey, TransportAddr};
    use iroh_blobs::{BlobFormat, Hash};

    /// Builds an `fd2:` envelope with the *exact* field set the desktop/CLI app
    /// emits (version, hash, format, providers[{ticket,node_id,
    /// direct_address_count,relay}], label, size, features) so this test fails
    /// if the decoder ever stops tolerating the app's real schema.
    fn app_style_ticket(label: &str, size: u64) -> (String, Hash) {
        let node_id = SecretKey::from_bytes(&[7_u8; 32]).public();
        let relay: RelayUrl = "https://relay.example.com".parse().expect("relay url");
        let addr = EndpointAddr::from_parts(node_id, [TransportAddr::Relay(relay)]);
        let hash = Hash::new(b"lightning-p2p-payload");
        let blob = BlobTicket::new(addr, hash, BlobFormat::HashSeq);
        let json = format!(
            r#"{{"version":2,"hash":"{hash}","format":"hash_seq","providers":[{{"ticket":"{blob}","node_id":"{node_id}","direct_address_count":0,"relay":true}}],"label":{label},"size":{size},"features":["swarm","fd2"]}}"#,
            label = serde_json::to_string(label).unwrap(),
        );
        let envelope = format!("fd2:{}", URL_SAFE_NO_PAD.encode(json.as_bytes()));
        (envelope, hash)
    }

    #[test]
    fn parses_app_emitted_envelope() {
        let (envelope, hash) = app_style_ticket("photos.zip", 1_048_576);
        let parsed = parse(&envelope).expect("app ticket should parse");
        assert_eq!(parsed.label, "photos.zip");
        assert_eq!(parsed.size, 1_048_576);
        assert_eq!(parsed.providers.len(), 1);
        assert_eq!(parsed.primary().hash(), hash);
        assert_eq!(parsed.primary().format(), BlobFormat::HashSeq);
    }

    #[test]
    fn parses_app_envelope_from_receive_url_fragment() {
        let (envelope, hash) = app_style_ticket("clip.mov", 42);
        let url = format!("https://lightning-p2p.netlify.app/receive#t={envelope}&x=1");
        let parsed = parse(&url).expect("receive-url ticket should parse");
        assert_eq!(parsed.primary().hash(), hash);
        assert_eq!(parsed.label, "clip.mov");
    }

    #[test]
    fn browser_encoded_ticket_round_trips_through_the_decoder() {
        let node_id = SecretKey::from_bytes(&[5_u8; 32]).public();
        let relay: RelayUrl = "https://relay.example.com".parse().expect("relay url");
        let addr = EndpointAddr::from_parts(node_id, [TransportAddr::Relay(relay)]);
        let hash = Hash::new(b"browser-share");
        let blob = BlobTicket::new(addr, hash, BlobFormat::HashSeq);

        let envelope = fd2_encode(&blob, "photos.zip", 9001);
        let parsed = parse(&envelope).expect("browser envelope should parse");

        assert_eq!(parsed.label, "photos.zip");
        assert_eq!(parsed.size, 9001);
        assert_eq!(parsed.primary().hash(), hash);
        assert_eq!(parsed.primary().format(), BlobFormat::HashSeq);
    }

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
