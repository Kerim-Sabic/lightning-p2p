<div align="center">

# Lightning P2P

**Direct files. Verified bytes. No cloud account.**

A free, open-source peer-to-peer file transfer app for **Windows + Android** —
built on **Rust**, **Tauri 2**, **iroh QUIC**, **iroh-blobs**, and **BLAKE3**.

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-7ddf9c?style=flat-square)](LICENSE)
[![Windows stable](https://img.shields.io/badge/Windows-stable_v0.4.6-7ddf9c?style=flat-square)](https://github.com/Kerim-Sabic/lightning-p2p/releases/tag/v0.4.6)
[![Android sideload](https://img.shields.io/badge/Android-sideload_v0.4.6-7ddf9c?style=flat-square)](https://github.com/Kerim-Sabic/lightning-p2p/releases/tag/v0.4.6)
[![Experimental](https://img.shields.io/badge/Experimental-v0.5.1_speed_modes-f0c76b?style=flat-square)](https://github.com/Kerim-Sabic/lightning-p2p/releases/tag/v0.5.1)
[![Rust](https://img.shields.io/badge/Rust-1.81+-f0c76b?style=flat-square)](https://www.rust-lang.org/)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-7ddf9c?style=flat-square)](https://tauri.app/)
[![iroh QUIC](https://img.shields.io/badge/iroh-QUIC_+_relay-7ddf9c?style=flat-square)](https://iroh.computer/)
[![BLAKE3](https://img.shields.io/badge/integrity-BLAKE3-7ddf9c?style=flat-square)](https://github.com/BLAKE3-team/BLAKE3)
[![No cloud](https://img.shields.io/badge/cloud_upload-none-7ddf9c?style=flat-square)](#security-model)

[**Download**](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest)
· [Website](https://lightning-p2p.netlify.app/)
· [AUDIT.md](AUDIT.md)
· [Speed modes](#speed-modes-v051)
· [Security](#security-model)
· [Benchmarks](#benchmarks)
· [Roadmap](docs/ROADMAP_v0.5_to_v0.7.md)
· [Changelog](CHANGELOG.md)

</div>

---

## What it is

Most large-file workflows still ask you to upload first. Lightning P2P doesn't.
The sender keeps the file on the device, generates a capability ticket
(NodeId + content hash), and the receiver pulls bytes directly through
iroh QUIC. Direct path when the network allows; relay-assisted when it
doesn't. **BLAKE3 verifies every chunk** as it lands on disk.

| Best fit | Not for |
| --- | --- |
| Moving large builds, databases, media between Windows machines | Browser-only transfer (the web is handoff, not the engine) |
| Windows ↔ Android sideload testing | macOS / Linux production (planned, not shipped) |
| Sharing without cloud accounts, upload caps, or hosted retention | AirDrop protocol compatibility |
| Open-source workflows that need inspectable artifacts + checksums | Phone-to-phone NFC writing (NFC receive only) |
| Honest benchmark methodology with committed evidence | "Fastest in the world" marketing claims |

---

## Install

Latest **stable** release: **v0.4.6**. Latest **experimental**: **v0.5.1**
(speed modes + reliability hardening; carries the v0.5.0 BLE/NFC plumbing).

| Platform | Asset | Channel | Notes |
| --- | --- | --- | --- |
| Windows | [`LightningP2P-win-Setup.exe`](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/LightningP2P-win-Setup.exe) | Stable | One-click Velopack installer (recommended) |
| Windows | [`LightningP2PSetup.exe`](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/LightningP2PSetup.exe) | Stable | Classic NSIS installer |
| Windows | [`LightningP2P.msi`](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/LightningP2P.msi) | Stable | MSI for policy-managed installs |
| Android | [`LightningP2P-android-latest.apk`](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/LightningP2P-android-latest.apk) | Stable | Android 10+ sideload (signed) |
| All | [Release v0.5.1](https://github.com/Kerim-Sabic/lightning-p2p/releases/tag/v0.5.1) | Experimental | Speed modes, retry/backoff, cancel-race fix |

### Verify before you install

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File .\scripts\verify-release.ps1 `
  -Installer .\LightningP2P-win-Setup.exe `
  -Checksums .\SHA256SUMS.txt

# Android
(Get-FileHash .\LightningP2P-android-latest.apk -Algorithm SHA256).Hash
Get-Content .\SHA256SUMS-android.txt | Select-String "LightningP2P-android-latest.apk"
apksigner verify --print-certs --verbose .\LightningP2P-android-latest.apk
```

Android signer certificate SHA-256:

```text
5F:A0:D6:63:46:FF:9C:91:1B:18:D1:2A:5F:77:F1:F0:9B:2D:E2:A7:69:A0:97:68:6C:FC:FA:43:BD:86:29:16
```

Full trust guide: [`docs/download-trust.md`](docs/download-trust.md).

---

## How it works

```text
Sender (native app)                                  Receiver (native app)
┌─────────────────┐                                  ┌─────────────────┐
│ files on disk   │                                  │ destination dir │
│       ↓         │                                  │       ↑         │
│ iroh-blobs add  │ ──► BlobTicket (NodeId+hash) ──► │ iroh-blobs get  │
│                 │                                  │                 │
│ keeps content   │ ◄── encrypted iroh QUIC ──────►  │ BLAKE3 verify   │
│ until receiver  │      direct, then relay if NAT   │ stream to disk  │
│ finishes        │                                  │                 │
└─────────────────┘                                  └─────────────────┘
```

1. Sender picks files / folders / an Android share-sheet item.
2. The Rust engine imports content into the local iroh-blobs store.
3. A receive ticket is generated (NodeId + content hash + format).
4. Receiver opens a QR, HTTPS handoff link, deep link, or pastes the raw ticket.
5. iroh dials direct QUIC; falls back to relay-assisted route when needed.
6. iroh-blobs streams BLAKE3-verified bytes to the destination.

Receive handoff URLs use `/receive#t=<ticket>`. The ticket lives in the URL
fragment, so it **never reaches the website server**.

---

## Speed modes (v0.5.1)

v0.5.1 introduces five session-level transfer modes. Each swaps a full
transport profile: QUIC send/recv/stream windows, max streams, keepalive,
import concurrency, idle timeout, and UI emit cadence.

| Mode | Parallelism | Emit ms | Conn window | Stream window | Streams | Idle timeout |
|---|---:|---:|---:|---:|---:|---:|
| **Battery Safe** (Android default) | 8   | 250 | 64 MB   | 16 MB  | 256  | 30 s |
| **Standard** (desktop default)     | 64  | 100 | 256 MB  | 64 MB  | 1024 | 60 s |
| **Fast**                           | 128 | 100 | 256 MB  | 64 MB  | 1024 | 60 s |
| **Extreme**                        | 128 | 200 | 512 MB  | 128 MB | 2048 | 90 s |
| **LAN Beast**                      | 128 | 200 | 1024 MB | 256 MB | 4096 | 120 s |

Change the mode in Settings → the node restarts (deferred if a transfer is
in flight). The active mode persists across launches.

> **Honest scope.** On same-machine loopback all five modes cluster within
> ~13% (626 – 710 Mbps median). The hierarchy encodes design intent; LAN/WAN
> throughput-delta validation lands in v0.6. The receipts:
> [`AUDIT.md` §2.1.1](AUDIT.md) + [`docs/reports/raw/audit-v0.5.1/mode-sweep/`](docs/reports/raw/audit-v0.5.1/mode-sweep/).

---

## What works today

| Area | Status |
| --- | --- |
| Windows send + receive (Tauri 2 desktop app) | **Stable** |
| Android send + receive (sideload APK) | **Stable** |
| Android system share-target | **Stable** in v0.4.6 |
| Android MediaStore routing (Pictures / Movies / Music / Downloads) | **Stable** in v0.4.6 |
| QR + handoff link + raw ticket | **Stable** |
| Nearby Wi-Fi / LAN discovery (mDNS) | **Stable** |
| iroh relay fallback when direct path is blocked | **Stable** |
| Atomic single-blob writes (`.part` + rename) | **Stable** in v0.5.1 |
| Retry + exponential backoff on transient receive errors | **Stable** in v0.5.1 |
| Speed modes (5 profiles) | **Experimental** in v0.5.1 |
| Implicit resume across restarts (re-paste ticket) | **Stable** (iroh-blobs persistent store) |
| Explicit resume UI for failed transfers | Planned for v0.6 |
| BLE proximity discovery (Android + Windows) | **Experimental** since v0.5.0 |
| NFC ticket receive (Android) | **Experimental** since v0.5.0 |
| Phone-to-phone NFC write, macOS/Linux BLE | Not shipped |
| macOS / Linux / iOS desktop builds | Not shipped |

BLE and NFC **never carry file bytes** — they only carry discovery beacons
and ticket material. Bytes always travel through iroh QUIC. Full proximity
behavior + hardware test plan: [`docs/proximity.md`](docs/proximity.md).

---

## Security model

Lightning P2P avoids cloud file hosting, but receive tickets are
**capability tokens**. Anyone with a valid ticket can request the content
while the sender is online — treat tickets like secrets.

- **Transport**: every byte encrypted by iroh's QUIC stack. TLS 1.3 keys
  are derived per-session.
- **Integrity**: BLAKE3 verifies as the receiver streams to disk. A bad
  byte surfaces as a structured error, never silent corruption.
- **Storage**: the sender keeps the file on its disk until the receiver
  finishes. There is no upload step to a hosted bucket.
- **Relay**: connectivity help (a hop when NAT blocks the direct path),
  not a hosted retention store. Relay still sees encrypted QUIC frames,
  not plaintext.
- **Diagnostics**: bundles are gathered locally, redacted, and copied
  by the user. The frontend never auto-posts transfer secrets.
- **Telemetry**: no product telemetry by default. The native app does
  not phone home.
- **Sender requirement**: keep the sender online until the receive
  finishes. Closing the app cancels in-flight transfers.

Read [`SECURITY.md`](SECURITY.md), [`docs/security-model.md`](docs/security-model.md),
and [`docs/download-trust.md`](docs/download-trust.md) before using the app on
sensitive machines.

---

## Benchmarks

The bench tool lives at
[`src-tauri/src/bin/benchmark_local.rs`](src-tauri/src/bin/benchmark_local.rs).
It generates payloads at runtime (xorshift PRNG), spins up two
`LightningP2PNode` instances in temp dirs, and runs the real
`sender::create_share` + `receiver::receive_ticket` paths.

**Current committed reference** — same-machine loopback, 5 runs each, AMD
Zen 5 on Windows 11 Build 26200, NVMe boot, schema v2:

| Scenario | Runs | Failures | Median total | Median export | Median effective |
| --- | ---: | ---: | ---: | ---: | ---: |
| `same_machine_10mb`        | 5 | 0 |   147 ms |  7 ms |  **569.89 Mbps** |
| `same_machine_100mb`       | 5 | 0 | 1,356 ms |  7 ms |  **618.45 Mbps** |
| `same_machine_1gb`         | 5 | 0 | 13,565 ms | 8 ms |  **633.21 Mbps** |
| `same_machine_many_small`  | 5 | 0 |   512 ms | 274 ms | **327.05 Mbps** (200 × 100 KB) |

**Caveat.** Same-machine loopback only. Not WAN. Not Windows ↔ Android. Not
Wi-Fi. Not relay. Don't quote these for "fastest" claims. The full audit and
mode-comparison evidence live in [`AUDIT.md`](AUDIT.md) and the raw JSON +
CSV reports are at [`docs/reports/raw/`](docs/reports/raw/).

Reproduce locally:

```powershell
pnpm bench:local           # smoke profile, 10 MB only, ~30s
pnpm bench:local:full      # full profile (10 MB / 100 MB / 1 GB / many-small)

# Or directly, with mode + hardware notes:
.\src-tauri\target\release\benchmark-local.exe `
  --profile full --runs 5 --mode standard `
  --hardware-notes "AMD Zen 5, Win 11 26200, NVMe" `
  --output-dir docs/reports/raw/local
```

Methodology + benchmark-report template:
[`docs/BENCHMARKS.md`](docs/BENCHMARKS.md) ·
[`docs/benchmark-report-template.md`](docs/benchmark-report-template.md).

---

## Architecture

```text
src/                                React + TypeScript presentation layer
src/components/WebLandingPage.tsx   Marketing surface (cinematic, dark, signal-green)
src/components/ReceiveHandoffPage.tsx  /receive#t=<ticket> page

src-tauri/                          Rust backend, Tauri 2 IPC, iroh engine
src-tauri/src/node/                 endpoint, relay, discovery, nearby ALPN
src-tauri/src/transfer/             send, receive, export, progress, mode profiles
src-tauri/src/storage/              settings, history, peer cache (sled)
src-tauri/src/proximity/ble.rs      Windows WinRT BLE (Android equivalent under gen/)
src-tauri/src/bin/benchmark_local.rs   the bench tool

docs/                               architecture, trust, release, proximity, audit
scripts/                            release verification, benchmark, packaging
AUDIT.md                            v0.5.1 architecture + bench audit (root level)
```

**Architecture rules** (enforced by code review, not advisory):

1. Networking goes through iroh. No raw sockets, no WebRTC, no HTTP file transfer.
2. Blob transfer goes through iroh-blobs. No custom chunking or hashing.
3. Frontend ↔ backend communicate through Tauri IPC only. No embedded HTTP.
4. React is presentational. Rust owns transfer logic + persistence.
5. Public claims attach to source, release artifacts, or benchmark evidence.

Deeper reading: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Develop

Prereqs: **Node 22+**, **pnpm 10**, **Rust 1.81+**, platform Tauri toolchains.

```powershell
pnpm install
pnpm tauri dev               # native desktop app
pnpm dev                     # web (marketing site only)
pnpm android:dev             # Android device/emulator (Tauri-Android)
```

Local gate before a PR (mirrors what CI runs):

```powershell
pnpm check                   # release-state + lint + typecheck + test + build + cargo
```

Two profiles, two windows (test sender ↔ receiver on one machine):

```powershell
$env:LIGHTNING_P2P_PROFILE = "alice"; pnpm tauri dev
$env:LIGHTNING_P2P_PROFILE = "bob";   pnpm tauri dev
```

Environment overrides documented in [`.env.example`](.env.example).
Bench-time import-parallelism override:
`$env:LIGHTNING_P2P_IMPORT_PARALLELISM = 16` (any positive int).

---

## Contributing

Good first areas:

- **Device testing** on real Windows + Android hardware (LAN, WAN, relay)
- **Benchmark reports** on different hardware (CPU, NIC, NVMe class)
- **Accessibility + keyboard nav** across the app shell
- **Diagnostics + error copy** that helps users self-recover
- **macOS / Linux packaging spikes** (Tauri builders exist; CI is greenfield)
- **Proximity validation** with physical BLE + NFC hardware
- **Docs + screenshots + release verification**

Start with [`CONTRIBUTING.md`](CONTRIBUTING.md), [`docs/README.md`](docs/README.md),
and [`docs/ROADMAP_v0.5_to_v0.7.md`](docs/ROADMAP_v0.5_to_v0.7.md).

---

## License + citation

[Apache-2.0](LICENSE) · [NOTICE](NOTICE).

Citing Lightning P2P in research, posts, or benchmarks?
Use [`CITATION.cff`](CITATION.cff).

---

<div align="center">

Built by **[Horalix](https://horalix.com)** · Powered by **[iroh](https://iroh.computer/)** + **[iroh-blobs](https://www.iroh.computer/proto/iroh-blobs)** + **[Tauri](https://tauri.app/)**

</div>
