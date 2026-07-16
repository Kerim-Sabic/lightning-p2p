# Changelog

All notable changes to Lightning P2P are documented here. The project follows semantic versioning where practical.

## [Unreleased]

### Fixed

- **Stale-cached engine no longer crashes the send page**: the wasm engine (`/webrx/web_receiver.js` + `.wasm`) lives at stable URLs cached for an hour, so right after a deploy that changes the engine's API, returning visitors ran the new page against the old module — `this.inner.begin_file is not a function`. Engine URLs now carry a content-hash query (`?v=<hash>`, generated into `src/lib/webrxVersion.ts` by `scripts/build-web-receiver.sh`), so any engine change busts caches immediately; and the TS bridge feature-detects every post-v1 engine API, falling back gracefully (buffered import, plain save, no QR) instead of throwing. Verified with a stale-engine simulation E2E that serves the old engine to the new frontend.

- **Browser receive buttons no longer swallowed by the app auto-launch**: the `/receive` page fired a `lightning-p2p://` deep link 700ms after load, and the browser's external-protocol prompt then ate every click on "Receive in this browser" / "Receive here" — the receive flow looked dead (reproduced live with a headless-browser E2E; a share published fine but could not be received through the UI). The page now auto-launches the app only when browser receive is unavailable, cancels on first interaction, and the panel buttons work.
- **"Stop sharing" on `/send` now actually stops serving**: dropping the wasm `Sharer` left iroh's router accept-task running with its own endpoint + store clones, so a "stopped" share kept answering downloads. `Sharer::shutdown` (router shutdown + endpoint close) is now wired through `WebSender.shutdown()` and verified end-to-end: after stop, a fresh receiver can no longer fetch.
- The browser sender is now explicitly owned by the page for the life of the share (previously it was a dangling local kept alive only by a leaked task), is stopped on navigation, and the tab warns before closing while a share is live.

### Added

- **QR code on browser send**: publishing a share from `/send` now renders the receive link as a QR code — same `qrcode`-crate SVG styling as the desktop app, rendered by the wasm engine — so a phone can scan and receive without typing anything. A Web Share button appears on platforms with a native share sheet.
- **Anti tab-sleep guard while sharing**: a live `/send` tab holds a Web Lock and marks its title, so Chromium (Edge sleeping tabs, Chrome memory saver) doesn't silently put the serving tab to sleep — previously the most likely way a "sent" share died in the background.
- `scripts/e2e-browser-send.mjs`: headless-browser E2E (playwright-core + installed Edge/Chrome) proving share → QR → receive → stop across real tabs against the production bundle.

### Changed

- **Streaming imports and saves in the browser**: `/send` now streams files into the engine chunk-by-chunk with backpressure (`add_stream`) instead of buffering the whole file twice, and Chromium saves stream out of the store in 8 MB slices via the save picker (`read_blob_range`). Peak memory per file drops from ~2–3× its size to ~1×, so large shares actually fit inside the browser's ~2 GB gate; the stated limits are unchanged pending real large-file measurements. Prewarming the endpoint while files are picked makes publish near-instant.

## [0.8.0] - 2026-07-15 ("everywhere")

### Added

- **macOS build** (universal DMG, macOS 10.15+, Intel + Apple Silicon): native traffic-light title bar via overlay chrome, all transfer features. Unsigned community build; right-click → Open or `xattr -cr` on first launch.
- **Linux build** (AppImage, deb, rpm; built on Ubuntu 22.04 for broad glibc compatibility): keys in the Secret Service keyring with an app-data fallback for headless boxes.
- **`lightning-p2p-cli`**: `send <paths...>` prints the receive ticket to stdout (everything else on stderr, so piping stays clean) and stays online until Ctrl+C; `receive <ticket> -o <dir>` pulls BLAKE3-verified bytes. `--qr` renders a terminal QR for the Android scanner. Tickets are byte-identical to app tickets — the CLI reuses the exact GUI engine paths and keeps its own node profile so it never contends with a running GUI. Shipped as standalone tarballs for Windows/macOS/Linux.
- Per-platform bundle configs (`tauri.windows/macos/linux.conf.json`); release CI now publishes macOS and Linux assets with per-platform SHA256SUMS files.
- Signed Android APK returns with this release, carrying the startup-crash fix below.

### Fixed

- **Android startup crash**: tao 0.35 stopped initializing `ndk-context`, so the first Rust JNI bridge call (the deferred staging-cache sweep) hit an assert and aborted the app under `panic = "abort"`. `MainActivity` now installs a typed, process-wide JavaVM and application Context via `initRustAndroidContext`; bridge helpers create valid local references and fail soft until bootstrap completes. CI launches the release-shaped APK on an emulator and requires a positive end-to-end JNI marker.
- Android download links no longer 404: community (unsigned) releases skip the Android build, so `/releases/latest` had no APK. Links are pinned to the newest APK-bearing release (v0.5.1) until the signed Android pipeline returns in v0.8.0.
- Latent device-name bug exposed by clippy: manufacturer-prefixed Android model names ("Samsung SM-G991U") were never produced because both branches returned the bare model.

### Changed

- README now leads with the animated product demo; the whole Android-only code path is clippy-pedantic clean for the first time (18 findings fixed — CI's Linux clippy never compiles `cfg(target_os = "android")` code, so these had accumulated silently).

## [0.7.0] - 2026-07-02 ("the warp drive")

> v0.6.0 was tagged but never published (release CI failed on a docs lint);
> its content ships here.

### Added

- **Swarm receive on by default for the performance tiers**: Extreme, LAN Beast, and Warp now run the parallel swarm path automatically, with per-mode fan-out width (Extreme 8, LAN Beast 12, Warp 16 concurrent connections; Standard 4 and Battery Safe 2 when forced on via Settings). The Settings toggle still forces it for every mode, and automatic fallback to the sequential path is unchanged.
- **Redesigned app icon**: the installed app, Start Menu, taskbar, Windows Store logos, and Android launcher now carry a clean speed-lab tile — dark lab surface, signal-green bolt, amber packet trail — rendered reproducibly by `scripts/render-app-icon.ps1` + `tauri icon`.

- **BBR congestion control** for Fast, Extreme, LAN Beast, and Warp modes. quinn's default loss-based CUBIC collapses throughput on lossy Wi-Fi and high-bandwidth-delay paths; upstream iroh measured CUBIC up to ~30× slower than BBR on the same LAN path (n0-computer/iroh#4286). Standard and Battery Safe keep CUBIC so default behavior is unchanged.
- **Warp mode**: new flagship transfer mode — BBR with an 8 MB initial congestion window, jumbo-frame MTU probing, 2 GB connection windows, 512 MB stream windows, and 8192 streams.
- **Swarm receive (experimental)**: folder transfers fetch their files concurrently over parallel direct connections instead of iroh-blobs' sequential single-stream walk. Every byte stays BLAKE3-verified in the same store; any non-cancel failure falls back to the standard sequential path automatically, so enabling it is never worse than the default. `LIGHTNING_P2P_SWARM_PARALLELISM` overrides the fan-out (max 16).
- **Per-mode initial congestion window**: Fast 256 KB, Extreme 1 MB, LAN Beast 4 MB, Warp 8 MB. Skips most of slow-start, which dominates total time for short transfers.
- **Jumbo-frame MTU discovery** on Extreme, LAN Beast, and Warp (ceiling 8952 bytes = 9000-byte jumbo minus IPv6/UDP headers). quinn binary-searches the path MTU; black-hole detection recovers safely on networks that cannot carry large datagrams.
- **Ticket pre-warming**: the receive screen pre-dials the sender as soon as a valid ticket lands in the input field, so discovery, NAT holepunching, and the QUIC handshake complete while the user is still looking at the Receive button. Cuts time-to-first-byte on the actual transfer.
- **Custom installer artwork**: NSIS and MSI installers now carry the speed-lab brand (dark lab surfaces, signal-green traces, packet squares), rendered reproducibly by `scripts/render-installer-art.ps1`.
- Transfer-mode picker shows each mode's congestion engine (CUBIC/BBR) inline; transfer cards label swarm transfers with a "Swarm" strategy chip.
- Landing page: true 3D depth on the hero instrument (preserve-3d planes + idle float), refreshed mode table with Warp.

### Changed

- Upgraded to iroh 0.35 / iroh-blobs 0.35, jni 0.22 (new `Env` API), keyring 4, TypeScript 6, Vite 8, ESLint 10.
- Android: new `TransferForegroundService` JNI bridge keeps transfers alive with a foreground service while the app is backgrounded.

### Notes

- The BBR switch is evidence-based from upstream measurements; the repo's own LAN/WAN throughput validation for these changes is still owed and tracked for v0.6.x. Loopback benchmarks cannot show the delta (CPU-bound, not congestion-bound).

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
