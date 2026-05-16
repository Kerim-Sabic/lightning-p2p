# Lightning P2P Roadmap

This roadmap is intentionally conservative. It avoids fake speed, security, or platform claims. Items move from "next" to "shipped" only after they actually work on the platforms they target.

## Shipped

### v0.4.1 — Promotion polish

- Polished README and website.
- Release notes avoid speed-leadership claims and use "no artificial file-size cap".
- Verified installer aliases: `LightningP2P-win-Setup.exe`, `LightningP2PSetup.exe`, `LightningP2P.msi`.
- Verified Authenticode, updater signatures, and `SHA256SUMS.txt` on a clean Windows machine.

### v0.4.4 — Quick polish

- QR rendering uses dark modules on an opaque white background.
- App surfaces the Android signing SHA-256 fingerprint.
- Windows release artifacts labelled "community unsigned" until Authenticode signing is configured.
- Bluetooth proximity discovery stays a planned, default-off capability rather than a shipped feature.

### v0.4.5 — Proof Android pre-release

- iroh node rebuilds through a supervisor when relay or LAN discovery settings change, while deferring restarts during active transfers.
- Transfer-scoped diagnostics, node-supervisor status, BLE status, and clear history/cache controls.
- Benchmark and physical Android acceptance scripts.
- BLE stays experimental and off by default; all file data flows over iroh QUIC / iroh-blobs.
- Signed Android release APK passes the CI emulator launch smoke gate.

### v0.4.6 — Android polish

- **Send bug fix:** Android file picker `content://` URIs are now resolved into app cache through a JNI bridge before iroh-blobs sees them, eliminating the `io error: no such file or directory` failure.
- **Smart save routing:** received files auto-route into the user's `MediaStore` collections — images → Pictures, video → Movies, audio → Music, other files → Downloads. Each lands in a `Lightning P2P` subfolder.
- **System share target:** Lightning P2P appears in Android's share sheet for `image/*`, `video/*`, `audio/*`, `application/*`, and `*/*`. Tapping it from Gallery / Files / browser opens the app with the file pre-selected and the receive ticket auto-created.
- **Mobile UX polish:** larger touch targets, mobile-hero CTAs, friendly empty states, smart-routing info panels in Settings and FirstRun.
- **minSdk** bumped 24 → 29 to use scoped storage cleanly without `WRITE_EXTERNAL_STORAGE`.

## Next

### v0.5.0 — Proximity Discovery (BLE)

- Wire the Android BLE scanner/advertiser into the existing `register_ble_candidate` registry path.
- Add Windows BLE watcher/publisher support where laptop hardware supports it.
- Use BLE only as a discovery beacon; identity handoff and all file transfer remain on iroh QUIC / iroh-blobs.
- Validate Windows-to-Android discovery and tap-device-card transfer on real hardware before publishing claims.
- Document the supported hardware matrix and call out the runtime permissions clearly.

### v0.5.1 — Tap to transfer (NFC)

- NDEF push of the iroh node id + ticket payload so two phones placed back-to-back can immediately seed a transfer.
- Wi-Fi Direct fallback discussion for environments where NFC is unavailable; Android Beam is deprecated so we cannot rely on it.
- Honest note that iOS interop will require a manual handshake fallback until iOS support catches up.
- All file data still flows over iroh QUIC / iroh-blobs; NFC carries only the ticket.

### v0.5.2+ — Quality and breadth

- Light theme + theme switcher.
- Accessibility audit: screen-reader labels, focus order, color contrast.
- iOS share-sheet integration once Tauri iOS maturity allows it.
- Multi-file queue UX with per-file progress.
- Real-world speed leaderboard with documented benchmark methodology — network conditions, payload sizes, peer geography. No leaderboard published until the methodology is real.
- Folder-transfer smart routing (per-file MediaStore publish for collection receives, not just single-file blobs).
- Pause / resume transfer UX.
- Richer transfer-timeline visualization for direct vs relay paths.

## Reliability

- Expand endpoint-restart supervisor tests around active-transfer restart deferral.
- Improve nearby-discovery diagnostics in Settings.
- Move flaky LAN/multicast smoke tests to ignored/manual test suites.
- Add deterministic nearby registry/protocol tests.
- Add IPC contract tests for command/event payloads.
- Add cancellation through receive export.

## Platform expansion

- macOS packaging spike.
- Linux packaging spike.
- iOS feasibility after multicast entitlement and file-picker strategy are clear.

## Growth

- Real updated demo capture after the next polished build.
- Fill benchmark reports before making speed claims.
- Keep README first-screen short and proof-oriented.
- Publish honest comparison pages and docs.
- Encourage good-first-issues around packaging, diagnostics, tests, and accessibility.
