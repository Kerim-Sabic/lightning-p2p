//! Commands for installer-integrated (Velopack) self-updates.

use crate::commands::{command_error, CommandResult};
use crate::installer_update::{self, InstallerUpdateStatus};
use crate::AppState;
use tauri::{AppHandle, State};

async fn run_blocking<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> CommandResult<T> {
    tokio::task::spawn_blocking(job)
        .await
        .map_err(|error| command_error(format!("Update task failed: {error}")))?
        .map_err(command_error)
}

/// Checks the release feed for installs made by the Velopack setup. With
/// automatic updates on, a newer version downloads in the background and is
/// applied by the next restart; other installs report `managed: false`.
///
/// # Errors
///
/// Returns a structured error when the feed or package download fails.
#[tauri::command]
pub async fn check_installer_update(
    state: State<'_, AppState>,
) -> CommandResult<InstallerUpdateStatus> {
    let download = state.settings.snapshot().await.auto_update_enabled;
    run_blocking(move || installer_update::check(download)).await
}

/// Downloads an available update so a restart can apply it.
///
/// # Errors
///
/// Returns a structured error when the feed or package download fails.
#[tauri::command]
pub async fn download_installer_update() -> CommandResult<InstallerUpdateStatus> {
    run_blocking(|| installer_update::check(true)).await
}

/// Applies a downloaded update by restarting the app. Refuses while transfers
/// are running, and flushes local history before exiting so Velopack can swap
/// the install and relaunch it.
///
/// # Errors
///
/// Returns a structured error when transfers are active, no update is
/// staged, or the updater cannot be scheduled.
#[tauri::command]
pub async fn restart_to_apply_update(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    if state.transfers.has_active().await {
        return Err(command_error(
            "Finish or cancel active transfers before restarting to update.",
        ));
    }
    run_blocking(installer_update::apply_after_exit).await?;
    if let Some(node) = state.node.read().await.clone() {
        if let Err(error) = node.db().flush() {
            tracing::warn!(%error, "could not flush local history before updating");
        }
    }
    app.exit(0);
    Ok(())
}
