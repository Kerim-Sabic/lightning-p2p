//! Receive destination preflight and safe output path helpers.

use crate::error::{LightningP2PError, Result};
use std::path::{Path, PathBuf};

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
/// Returns `LightningP2PError` if the destination cannot be created, is not a
/// directory, or is not writable.
pub(crate) fn preflight_destination(destination: &Path) -> Result<DestinationPreflight> {
    if destination.as_os_str().is_empty() {
        return Err(LightningP2PError::Other(
            "Download folder cannot be empty".into(),
        ));
    }

    std::fs::create_dir_all(destination).map_err(|error| {
        LightningP2PError::Other(format!(
            "Download folder is missing and could not be created: {error}"
        ))
    })?;

    if !destination.is_dir() {
        return Err(LightningP2PError::Other(
            "Download destination must be a folder".into(),
        ));
    }

    write_probe(destination)?;
    Ok(DestinationPreflight {
        exists: destination.exists(),
        writable: true,
        available_bytes: available_disk_space(destination),
    })
}

pub(crate) fn ensure_enough_space(destination: &Path, size: u64) -> Result<()> {
    if size == 0 {
        return Ok(());
    }

    let Some(available_bytes) = available_disk_space(destination) else {
        return Ok(());
    };
    ensure_available_space(size, available_bytes)
}

fn ensure_available_space(size: u64, available_bytes: u64) -> Result<()> {
    let Some(required) = size.checked_add(DISK_SPACE_HEADROOM_BYTES) else {
        return Err(LightningP2PError::Other(
            "Requested transfer size exceeds the supported receive limit.".into(),
        ));
    };
    if available_bytes < required {
        return Err(LightningP2PError::Other(format!(
            "Not enough free disk space in the download folder. Required at least {required} bytes, available {available_bytes} bytes."
        )));
    }
    Ok(())
}

pub(crate) fn safe_collection_label(label: &str) -> String {
    let safe = label
        .trim()
        .chars()
        .map(|character| match character {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            character if character.is_control() => '_',
            other => other,
        })
        .collect::<String>()
        .trim_end_matches(['.', ' '])
        .chars()
        .take(120)
        .collect::<String>();
    if safe.is_empty() {
        "download".into()
    } else if is_windows_reserved_name(&safe) {
        format!("_{safe}")
    } else {
        safe
    }
}

/// Validates an untrusted collection member name and returns a relative path.
/// Both slash styles are treated as separators on every platform so a ticket
/// cannot carry a Windows traversal path that becomes meaningful elsewhere.
///
/// # Errors
///
/// Returns an error for absolute paths, traversal, empty components, Windows
/// device names, control characters, invalid cross-platform characters, or
/// components that exceed common filesystem limits.
pub(crate) fn safe_collection_entry_path(name: &str) -> Result<PathBuf> {
    let normalized = name.replace('\\', "/");
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized.as_bytes().get(1) == Some(&b':')
        || normalized.contains(':')
    {
        return Err(unsafe_collection_path_error());
    }

    let mut relative = PathBuf::new();
    for component in normalized.split('/') {
        if component.is_empty()
            || component == "."
            || component == ".."
            || component.ends_with(['.', ' '])
            || component.chars().any(|character| {
                character.is_control() || matches!(character, '<' | '>' | '"' | '|' | '?' | '*')
            })
            || component.encode_utf16().count() > 255
            || is_windows_reserved_name(component)
        {
            return Err(unsafe_collection_path_error());
        }
        relative.push(component);
    }
    Ok(relative)
}

fn unsafe_collection_path_error() -> LightningP2PError {
    LightningP2PError::Other("The shared folder contains an unsafe file path.".into())
}

fn is_windows_reserved_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or_default();
    let stem = stem.trim_end_matches(['.', ' ']).to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(suffix, "¹" | "²" | "³")
                    || (suffix.len() == 1
                        && suffix
                            .as_bytes()
                            .first()
                            .is_some_and(|digit| (b'1'..=b'9').contains(digit)))
            })
        })
}

pub(crate) fn suffixed_path(base: &Path, index: u64) -> PathBuf {
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
    let probe_path = write_probe_path(destination);
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe_path)
        .map_err(|error| {
            LightningP2PError::Other(format!("Download folder is not writable: {error}"))
        })?;
    drop(file);
    let _ = std::fs::remove_file(probe_path);
    Ok(())
}

fn write_probe_path(destination: &Path) -> PathBuf {
    destination.join(format!(
        ".lightning-p2p-write-test-{}",
        uuid::Uuid::new_v4()
    ))
}

#[cfg(windows)]
fn available_disk_space(path: &Path) -> Option<u64> {
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
            &raw mut available_bytes,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        tracing::warn!(
            error = %std::io::Error::last_os_error(),
            "Could not query free disk space for receive destination"
        );
        return None;
    }
    Some(available_bytes)
}

#[cfg(not(any(windows, unix)))]
fn available_disk_space(_path: &Path) -> Option<u64> {
    None
}

#[cfg(unix)]
fn available_disk_space(path: &Path) -> Option<u64> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let path = CString::new(path.as_os_str().as_bytes()).ok()?;
    // SAFETY: `path` is NUL terminated and `space` points to initialized,
    // writable storage for the duration of the synchronous libc call.
    let mut space = unsafe { std::mem::zeroed::<libc::statvfs>() };
    // SAFETY: both pointers satisfy statvfs' C ABI requirements.
    if unsafe { libc::statvfs(path.as_ptr(), &raw mut space) } != 0 {
        tracing::warn!(
            error = %std::io::Error::last_os_error(),
            "Could not query free disk space for receive destination"
        );
        return None;
    }
    // Keep checked conversions for 32-bit Unix targets; on 64-bit targets libc
    // aliases both counters to u64, so Clippy sees these as identity casts.
    #[allow(clippy::useless_conversion)]
    let available_blocks = u64::try_from(space.f_bavail).ok()?;
    #[allow(clippy::useless_conversion)]
    let block_size = u64::try_from(space.f_frsize).ok()?;
    available_blocks.checked_mul(block_size)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn concurrent_write_probe_names_do_not_collide() {
        let directory = PathBuf::from("downloads");
        let paths = (0..128)
            .map(|_| write_probe_path(&directory))
            .collect::<HashSet<_>>();

        assert_eq!(paths.len(), 128);
    }

    #[test]
    fn collection_label_is_filesystem_safe() {
        assert_eq!(safe_collection_label("bad/name:here"), "bad_name_here");
        assert_eq!(safe_collection_label("   "), "download");
        assert_eq!(safe_collection_label("CON"), "_CON");
        assert_eq!(safe_collection_label("COM¹.txt"), "_COM¹.txt");
        assert_eq!(safe_collection_label("LPT³"), "_LPT³");
        assert_eq!(safe_collection_label("folder. "), "folder");
    }

    #[test]
    fn disk_space_preflight_includes_headroom_and_accepts_exact_boundary() {
        let size = 10_000;
        let required = size + DISK_SPACE_HEADROOM_BYTES;

        assert!(ensure_available_space(size, required - 1).is_err());
        assert!(ensure_available_space(size, required).is_ok());
        assert!(ensure_available_space(u64::MAX, u64::MAX).is_err());
    }

    #[test]
    fn collection_entry_paths_allow_nested_relative_files() {
        assert_eq!(
            safe_collection_entry_path("folder/sub/file.txt").unwrap(),
            PathBuf::from("folder").join("sub").join("file.txt")
        );
    }

    #[test]
    fn collection_entry_paths_reject_traversal_and_cross_platform_special_names() {
        for unsafe_name in [
            "../outside.txt",
            "..\\outside.txt",
            "/rooted.txt",
            "\\\\server\\share.txt",
            "C:\\outside.txt",
            "folder//empty.txt",
            "CON.txt",
            "folder\\LPT1.log",
            "COM¹.txt",
            "folder/LPT².log",
            "COM³",
            "trail. ",
            "bad:name.txt",
        ] {
            assert!(
                safe_collection_entry_path(unsafe_name).is_err(),
                "accepted unsafe path {unsafe_name:?}"
            );
        }
    }
}
