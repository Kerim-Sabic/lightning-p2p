<div align="center">

# ⚡ Lightning P2P

**Direct, peer-to-peer file transfer for Windows and Android. No cloud. No accounts. No file-size cap.**

Built on **Rust**, **Tauri v2**, **iroh** (QUIC + relay fallback), **iroh-blobs** (BLAKE3-verified streaming), and **React 19**.

[![MIT license](https://img.shields.io/badge/license-MIT-7ce7b2?style=flat-square)](LICENSE)
[![Windows](https://img.shields.io/badge/Windows-public-7ce7b2?style=flat-square)](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest)
[![Android](https://img.shields.io/badge/Android-sideload_alpha-38bdf8?style=flat-square)](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest)
[![Rust](https://img.shields.io/badge/Rust-2021_edition-f97316?style=flat-square)](https://www.rust-lang.org/)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-24c8db?style=flat-square)](https://tauri.app/)
[![iroh](https://img.shields.io/badge/iroh-QUIC%20%2B%20relay-c084fc?style=flat-square)](https://iroh.computer/)
[![BLAKE3](https://img.shields.io/badge/integrity-BLAKE3-7ce7b2?style=flat-square)](https://github.com/BLAKE3-team/BLAKE3)

[**Download**](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest) · [**Website**](https://lightning-p2p.netlify.app/) · [**Windows trust**](docs/download-trust.md) · [**Android trust**](docs/android-trust.md) · [**Security**](SECURITY.md) · [**Privacy**](PRIVACY.md) · [**Roadmap**](docs/ROADMAP.md) · [**Contribute**](CONTRIBUTING.md)

</div>

---

## Demo

<img src="./public/demo-lightning-p2p.gif" alt="Sender creates a receive link and QR code; receiver pastes the link and the file streams directly" width="900" />

---

## Why Lightning P2P

Sending large files between your own devices is still harder than it should be.

| Tool | Cloud upload? | File-size cap? | Account? | Works across networks? |
|---|:-:|:-:|:-:|:-:|
| Email attachments | yes | tight | yes | yes |
| Generic cloud drives | **yes** | varies | yes | yes |
| LAN-only utilities | no | none | no | **no** |
| CLI tools | no | none | no | yes (if you know what you're doing) |
| **Lightning P2P** | **no** | **none** | **no** | **yes** (direct + relay fallback) |

Lightning P2P puts the connection directly between your two devices. The bytes never visit a third-party server. There's no upload step before the receiver can start downloading — once the receiver opens the link, the stream begins.

---

## What's new in v0.4.6 — Android polish

The v0.4.6 release is a focused Android quality leap:

- ✅ **Send actually works** — fixed the `io error: no such file or directory` failure caused by Android's `content://` SAF URIs. The file picker now resolves URIs into app cache through a JNI bridge before iroh-blobs sees them.
- ✅ **Smart save routing** — verified receives auto-route into the user's `MediaStore` collections. Pictures land in **Pictures**, video in **Movies**, audio in **Music**, everything else in **Downloads**. Each lands in a `Lightning P2P` subfolder so received content sits alongside your existing media.
- ✅ **System share-target** — Lightning P2P now appears in Android's native share sheet. Open Gallery → Share → Lightning P2P → the app launches with the file pre-selected and the QR/link **auto-generated**. Zero extra taps.
- ✅ **Mobile-first UI polish** — bigger touch targets, mobile-hero CTAs, smart-routing info panels, friendly empty states, a new launcher icon.
- ⚠️ **Heads-up:** `minSdk` is now 29 (Android 10+). Devices on Android 7–9 no longer install this build. This is intentional — it lets the app use scoped storage cleanly without `WRITE_EXTERNAL_STORAGE`.

See the full per-release history in [docs/ROADMAP.md](docs/ROADMAP.md).

---

## Install

### Windows

| Asset | When to use |
|---|---|
| **[`LightningP2P-win-Setup.exe`](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/LightningP2P-win-Setup.exe)** | One-click installer (recommended) |
| [`LightningP2PSetup.exe`](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/LightningP2PSetup.exe) | Classic NSIS installer |
| [`LightningP2P.msi`](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/LightningP2P.msi) | MSI for managed deployments |

Verify the download:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-release.ps1 `
  -Installer .\LightningP2PSetup.exe `
  -Checksums .\SHA256SUMS.txt
```

Read [docs/download-trust.md](docs/download-trust.md) for SmartScreen, SHA-256, and Authenticode guidance.

**Requirements:** Windows 10 or 11 x64. Microsoft Edge WebView2 Runtime (installed by the bundle if missing). Firewall permission for nearby LAN discovery.

### Android (sideload pre-release)

Download both files from the [latest GitHub Release](https://github.com/Kerim-Sabic/lightning-p2p/releases):

- `LightningP2P-android-latest.apk`
- `SHA256SUMS-android.txt`

**Verify the hash** before installing:

```powershell
(Get-FileHash .\LightningP2P-android-latest.apk -Algorithm SHA256).Hash
Get-Content .\SHA256SUMS-android.txt | Select-String "LightningP2P-android-latest.apk"
```

**Verify the signer** (power users):

```powershell
apksigner verify --print-certs --verbose LightningP2P-android-latest.apk
```

The `Signer #1 certificate SHA-256 digest` must match:

```
5F:A0:D6:63:46:FF:9C:91:1B:18:D1:2A:5F:77:F1:F0:9B:2D:E2:A7:69:A0:97:68:6C:FC:FA:43:BD:86:29:16
```

If it doesn't, **do not install** — the APK is signed with a different key than this project publishes.

**Install:** open the APK from your file manager → allow installs from this source if Android asks → tap Install. If Play Protect shows "couldn't verify this app", tap **Install anyway** — that's the expected one-time dialog for any app outside the Play Store.

| Prompt | Normal? | What it means |
|---|:-:|---|
| "Install unknown apps" permission | ✅ once per downloader | Android's OS-level confirmation for any sideload |
| "Play Protect couldn't verify this app" | ✅ once | Low-reputation warning, not malware |
| "App not installed" / "App damaged" | ❌ | Bad download — verify SHA-256 and re-download |
| Red "Blocked by Play Protect" banner | ❌ | Verify SHA-256; if it matches, file an issue |

Read [docs/android-trust.md](docs/android-trust.md) for the full trust guide.

**Requirements:** Android 10 (API 29) or newer. Wi-Fi network that doesn't block multicast (most home networks). ~50 MB of free space.

---

## How it works

```
┌──────────────┐          ticket            ┌──────────────┐
│              │  ───────────────────────▶  │              │
│   Sender     │       (QR · link · paste)  │   Receiver   │
│  (iroh node) │                            │  (iroh node) │
│              │  ◀━━━━━━━━━━━━━━━━━━━━━━━  │              │
└──────────────┘    QUIC direct or relay    └──────────────┘
                    BLAKE3-verified bytes
```

1. **Sender** picks files (or accepts a system Share intent on Android).
2. Lightning P2P adds the content to its local **iroh-blobs** store.
3. The app generates a **receive ticket** — surfaced as a QR code, a clickable web link, and a raw paste-able string.
4. **Receiver** opens the link (or scans the QR, or pastes the ticket).
5. The two iroh nodes connect — **directly** when the network allows, falling back to the iroh **relay** when direct is blocked.
6. Bytes stream over **QUIC**, verified continuously with **BLAKE3** by iroh-blobs.

Web handoff links carry the ticket in the URL **fragment** (`#t=...`) so the ticket never reaches the website server.

---

## What you get

|  |  |
|---|---|
| ✅ Direct peer-to-peer transfer | ❌ No cloud upload step |
| ✅ Relay fallback when direct is blocked | ❌ No accounts, no sign-up |
| ✅ BLAKE3 verification on every byte | ❌ No artificial file-size cap |
| ✅ QR + link + paste-ticket handoff | ❌ No third-party storage |
| ✅ Native Windows desktop app | ❌ No telemetry without explicit opt-in |
| ✅ Android sideload alpha with system share-target | ❌ No ads |
| ✅ Nearby-device LAN discovery | ❌ No vendor lock-in |
| ✅ Open source under MIT | ❌ No "premium" tier |

---

## Security model

Lightning P2P keeps file bytes off third-party servers, but **receive tickets are capability tokens** — anyone with a valid ticket can request that content while the sender is online.

- **Transport:** QUIC TLS 1.3 via iroh
- **Integrity:** BLAKE3 verification via iroh-blobs
- **Identity:** Ed25519 keypair stored in the OS keychain when available, with a profile-scoped app-data fallback
- **No cloud bucket** in the transfer path; the iroh relay is a connectivity helper, not storage
- **No telemetry** without explicit opt-in
- **Sender stays online** for the transfer
- **Nearby discovery** exposes active-share metadata to peers on trusted LAN networks

See [SECURITY.md](SECURITY.md) for the threat model and reporting policy.

---

## Platform status

| Platform | Status | Notes |
|---|---|---|
| Windows | **Public release** | One-click installer, MSI, NSIS variants |
| Android | **Sideload pre-release** | mDNS nearby discovery, system share-target, smart `MediaStore` routing; BLE planned for v0.5.0 |
| macOS / Linux | Planned | Source build works; packaging spike pending |
| iOS | Not shipped | Needs macOS, Xcode, Apple signing, multicast entitlement work |
| Browser | Receive handoff only | Not the transfer engine — the link routes into the native app |

---

## Architecture

```
lightning-p2p/
├── src/                React 19 + TypeScript presentation layer
├── src-tauri/          Rust backend, Tauri commands, iroh transfer engine
│   ├── src/
│   │   ├── commands/   Tauri IPC handlers (share, transfer, mobile, …)
│   │   ├── node/       LightningP2PNode wrapper around iroh + iroh-blobs
│   │   ├── transfer/   Send / receive / export / MIME bucket routing
│   │   └── storage/    Sled-backed settings + history
│   └── gen/android/    Android Gradle project + Kotlin glue
├── docs/               Release, security, mobile, and architecture docs
└── scripts/            Packaging, signing, and acceptance helpers
```

**Architecture invariants** (don't break these):

1. All networking goes through **iroh**.
2. All blob transfer goes through **iroh-blobs** with BLAKE3 verification.
3. Frontend ↔ backend uses **Tauri IPC** only — no HTTP servers.
4. The React layer is **purely presentational**; business logic lives in Rust.
5. Every Tauri command returns a typed `Result`.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for module boundaries and the transfer flow.

---

## Benchmarks

Lightning P2P **does not claim speed leadership** until repeatable public benchmark results land. Use [docs/benchmark-report-template.md](docs/benchmark-report-template.md) for LAN-direct, WAN-direct, relay-fallback, many-small-file, and large-single-file reports.

If you run a benchmark on your own hardware, please share the numbers (with the methodology) so they can land on the upcoming speed leaderboard.

---

## Develop

```powershell
pnpm install
pnpm tauri dev                # desktop dev
pnpm android:build:apk        # signed Android APK (needs keystore env vars)
pnpm check                    # frontend + rust checks
pnpm build                    # frontend production bundle
cargo test     --manifest-path src-tauri/Cargo.toml
cargo clippy   --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

**Same-machine transfer testing:**

```powershell
$env:LIGHTNING_P2P_PROFILE = "alice"
.\src-tauri\target\release\lightning-p2p.exe

# In a second terminal
$env:LIGHTNING_P2P_PROFILE = "bob"
.\src-tauri\target\release\lightning-p2p.exe
```

Deprecated `FASTDROP_PROFILE` and `FASTDROP_DATA_DIR` env vars are still accepted as compatibility shims; new scripts should use the `LIGHTNING_P2P_*` names.

---

## Contributing

Pull requests improving **transfer reliability, diagnostics, packaging, docs, tests, accessibility, or UX** are very welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before larger changes.

Useful docs:

- [Docs index](docs/README.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Android release runbook](docs/android-release-runbook.md)
- [Code quality notes](docs/CODE_QUALITY_NOTES.md)

---

## License

MIT — see [LICENSE](LICENSE). Free for personal and commercial use.

---

<div align="center">

**Built with care. No cloud middleman. No ads. No tracking.**

⭐ Star this repo if Lightning P2P saves you from yet another email-attachment-too-large rejection.

</div>
