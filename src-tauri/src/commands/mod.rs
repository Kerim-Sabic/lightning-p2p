//! Tauri IPC command handlers.
//!
//! Each sub-module exposes `#[tauri::command]` functions that the
//! frontend calls via `invoke()`. Migrated commands return structured
//! [`CommandResult`] errors while legacy commands still return strings.

use crate::error::AppErrorPayload;

/// Tauri command result used by structured-error migrations.
pub type CommandResult<T> = std::result::Result<T, Box<AppErrorPayload>>;

/// Boxes a structured command error so command `Result` values stay small.
pub fn command_error(error: impl Into<AppErrorPayload>) -> Box<AppErrorPayload> {
    Box::new(error.into())
}

pub mod diagnostics;
pub mod mobile;
#[cfg(target_os = "android")]
pub mod mobile_context;
pub mod nearby;
pub mod peer;
pub mod platform;
pub mod settings;
pub mod share;
pub mod transfer;
