# Lightning P2P

Free, open-source peer-to-peer file transfer for Windows.

No cloud upload. No account. No artificial file-size cap. Direct encrypted transfers over LAN or the public internet.

[Download Windows Installer](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/LightningP2P-win-Setup.exe) | [Watch Demo](#demo) | [Security Model](#security-model) | [Benchmarks](#benchmarks) | [Star Repo](https://github.com/Kerim-Sabic/lightning-p2p)

## Demo

<img src="./public/demo-lightning-p2p.gif" alt="Lightning P2P demo showing a sender creating a receive link and QR code, then a receiver completing a transfer" width="900" />

## Why This Exists

Sending large files is still weirdly annoying:

- cloud tools upload your files to someone else's server
- many tools need accounts or links that expire
- LAN-only tools break when people are not on the same network
- CLI tools are powerful but not friendly for normal users

Lightning P2P is a native Windows app built with Rust, Tauri, iroh, QUIC, and BLAKE3.

## What You Get

| Feature                | Lightning P2P            |
| ---------------------- | ------------------------ |
| No account             | Yes                      |
| No cloud storage       | Yes                      |
| Direct P2P transfer    | Yes                      |
| Works across WAN       | Yes, with relay fallback |
| Integrity verification | BLAKE3                   |
| Native Windows app     | Yes                      |
| Open source            | MIT                      |

## Install

Download the latest Windows installer from [GitHub Releases](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest).

Recommended:

- [`LightningP2P-win-Setup.exe`](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/LightningP2P-win-Setup.exe)

Optional:

- [`LightningP2PSetup.exe`](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/LightningP2PSetup.exe) for the classic NSIS installer
- [`LightningP2P.msi`](https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/LightningP2P.msi) for managed deployments
- source build for developers

## How It Works

1. Sender drops a file.
2. App hashes it with BLAKE3.
3. Sender shares a ticket, link, or QR code.
4. Receiver opens it.
5. Devices connect directly when possible.
6. Transfer streams and verifies bytes before saving.

Receive handoff links use `https://lightning-p2p.netlify.app/receive#t=<ticket>`, so the ticket stays in the URL fragment and is not sent to the website server. The raw ticket contains the sender node ID, content hash, and relay info needed to connect while the sender is online.

## Security Model

Lightning P2P is private by design, but tickets are capability tokens. Anyone with a valid ticket can request that transfer while the sender is online and the content remains available.

- QUIC TLS 1.3 transport through iroh
- BLAKE3 content verification through iroh-blobs
- Ed25519 identity keys stored through the OS keychain
- no third-party cloud bucket in the transfer path
- no telemetry without explicit opt-in

See [SECURITY.md](SECURITY.md) for the threat model and reporting policy.

## Status

- Windows: public release
- Android: alpha/internal
- macOS/Linux: planned
- iOS: not shipped

## Roadmap

- Better benchmark reports
- macOS/Linux packaging
- Android public alpha
- Pause/resume transfers
- Transfer diagnostics

## Benchmarks

Lightning P2P should not claim speed leadership until repeatable results are published. Use [docs/benchmark-report-template.md](docs/benchmark-report-template.md) for every public result so the hardware, route, app version, transfer size, failure count, and export time stay attached to the claim.

Benchmark comparison targets:

- LocalSend
- PairDrop
- Snapdrop
- Magic Wormhole
- Windows Nearby Sharing
- cloud upload/download workflows

## Architecture

```
lightning-p2p/
  src/                  React 19 + TypeScript frontend
  src-tauri/            Rust backend and Tauri commands
  docs/                 release, SEO, mobile, benchmark, and launch docs
  scripts/              packaging and metadata helpers
```

Design rules:

1. Networking uses iroh only.
2. Blob transfer uses iroh-blobs only.
3. Frontend and backend communicate through Tauri IPC only.
4. React stays presentational; transfer logic lives in Rust.
5. Expected failures return `Result` types instead of panicking.

## Development

Install dependencies:

```powershell
pnpm install
cargo build --manifest-path src-tauri/Cargo.toml
```

Run the app:

```powershell
pnpm tauri dev
```

Run checks:

```powershell
pnpm lint
pnpm typecheck
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Build Windows installers:

```powershell
pnpm build:windows
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

Deprecated compatibility env vars `FASTDROP_PROFILE` and `FASTDROP_DATA_DIR` are still accepted, but new scripts should use `LIGHTNING_P2P_PROFILE` and `LIGHTNING_P2P_DATA_DIR`.

## Website

The browser build is a public website and receive-link handoff surface, not the transfer engine. The native Rust/Tauri app performs transfers with iroh. See [docs/online-handoff.md](docs/online-handoff.md).

## Contributing

Contributions that improve transfer reliability, performance measurement, UX, packaging, docs, or test coverage are welcome.

1. Read [CONTRIBUTING.md](CONTRIBUTING.md).
2. Open an issue or discuss before large changes.
3. Follow conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`.

## License

MIT
