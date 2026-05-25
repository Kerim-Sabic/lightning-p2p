<div align="center">

# Lightning P2P

**Send huge files device-to-device. No cloud upload. No account. No size cap.**

Native Windows and Android file transfer built with **Rust**, **Tauri v2**,
**iroh QUIC**, **iroh-blobs**, and **BLAKE3-verified streaming**.

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-7ddf9c?style=flat-square)](LICENSE)
[![Windows stable](https://img.shields.io/badge/Windows-stable_v0.4.6-7ddf9c?style=flat-square)](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest)
[![Android sideload](https://img.shields.io/badge/Android-sideload_v0.4.6-7ddf9c?style=flat-square)](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest)
[![Rust](https://img.shields.io/badge/Rust-transfer_engine-f0c76b?style=flat-square)](https://www.rust-lang.org/)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-7ddf9c?style=flat-square)](https://tauri.app/)
[![iroh](https://img.shields.io/badge/iroh-QUIC_%2B_relay-7ddf9c?style=flat-square)](https://iroh.computer/)

[Download](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest)
| [Website](https://lightning-p2p.netlify.app/)
| [Security](SECURITY.md)
| [Privacy](PRIVACY.md)
| [Benchmarks](docs/BENCHMARKS.md)
| [Contribute](CONTRIBUTING.md)

</div>

---

## Why It Exists

Most large-file workflows still ask you to upload the file somewhere first.
Lightning P2P keeps the sender in control: the receiver opens a ticket, iroh
finds a direct or relay-assisted route, and iroh-blobs streams verified bytes
to disk.

Best fit today:

- moving large files between Windows machines
- Windows-to-Android and Android-to-Windows sideload testing
- sharing without accounts, cloud buckets, upload caps, or hosted retention links
- open-source workflows that need inspectable release artifacts and checksums
- benchmarkable transfer experiments with honest methodology

Not shipped yet:

- production macOS, Linux, or iOS packages
- browser-only file transfer
- AirDrop protocol compatibility
- macOS/Linux BLE discovery
- phone-to-phone NFC writing
- third-party security audit

## Demo

<img src="./public/demo-lightning-p2p.gif" alt="Lightning P2P sender creates a receive link and QR code; the receiver opens the ticket and the file streams peer-to-peer" width="900" />

## Install

Latest stable public release: **v0.4.6**.

| Platform | Asset | Notes |
| --- | --- | --- |
| Windows | [`LightningP2P-win-Setup.exe`](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/LightningP2P-win-Setup.exe) | Recommended one-click installer |
| Windows | [`LightningP2PSetup.exe`](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/LightningP2PSetup.exe) | Classic NSIS installer |
| Windows | [`LightningP2P.msi`](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/LightningP2P.msi) | MSI for managed installs |
| Android | [`LightningP2P-android-latest.apk`](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/LightningP2P-android-latest.apk) | Android 10+ sideload APK |

Verify Windows artifacts:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-release.ps1 `
  -Installer .\LightningP2P-win-Setup.exe `
  -Checksums .\SHA256SUMS.txt
```

Verify Android artifacts:

```powershell
(Get-FileHash .\LightningP2P-android-latest.apk -Algorithm SHA256).Hash
Get-Content .\SHA256SUMS-android.txt | Select-String "LightningP2P-android-latest.apk"
apksigner verify --print-certs --verbose .\LightningP2P-android-latest.apk
```

Published Android signer certificate SHA-256:

```text
5F:A0:D6:63:46:FF:9C:91:1B:18:D1:2A:5F:77:F1:F0:9B:2D:E2:A7:69:A0:97:68:6C:FC:FA:43:BD:86:29:16
```

Experimental release: [v0.5.0](https://github.com/Kerim-Sabic/lightning-p2p/releases/tag/v0.5.0)
adds BLE/NFC proximity plumbing for testing. Use stable v0.4.6 unless you are
explicitly testing proximity features.

## How It Works

```text
Sender app                  ticket / QR / link                  Receiver app
files -> iroh-blobs store -> BlobTicket with NodeId + hash -> iroh-blobs fetch
        \________ encrypted iroh QUIC direct or relay-assisted route ________/
```

1. Sender chooses files, folders, or an Android share-sheet item.
2. Rust imports content into the local iroh-blobs store.
3. Lightning P2P creates a receive ticket with NodeId, hash, and blob format.
4. Receiver opens a QR code, HTTPS handoff link, deep link, or raw ticket.
5. iroh tries direct QUIC connectivity and falls back through relay when needed.
6. iroh-blobs streams BLAKE3-verified bytes to the selected output location.

Receive handoff links use `/receive#t=<ticket>`. The ticket is in the URL
fragment, so ordinary HTTP requests to the website do not include it.

## What Works Today

| Area | Status |
| --- | --- |
| Windows send/receive | Stable public release |
| Android send/receive | Stable sideload release |
| Android system share target | Stable in v0.4.6 |
| Android MediaStore routing | Stable in v0.4.6 |
| QR/link/raw-ticket handoff | Stable |
| Nearby Wi-Fi/LAN discovery | Stable |
| iroh relay fallback | Stable |
| BLE proximity discovery | Experimental Android + Windows v0.5.0 |
| NFC ticket receive | Experimental Android v0.5.0 |
| macOS/Linux BLE | Not shipped |

BLE and NFC never carry file bytes. See [docs/proximity.md](docs/proximity.md)
for exact behavior and the hardware test plan.

## Security Model

Lightning P2P avoids cloud file hosting, but receive tickets are capability
tokens. Anyone with a valid ticket can request the referenced content while the
sender is online and the content remains available.

- Transport: encrypted iroh QUIC.
- Integrity: BLAKE3 verification through iroh-blobs.
- Storage: sender keeps the file until the receiver pulls it.
- Relay fallback: connectivity help, not a hosted retention bucket.
- Telemetry: no product telemetry by default.
- Sender requirement: keep the sender online until receive completes.

Read [SECURITY.md](SECURITY.md), [docs/security-model.md](docs/security-model.md),
and [docs/download-trust.md](docs/download-trust.md) before using the app on
sensitive machines.

## Benchmarks

The repo includes an automated same-machine loopback harness. It is useful for
regression detection, not marketing speed claims.

Current committed harness summary:

| Scenario | Runs | Failures | Median total | Median effective |
| --- | ---: | ---: | ---: | ---: |
| 10 MB loopback | 3 | 0 | 276 ms | 303.78 Mbps |
| 100 MB loopback | 3 | 0 | 1,130 ms | 742.10 Mbps |

Scope: same-machine loopback on one Windows dev machine. It is not WAN, relay,
Wi-Fi, NAT traversal, or Windows <-> Android. Do not use these numbers for
speed leadership claims.

Reproduce:

```powershell
pnpm bench:local
pnpm bench:local:full
```

Evidence and methodology:

- [docs/reports/automated-local-benchmarks.md](docs/reports/automated-local-benchmarks.md)
- [docs/BENCHMARKS.md](docs/BENCHMARKS.md)
- [docs/benchmark-report-template.md](docs/benchmark-report-template.md)

## Architecture

```text
src/                  React + TypeScript presentation layer
src-tauri/            Rust backend, Tauri IPC, iroh transfer engine
src-tauri/src/node/   endpoint, relay, discovery, nearby protocol
src-tauri/src/transfer/
                      send, receive, export, progress, MIME routing
src-tauri/src/storage/
                      settings, history, peer cache
src-tauri/gen/android/
                      Android activity, share-sheet, BLE/NFC glue
docs/                 architecture, trust, release, launch, benchmark docs
scripts/              release verification, benchmark, packaging helpers
```

Architecture rules:

1. Networking goes through iroh.
2. Blob transfer goes through iroh-blobs.
3. Frontend and backend communicate through Tauri IPC only.
4. React is presentation; Rust owns transfer logic and persistence.
5. Public claims must attach to source, release artifacts, or benchmark evidence.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Develop

Prerequisites: Node 22+, pnpm 10, Rust 1.81+, platform toolchains for Tauri.

```powershell
pnpm install
pnpm tauri dev
```

Run the full local gate before a PR:

```powershell
pnpm check
```

Expanded checks:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Run two local desktop profiles:

```powershell
$env:LIGHTNING_P2P_PROFILE = "alice"
pnpm tauri dev

$env:LIGHTNING_P2P_PROFILE = "bob"
pnpm tauri dev
```

Optional local overrides are documented in [.env.example](.env.example).

## Contributing

Good first areas:

- Windows and Android device testing
- benchmark reports with real hardware
- accessibility and keyboard navigation
- diagnostics and user-facing error messages
- macOS and Linux packaging spikes
- proximity feature validation with physical BLE/NFC hardware
- docs, screenshots, and release verification

Start with [CONTRIBUTING.md](CONTRIBUTING.md), [docs/README.md](docs/README.md),
and [docs/ROADMAP.md](docs/ROADMAP.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

If you cite Lightning P2P in research, posts, or benchmarks, use
[CITATION.cff](CITATION.cff).
