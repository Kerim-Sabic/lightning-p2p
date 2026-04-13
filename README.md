<div align="center">

<br />

<img src="https://img.shields.io/badge/Rust-1.81+-000000?style=for-the-badge&logo=rust&logoColor=white" alt="Rust 1.81+" />
<img src="https://img.shields.io/badge/Tauri-v2-24C8DB?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri v2" />
<img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19" />
<img src="https://img.shields.io/badge/TypeScript-Strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript Strict" />
<img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT License" />

<br /><br />

# Lightning P2P

### The fastest way to move files between devices.

**FastDrop** is a desktop peer-to-peer file transfer app built with Rust, iroh, and Tauri v2.<br />
No cloud. No accounts. No file size limits. Just direct, encrypted, verified transfers.

<br />

[Download for Windows](#download) &nbsp;&middot;&nbsp; [Quick Start](#quick-start) &nbsp;&middot;&nbsp; [How It Works](#how-it-works) &nbsp;&middot;&nbsp; [Contributing](#contributing)

<br />

</div>

---

## Why Lightning P2P?

Most file sharing tools route your data through the cloud, require accounts, or cap file sizes. Lightning P2P takes a different approach:

| Feature | Lightning P2P | Cloud Services | Other P2P Tools |
|---------|:---:|:---:|:---:|
| Direct device-to-device | **Yes** | No | Sometimes |
| End-to-end encrypted | **QUIC TLS 1.3** | Varies | Varies |
| No file size limit | **Yes** | Usually capped | Sometimes |
| No account required | **Yes** | No | Usually |
| Verified integrity | **BLAKE3** | Rarely | Rarely |
| NAT traversal built-in | **Yes** | N/A | Sometimes |
| Open source | **Yes** | Rarely | Sometimes |
| Native desktop app | **Yes** | Web only | Web/CLI |

## Key Features

- **Instant P2P transfers** using [iroh](https://iroh.computer) for QUIC networking, NAT traversal, and relay fallback
- **BLAKE3 verified streaming** with [iroh-blobs](https://docs.rs/iroh-blobs) -- every byte is cryptographically verified during transfer
- **End-to-end encrypted** via QUIC TLS 1.3 -- your files never touch a server
- **QR code sharing** -- scan a code to start receiving on another device
- **Live progress tracking** -- speed, ETA, and progress bar updated in real-time
- **Transfer history** with one-click re-sharing of previously sent content
- **Auto-updates** with signed releases delivered through GitHub Releases
- **Native Windows installer** -- NSIS and MSI bundles with embedded WebView2

## Download

### Windows

Download the latest installer from [**GitHub Releases**](https://github.com/Kerim-Sabic/lightning-p2p/releases).

| Installer | Description |
|-----------|-------------|
| `FastDrop_x.x.x_x64-setup.exe` | NSIS installer (recommended) |
| `FastDrop_x.x.x_x64_en-US.msi` | MSI installer |

> **Note:** Windows may show a SmartScreen warning on first launch since the app is not yet code-signed. Click "More info" then "Run anyway".

## Quick Start

### From source

```bash
# 1. Clone
git clone https://github.com/Kerim-Sabic/lightning-p2p.git
cd lightning-p2p

# 2. Install dependencies
pnpm install

# 3. Run in development mode
pnpm tauri dev
```

**Prerequisites:** [Rust 1.81+](https://rustup.rs/), [Node.js 20+](https://nodejs.org/), [pnpm](https://pnpm.io/)

### Build Windows installers

```bash
pnpm build:windows
```

Output: `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/`

## How It Works

Lightning P2P uses **iroh** for peer-to-peer networking and **iroh-blobs** for content-addressed blob transfer. The entire transfer flow is:

```
Sender                              Receiver
  |                                    |
  |  1. Drop files into FastDrop       |
  |  2. Files hashed with BLAKE3       |
  |  3. Added to local blob store      |
  |  4. Ticket generated               |
  |                                    |
  |  -------- share ticket -------->   |
  |                                    |
  |                                    |  5. Paste ticket
  |  <------- QUIC connection ------   |  6. Connect to sender
  |  ---- verified blob stream ---->   |  7. Stream with integrity check
  |                                    |  8. Export to disk
  |                                    |
```

**Tickets** contain the sender's node ID, content hash, and relay info -- everything the receiver needs to connect directly and download.

### Performance

The transfer pipeline is tuned for maximum throughput:

- **256 MB** QUIC connection window with **64 MB** per-stream windows
- **1024** concurrent QUIC streams
- **Parallel file hashing** across up to 64 cores
- **Direct download mode** skips relay when peers can connect directly
- **Streaming export** writes to disk during transfer, no full-file buffering
- **10 Hz** progress sampling with exponential moving average smoothing

## Architecture

```
lightning-p2p/
  src/                  React 19 + TypeScript frontend
    components/         UI views (Send, Receive, History, Settings)
    stores/             Zustand state management
    hooks/              Transfer event subscriptions
    lib/                Typed Tauri IPC wrappers
  src-tauri/            Rust backend
    src/commands/       Tauri command handlers
    src/node/           iroh endpoint + QUIC transport
    src/transfer/       Send, receive, progress, export pipeline
    src/storage/        sled database (history, peers, settings)
    benches/            Criterion transfer benchmarks
    tests/              Integration tests
```

### Design principles

1. **iroh handles all networking.** No raw sockets, no WebRTC, no HTTP transfers.
2. **iroh-blobs handles all blob transfer.** No custom chunking or hashing.
3. **Tauri IPC is the only bridge.** No HTTP servers between frontend and backend.
4. **Frontend is purely presentational.** Zero business logic in TypeScript.
5. **Every command returns a typed Result.** No panics in library code.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Networking** | iroh (QUIC, NAT traversal, relay) |
| **Transfer** | iroh-blobs (BLAKE3 verified streaming) |
| **Backend** | Rust, Tauri v2, tokio |
| **Frontend** | React 19, TypeScript (strict), Zustand |
| **Styling** | Tailwind CSS v4, Framer Motion |
| **Storage** | sled embedded database |
| **Security** | QUIC TLS 1.3, Ed25519 keys in OS keychain |
| **Packaging** | NSIS + MSI installers, signed auto-updates |

## Development

### Quality gates

```bash
pnpm lint              # ESLint (strict, no any)
pnpm typecheck         # TypeScript strict mode
cargo test             # Rust unit + integration tests
cargo clippy -- -D warnings  # Rust linting
```

### Benchmarks

```bash
cargo bench --manifest-path src-tauri/Cargo.toml --bench transfer_bench -- --noplot
```

### Same-machine testing

Test end-to-end on a single machine using separate profiles:

```powershell
# Terminal 1 (sender)
$env:FASTDROP_PROFILE="alice"
.\src-tauri\target\release\fastdrop.exe

# Terminal 2 (receiver)
$env:FASTDROP_PROFILE="bob"
.\src-tauri\target\release\fastdrop.exe
```

## Security

- **End-to-end encryption** via QUIC TLS 1.3 (handled by iroh)
- **Ed25519 identity keys** stored in the OS keychain via the `keyring` crate
- **BLAKE3 content verification** -- every chunk is verified during streaming
- **Tickets are capability tokens** -- treat them as secrets
- **No telemetry** without explicit opt-in

## Contributing

Contributions that improve transfer reliability, performance, UX, packaging, or test coverage are welcome.

1. Read [CONTRIBUTING.md](./CONTRIBUTING.md)
2. Open an issue or discuss before large changes
3. Follow conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`

### Good first issues

- Linux and macOS packaging support
- Pause/resume transfers
- Drag-and-drop between FastDrop instances
- Richer transfer diagnostics
- Broader integration test coverage

## License

MIT

---

<div align="center">

Built with [iroh](https://iroh.computer), [Tauri](https://tauri.app), and [React](https://react.dev).

**[Star this repo](https://github.com/Kerim-Sabic/lightning-p2p)** if you find it useful.

</div>
