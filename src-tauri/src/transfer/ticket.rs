//! Lightning P2P ticket compatibility and v2 ticket encoding.

use crate::error::{LightningP2PError, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use iroh::NodeAddr;
use iroh_blobs::ticket::BlobTicket;
use iroh_blobs::BlobFormat;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

const FD2_PREFIX: &str = "fd2:";
const FEATURE_LEGACY_BLOB_TICKET: &str = "legacy_blob_ticket";
const FEATURE_MULTI_PROVIDER: &str = "multi_provider";
const FEATURE_QUEUED_DOWNLOADER: &str = "queued_downloader";

/// Serializable provider entry inside a Lightning P2P v2 ticket.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LightningP2PProviderV2 {
    /// Provider ticket containing the node address for this hash.
    pub ticket: String,
    /// Provider node identifier for display and debugging.
    pub node_id: String,
    /// Number of direct socket addresses embedded in the provider ticket.
    pub direct_address_count: usize,
    /// Whether the provider ticket has a relay URL.
    pub relay: bool,
}

/// Versioned Lightning P2P ticket payload.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LightningP2PTicketV2 {
    /// Ticket schema version.
    pub version: u8,
    /// Root content hash.
    pub hash: String,
    /// Blob format for the root hash.
    pub format: String,
    /// Provider tickets for the same hash.
    pub providers: Vec<LightningP2PProviderV2>,
    /// User-visible label.
    pub label: String,
    /// Expected user payload size in bytes.
    pub size: u64,
    /// Supported transfer features advertised by this ticket.
    pub features: Vec<String>,
}

/// Parsed ticket accepted by receive flows.
#[derive(Debug, Clone)]
pub struct ShareTicket {
    primary: BlobTicket,
    providers: Vec<BlobTicket>,
    label: Option<String>,
    size: Option<u64>,
    features: Vec<String>,
}

/// Provider composition summary used by transfer metrics.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ProviderTopology {
    /// Number of provider tickets.
    pub provider_count: u64,
    /// Providers with direct addresses.
    pub direct_provider_count: u64,
    /// Providers with relay URLs.
    pub relay_provider_count: u64,
}

impl ShareTicket {
    /// Parses a legacy `blob...` or Lightning P2P `fd2:` ticket.
    ///
    /// # Errors
    ///
    /// Returns `LightningP2PError::InvalidTicket` if the ticket cannot be decoded.
    pub fn parse(input: &str) -> Result<Self> {
        let value = input.trim();
        if let Some(payload) = value.strip_prefix(FD2_PREFIX) {
            return Self::parse_fd2(payload);
        }
        Self::parse_legacy(value)
    }

    /// Wraps a legacy blob ticket in the share-ticket abstraction.
    #[must_use]
    pub fn from_blob_ticket(ticket: BlobTicket) -> Self {
        Self {
            primary: ticket.clone(),
            providers: vec![ticket],
            label: None,
            size: None,
            features: vec![FEATURE_LEGACY_BLOB_TICKET.into()],
        }
    }

    /// Returns the primary blob ticket.
    #[must_use]
    pub fn primary(&self) -> &BlobTicket {
        &self.primary
    }

    /// Returns all provider node addresses, preserving ticket order.
    #[must_use]
    pub fn provider_node_addrs(&self) -> Vec<NodeAddr> {
        self.providers
            .iter()
            .map(|ticket| ticket.node_addr().clone())
            .collect()
    }

    /// Returns provider topology metrics.
    #[must_use]
    pub fn topology(&self) -> ProviderTopology {
        let mut topology = ProviderTopology {
            provider_count: self.providers.len() as u64,
            ..ProviderTopology::default()
        };
        for provider in &self.providers {
            let addr = provider.node_addr();
            if !addr.direct_addresses.is_empty() {
                topology.direct_provider_count += 1;
            }
            if addr.relay_url().is_some() {
                topology.relay_provider_count += 1;
            }
        }
        topology
    }

    /// Returns the advertised label, if present.
    #[must_use]
    pub fn label(&self) -> Option<&str> {
        self.label.as_deref()
    }

    /// Returns the advertised size, if present.
    #[must_use]
    pub fn size(&self) -> Option<u64> {
        self.size
    }

    /// Returns advertised feature flags.
    #[must_use]
    pub fn features(&self) -> &[String] {
        &self.features
    }

    fn parse_legacy(value: &str) -> Result<Self> {
        let ticket = parse_blob_ticket(value)?;
        Ok(Self {
            primary: ticket.clone(),
            providers: vec![ticket],
            label: None,
            size: None,
            features: vec![FEATURE_LEGACY_BLOB_TICKET.into()],
        })
    }

    fn parse_fd2(payload: &str) -> Result<Self> {
        let bytes = URL_SAFE_NO_PAD
            .decode(payload)
            .map_err(|error| LightningP2PError::InvalidTicket(error.to_string()))?;
        let decoded: LightningP2PTicketV2 = serde_json::from_slice(&bytes)?;
        if decoded.version != 2 {
            return Err(LightningP2PError::InvalidTicket(format!(
                "Unsupported Lightning P2P ticket version {}",
                decoded.version
            )));
        }

        let mut providers = decoded
            .providers
            .iter()
            .map(|provider| parse_blob_ticket(&provider.ticket))
            .collect::<Result<Vec<_>>>()?;
        if providers.is_empty() {
            return Err(LightningP2PError::InvalidTicket(
                "Lightning P2P ticket has no providers".into(),
            ));
        }
        validate_provider_consistency(&decoded, &providers)?;
        let primary = providers.remove(0);
        let mut ordered = vec![primary.clone()];
        ordered.extend(providers);
        Ok(Self {
            primary,
            providers: ordered,
            label: Some(decoded.label),
            size: Some(decoded.size),
            features: decoded.features,
        })
    }
}

/// Encodes a Lightning P2P v2 ticket for a prepared share.
///
/// # Errors
///
/// Returns `LightningP2PError` if the JSON payload cannot be serialized.
pub fn encode_fd2_ticket(ticket: &BlobTicket, label: &str, size: u64) -> Result<String> {
    encode_fd2_ticket_with_providers(ticket, [ticket.clone()], label, size)
}

/// Encodes a Lightning P2P v2 ticket with explicit providers for the same hash.
///
/// # Errors
///
/// Returns `LightningP2PError` if provider metadata is inconsistent or serialization fails.
pub fn encode_fd2_ticket_with_providers(
    primary: &BlobTicket,
    providers: impl IntoIterator<Item = BlobTicket>,
    label: &str,
    size: u64,
) -> Result<String> {
    let providers = providers.into_iter().collect::<Vec<_>>();
    if providers.is_empty() {
        return Err(LightningP2PError::InvalidTicket(
            "Cannot encode a ticket without providers".into(),
        ));
    }
    validate_all_match(primary, &providers)?;
    let payload = LightningP2PTicketV2 {
        version: 2,
        hash: primary.hash().to_string(),
        format: format_to_wire(primary.format()).into(),
        providers: providers.iter().map(provider_payload).collect(),
        label: label.to_string(),
        size,
        features: vec![
            FEATURE_LEGACY_BLOB_TICKET.into(),
            FEATURE_MULTI_PROVIDER.into(),
            FEATURE_QUEUED_DOWNLOADER.into(),
        ],
    };
    let json = serde_json::to_vec(&payload)?;
    Ok(format!("{FD2_PREFIX}{}", URL_SAFE_NO_PAD.encode(json)))
}

fn validate_all_match(primary: &BlobTicket, providers: &[BlobTicket]) -> Result<()> {
    for provider in providers {
        if provider.hash() != primary.hash() || provider.format() != primary.format() {
            return Err(LightningP2PError::InvalidTicket(
                "All providers must reference the same hash and format".into(),
            ));
        }
    }
    Ok(())
}

fn validate_provider_consistency(
    decoded: &LightningP2PTicketV2,
    providers: &[BlobTicket],
) -> Result<()> {
    for provider in providers {
        if provider.hash().to_string() != decoded.hash
            || format_to_wire(provider.format()) != decoded.format
        {
            return Err(LightningP2PError::InvalidTicket(
                "Lightning P2P provider does not match ticket hash or format".into(),
            ));
        }
    }
    Ok(())
}

fn provider_payload(ticket: &BlobTicket) -> LightningP2PProviderV2 {
    let addr = ticket.node_addr();
    LightningP2PProviderV2 {
        ticket: ticket.to_string(),
        node_id: addr.node_id.to_string(),
        direct_address_count: addr.direct_addresses.len(),
        relay: addr.relay_url().is_some(),
    }
}

fn parse_blob_ticket(ticket: &str) -> Result<BlobTicket> {
    BlobTicket::from_str(ticket)
        .map_err(|error| LightningP2PError::InvalidTicket(error.to_string()))
}

fn format_to_wire(format: BlobFormat) -> &'static str {
    match format {
        BlobFormat::Raw => "raw",
        BlobFormat::HashSeq => "hash_seq",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use iroh::{NodeAddr, PublicKey};
    use iroh_blobs::Hash;

    fn sample_ticket() -> BlobTicket {
        let node_id =
            PublicKey::from_str("ae58ff8833241ac82d6ff7611046ed67b5072d142c588d0063e942d9a75502b6")
                .expect("public key should parse");
        BlobTicket::new(
            NodeAddr::new(node_id),
            Hash::new(b"hello"),
            BlobFormat::HashSeq,
        )
        .expect("ticket should build")
    }

    #[test]
    fn legacy_ticket_still_parses() {
        let ticket = sample_ticket();
        let parsed = ShareTicket::parse(&ticket.to_string()).expect("legacy parses");
        assert_eq!(parsed.primary().hash(), ticket.hash());
        assert_eq!(parsed.topology().provider_count, 1);
    }

    #[test]
    fn fd2_ticket_round_trips() {
        let ticket = sample_ticket();
        let encoded = encode_fd2_ticket(&ticket, "demo.bin", 42).expect("fd2 encodes");
        assert!(encoded.starts_with("fd2:"));
        let parsed = ShareTicket::parse(&encoded).expect("fd2 parses");
        assert_eq!(parsed.primary().hash(), ticket.hash());
        assert_eq!(parsed.label(), Some("demo.bin"));
        assert_eq!(parsed.size(), Some(42));
        assert!(parsed
            .features()
            .iter()
            .any(|feature| feature == FEATURE_MULTI_PROVIDER));
    }
}
