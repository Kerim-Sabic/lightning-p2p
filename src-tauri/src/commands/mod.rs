//! Tauri IPC command handlers.
//!
//! Each sub-module exposes `#[tauri::command]` functions that the
//! frontend calls via `invoke()`. Every command returns `Result<T, String>`.

pub mod peer;
pub mod settings;
pub mod share;
pub mod transfer;
