//! Size-bounded JSON persistence helpers for startup-critical local stores.

use serde::{de::DeserializeOwned, Serialize};
use std::{fs::File, io::Read, path::Path};

pub(crate) fn read_bytes(path: &Path, max_bytes: usize) -> Result<Vec<u8>, String> {
    read_bytes_if_exists(path, max_bytes)?.ok_or_else(|| "JSON store does not exist".into())
}

pub(crate) fn read_bytes_if_exists(
    path: &Path,
    max_bytes: usize,
) -> Result<Option<Vec<u8>>, String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if file
        .metadata()
        .map_err(|error| error.to_string())?
        .len()
        > max_bytes as u64
    {
        return Err(format!("JSON store exceeds {max_bytes} byte limit"));
    }
    let mut bytes = Vec::with_capacity(max_bytes.min(64 * 1024));
    file.take(max_bytes as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > max_bytes {
        return Err(format!("JSON store exceeds {max_bytes} byte limit"));
    }
    Ok(Some(bytes))
}

pub(crate) fn read<T: DeserializeOwned>(path: &Path, max_bytes: usize) -> Result<T, String> {
    serde_json::from_slice(&read_bytes(path, max_bytes)?).map_err(|error| error.to_string())
}

pub(crate) fn write<T: Serialize>(path: &Path, value: &T, max_bytes: usize) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    if bytes.len() > max_bytes {
        return Err(format!("JSON store exceeds {max_bytes} byte limit"));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    std::fs::rename(temporary, path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn oversized_json_is_rejected_without_modifying_source() {
        let directory = tempdir().expect("temporary directory");
        let path = directory.path().join("store.json");
        let original = vec![b' '; 1025];
        std::fs::write(&path, &original).expect("write fixture");

        assert!(read::<Vec<String>>(&path, 1024).is_err());
        assert_eq!(std::fs::read(path).expect("read source"), original);
    }

    #[test]
    fn bounded_json_round_trips() {
        let directory = tempdir().expect("temporary directory");
        let path = directory.path().join("nested/store.json");
        let value = vec!["mesh".to_string()];

        write(&path, &value, 1024).expect("write bounded JSON");

        assert_eq!(read::<Vec<String>>(&path, 1024).expect("read bounded JSON"), value);
    }
}
