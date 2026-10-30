//! Persistent retention tags for the transfer store.
//!
//! iroh-blobs GC collects every blob that no tag or temp tag reaches. Content
//! that must outlive a restart carries a persistent tag:
//!
//! - `share/<hash>` for every hash a public share link serves, mirroring
//!   `storage::share_access` one to one;
//! - `receive/<transfer-id>` for a receive's root, from before its first
//!   downloaded byte until its export is durably in history or its resume
//!   record is discarded.
//!
//! Everything else — chiefly the store copy of a finished receive — is
//! collected. In-memory protection (live grants, prepared shares, requests
//! being served) lives in [`super::gc_gate`].

use super::LightningP2PNode;
use crate::error::{LightningP2PError, Result};
use crate::storage::db::StorageDb;
use crate::storage::history;
use crate::storage::resumable_receives::ResumableReceiveStore;
use crate::transfer::ticket::ShareTicket;
use futures_util::StreamExt;
use iroh_blobs::api::Store;
use iroh_blobs::{Hash, HashAndFormat};
use std::collections::HashSet;
use std::path::Path;

const SHARE_TAG_PREFIX: &str = "share/";
const RECEIVE_TAG_PREFIX: &str = "receive/";

fn share_tag(hash: Hash) -> String {
    format!("{SHARE_TAG_PREFIX}{hash}")
}

fn receive_tag(transfer_id: &str) -> String {
    format!("{RECEIVE_TAG_PREFIX}{transfer_id}")
}

fn blob_error(error: impl std::fmt::Display) -> LightningP2PError {
    LightningP2PError::Blob(error.to_string())
}

/// Tags every hash a public share serves so its link survives GC and restarts.
pub(crate) async fn retain_public_hashes(store: &Store, hashes: &[Hash]) -> Result<()> {
    for hash in hashes {
        store
            .tags()
            .set(share_tag(*hash), HashAndFormat::raw(*hash))
            .await
            .map_err(blob_error)?;
    }
    Ok(())
}

/// Fails unless every hash is completely present in the store.
pub(crate) async fn ensure_complete(store: &Store, hashes: &[Hash]) -> Result<()> {
    for hash in hashes {
        if !store.blobs().has(*hash).await.map_err(blob_error)? {
            return Err(LightningP2PError::Other(
                "Shared content is no longer available locally".into(),
            ));
        }
    }
    Ok(())
}

impl LightningP2PNode {
    /// Keeps a receive's blobs, partial or complete, until it is released.
    pub(crate) async fn retain_receive(
        &self,
        transfer_id: &str,
        content: HashAndFormat,
    ) -> Result<()> {
        self.blobs_client()
            .tags()
            .set(receive_tag(transfer_id), content)
            .await
            .map_err(blob_error)
    }

    /// Lets GC reclaim a receive's store copy once its export is durable in
    /// history or the receive can no longer be resumed.
    pub(crate) async fn release_receive(&self, transfer_id: &str) {
        if let Err(_error) = self
            .blobs_client()
            .tags()
            .delete(receive_tag(transfer_id))
            .await
        {
            tracing::warn!("could not release receive store retention; startup retries it");
        }
    }
}

/// Brings persistent tags in line with durable app state before GC is armed.
///
/// Best effort: public hashes left untagged stay protected in memory by the
/// GC gate, and a receive whose resume credential is unreadable could not be
/// resumed anyway.
pub(crate) async fn reconcile_at_startup(
    store: &Store,
    db: &StorageDb,
    data_dir: &Path,
    public_hashes: &[Hash],
) {
    match tag_untagged_public_hashes(store, public_hashes).await {
        Ok(0) => {}
        Ok(count) => tracing::info!(count, "tagged existing public share content for store GC"),
        Err(error) => tracing::warn!(%error, "could not tag existing public share content"),
    }
    if let Err(error) = reconcile_receive_tags(store, db, data_dir).await {
        tracing::warn!(%error, "could not reconcile receive store retention");
    }
}

/// Tags public hashes authorized by releases that did not tag them yet.
async fn tag_untagged_public_hashes(store: &Store, public_hashes: &[Hash]) -> Result<usize> {
    let mut tagged = HashSet::new();
    let mut tags = store
        .tags()
        .list_prefix(SHARE_TAG_PREFIX)
        .await
        .map_err(blob_error)?;
    while let Some(tag) = tags.next().await {
        tagged.insert(tag.map_err(blob_error)?.hash);
    }
    let untagged = public_hashes
        .iter()
        .copied()
        .filter(|hash| !tagged.contains(hash))
        .collect::<Vec<_>>();
    retain_public_hashes(store, &untagged).await?;
    Ok(untagged.len())
}

async fn reconcile_receive_tags(store: &Store, db: &StorageDb, data_dir: &Path) -> Result<()> {
    let records_db = db.clone();
    let records_dir = data_dir.to_owned();
    let live =
        tokio::task::spawn_blocking(move || resumable_receive_ids(&records_db, &records_dir))
            .await
            .map_err(|error| LightningP2PError::Other(error.to_string()))??;
    let tagged = drop_stale_receive_tags(store, &live).await?;
    let untagged = live.difference(&tagged).cloned().collect::<Vec<_>>();
    if untagged.is_empty() {
        return Ok(());
    }
    let ticket_dir = data_dir.to_owned();
    let adopted =
        tokio::task::spawn_blocking(move || resume_ticket_contents(&ticket_dir, untagged))
            .await
            .map_err(|error| LightningP2PError::Other(error.to_string()))?;
    for (transfer_id, content) in adopted {
        store
            .tags()
            .set(receive_tag(&transfer_id), content)
            .await
            .map_err(blob_error)?;
    }
    Ok(())
}

/// Receives that can still resume: a recovery record exists and history does
/// not already hold the completed export.
fn resumable_receive_ids(db: &StorageDb, data_dir: &Path) -> Result<HashSet<String>> {
    let mut live = HashSet::new();
    for record in ResumableReceiveStore::load(data_dir)?.list() {
        let transfer_id = record.transfer.transfer_id;
        if history::receive_by_transfer_id(db, &transfer_id)?.is_none() {
            live.insert(transfer_id);
        }
    }
    Ok(live)
}

/// Deletes receive tags with no resumable receive behind them (a crash after
/// the export was recorded, or before a discarded receive was released) and
/// returns the ids whose tags remain.
async fn drop_stale_receive_tags(store: &Store, live: &HashSet<String>) -> Result<HashSet<String>> {
    let mut stale = Vec::new();
    let mut kept = HashSet::new();
    let mut tags = store
        .tags()
        .list_prefix(RECEIVE_TAG_PREFIX)
        .await
        .map_err(blob_error)?;
    while let Some(tag) = tags.next().await {
        let name = tag.map_err(blob_error)?.name;
        let transfer_id = name
            .as_ref()
            .strip_prefix(RECEIVE_TAG_PREFIX.as_bytes())
            .and_then(|id| std::str::from_utf8(id).ok());
        match transfer_id {
            Some(id) if live.contains(id) => {
                kept.insert(id.to_owned());
            }
            _ => stale.push(name),
        }
    }
    for name in stale {
        store.tags().delete(name).await.map_err(blob_error)?;
    }
    Ok(kept)
}

/// Reads the roots of receives recorded by releases that did not tag them.
fn resume_ticket_contents(
    data_dir: &Path,
    transfer_ids: Vec<String>,
) -> Vec<(String, HashAndFormat)> {
    transfer_ids
        .into_iter()
        .filter_map(|transfer_id| {
            let secret = crate::crypto::load_receive_resume_ticket(data_dir, &transfer_id)
                .ok()
                .flatten()?;
            let ticket = ShareTicket::parse(&secret).ok()?;
            Some((transfer_id, ticket.primary().hash_and_format()))
        })
        .collect()
}

#[cfg(test)]
mod tests;
