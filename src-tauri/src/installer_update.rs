//! Self-updates for installs made by the Velopack setup
//! (`LightningP2P-win-Setup.exe`).
//!
//! Velopack installs keep an `Update.exe` beside the app. Each GitHub release
//! publishes the matching `releases.win.json` feed and full packages, and
//! GitHub serves the newest promoted release under `releases/latest/download`.
//! A downloaded update is applied by the explicit restart command or, at the
//! latest, by `velopack::VelopackApp::run` the next time the app starts, so a
//! running transfer is never interrupted. Other installs (NSIS, MSI, macOS,
//! Linux) report `managed: false` and keep the Tauri updater path.

use serde::Serialize;

/// Prefix under which GitHub serves the latest promoted release's assets.
#[cfg(any(windows, test))]
const RELEASE_FEED_BASE: &str =
    "https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/";

/// State of the installer-integrated updater.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct InstallerUpdateStatus {
    /// Whether this app was installed by the Velopack setup and can update
    /// itself.
    pub managed: bool,
    /// Installed version, when the install is managed.
    pub current_version: Option<String>,
    /// Newer version offered by the release feed, if any.
    pub available_version: Option<String>,
    /// Whether a downloaded update is waiting to be applied by a restart.
    pub ready_to_restart: bool,
}

/// URL of the release feed for a Velopack channel.
#[cfg(any(windows, test))]
fn release_feed_url(channel: &str) -> String {
    format!("{RELEASE_FEED_BASE}releases.{channel}.json")
}

#[cfg(windows)]
mod platform {
    use super::{release_feed_url, InstallerUpdateStatus, RELEASE_FEED_BASE};
    use std::path::Path;
    use std::sync::mpsc::Sender;
    use velopack::bundle::Manifest;
    use velopack::sources::{HttpSource, UpdateSource};
    use velopack::{Error, UpdateCheck, UpdateManager, VelopackAsset, VelopackAssetFeed};

    /// Reads the public release feed. Velopack's `HttpSource` appends the
    /// install's persistent staging id to feed requests; this source sends a
    /// plain request so update checks carry no per-install identifier.
    struct ReleaseFeed;

    impl UpdateSource for ReleaseFeed {
        fn get_release_feed(
            &self,
            channel: &str,
            _app: &Manifest,
            _staged_user_id: &str,
        ) -> Result<VelopackAssetFeed, Error> {
            let json =
                velopack::download::download_url_as_string(&release_feed_url(channel), None)?;
            Ok(serde_json::from_str(&json)?)
        }

        fn download_release_entry(
            &self,
            asset: &VelopackAsset,
            local_file: &Path,
            progress_sender: Option<Sender<i16>>,
        ) -> Result<(), Error> {
            HttpSource::new(RELEASE_FEED_BASE).download_release_entry(
                asset,
                local_file,
                progress_sender,
            )
        }
    }

    /// Returns `None` when this app was not installed by the Velopack setup.
    fn manager() -> Option<UpdateManager> {
        UpdateManager::new(ReleaseFeed, None, None).ok()
    }

    pub(super) fn check(download: bool) -> Result<InstallerUpdateStatus, String> {
        let Some(manager) = manager() else {
            return Ok(InstallerUpdateStatus::default());
        };
        let mut status = InstallerUpdateStatus {
            managed: true,
            current_version: Some(manager.get_current_version_as_string()),
            ..InstallerUpdateStatus::default()
        };
        if let Some(pending) = manager.get_update_pending_restart() {
            status.available_version = Some(pending.Version);
            status.ready_to_restart = true;
            return Ok(status);
        }
        let check = manager
            .check_for_updates()
            .map_err(|error| format!("Could not check for updates: {error}"))?;
        if let UpdateCheck::UpdateAvailable(info) = check {
            status.available_version = Some(info.TargetFullRelease.Version.clone());
            if download {
                manager
                    .download_updates(&info, None)
                    .map_err(|error| format!("Could not download the update: {error}"))?;
                status.ready_to_restart = true;
            }
        }
        Ok(status)
    }

    pub(super) fn apply_after_exit() -> Result<(), String> {
        let manager = manager().ok_or("This install cannot update itself.")?;
        let pending = manager
            .get_update_pending_restart()
            .ok_or("No downloaded update is waiting to be applied.")?;
        manager
            .wait_exit_then_apply_updates(&pending, true, true, Vec::<String>::new())
            .map_err(|error| format!("Could not schedule the update: {error}"))
    }
}

#[cfg(not(windows))]
mod platform {
    use super::InstallerUpdateStatus;

    // Same signature as the Windows implementation, which can fail.
    #[allow(clippy::unnecessary_wraps)]
    pub(super) fn check(_download: bool) -> Result<InstallerUpdateStatus, String> {
        Ok(InstallerUpdateStatus::default())
    }

    pub(super) fn apply_after_exit() -> Result<(), String> {
        Err("This install cannot update itself.".into())
    }
}

/// Checks the release feed and, when `download` is set, stages a newer
/// version for the next restart. Blocking: call it off the async runtime.
///
/// # Errors
///
/// Returns a user-facing message when the feed or package download fails.
pub fn check(download: bool) -> Result<InstallerUpdateStatus, String> {
    platform::check(download)
}

/// Hands a staged update to Velopack, which applies it and relaunches the app
/// once this process exits. Blocking: call it off the async runtime.
///
/// # Errors
///
/// Returns a user-facing message when this install cannot self-update or no
/// update has been downloaded.
pub fn apply_after_exit() -> Result<(), String> {
    platform::apply_after_exit()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feed_url_names_the_channel_without_an_install_identifier() {
        let url = release_feed_url("win");
        assert_eq!(
            url,
            "https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/releases.win.json"
        );
        assert!(!url.contains('?'));
    }

    #[cfg(not(windows))]
    #[test]
    fn non_windows_installs_are_not_managed() {
        assert_eq!(check(true).unwrap(), InstallerUpdateStatus::default());
        assert!(apply_after_exit().is_err());
    }
}
