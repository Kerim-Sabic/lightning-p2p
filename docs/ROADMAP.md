# Lightning P2P Roadmap

This roadmap is deliberately conservative. Do not publish speed, platform, security, or interop claims until the release and validation evidence exists.

## Stable

### v0.4.6 - Current stable release

- Windows public release with Velopack, NSIS, MSI, and checksums.
- Android 10+ sideload release.
- Android `content://` file picker and share-sheet sends work through a JNI resolver.
- Received Android files route into Pictures, Movies, Music, or Downloads through `MediaStore`.
- Lightning P2P appears as an Android system share target.
- File bytes still transfer through iroh QUIC and iroh-blobs, not BLE, NFC, HTTP, or WebRTC.

## Experimental

### v0.5.0 - BLE and NFC pre-release

- Bluetooth LE proximity discovery is experimental.
- NFC tap-to-transfer is experimental.
- BLE only carries discovery beacons.
- NFC only carries ticket material.
- Physical-device validation is required before these features move into a stable release.

## Next

### v0.5.1 - Stabilize proximity features

- Validate BLE discovery on Windows-to-Android and Android-to-Android hardware.
- Validate NFC ticket handoff on two physical Android phones.
- Add clear runtime permission states and diagnostics.
- Keep manual ticket sharing as the reliable fallback.

### v0.5.2 - Quality and breadth

- Accessibility audit: screen-reader labels, focus order, touch target verification, color contrast.
- Multi-file queue UX with per-file progress.
- Folder-transfer smart routing for Android `MediaStore`.
- Pause/resume transfer UX.
- Richer transfer timeline for direct vs relay paths.
- Light theme only after the core transfer UX is stable.

## Platform Expansion

- macOS packaging spike.
- Linux packaging spike.
- iOS feasibility after signing, file picker, multicast entitlement, and Tauri iOS constraints are clear.
- Microsoft Store readiness after publisher identity and signing are settled.
- Winget resubmission after the latest stable release assets are verified.

## Reliability

- Expand node-supervisor tests around active-transfer restart deferral.
- Add deterministic nearby registry/protocol tests.
- Add IPC contract tests for command and event payloads.
- Improve nearby discovery diagnostics in Settings.
- Move flaky LAN/multicast tests into explicit manual test suites.

## Growth

- Keep README first screen proof-oriented and installation-focused.
- Publish real benchmark reports before speed claims.
- Keep comparison pages honest and specific.
- Encourage good-first issues around packaging, diagnostics, accessibility, and benchmark reports.
