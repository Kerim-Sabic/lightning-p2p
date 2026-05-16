//! File-type to MediaStore bucket mapping for Android receive routing.
//!
//! Android 10+ scoped storage exposes four idiomatic public collections:
//! `MediaStore.Images` (Pictures/), `MediaStore.Video` (Movies/),
//! `MediaStore.Audio` (Music/), and `MediaStore.Downloads` (Downloads/).
//! This module decides which collection a received file lands in so that
//! Gallery and music apps surface the file in the right place automatically.
//!
//! Detection prefers `mime_guess`'s extension table. A small explicit
//! override table covers edge cases where the extension's official MIME
//! does not match how Android tooling treats the file in practice.

use std::path::Path;

/// Public bucket a received file should land in on Android.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MediaBucket {
    Pictures,
    Movies,
    Music,
    Downloads,
}

impl MediaBucket {
    /// String identifier matching `android.os.Environment.DIRECTORY_*` constants.
    /// Consumed by the Kotlin side to pick the matching `MediaStore` collection.
    #[must_use]
    pub fn as_kotlin_id(self) -> &'static str {
        match self {
            Self::Pictures => "Pictures",
            Self::Movies => "Movies",
            Self::Music => "Music",
            Self::Downloads => "Downloads",
        }
    }
}

/// Decide the bucket for a filename.
///
/// `image/*` → Pictures, `video/*` → Movies, `audio/*` → Music, anything
/// else (including unknown extensions) → Downloads.
#[must_use]
pub fn bucket_for(filename: &str) -> MediaBucket {
    let lower = filename.to_ascii_lowercase();
    let ext = Path::new(&lower)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    if let Some(forced) = forced_bucket(ext) {
        return forced;
    }

    let mime = mime_guess::from_path(&lower).first_or_octet_stream();
    match mime.type_().as_str() {
        "image" => MediaBucket::Pictures,
        "video" => MediaBucket::Movies,
        "audio" => MediaBucket::Music,
        _ => MediaBucket::Downloads,
    }
}

/// Extension overrides for cases where `mime_guess` does not match Android
/// gallery/player behaviour:
/// * Modern photo formats (`.heic`, `.heif`, `.avif`, `.dng`) often resolve
///   to `application/octet-stream` even though Gallery treats them as photos.
/// * `.svg` resolves to `image/svg+xml`, but the system Gallery generally
///   refuses to display SVGs — routing to Downloads keeps them findable.
fn forced_bucket(ext: &str) -> Option<MediaBucket> {
    match ext {
        "heic" | "heif" | "avif" | "dng" => Some(MediaBucket::Pictures),
        "svg" => Some(MediaBucket::Downloads),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn images_route_to_pictures() {
        assert_eq!(bucket_for("photo.jpg"), MediaBucket::Pictures);
        assert_eq!(bucket_for("photo.jpeg"), MediaBucket::Pictures);
        assert_eq!(bucket_for("photo.PNG"), MediaBucket::Pictures);
        assert_eq!(bucket_for("animation.gif"), MediaBucket::Pictures);
        assert_eq!(bucket_for("photo.webp"), MediaBucket::Pictures);
    }

    #[test]
    fn modern_photo_formats_route_to_pictures_via_override() {
        assert_eq!(bucket_for("vacation.heic"), MediaBucket::Pictures);
        assert_eq!(bucket_for("vacation.HEIF"), MediaBucket::Pictures);
        assert_eq!(bucket_for("art.avif"), MediaBucket::Pictures);
        assert_eq!(bucket_for("camera.dng"), MediaBucket::Pictures);
    }

    #[test]
    fn svg_routes_to_downloads_not_pictures() {
        // SVG is technically `image/svg+xml`, but the system Gallery does
        // not display it; users find them via the Files app.
        assert_eq!(bucket_for("vector.svg"), MediaBucket::Downloads);
    }

    #[test]
    fn videos_route_to_movies() {
        assert_eq!(bucket_for("clip.mp4"), MediaBucket::Movies);
        assert_eq!(bucket_for("clip.mov"), MediaBucket::Movies);
        assert_eq!(bucket_for("clip.mkv"), MediaBucket::Movies);
        assert_eq!(bucket_for("clip.webm"), MediaBucket::Movies);
    }

    #[test]
    fn audio_routes_to_music() {
        assert_eq!(bucket_for("song.mp3"), MediaBucket::Music);
        assert_eq!(bucket_for("song.flac"), MediaBucket::Music);
        assert_eq!(bucket_for("song.m4a"), MediaBucket::Music);
        assert_eq!(bucket_for("song.ogg"), MediaBucket::Music);
        assert_eq!(bucket_for("song.wav"), MediaBucket::Music);
    }

    #[test]
    fn documents_and_archives_route_to_downloads() {
        assert_eq!(bucket_for("report.pdf"), MediaBucket::Downloads);
        assert_eq!(bucket_for("archive.zip"), MediaBucket::Downloads);
        assert_eq!(bucket_for("notes.txt"), MediaBucket::Downloads);
        assert_eq!(bucket_for("presentation.pptx"), MediaBucket::Downloads);
    }

    #[test]
    fn unknown_or_extensionless_files_route_to_downloads() {
        assert_eq!(bucket_for("mystery.xyz"), MediaBucket::Downloads);
        assert_eq!(bucket_for("README"), MediaBucket::Downloads);
        assert_eq!(bucket_for(""), MediaBucket::Downloads);
    }

    #[test]
    fn kotlin_id_matches_environment_directory_constants() {
        assert_eq!(MediaBucket::Pictures.as_kotlin_id(), "Pictures");
        assert_eq!(MediaBucket::Movies.as_kotlin_id(), "Movies");
        assert_eq!(MediaBucket::Music.as_kotlin_id(), "Music");
        assert_eq!(MediaBucket::Downloads.as_kotlin_id(), "Downloads");
    }
}
