# Changelog

All notable changes to Lightning P2P are documented here. The project follows semantic versioning where practical.

## [Unreleased]

### Changed

- Default branch continues the `v0.5.x` experimental track for BLE proximity discovery and NFC ticket handoff.
- Public README, website metadata, and LLM context now point stable users to `v0.4.6`.
- Project license changed to Apache-2.0 with `NOTICE` and `CITATION.cff`.

## [0.5.0] - 2026-05-22

### Added

- Experimental Bluetooth LE proximity discovery.
- Experimental NFC tap-to-transfer ticket handoff.
- Refreshed app icon assets.

### Notes

- `v0.5.0` is a pre-release. BLE and NFC carry discovery or ticket material only; file bytes still transfer through iroh QUIC and iroh-blobs.

## [0.4.6] - 2026-05-22

### Added

- Android `content://` resolver for system file picker and share-sheet files.
- Android `MediaStore` save routing for received images, videos, audio, and other files.
- Android system share-target integration for Gallery, Files, browser, and other apps.
- Mobile UX polish for larger touch targets, empty states, and smart-routing copy.

### Changed

- Android `minSdk` moved to 29 (Android 10+) to support scoped storage cleanly.
- Stable public Android downloads now point at the latest stable GitHub Release.

### Fixed

- Android sends no longer fail because iroh-blobs received an unreadable `content://` URI.
- Android target compile issue fixed before the `v0.4.6` tag cutoff.

## [0.4.5] - 2026-05-16

### Added

- Android reliability pre-release with signed APK/AAB artifacts.
- Node supervisor diagnostics, transfer diagnostics, benchmark scripts, and physical Android acceptance script.

### Fixed

- Android startup/freeze reliability issues found during early sideload testing.
- Settings restart clippy warning.

## [0.4.4] - 2026-05-14

### Added

- Public Android APK launch smoke in CI.
- Android signing fingerprint surfaced in docs.
- Windows package smoke and release artifact verification.

### Fixed

- Android startup diagnostics and release APK launch path.
- QR rendering contrast for mobile receive handoff.

## [0.4.3] - 2026-05-14

### Changed

- Community unsigned release packaging and installer trust wording.

## [0.4.2] - 2026-05-13

### Added

- Signed Android sideload support.
- Android release certificate fingerprint documentation.
- Helper script for Android signing secrets.

## [0.4.1] - 2026-05-13

### Added

- Android foundation.
- Browser receive handoff route at `/receive#t=<ticket>`.
- Launch website and SEO/AEO route metadata.
- Download trust, privacy, store readiness, and release checklist docs.

### Changed

- Public docs and metadata moved from FastDrop-era naming to Lightning P2P naming.
- Velopack became the recommended Windows installer path.

## [0.4.0] - 2026-04-20

### Added

- Settings diagnostics copy flow.
- Transfer event metadata for phases, route kind, and receive output paths.
- Benchmark report template.
- Stable release aliases for Windows installer assets.

### Fixed

- Receive destination preflight.
- Safe output suffixing for completed receives.
- User-facing receive failure categories.

## [0.3.2] - 2026-04-19

### Added

- Website logo and updated icon assets.
- Velopack installer path.
- `llms.txt`, `llms-full.txt`, and SEO-targeted comparison pages.
- Per-page structured data and sitemap metadata.

## [0.3.1] - 2026-04

### Added

- Custom NSIS installer artwork.
- Browser landing page.
- `lightning-p2p://receive?t=<ticket>` deep-link handler.
- Clipboard auto-detect chip on Receive.

### Fixed

- Windows LAN discovery firewall and mDNS diagnostic behavior.

## [0.3.0] - 2026-03

Initial 0.3 line. See Git history for prior releases.
