# Lightning P2P

Lightning P2P is a Windows-first peer-to-peer file transfer app built with:

- Rust
- Tauri v2
- React + TypeScript
- iroh
- iroh-blobs

## Features

- Direct peer-to-peer file and directory transfer
- Verified blob streaming with iroh-blobs
- Share tickets and QR codes
- Live transfer progress, speed, and ETA
- Persistent transfer history
- Windows installer output via NSIS and MSI

## Development

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm build
cd src-tauri
cargo test
cargo clippy --all-targets -- -D warnings
```

## Desktop Build

```bash
pnpm tauri build
```

Installer output is written to `src-tauri/target/release/bundle/`.
