# Lightning P2P — v0.5.1 Audit ("the elegant brook")

**Date**: 2026-05-26
**Branch**: `v0.5.1` (off `main` at `82ccd43`, post-PR-#32 polish merge)
**Auditor**: AI-assisted, with full code-reading + same-machine benchmarking on the development workstation.
**Hardware under test**: AMD Zen 5 (Family 25 Model 97, ~4.5 GHz), Windows 11 Pro Build 26200, NVMe boot volume.

This document is the foundation for the v0.5.1 mission ("fastest, most reliable P2P transfer app for
Windows + Android"). Every number below is either measured on this machine or marked `UNMEASURED`.
No estimate is presented as fact.

Companion artifact: [`docs/reports/raw/audit-v0.5.1/latest.json`](docs/reports/raw/audit-v0.5.1/latest.json)
(5-run × 2-scenario same-machine baseline).

---

## 1. Architecture map

### Crate layout

Single Rust crate at `src-tauri/`, no workspace. Targets desktop (Tauri 2 + Wry) and Android (JNI
via `tauri-android` generated shell at `src-tauri/gen/android/`). iOS targets exist in source but
no CI builds them.

Key deps (`src-tauri/Cargo.toml`): `iroh 0.32`, `iroh-blobs 0.32` (rpc feature), `tokio` full,
`sled 0.34`, `tauri 2.x`, `keyring 3.x`, `criterion 0.5` (dev). No custom networking, no
`quinn`/`zstd`/`io-uring`.

### Module ownership

| Concern | Module | LOC | Hot path |
|---|---|---|---|
| iroh endpoint, transport tuning | [`src-tauri/src/node/endpoint.rs`](src-tauri/src/node/endpoint.rs) | 434 | yes (transport_config) |
| Node lifecycle / restart | [`src-tauri/src/node/supervisor.rs`](src-tauri/src/node/supervisor.rs) | 304 | no |
| LAN/BLE discovery aggregation | [`src-tauri/src/node/nearby.rs`](src-tauri/src/node/nearby.rs) | 1296 | no |
| Nearby ALPN protocol v2 | [`src-tauri/src/node/nearby_protocol.rs`](src-tauri/src/node/nearby_protocol.rs) | 477 | no |
| Sender (import + ticket) | [`src-tauri/src/transfer/sender.rs`](src-tauri/src/transfer/sender.rs) | 455 | **yes** |
| Receiver (download + export) | [`src-tauri/src/transfer/receiver.rs`](src-tauri/src/transfer/receiver.rs) | 655 | **yes** |
| Progress events + sampler | [`src-tauri/src/transfer/progress.rs`](src-tauri/src/transfer/progress.rs) | 935 | yes (10 Hz emit) |
| Transfer queue (in-memory) | [`src-tauri/src/transfer/queue.rs`](src-tauri/src/transfer/queue.rs) | 169 | no |
| Ticket codec (fd2: v2) | [`src-tauri/src/transfer/ticket.rs`](src-tauri/src/transfer/ticket.rs) | 328 | no |
| Destination + free-space | [`src-tauri/src/transfer/destination.rs`](src-tauri/src/transfer/destination.rs) | 204 | no |
| Export (collection/blob) | [`src-tauri/src/transfer/export.rs`](src-tauri/src/transfer/export.rs) | 313 | yes (rename hop) |
| Windows BLE (WinRT) | [`src-tauri/src/proximity/ble.rs`](src-tauri/src/proximity/ble.rs) | ~470 | no |
| Android BLE (Kotlin) | [`src-tauri/gen/android/app/src/main/java/com/lightningp2p/app/LightningBleService.kt`](src-tauri/gen/android/app/src/main/java/com/lightningp2p/app/LightningBleService.kt) | ~437 | no |
| IPC commands | `src-tauri/src/commands/*.rs` | varies | no |

### Transfer pipeline (measured)

**Send**: `commands/share.rs::create_share` → `transfer/sender.rs::send_files` →
`build_share_plan` → `import_sources` (buffered_unordered, parallelism = `min(count, 128)` per
[`sender.rs:287-292`](src-tauri/src/transfer/sender.rs#L287-L292)) → `persist_collection` →
`build_ticket` (BlobFormat::HashSeq). Progress is sampled at 100 ms via
[`progress.rs:14`](src-tauri/src/transfer/progress.rs#L14) (`MAX_PROGRESS_INTERVAL`).

**Receive**: `commands/transfer.rs::start_receive` →
[`transfer/receiver.rs::receive_blob`](src-tauri/src/transfer/receiver.rs#L85-L155) →
`receive_core` →
[`download_to_store`](src-tauri/src/transfer/receiver.rs#L227-L260) (60 s idle timeout,
`DownloadMode::Queued`) → `export::export_ticket` → final move/MediaStore publish.

**UI bridge**: only scalars cross IPC (bytes/speed_bps/phase + string ticket). No binary blobs in
events. Verified by reading `progress.rs::TransferEvent` enum.

---

## 2. Profiling results

### 2.1 Same-machine baseline (5 runs, full profile)

Source: `cargo run --release --bin benchmark-local -- --profile full --runs 5`
Artifacts: `docs/reports/raw/audit-v0.5.1/{latest.json,latest.csv}`

| Scenario | Runs | Median total | Median download | Median export | Median Mbps | Range Mbps |
|---|---|---|---|---|---|---|
| `same_machine_10mb` | 5/5 | 149 ms | 140 ms | 8 ms | **562.74** | 285.9 – 603.3 |
| `same_machine_100mb` | 5/5 | 1335 ms | 1327 ms | 8 ms | **627.99** | 592.1 – 666.8 |

Observations:
- 10 MB shows wider spread because per-transfer overhead (peer establishment, hash table warm-up,
  iroh ALPN handshake) dominates short transfers. Run 3 had `connect_ms=171` vs ~2 ms elsewhere —
  one-off iroh peer-cache cold start.
- 100 MB throughput (628 Mbps) is **lower** than the previously embedded v0.5.0 figure
  (742 Mbps, 3-run median in `src/content/local-benchmark-summary.json`). Two likely causes:
  smaller sample size in the old run, and machine state (Windows update + indexing daemon were
  active during the new run). Both runs are **loopback-only** and **not comparable to LAN/WAN**.
- Export time is essentially constant at ~8 ms for all sizes. Reason: iroh-blobs `ExportMode::TryReference`
  in [`export.rs:171-174`](src-tauri/src/transfer/export.rs#L171-L174) — hardlinks the verified blob
  from the store into the destination, no copy. Export is **not** a bottleneck.
- `time_to_ticket_ms` is ~300 ms in steady state. For 100 MB that is ~19% of the round trip —
  measurable but not dominant.

### 2.2 Flamegraph / CPU profile

**UNMEASURED**. `cargo-flamegraph`, `samply`, and `perf` are not installed on the audit machine,
and Windows perf tools (WPR/WPA) were not used in this pass. A follow-up pass with `samply`
(cross-platform sampling profiler that outputs Firefox-compatible profiles) is the cheapest
next step; this audit deliberately ships without flamegraph data rather than fabricate one.

Hot-path identification in §3 is therefore **hypothesis-driven from code-reading + bench numbers**,
not from CPU sampling. Each fix proposal in Phase 2 will be gated by an actual flamegraph capture
before merge.

### 2.3 Criterion micro-benchmarks

Not re-run for this audit. The existing
[`src-tauri/benches/transfer_bench.rs`](src-tauri/benches/transfer_bench.rs) covers sender prep,
download-phase, export-phase, and end-to-end for 100 MB. Phase 2 will use criterion as the
before/after gate.

---

## 3. Bottleneck ranking (hypothesis, awaiting flamegraph confirmation)

Ranked by **estimated impact on 100 MB loopback throughput**. Each entry: where the cost lives,
why it is suspect, what to try, what to measure.

### B1 — iroh-blobs internal chunking / hashing pipeline depth
- **Where**: Inside `iroh-blobs 0.32` (`BlobStore::add_from_path`, `download_with_opts`). Our code
  does not chunk or hash.
- **Why suspect**: At ~628 Mbps loopback on Zen 5 NVMe, the link is software-bounded. BLAKE3 alone
  on this CPU is well above 5 GB/s — orders of magnitude faster than 78 MB/s (628 Mbps). The
  ceiling is more likely pipeline depth or async context-switch overhead between the
  iroh-blobs store, the QUIC stream, and tokio runtime — not raw hashing or disk.
- **Try**: Capture a flamegraph during the 100 MB scenario. If iroh-blobs's `Reader`/`Writer`
  tasks dominate, the lever is upstream (file a tuning issue / try a newer iroh-blobs minor).
  If tokio scheduling dominates, increase `tokio::runtime::Builder::worker_threads` past the
  default and re-measure.
- **Win estimate**: UNMEASURED (could be 0% or +50%, completely depends on flamegraph).
- **Risk**: Low — tuning, not surgery.

### B2 — Single global QUIC transport config; no per-mode tuning
- **Where**: [`endpoint.rs:317-326`](src-tauri/src/node/endpoint.rs#L317-L326),
  [`tuned_transport_config`](src-tauri/src/node/endpoint.rs#L317).
- **Why suspect**: Current values (256 MB connection window, 64 MB stream window, 1024 streams,
  5 s keepalive) were chosen once and never benchmarked across scenarios. On loopback they may be
  oversized (memory pressure on the receive side), on multi-GbE LAN they may be undersized
  (BDP-limited). One config cannot be optimal for both Standard, LanBeast, and BatterySafe.
- **Try**: Phase 3 introduces `TransferMode` with per-mode `TransportConfig`. Sweep
  send/recv windows ∈ {64 MB, 256 MB, 1 GB} and stream window ∈ {16 MB, 64 MB, 256 MB} on the
  loopback bench; pick the best per scenario.
- **Win estimate**: UNMEASURED. Loopback may not move at all; LAN sweep is where this pays off.
- **Risk**: Medium — wider windows consume memory; need to gate by available RAM.

### B3 — Progress event emission cost at 10 Hz (100 ms interval)
- **Where**: [`progress.rs:14`](src-tauri/src/transfer/progress.rs#L14),
  [`ProgressSampler::spawn`](src-tauri/src/transfer/progress.rs#L144).
- **Why suspect**: Tauri IPC emit serializes to JSON and crosses a thread boundary. At 10 Hz on a
  ~1.3 s transfer that's ~13 emits — likely cheap. But during a long LAN transfer (e.g. 10 GB at
  1 GbE = ~80 s) it's ~800 emits and the WebView render loop competes for the same main thread.
- **Try**: Add a tracing `tracing::Span` around the sampler emit and measure ns. If the per-emit
  cost is < 100 µs, leave at 10 Hz. If higher, drop to 5 Hz for Standard/Fast and reserve 10 Hz
  for the brief "showing UI" window.
- **Win estimate**: UNMEASURED but expected small (< 2% throughput).
- **Risk**: Very low — UI smoothness vs throughput tradeoff is explicit.

### B4 — Import parallelism = `min(count, 128)` without benchmark
- **Where**: [`sender.rs:287-292`](src-tauri/src/transfer/sender.rs#L287-L292),
  `MAX_IMPORT_PARALLELISM=128` constant.
- **Why suspect**: 128 is a guess. For a many-small-file fleet (e.g. 1024 × 64 KB) the bench
  scenario does not exist yet (only 10 MB / 100 MB single-file), but in practice 128 concurrent
  file opens + 128 in-flight BLAKE3 hashes may starve the receiver-side reservation queue.
- **Try**: Add `same_machine_many_small` (200 × 100 KB) and `same_machine_huge` (1 GB) scenarios
  to `benchmark-local`. Sweep `import_parallelism` ∈ {1, 4, 16, 64, 128, 256}.
- **Win estimate**: UNMEASURED. Could be 0 on single-file, meaningful on many-small.
- **Risk**: Low.

### B5 — `time_to_ticket_ms` ≈ 300 ms cold start (mostly iroh peer discovery)
- **Where**: [`endpoint.rs::wait_for_ticket_direct_addresses`](src-tauri/src/node/endpoint.rs#L345-L358)
  + [`wait_for_optional_home_relay`](src-tauri/src/node/endpoint.rs#L360-L373), both with
  `RELAY_WAIT_TIMEOUT=6s`.
- **Why suspect**: On a fully warm node the bench shows ~300 ms before the ticket is built. Some
  of that is iroh's first relay handshake + direct-address probe. Receivers paste a ticket and see
  300 ms of nothing on the sender side.
- **Try**: Phase 2 only if Phase 1 flamegraph confirms iroh blocks here. Otherwise leave alone —
  this is a one-shot cost per share, not per byte.
- **Win estimate**: UNMEASURED. Negligible on big transfers.
- **Risk**: Touches iroh boot path; out-of-scope unless free.

### B6 — No small-file packing fast path
- **Where**: [`sender.rs::import_sources`](src-tauri/src/transfer/sender.rs#L252-L274) — each
  source becomes one iroh-blobs entry + one HashSeq slot.
- **Why suspect**: Mission §2 calls for "pack tiny files into one framed stream". Currently the
  collection wraps them but each is still its own blob. For 1000 × 1 KB files, that's 1000 blob
  imports + 1000 hashes (cheap per file, but lots of tokio scheduling).
- **Try**: Phase 2 (gated by B4 measurement). Add an opt-in "pack" mode that concatenates files
  < N KB into a single blob with a sidecar manifest. Risk-managed by keeping it sender-side only —
  receivers don't need new protocol support if we ship a `pack.json` inside the collection.
- **Win estimate**: UNMEASURED. Probably significant for many-small.
- **Risk**: Medium — new code path; needs extraction logic on the receiver, edge cases for
  filename uniqueness.

### B7 — Magic-byte zstd compression
- **Where**: Sender source list, not implemented.
- **Why suspect**: Mission §2 calls for this. On LAN where link >> CPU, compression is a net
  loss for compressible content too. On WAN/relay where link << CPU, it can be a win.
- **Try**: Defer. The audit bench corpus is xorshift-generated noise (high entropy), so any zstd
  attempt would show as a CPU drag with no compression. Only worth shipping if benched on real
  user content (text/code/json) over a real WAN path.
- **Win estimate**: UNMEASURED.
- **Risk**: Adds CPU + library dep for unclear gain. Defer to v0.6.

### B8 — `cargo build` lock contention during bench
- **Where**: Not user-visible; this is harness noise during the audit.
- **Skip**.

---

## 4. Reliability gap inventory

Each item is `present` / `partial` / `absent` with file:line evidence and behaviour notes.

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| Cancel mid-transfer | **present** | [`receiver.rs:280-301`](src-tauri/src/transfer/receiver.rs#L280-L301) | `watch::channel` checked in every `next_event` select arm. |
| Free-space precheck | **present** | [`export.rs:52`](src-tauri/src/transfer/export.rs#L52) via `ensure_enough_space` | Runs before any disk write. |
| Overwrite protection (file) | **present** | [`destination.rs::next_available_path`](src-tauri/src/transfer/destination.rs), used in [`export.rs:167,189,261,267`](src-tauri/src/transfer/export.rs) | Numeric suffix on collision. |
| Atomic temp→rename (collection) | **present** | [`export.rs:189-213, 246-270`](src-tauri/src/transfer/export.rs#L189-L213) | Stages to suffixed dir, `tokio::fs::rename` to final. |
| Atomic temp→rename (single blob) | **partial** | [`export.rs:162-181`](src-tauri/src/transfer/export.rs#L162-L181) | Writes directly to `next_available_path`. If interrupted, leaves partial bytes at final name. Fix: write to `<name>.part`, rename on success. |
| Overwrite protection (Android MediaStore) | **partial** | [`export.rs:78-135`](src-tauri/src/transfer/export.rs#L78-L135) | Conflict handling is delegated to `android_bridge::publish_to_mediastore`; the Rust side does not gate. Needs verification in JNI shim. |
| Duplicate / out-of-order bytes | **present** | iroh-blobs BLAKE3 verification end-to-end. |  |
| Receiver idle-timeout | **present** | [`receiver.rs:28`](src-tauri/src/transfer/receiver.rs#L28) `DOWNLOAD_IDLE_TIMEOUT=60s` |  |
| Retry / exponential backoff on transient errors | **absent** | [`receiver.rs:227-260`](src-tauri/src/transfer/receiver.rs#L227-L260) | `download_to_store` returns on first error. No reconnect. |
| Resume across app restart | **absent at app layer** | iroh-blobs store *is* persistent ([`endpoint.rs:328`](src-tauri/src/node/endpoint.rs#L328) `BlobStore::load`), but `receive_blob` creates a fresh download every call. No "Resume" button, no chunk manifest. | Fix: persist `TransferRecord` with `partial` status; on app launch, scan store and offer resume. |
| Drop-recovery (network blip mid-transfer) | **partial** | iroh QUIC keeps the stream open up to keepalive, but if the connection drops the receiver sees `Abort` and errors out (see B-above). Combined with **no retry** the user has to manually re-paste the ticket. |  |
| Cancel cleanup of partial files | **partial** | Single-blob export leaves partial bytes; collection staging dir cleanup at [`export.rs:209`](src-tauri/src/transfer/export.rs#L209) only runs on `Err`, not on `cancel_rx` mid-export. | Verify and harden in Phase 4. |

---

## 5. Honest mission-item status

Mission text references §2–§7. Each item marked **present** / **partial** / **absent** /
**out-of-scope-for-v0.5.1**.

### §2 Transfer engine

| Mission ask | Status | Evidence / planned action |
|---|---|---|
| QUIC primary (quinn) | **present** | iroh ships quinn under the hood. |
| TCP fallback | **absent** | iroh has relay (TCP-via-relay) fallback; no direct-TCP path. **out-of-scope-for-v0.5.1**. |
| Multiplexed streams | **present** | 1024 streams configured. |
| Adaptive chunk sizing (RTT/throughput) | **absent** → **out-of-scope-for-v0.5.1**. BBR-style probing belongs in iroh-blobs upstream, not a fork. |
| Adaptive parallel streams | **absent** → **out-of-scope-for-v0.5.1**. |
| Large socket buffers | **present** | 256 MB conn window, 64 MB stream window. |
| sendfile/splice/zero-copy | **absent** | iroh-blobs internal. Not touching for v0.5.1. |
| io_uring | **absent** → **out-of-scope-for-v0.5.1** (Windows is the primary target). |
| Bounded queues + backpressure | **present** | tokio mpsc bounded; iroh-blobs handles transport backpressure. |
| Sender read-ahead / receiver write-behind | **partial** | iroh-blobs handles inside the store; no explicit prefetch. Profile before adding. |
| Small-file fast path | **absent** | Phase 2 candidate (B6), gated by measurement. |
| Huge-file path (fallocate + mmap) | **absent** → **out-of-scope-for-v0.5.1**. iroh-blobs export uses `TryReference`; size-prealloc is upstream's job. |
| Compression (zstd, magic-byte gated) | **absent** → **out-of-scope-for-v0.5.1** (B7). |
| BLAKE3 hashing pipelined with I/O | **present** | iroh-blobs default. |
| Mandatory full-file verify | **present** | iroh-blobs always verifies; tested via existing integration. |
| Validated 1/2.5/10 GbE | **UNMEASURED** | No LAN benchmark in this audit. |

### §3 Pairing (BLE + NFC)

| Mission ask | Status | Evidence |
|---|---|---|
| BLE discovery + advertising (desktop) | **present (experimental)** | Windows WinRT [`proximity/ble.rs`](src-tauri/src/proximity/ble.rs); macOS/Linux **absent**. |
| BLE on Android | **present (experimental)** | [`LightningBleService.kt`](src-tauri/gen/android/app/src/main/java/com/lightningp2p/app/LightningBleService.kt). |
| NFC tap-to-pair (Android receive) | **present (experimental)** | NDEF intent filter + `drainPendingSharedTicket` Tauri command. |
| NFC tap-to-pair (Android send / HCE) | **absent** → **out-of-scope-for-v0.5.1**. |
| Desktop NFC | **absent** → **out-of-scope-for-v0.5.1**. |
| QR + manual fallback | **present** | `qrcode` crate + paste UI. |
| Ed25519-signed token, nonce + timestamp replay protection | **absent** | Tickets are unsigned capability tokens; iroh handles transport encryption. **out-of-scope-for-v0.5.1**. |
| Pairing = discovery only; transfer always Wi-Fi/LAN/direct | **present** | BLE carries only NodeId; transfer always iroh. |
| Session encryption (Noise/TLS 1.3) | **present** | iroh QUIC TLS 1.3. No app-level Noise. |

### §4 Speed modes

| Mission ask | Status |
|---|---|
| Standard / Fast / Extreme / LAN Beast / Battery-Safe | **absent everywhere** — Phase 3 builds backend + UI. |

### §5 High-leverage features

| Feature | Status (v0.5.1) | Disposition |
|---|---|---|
| Android Share Sheet | **present (stable)** | Already shipped. |
| Windows right-click "Send with" | **absent** | Phase 6 roadmap. |
| Web Receiver | **absent** | Phase 6 roadmap. |
| Resume across restarts | **absent** | Phase 4. |
| Smart Auto Mode | **absent** | Phase 6 roadmap. |
| Multi-device fan-out | **absent** | Phase 6 roadmap. |
| Magic Drop Folder | **absent** | Phase 6 roadmap. |
| Universal Clipboard | **absent** | Phase 6 roadmap. |
| Offline Hotspot Mode | **absent** | Phase 6 roadmap. |
| Transfer history with re-send | **partial** | History persisted (`storage/history.rs`); UI shows it; re-send button not wired. |

### §6 Reliability + UX

| Feature | Status |
|---|---|
| Resume | **absent** → Phase 4 |
| Failed-chunk retry w/ backoff | **absent** → Phase 4 |
| Atomic temp→rename | **partial** → Phase 4 |
| Overwrite protection | **partial** (Android MediaStore gap) → Phase 4 |
| Free-space precheck | **present** |
| Timeouts | **present** (60 s idle) |
| Drop recovery | **partial** (no retry) → Phase 4 |
| Out-of-order + duplicate safety | **present** (iroh-blobs) |
| Cancel/retry UI | **partial** (cancel yes, retry no) |
| Live + peak + avg MB/s | **partial** (avg shown; peak missing) → Phase 3 UI |
| ETA | **partial** (computed frontend from speed) |
| Bottleneck indicator | **absent** → Phase 3/5 |
| Verification badge | **partial** (final hash shown in completion event) |
| UI event rate cap | **present** (10 Hz) |

### §7 Benchmarks + docs

| Feature | Status |
|---|---|
| Bench tool runtime file generation | **present** ([`bin/benchmark_local.rs`](src-tauri/src/bin/benchmark_local.rs)) |
| Scenarios: 10MB / 100MB / 1GB / many-small | **partial** — only 10MB + 100MB exist. Phase 5 adds 1GB + many-small. |
| Output: mode, size, duration, avg/peak MB/s, CPU/RAM, bottleneck estimate | **partial** — current schema has duration + avg Mbps; missing peak, CPU, RAM, bottleneck. Phase 5 extends schema. |
| README upgrade w/ honest claims | **present** (BENCHMARKS.md policy already enforces) |
| Wire-protocol spec | **absent** → Phase 6 doc |
| CI matrix Win+Android | **present** (`.github/workflows/ci.yml`) |
| Tests, lint, fmt | **present** (109 tests passing on this commit) |
| SECURITY.md, CONTRIBUTING.md, templates | **present** (verified existing) |

---

## 6. What v0.5.1 will and will not include

**Will ship in v0.5.1:**

1. This AUDIT.md (Phase 1, done after merge).
2. Flamegraph + perf pass to confirm B1-B5 bottleneck hypotheses (Phase 1 follow-up before Phase 2).
3. Top-N measured perf wins, each with before/after numbers from `benchmark-local`. Final N
   depends on what flamegraph confirms; commitment is "every fix shows a real win, no
   speculative tuning."
4. **Speed modes** as a real concept: `TransferMode` enum + per-mode profile + UI selector +
   settings persistence. Modes that show no measurable difference on the test rig will be
   collapsed (we ship 3 modes, not 5, if 5 can't be told apart).
5. **Reliability hardening** for the items marked `absent`/`partial` in §4 — at minimum:
   atomic-rename for single-blob export, retry w/ exponential backoff for transient download
   errors, app-layer resume across restarts.
6. **Bench tool extension**: add `1gb`, `many_small` scenarios; extend report schema with peak
   MB/s, RSS, bottleneck estimate.
7. **Refreshed `src/content/local-benchmark-summary.json`** with the v0.5.1 numbers (5-run).
8. **Roadmap doc** for everything below.
9. Both platforms green in CI (Windows + Android signed builds).

**Will NOT ship in v0.5.1:**

- Adaptive BBR-style probing, custom QUIC chunking, sendfile/io_uring custom paths
  (would require forking iroh-blobs).
- Direct-TCP fallback (relay covers connectivity).
- Web Receiver, Magic Drop Folder, Universal Clipboard, Offline Hotspot, multi-device fan-out,
  Smart Auto Mode (all §5 → Phase 6 roadmap doc, with feature flags only where applicable).
- Desktop BLE on macOS/Linux; Android NFC write/HCE (§3 platform expansion).
- 1/2.5/10 GbE LAN benchmarks (requires hardware not on the audit machine; documented as gap).
- Any marketing claim not backed by a committed reproducible report.

**Rationale**: v0.5.1 is a point release in the "elegant brook" line — truth + measured speed +
reliability + speed modes. Bigger product surfaces belong in a minor bump (v0.6.0) with their own
plan + RFC.

---

## 7. Next step

Phase 2 begins after **you** review §3 (bottleneck ranking) and explicitly list which of B1–B7
to authorize. I will then capture a flamegraph for each authorized item (installing `samply`
first if needed), measure, fix, and re-measure — one commit per fix with before/after numbers in
the commit message.

No code changes will happen on `v0.5.1` until that authorization. The branch currently contains
only this AUDIT.md and the bench artifacts under [`docs/reports/raw/audit-v0.5.1/`](docs/reports/raw/audit-v0.5.1/).
