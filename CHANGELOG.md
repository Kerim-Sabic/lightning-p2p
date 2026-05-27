# Changelog

All notable changes to Lightning P2P are documented here. The project follows semantic versioning where practical.

## [Unreleased]

### Changed

- Default branch continues the `v0.5.x` experimental track for BLE proximity discovery and NFC ticket handoff.

## [0.5.1] - 2026-05-26 ("the elegant brook")

### Added

- **Speed modes**: `TransferMode` (Standard, Fast, Extreme, LAN Beast, Battery Safe) selectable in Settings. Each mode controls QUIC transport tuning (send/recv/stream windows, max streams, keepalive), import parallelism, idle timeout, and UI emit cadence. Setting persists across launches; changing it restarts the node when no transfer is in flight.
- **Retry + exponential backoff** on transient download failures (Unreachable, Interrupted): up to 3 attempts with 1s/2s backoff. Cancel-aware sleeps. iroh-blobs' persistent store means retries fetch only missing bytes.
- **Atomic single-blob exports**: writes through a sibling `.part` file and renames onto the final name on success. Crashes mid-write leave a clearly partial `.part` artifact instead of a half-written file at the user-visible name.
- **Failure-card resume tip**: failed receive transfers now show "Tip: paste the ticket again to resume" — iroh-blobs' persistent store already does implicit resume; the tip surfaces it. Explicit resume UI follows in v0.6.
- **Bench tool v2 schema**: `--mode <m>`, `--hardware-notes <text>`, per-run `bottleneck_estimate` heuristic (first_byte / export / download / balanced), `same_machine_1gb` and `same_machine_many_small` scenarios. Reproducible JSON + CSV under `docs/reports/raw/`.
- **AUDIT.md** at repo root: architecture map, baseline numbers (5-run), bottleneck ranking, reliability gap inventory, mode-comparison evidence, honest status table for every mission item.
- **ROADMAP_v0.5_to_v0.7.md**: per-feature scope for everything deferred from v0.5.1 (explicit resume UI, LAN/WAN bench validation, web receiver, multi-device fan-out, Magic Folder, hotspot, NFC write, macOS/Linux BLE, peak Mbps + CPU/RAM bench polling).

### Fixed

- **Cancel race during verify phase**: previously, cancelling between download-complete and export-start would deliver the file and emit Completed despite user cancellation. Now `receive_core` re-checks the cancel signal before export starts.

### Changed

- `receive_blob` now takes a `ReceiveContext` struct (queue + window + transfer_id + cancel_rx) instead of those four as separate args.
- `ReceiveOutcome` now exposes `first_byte_ms` so external consumers (bench tool) can read it without re-implementing metric extraction.

### Notes

- Mode-comparison bench on `same_machine_100mb` showed all 5 modes cluster within ~13% on loopback (626 – 710 Mbps median; within-mode variance is larger than between-mode). The mode hierarchy encodes design intent (clear resource-shape progression); LAN/WAN throughput-delta validation lands in v0.6 against a real network.
- The parallelism sweep (B4) on `same_machine_many_small` produced **no production code change** — parallelism is not a measurable lever on this hardware; the existing `MAX_IMPORT_PARALLELISM=128` stays.
- B1 (iroh-blobs internal pipeline) and B6 (small-file packing) remain deferred pending a flamegraph capture; samply on Windows needs the WPT/xperf install which is not on the audit machine.
- Hardware-context: AMD Zen 5 (Family 25 Model 97, ~4.5 GHz), Windows 11 Build 26200, NVMe boot volume. See `docs/reports/raw/audit-v0.5.1/`.

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
