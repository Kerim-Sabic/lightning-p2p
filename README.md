# Lightning P2P

Open-source AirDrop for Windows.

Free, open-source peer-to-peer file transfer for Windows. No cloud upload, no account, no artificial file-size cap. Built with Rust, Tauri, iroh, QUIC, and BLAKE3.

![MIT license](https://img.shields.io/badge/license-MIT-7ce7b2)
![Windows](https://img.shields.io/badge/platform-Windows-7ce7b2)
![Rust](https://img.shields.io/badge/Rust-native-f97316)
![Tauri](https://img.shields.io/badge/Tauri-v2-38bdf8)
![BLAKE3](https://img.shields.io/badge/integrity-BLAKE3-7ce7b2)

[Download for Windows](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest) | [Website](https://lightning-p2p.netlify.app/) | [Windows trust](docs/download-trust.md) | [Android trust](docs/android-trust.md) | [Security](SECURITY.md) | [Privacy](PRIVACY.md) | [Benchmarks](docs/benchmark-report-template.md) | [Contribute](CONTRIBUTING.md)

## Demo

<img src="./public/demo-lightning-p2p.gif" alt="Lightning P2P demo showing a sender creating a receive link and QR code, then a receiver completing a transfer" width="900" />

## What is Lightning P2P?

Lightning P2P is a free open-source P2P file transfer app for Windows. It sends files directly between devices using iroh and QUIC, verifies content with BLAKE3, and does not require cloud upload, accounts, or artificial file-size caps.

## Why this exists

Sending large files is still more complicated than it should be.

- Cloud tools upload private files before the receiver downloads them.
- LAN-only tools fail when devices are on different networks.
- CLI tools are powerful but not friendly for normal Windows users.
- Email and chat apps hit file-size limits quickly.

Lightning P2P keeps the workflow simple and removes the cloud file-hosting middleman.

## What you get

| Feature | Lightning P2P |
| --- | --- |
| No account | Yes |
| No cloud upload | Yes |
| Direct-first transfer | Yes |
| WAN-capable fallback | Yes, with relay fallback |
| BLAKE3 verification | Yes |
| Native Windows app | Yes |
| QR/link receive handoff | Yes |
| Nearby LAN discovery | Yes |
| Open source | Yes |
| MIT license | Yes |

## Download & Trust

Download the latest public Windows release from [GitHub Releases](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest).

Early community builds may be unsigned and may trigger Microsoft Defender SmartScreen. Verify the download source and checksum before installing. Do not install if the checksum does not match or if you do not trust the source.

### Windows

Recommended:

- [`LightningP2P-win-Setup.exe`](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/LightningP2P-win-Setup.exe) - one-click Windows installer

Optional:

- [`LightningP2PSetup.exe`](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/LightningP2PSetup.exe) - classic NSIS installer
- [`LightningP2P.msi`](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/LightningP2P.msi) - MSI for managed deployments
- Source build for developers

Verify a release download:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-release.ps1 -Installer .\LightningP2PSetup.exe -Checksums .\SHA256SUMS.txt
```

Read [docs/download-trust.md](docs/download-trust.md) for SmartScreen, SHA256, and Authenticode guidance. Read [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md) before using Lightning P2P on sensitive files or networks.

Requirements:

- Windows 10 or Windows 11 x64
- Microsoft Edge WebView2 Runtime, installed by the app bundle when needed
- Firewall permission for nearby LAN discovery if Windows prompts for it

### Android

Download `LightningP2P-android-latest.apk` and `SHA256SUMS-android.txt` from
the latest [GitHub Release](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest)
on your phone (or on a PC for USB sideload).

#### Install

1. Open the downloaded APK from your file manager.
2. The first time, Android asks "Allow [your downloader] to install unknown
   apps?" — tap **Settings** → toggle **Allow from this source** → back out.
3. Tap **Install**.
4. If Play Protect shows "couldn't verify this app", tap **Install anyway** —
   that's the expected one-time dialog for any new app not on the Play Store.
5. Launch Lightning P2P, allow notifications + Bluetooth when prompted.

#### What's normal vs. what isn't

| Prompt | Normal? | What it means |
| --- | --- | --- |
| "Install unknown apps" permission | Yes, once per downloader | Android's OS-level confirmation for any sideload |
| "Play Protect couldn't verify this app" | Yes, once | Low-reputation warning, not a malware warning |
| "App not installed" / "App damaged" | **No** | Bad download — verify SHA-256 and re-download |
| Red "Blocked by Play Protect" banner | **No** | Verify SHA-256; if it matches, file an issue |

See [docs/android-trust.md](docs/android-trust.md) for the full trust guide,
SHA-256 verification steps, and signer-fingerprint instructions.

#### Verify the download

```powershell
(Get-FileHash .\LightningP2P-android-latest.apk -Algorithm SHA256).Hash
Get-Content .\SHA256SUMS-android.txt | Select-String "LightningP2P-android-latest.apk"
```

The two values must match. If they don't, delete the APK and re-download.

Every Lightning P2P release is signed with the same keystore. Power users can
verify with `apksigner verify --print-certs <apk>` and compare the
`Signer #1 certificate SHA-256 digest` against:

```
5F:A0:D6:63:46:FF:9C:91:1B:18:D1:2A:5F:77:F1:F0:9B:2D:E2:A7:69:A0:97:68:6C:FC:FA:43:BD:86:29:16
```

If the value does not match, do not install — the APK is signed with a
different key than this project publishes.

#### Use it

Open Lightning P2P on a second device (Windows desktop, another phone) and the
two devices should appear in each other's Devices tab within ~10 seconds. Pick
a device, choose files, the receiver taps **Accept**. Devices on the same Wi-Fi
discover each other via mDNS; off-Wi-Fi devices in range discover each other via
Bluetooth and the actual transfer uses iroh's relay fallback.

Requirements:

- Android 7.0 (API 24) or newer
- Wi-Fi network that does not block multicast (most home networks; some
  hotel/guest networks do — the app surfaces a hint when this happens)
- Bluetooth for off-Wi-Fi nearby discovery (optional, can be turned off in
  Settings)
- ~50 MB of free space

## How it works

1. Sender selects files or a folder.
2. Lightning P2P prepares the content locally.
3. The app creates a receive ticket, link, and QR code.
4. Receiver opens the handoff link or scans the QR.
5. Peers connect directly when possible.
6. Relay fallback helps when direct connectivity is blocked.
7. Receiver streams and verifies bytes with BLAKE3.

Receive handoff links use `https://lightning-p2p.netlify.app/receive#t=<ticket>`, so the ticket stays in the URL fragment instead of being sent to the website server.

## Security model

Lightning P2P avoids cloud file hosting, but receive tickets are capability tokens. Anyone with a valid ticket can request that transfer while the sender is online and the content remains available.

- QUIC TLS through iroh
- BLAKE3 verification through iroh-blobs
- Ed25519 identity keys prefer the OS keychain, with an app-data fallback when keychain storage is unavailable
- No third-party cloud bucket in the transfer path
- Relay fallback helps connectivity but is not storage
- No telemetry without explicit opt-in
- Sender must stay online
- Nearby discovery exposes active-share metadata to peers on trusted local networks

See [SECURITY.md](SECURITY.md) for the threat model and reporting policy.

## Platform status

| Platform | Status |
| --- | --- |
| Windows | Public release |
| Android | Public sideload (mDNS + Bluetooth nearby discovery) |
| macOS/Linux | Planned |
| iOS | Not shipped |
| Browser | Receive handoff and marketing only, not the transfer engine |

## Benchmarks

Lightning P2P should not claim speed leadership until repeatable public benchmark results are published.

Use [docs/benchmark-report-template.md](docs/benchmark-report-template.md) for LAN direct, WAN direct, relay fallback, many-small-file, and large-single-file reports.

## Architecture

```text
lightning-p2p/
  src/        React 19 + TypeScript presentation layer
  src-tauri/  Rust backend, Tauri commands, iroh transfer engine
  docs/       release, security, SEO, mobile, and benchmark docs
  scripts/    packaging and metadata helpers
```

Project rules:

- Networking uses iroh.
- Blob transfer uses iroh-blobs.
- Frontend and backend communicate through Tauri IPC.
- React stays presentation-focused.
- Rust owns transfer logic, persistence, and validation.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for module boundaries, the transfer flow, and the Android foundation plan.

## Development

```powershell
pnpm install
pnpm tauri dev
pnpm build
pnpm lint
pnpm typecheck
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Same-machine transfer testing:

```powershell
# Terminal 1: sender
$env:LIGHTNING_P2P_PROFILE="alice"
.\src-tauri\target\release\lightning-p2p.exe

# Terminal 2: receiver
$env:LIGHTNING_P2P_PROFILE="bob"
.\src-tauri\target\release\lightning-p2p.exe
```

Deprecated compatibility env vars `FASTDROP_PROFILE` and `FASTDROP_DATA_DIR` are still accepted. New scripts should use `LIGHTNING_P2P_PROFILE` and `LIGHTNING_P2P_DATA_DIR`.

## Contributing

Contributions improving transfer reliability, diagnostics, packaging, docs, tests, or UX are welcome.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before larger changes.

Useful project docs:

- [Docs index](docs/README.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Code quality notes](docs/CODE_QUALITY_NOTES.md)
- [Roadmap](docs/ROADMAP.md)

## License

MIT. See [LICENSE](LICENSE).
