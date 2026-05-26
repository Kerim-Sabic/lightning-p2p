# Lightning P2P — Roadmap v0.5.1 → v0.7

Captures every mission-specified feature and audit-identified gap that v0.5.1
("the elegant brook", AUDIT.md) **does not** ship. Each entry: what it is, why
it's deferred, prerequisites, security implications, target release.

No release-date commitments are made here — release ordering is sketched, but
each item still needs a planning conversation before scheduling.

## v0.5.1 deferrals (audit gaps that didn't make this point release)

### Explicit resume UI for failed transfers
- **What**: A "Resume failed transfer" list in History or a banner on Send/
  Receive, driven by a status-aware history schema and one-click resume.
- **Why deferred**: Implicit resume via iroh-blobs' persistent store is already
  in production (re-paste the ticket → only missing chunks are re-fetched). The
  v0.5.1 commit `88295e0` surfaces this with a UI tip on the failure card.
  Explicit UI requires migrating `storage::history::TransferRecord` to a
  status enum (`in_progress` / `failed` / `completed`) plus persisting the
  ticket — non-trivial schema and Tauri-command surface.
- **Prereqs**: `TransferRecord` schema migration; `list_resumable_transfers` +
  `resume_transfer(record_id)` Tauri commands; HistoryView UI section.
- **Security**: Persisted tickets are capability tokens. Treat the new
  `ticket` column with the same care as the keychain entry: redact in
  diagnostics, never log, gate UI display.
- **Target**: v0.6.

### LAN/WAN validation for mode-throughput delta
- **What**: Bench evidence that Standard / Fast / Extreme / LAN Beast actually
  differ in throughput when the link has non-zero RTT and finite bandwidth.
- **Why deferred**: AUDIT.md §2.1.1 (Phase 5 mode sweep) shows all 5 modes
  cluster within ~13% on same-machine loopback — within within-mode 5-run
  variance. The QUIC window deltas can't be exercised without a real network.
- **Prereqs**: Two physical machines on a 1/2.5/10 GbE LAN, optional WAN
  link with measurable BDP. New harness mode in `benchmark-local` that talks
  to a remote endpoint rather than two in-process nodes.
- **Security**: None new (transport encryption already covered by iroh QUIC).
- **Target**: v0.6 or v0.7 depending on hardware availability.

### B1 — iroh-blobs internal pipeline tuning
- **What**: Investigate whether iroh-blobs' Reader/Writer task scheduling is
  the throughput ceiling on the 100 MB scenario (current: ~628 Mbps median).
- **Why deferred**: Requires a flamegraph or `samply` capture. Windows ADK /
  WPT is not installed on the audit machine, and AUDIT §2.2 documents this gap.
  Without CPU profiling we cannot know whether iroh-blobs is the lever or
  whether the ceiling is disk / tokio scheduling.
- **Prereqs**: Install Windows Performance Toolkit (multi-GB MS ADK) or run
  benches under WSL2 / a Linux build host where `perf` is available.
- **Security**: None.
- **Target**: v0.6.

### B6 — Small-file packing fast path
- **What**: Sender-side packing of files below a threshold (e.g. 100 KB) into a
  single iroh-blobs entry with a sidecar manifest; receiver unpacks. Backward-
  compatible — receivers without packing support get the original collection.
- **Why deferred**: Audit `same_machine_many_small` scenario shows export
  time = 51% of total wall (200 sequential per-file export syscalls). That's
  the real lever for many-small workloads, but the implementation requires
  packing logic, sidecar format, and careful edge cases (filename uniqueness,
  partial unpack on cancel). Should be gated on a flamegraph confirming the
  syscall cost dominates and is not iroh-blobs internal.
- **Prereqs**: Flamegraph (see B1); sidecar format spec; tests across the
  many-small + 1 GB scenarios.
- **Security**: None new.
- **Target**: v0.6 or v0.7.

### B3 — Progress emit cost benchmark
- **What**: New bench fixture that exercises the Tauri-emit path with a mock
  `Window` so MAX_PROGRESS_INTERVAL sweeps actually move bench numbers.
- **Why deferred**: Current `benchmark-local` uses `receive_ticket` (the
  headless path) which doesn't allocate a `ProgressSampler`. AUDIT §3 B3
  documents this — the gap can't be measured cleanly with the current harness.
- **Prereqs**: A `tauri::Window` mock or a test-only `receive_ticket_with_callback`
  variant on the receiver.
- **Target**: v0.6 with the peak-Mbps + CPU/RAM bench truthfulness work.

### Bench truthfulness: peak Mbps, during-bench CPU/RAM
- **What**: The bench `RunResult` schema currently has avg `effective_mbps`
  but no peak. CPU and RAM during the transfer are also unrecorded.
- **Why deferred**: Peak Mbps needs progress sampling during receive (requires
  the receive-with-callback variant above). CPU/RAM polling needs `sysinfo`
  crate or platform-specific code with sampling thread.
- **Prereqs**: Receive-with-callback API; `sysinfo` dep; sampling thread.
- **Target**: v0.6.

### Android MediaStore overwrite protection
- **What**: Verify and harden conflict handling in `android_bridge::publish_to_mediastore`.
  Desktop-side `next_available_path` already handles file collisions on disk; the
  Android JNI path may silently overwrite if MediaStore reuses display names.
- **Why deferred**: Requires reading the Kotlin/JNI side
  ([`ContentUriResolver.kt`](../src-tauri/gen/android/app/src/main/java/com/lightningp2p/app/ContentUriResolver.kt)
  + the `publish_to_mediastore` function) and ideally testing on a real Android
  device. Not testable from the Windows dev box used for the v0.5.1 audit.
- **Prereqs**: Android device or emulator with MediaStore permissions; JNI
  conflict-handling change if a gap is found.
- **Security**: None new.
- **Target**: v0.6 (gated on Android device availability for the maintainer).

## Mission §5 — feature roadmap (deferred from v0.5.1 by design)

The v0.5.1 mission scope chose "audit + measured wins + speed modes +
reliability hardening". The product surfaces below are deliberately out of
scope and become discrete features in later minor releases.

### Web Receiver (WebTransport / WebRTC)
- **What**: Browser-only receive surface, no install. User opens a fragment-
  URL (`/receive#t=<ticket>`), the browser pulls the blob from the sender via
  WebTransport (preferred) or WebRTC fallback.
- **Why now-able**: Modern browsers support WebTransport over HTTP/3. iroh
  has WASM/web-relay primitives in flight upstream.
- **Prereqs**: iroh-web-receiver upstream support; static page hosting (the
  existing landing-page Netlify deploy can serve it); ticket-fragment routing
  already in place at [`ReceiveHandoffPage.tsx`](../src/components/ReceiveHandoffPage.tsx).
- **Security**: The web origin terminates the encryption — confirm the trust
  model with the threat-model doc before shipping. URL fragments are not
  sent to the server, so the ticket stays out of access logs.
- **Target**: v0.6 (minor bump — significant new surface).

### Multi-device fan-out
- **What**: One sender → N receivers concurrently from a single share ticket.
- **Why deferred**: Each receiver currently runs its own `download_with_opts`;
  fan-out is implicit (each peer pulls independently). What's missing is the
  UI: sender sees how many peers are downloading + per-peer status. Backend
  is mostly there; this is a UX feature.
- **Prereqs**: Sender-side progress event aggregation; UI to display the list.
- **Security**: None new (each receiver still needs the ticket, which is a
  capability token — fan-out doesn't relax that).
- **Target**: v0.6.

### Magic Drop Folder
- **What**: A watched folder on disk; anything dropped into it auto-creates a
  share + posts the ticket to a designated peer or clipboard.
- **Prereqs**: File-system watcher (`notify` crate already in workspace deps
  via tauri); destination-peer selection UI; auto-clipboard write opt-in.
- **Security**: Auto-share is a footgun — files dropped accidentally would
  leave the device. Requires explicit opt-in flow + confirmation modal +
  audit trail in History.
- **Target**: v0.7.

### Universal Clipboard (opt-in)
- **What**: Cross-device clipboard sync between paired Lightning P2P
  installations. Send a clipboard event → receiver inserts to local clipboard.
- **Prereqs**: Pairing model (already discoverable via the nearby ALPN);
  clipboard-API permissions on each platform; opt-in toggle per peer.
- **Security**: Clipboard contents are sensitive (passwords, tokens). Requires
  explicit per-peer opt-in, encrypted per-session keys, and a way to flag
  "do not sync this clipboard event" (system-clipboard tagging).
- **Target**: v0.7.

### Offline Hotspot Mode
- **What**: Two devices with no Internet form a Wi-Fi hotspot (Android) or
  ad-hoc network (desktop) and transfer over it without any external
  infrastructure (no router, no DNS, no relay).
- **Prereqs**: Wi-Fi Direct / Tethering API hookup on Android; ad-hoc network
  setup on Windows (WlanCreateDiscoveryProfile or hosted-network APIs); QR
  bootstrap of network credentials.
- **Security**: Hotspot SSID + key are short-lived and bound to the device
  pairing. Tickets exchanged inside the hotspot are still QUIC-encrypted.
- **Target**: v0.7.

### Smart Auto Mode
- **What**: Auto-pick pairing path, route, speed mode, pack mode, resume
  behavior based on signal: device type, link quality, content size, battery.
- **Prereqs**: All the underlying mechanisms (pairing detection, route
  selection, mode picker, packing) shipped first. This is an orchestration
  layer on top.
- **Security**: None new; uses existing primitives.
- **Target**: v0.7+ (after Magic Folder, Hotspot, and §3 pairing matures).

### Android Share Sheet improvements
- **What**: The current share-target intent already works for received files.
  Improvements: pre-select last-used peer, show recent peers in the share
  sheet UI, support multiple selected files end-to-end.
- **Prereqs**: Tauri-Android intent enrichment; storage of last-used-peer.
- **Target**: v0.6.

### Windows right-click "Send with Lightning P2P"
- **What**: Explorer shell extension that adds a "Send with Lightning P2P"
  context-menu entry on any file/folder. Click → opens the app with the file
  pre-selected.
- **Prereqs**: COM shell-extension DLL or Windows 11 Sparse Package context
  menu; Tauri deep-link wiring to receive the path.
- **Security**: Shell extension runs in Explorer's process. Risky if
  vulnerable to crafted paths; needs a minimal surface area.
- **Target**: v0.6 or v0.7.

### Desktop BLE for macOS / Linux
- **What**: Mirror the Windows WinRT BLE proximity discovery
  ([`proximity/ble.rs`](../src-tauri/src/proximity/ble.rs)) on macOS (Core
  Bluetooth) and Linux (BlueZ).
- **Prereqs**: macOS Core Bluetooth bindings (existing crates: `core-bluetooth-rs`
  or direct objc); Linux BlueZ via `bluer` crate; Tauri permissions surface.
- **Security**: Same model as Windows BLE — beacon-only discovery, no file
  bytes over BLE.
- **Target**: v0.6 (mac) and v0.7 (Linux).

### Android phone-to-phone NFC write
- **What**: NFC tap to push a ticket from one Android device to another. Today
  Android receive works (NDEF intent filter); the write path needs Host Card
  Emulation or Android Beam alternative (Beam was deprecated in API 29+).
- **Prereqs**: HCE service implementation in Kotlin
  ([gen/android/.../app/src/main/java/com/lightningp2p/app/](../src-tauri/gen/android/app/src/main/java/com/lightningp2p/app/)).
- **Security**: NDEF payload is the ticket (a capability token). Same trust
  model as QR — receiver must trust the source.
- **Target**: v0.7.
