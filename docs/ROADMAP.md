# Lightning P2P Roadmap

This roadmap is deliberately conservative. Do not publish speed, platform, security, or interop claims until the release and validation evidence exists.

> **v0.5.1 → v0.7 detail**: see [`ROADMAP_v0.5_to_v0.7.md`](ROADMAP_v0.5_to_v0.7.md)
> for the per-feature breakdown of everything the v0.5.1 audit-pass deferred
> (explicit resume UI, LAN/WAN bench validation, web receiver, multi-device
> fan-out, Magic Folder, Universal Clipboard, Offline Hotspot, NFC write,
> desktop BLE for mac/Linux, Android MediaStore overwrite verification, peak
> Mbps + CPU/RAM bench instrumentation, B1/B6 flamegraph-gated perf work).

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
- Android and Windows BLE scan/advertise plumbing is wired, but hardware validation is required.
- BLE only carries discovery beacons.
- NFC receive handling only carries ticket material.
- Physical-device validation is required before these features move into a stable release.

### v0.8.0 - Everywhere release

- macOS (universal DMG) and Linux (AppImage/deb/rpm) community builds, unsigned with documented Gatekeeper steps.
- `lightning-p2p-cli`: send/receive from the terminal; tickets byte-identical to app tickets, stdout stays pipe-clean.
- Signed Android APK returns, carrying the v0.7.x startup-crash fix.
- macOS/Linux hardware validation of transfers is community-assisted until maintainer hardware exists.

### v0.7.0 - Speed engine pre-release

- BBR congestion control on Fast, Extreme, LAN Beast, and the new Warp mode (evidence: upstream iroh measured CUBIC far below BBR on real paths).
- Per-mode initial congestion window and jumbo-frame MTU probing.
- Experimental swarm receive: parallel child-blob fetches for folder transfers, with automatic fallback to the standard path.
- Ticket pre-warming: pre-dial the sender while the ticket is still in the input field.
- LAN/WAN throughput validation for these changes is still owed before any speed-delta claim.

## Next

### v0.5.1 - Stabilize proximity features

- Validate BLE discovery on Windows-to-Android and Android-to-Android hardware.
- Add macOS/Linux BLE backends before claiming cross-desktop BLE support.
- Validate NFC ticket receive on physical Android hardware and add a tested writer/HCE path before claiming phone-to-phone tap.
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
