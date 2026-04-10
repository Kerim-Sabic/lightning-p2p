```text
 _      ___ ____ _   _ _____ _   _ ___ _   _  ____   ____  ____  
| |    |_ _/ ___| | | |_   _| \ | |_ _| \ | |/ ___| |  _ \|  _ \ 
| |     | | |  _| |_| | | | |  \| || ||  \| | |  _  | |_) | |_) |
| |___  | | |_| |  _  | | | | |\  || || |\  | |_| | |  __/|  __/ 
|_____| |___\____|_| |_| |_| |_| \_|___|_| \_|\____| |_|   |_|    

                P 2 P   F I L E   T R A N S F E R
```

<div align="center">

# Lightning P2P

**FastDrop** is the desktop app inside this repository: a Windows-first, direct peer-to-peer file sharing app built with **Rust**, **Tauri v2**, **React**, **TypeScript**, **iroh**, and **iroh-blobs**.

Lightning P2P focuses on one job: **move files directly between devices with clean UX, verified transfers, and no custom networking protocol to babysit**.

<p>
  <img src="https://img.shields.io/badge/Rust-1.81%2B-000000?style=for-the-badge&logo=rust&logoColor=white" alt="Rust 1.81+" />
  <img src="https://img.shields.io/badge/Tauri-v2-24C8DB?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/React-19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-Strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript Strict" />
  <img src="https://img.shields.io/badge/Windows-NSIS%20%2B%20MSI-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows installers" />
</p>

</div>

## Why Lightning P2P

Most file sharing tools optimize for cloud storage, accounts, or convenience over control. Lightning P2P takes the opposite path:

- **Peer-to-peer by default** using `iroh` for NAT traversal, discovery, and relay fallback
- **Verified content transfer** using `iroh-blobs` instead of custom chunking logic
- **Desktop-first UX** with live progress, transfer speed, ETA, QR codes, and history
- **Windows-ready distribution** with both `NSIS` and `MSI` installers
- **Clean architecture**: Rust owns the logic, React renders the experience

This makes the project useful for:

- peer-to-peer file sharing
- local network file transfer
- direct device-to-device transfer
- secure Rust desktop apps
- Tauri + iroh example projects

## Highlights

- Send files and directories directly to another device
- Generate share tickets that include peer identity, hash, and routing info
- Display share tickets as text and QR code
- Receive with verified streaming to disk
- Track progress with bytes transferred, speed, and ETA
- Persist transfer history and known peers locally
- Build native Windows `.exe` and `.msi` installers
- Benchmark transfer performance with Criterion

## Product Naming

The **repository** is called **Lightning P2P**.

The **desktop app** currently ships with the product name **FastDrop** in the UI, Tauri config, installers, and Rust crate metadata.

## Tech Stack

### Backend

- Rust
- Tauri v2
- iroh
- iroh-blobs
- tokio
- sled
- keyring

### Frontend

- React
- TypeScript in strict mode
- Zustand
- Tailwind CSS
- Framer Motion
- Lucide React

## Architecture

Lightning P2P follows a deliberately strict split:

- **Networking:** `iroh` only
- **Blob transfer:** `iroh-blobs` only
- **Frontend to backend communication:** Tauri IPC only
- **Frontend responsibility:** presentation only
- **Backend responsibility:** transfer logic, progress, persistence, and validation

Core backend areas:

- [`src-tauri/src/node`](./src-tauri/src/node) for endpoint setup and node lifecycle
- [`src-tauri/src/transfer`](./src-tauri/src/transfer) for send, receive, progress, export, and queueing
- [`src-tauri/src/storage`](./src-tauri/src/storage) for history and peer persistence
- [`src-tauri/src/commands`](./src-tauri/src/commands) for typed Tauri commands

Core frontend areas:

- [`src/components`](./src/components) for views and UI components
- [`src/hooks`](./src/hooks) for event subscriptions and state orchestration
- [`src/stores`](./src/stores) for Zustand state
- [`src/lib/tauri.ts`](./src/lib/tauri.ts) for typed IPC wrappers

## Quick Start

### 1. Clone the repository

```powershell
git clone https://github.com/Kerim-Sabic/lightning-p2p.git
cd lightning-p2p
```

### 2. Install prerequisites

#### Rust

```powershell
winget install Rustlang.Rustup
```

Then restart your shell and verify:

```powershell
cargo --version
rustc --version
```

#### pnpm

```powershell
npm install -g pnpm
```

Verify:

```powershell
pnpm --version
```

#### Node.js

Use a modern LTS version of Node.js. `Node 20+` is the safest baseline for local development.

### 3. Install project dependencies

```powershell
pnpm install
```

### 4. Run the desktop app in development

```powershell
pnpm tauri dev
```

What to expect:

- Tauri starts the Rust backend
- the iroh node boots asynchronously
- once the node is ready, the UI shows the local **NodeId**
- you can then open **Send**, **Receive**, and **History**

## Full Tutorial: Run and Use the App

### Tutorial A: Start the app

1. Open a terminal in the repo root.
2. Run `pnpm tauri dev`.
3. Wait for the app window to open.
4. Confirm the UI shows a NodeId after startup.

If the NodeId never appears:

- confirm Rust is installed
- confirm `pnpm install` completed successfully
- check the terminal logs for iroh startup failures

### Tutorial B: Send a file

1. Open the **Send** view.
2. Drag a file or folder into the drop zone.
3. Review the selected items.
4. Click **Generate Link**.
5. Wait for the app to hash and register the content in the local `iroh-blobs` store.
6. Copy the generated ticket string or show the QR code to the receiver.

What the sender should see:

- a progress state while files are prepared
- a share ticket that starts with `blob`
- a QR code representing that same ticket

### Tutorial C: Receive a file

1. Open the **Receive** view.
2. Paste the ticket string from the sender.
3. Pick the destination directory.
4. Click **Download**.
5. Watch the transfer card update live.

What the receiver should see:

- transfer progress bar
- transferred bytes vs total bytes
- current speed
- ETA countdown
- completion state when the transfer is written to disk

### Tutorial D: Verify history

1. Open the **History** view.
2. Confirm the completed transfer appears in the list.
3. Review filename, direction, peer, size, and timestamp.
4. Use re-share when appropriate.

## Same-Machine Test Tutorial

If you want to test end-to-end transfer on a single Windows machine, use separate app profiles so local storage does not collide.

### Option 1: Run the packaged app twice with different profiles

Build the app first:

```powershell
pnpm build:windows
```

Then launch it from two terminals:

```powershell
$env:FASTDROP_PROFILE="alice"
.\src-tauri\target\release\fastdrop.exe
```

```powershell
$env:FASTDROP_PROFILE="bob"
.\src-tauri\target\release\fastdrop.exe
```

Use one instance as sender and the other as receiver.

### Option 2: Override the data directory manually

```powershell
$env:FASTDROP_DATA_DIR="C:\temp\fastdrop-a"
.\src-tauri\target\release\fastdrop.exe
```

```powershell
$env:FASTDROP_DATA_DIR="C:\temp\fastdrop-b"
.\src-tauri\target\release\fastdrop.exe
```

## Build a Windows Installer

### Standard Windows build

```powershell
pnpm build:windows
```

### Generic Tauri build

```powershell
pnpm tauri build
```

Installer output lands in:

- [`src-tauri/target/release/bundle/nsis`](./src-tauri/target/release/bundle/nsis)
- [`src-tauri/target/release/bundle/msi`](./src-tauri/target/release/bundle/msi)

### Packaged app defaults

The packaged Windows app now boots with:

- a default receive folder at `Downloads/FastDrop` when that folder can be created
- persistent packaged-app settings stored under the app data directory
- a first-run setup surface for confirming the receive folder
- signed in-app update support through GitHub Releases once release secrets are configured

## Development Workflow

### Install dependencies

```powershell
pnpm install
```

### Run frontend and backend in desktop dev mode

```powershell
pnpm tauri dev
```

### Required quality gates

```powershell
pnpm lint
pnpm typecheck
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

### Run benchmarks

```powershell
cargo bench --manifest-path src-tauri/Cargo.toml --bench transfer_bench -- --noplot
```

## Release and Updater Secrets

FastDrop now supports signed in-app updates through the Tauri updater plugin.

The public updater verification key is committed in [`src-tauri/tauri.conf.json`](./src-tauri/tauri.conf.json).

The private signing material is intentionally **not** committed. In this working copy it is stored locally under:

- `.secrets/tauri-updater.key`
- `.secrets/tauri-updater.password`

Before using the GitHub Actions release workflow for updater-enabled releases, configure these GitHub repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
  - the full contents of `.secrets/tauri-updater.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  - the full contents of `.secrets/tauri-updater.password`

Optional future Windows code-signing secrets:

- `WINDOWS_CERTIFICATE`
- `WINDOWS_CERTIFICATE_PASSWORD`
- `WINDOWS_CERTIFICATE_THUMBPRINT`

The workflow will still build NSIS and MSI installers without updater artifacts if the Tauri signing secrets are not configured.

### Local signed updater build

If you want to generate signed updater metadata locally, enable updater artifacts for the build and point Tauri at the private key:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = (Resolve-Path ".secrets\tauri-updater.key")
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content ".secrets\tauri-updater.password" -Raw).Trim()
$env:TAURI_CONFIG = '{"bundle":{"createUpdaterArtifacts":true}}'
pnpm build:windows
```

## Performance Notes

Lightning P2P includes:

- tuned QUIC transport settings
- throttled progress events
- direct download mode for known peers
- streaming receive/export logic
- Criterion benchmarks for transfer profiling

This repository is performance-focused, but the exact transfer speed depends on:

- local disk throughput
- Windows networking stack behavior
- CPU hashing cost
- relay vs direct path selection
- file count and file size distribution

## Contributing

Contributions are welcome if they improve:

- transfer reliability
- transport performance
- desktop UX
- Windows packaging
- tests, documentation, and diagnostics

Start here:

- read [`agents.md`](./agents.md)
- read [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- open an issue or discuss a concrete proposal before large changes

Good contribution areas:

- faster receive/export paths
- improved benchmarks and profiling
- Linux and macOS packaging
- richer settings and diagnostics UI
- pause/resume support
- broader integration test coverage

## Project Structure

```text
lightning-p2p/
|- src/                 React UI
|- src-tauri/           Rust backend + Tauri app
|  |- benches/          Criterion benchmarks
|  |- src/commands/     Tauri command layer
|  |- src/node/         iroh endpoint bootstrapping
|  |- src/storage/      history + peer persistence
|  |- src/transfer/     send/receive/progress/export
|  \- tests/            integration tests
|- agents.md            project rules and architecture constraints
\- README.md            project overview and usage guide
```

## Why People Contribute

Lightning P2P is a strong contributor project because it sits at the intersection of:

- systems programming
- desktop product design
- peer-to-peer networking
- performance engineering
- Rust + Tauri application architecture

If you want to work on a repo that is more interesting than a CRUD dashboard and still grounded in real product work, this is a good one.

## Status

Current status:

- active development
- Windows-first
- real end-to-end transfer flow implemented
- installer builds available
- benchmarks included

If you want to build a serious peer-to-peer desktop transfer tool in public, this repo is meant to be that foundation.
