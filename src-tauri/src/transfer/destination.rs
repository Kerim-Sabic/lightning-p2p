//! Receive destination preflight and safe output path helpers.

use crate::error::{FastDropError, Result};
use iroh_blobs::Hash;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const DISK_SPACE_HEADROOM_BYTES: u64 = 64 * 1024 * 1024;

/// Destination folder preflight result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DestinationPreflight {
    /// Whether the destination folder exists after preflight.
    pub exists: bool,
    /// Whether a write probe succeeded.
    pub writable: bool,
    /// Available bytes on Windows when the OS reports it.
    pub available_bytes: Option<u64>,
}

/// Validates and prepares a receive destination folder.
///
/// # Errors
///
/// Returns `FastDropError` if the destination cannot be created, is not a
/// directory, or is not writable.
pub(crate) fn preflight_destination(destination: &Path) -> Result<DestinationPreflight> {
    if destination.as_os_str().is_empty() {
        return Err(FastDropError::Other(
            "Download folder cannot be empty".into(),
        ));
    }

    std::fs::create_dir_all(destination).map_err(|error| {
        FastDropError::Other(format!(
            "Download folder is missing and could not be created: {error}"
        ))
    })?;

    if !destination.is_dir() {
        return Err(FastDropError::Other(
            "Download destination must be a folder".into(),
        ));
    }

    write_probe(destination)?;
    Ok(DestinationPreflight {
        exists: destination.exists(),
        writable: true,
        available_bytes: available_disk_space(destination)?,
    })
}

pub(crate) fn ensure_enough_space(destination: &Path, size: u64) -> Result<()> {
    if size == 0 {
        return Ok(());
    }

    let Some(available_bytes) = available_disk_space(destination)? else {
        return Ok(());
    };
    let required = size.saturating_add(DISK_SPACE_HEADROOM_BYTES);
    if available_bytes < required {
        return Err(FastDropError::Other(format!(
            "Not enough free disk space in the download folder. Required at least {required} bytes, available {available_bytes} bytes."
        )));
    }
    Ok(())
}

pub(crate) fn next_available_path(base: &Path) -> PathBuf {
    if !base.exists() {
        return base.to_path_buf();
    }

    for index in 1..=999 {
        let candidate = suffixed_path(base, index);
        if !candidate.exists() {
            return candidate;
        }
    }

    suffixed_path(base, unix_timestamp())
}

pub(crate) fn safe_collection_label(label: &str) -> String {
    let safe = label
        .trim()
        .chars()
        .map(|character| match character {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect::<String>();
    if safe.is_empty() {
        "download".into()
    } else {
        safe
    }
}

pub(crate) fn staging_dir_name(hash: Hash) -> String {
    format!(".lightning-p2p-export-{hash}-{}", unix_timestamp())
}

fn suffixed_path(base: &Path, index: u64) -> PathBuf {
    let parent = base.parent().map_or_else(PathBuf::new, Path::to_path_buf);
    let file_name = base
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "download".into());
    let extension = base
        .extension()
        .map(|ext| ext.to_string_lossy().into_owned());
    let stem = base
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .filter(|stem| !stem.is_empty())
        .unwrap_or(file_name);
    let next_name = extension.map_or_else(
        || format!("{stem} ({index})"),
        |extension| format!("{stem} ({index}).{extension}"),
    );
    parent.join(next_name)
}

fn write_probe(destination: &Path) -> Result<()> {
    let probe_path = destination.join(format!(".lightning-p2p-write-test-{}", unix_timestamp()));
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe_path)
        .map_err(|error| {
            FastDropError::Other(format!("Download folder is not writable: {error}"))
        })?;
    drop(file);
    let _ = std::fs::remove_file(probe_path);
    Ok(())
}

#[cfg(windows)]
fn available_disk_space(path: &Path) -> Result<Option<u64>> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let wide_path = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut available_bytes = 0_u64;
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide_path.as_ptr(),
            &mut available_bytes,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(Some(available_bytes))
}

#[cfg(not(windows))]
fn available_disk_space(_path: &Path) -> Result<Option<u64>> {
    Ok(None)
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn next_available_path_adds_suffix_before_extension() {
        let dir = tempfile::tempdir().expect("tempdir");
        let base = dir.path().join("payload.bin");
        std::fs::write(&base, b"existing").expect("write existing");
        let next = next_available_path(&base);
        assert_eq!(
            next.file_name().and_then(|name| name.to_str()),
            Some("payload (1).bin")
        );
    }

    #[test]
    fn collection_label_is_filesystem_safe() {
        assert_eq!(safe_collection_label("bad/name:here"), "bad_name_here");
        assert_eq!(safe_collection_label("   "), "download");
    }
}
