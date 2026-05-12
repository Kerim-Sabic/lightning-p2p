# CLAUDE.md - Lightning P2P

## Project Identity

Lightning P2P is a P2P file sharing application built for high-throughput direct transfer. Rust backend (iroh + Tauri v2) with React/TypeScript frontend.

The public product, Rust package, library crate, and generated executable now use Lightning P2P naming. The executable is `lightning-p2p.exe`; old `FASTDROP_*` env vars are accepted only as deprecated compatibility fallbacks.

## Architecture Invariants - NEVER VIOLATE

- ALL networking goes through iroh. No raw sockets, no WebRTC, no HTTP file transfer.
- iroh-blobs handles ALL blob transfer. Do not reinvent chunking, hashing, or resumption.
- Tauri IPC is the ONLY bridge between frontend and backend. No HTTP servers.
- Frontend is PURELY presentational. Zero business logic in TypeScript.
- Every Tauri command returns a typed Result. No unwrap() in command handlers.

## Rust Conventions

- Edition 2021, MSRV 1.81+
- `#![deny(clippy::all, clippy::pedantic)]` in lib.rs
- All async code uses tokio runtime
- Error handling: `thiserror` for library errors, `anyhow` only at boundaries
- No `.unwrap()` or `.expect()` in library code; use `?`
- Modules: one file per concern, max 400 LOC, functions max 50 LOC
- All public APIs have doc comments
- Tests: `#[cfg(test)]` module in every file with >20 LOC of logic

## TypeScript Conventions

- Strict mode, no `any`, no `as` casts except in typed Tauri invoke wrappers
- Functional components only, hooks for all state
- Zustand for global state
- All Tauri invokes wrapped in typed async functions in `src/lib/tauri.ts`
- Tailwind only; no inline styles or CSS modules

## Key Libraries

- `iroh` - P2P endpoint, connection management, NAT traversal
- `iroh-blobs` - content-addressed blob transfer with BLAKE3 verification
- `tauri` v2 - desktop shell and IPC
- `sled` - local storage
- `tracing` + `tracing-subscriber` - structured logging
- `clap` - optional CLI argument parsing

## Transfer Flow

1. Sender: user drops files -> Tauri command -> iroh-blobs adds to store -> returns BlobTicket.
2. Ticket: contains NodeId + Hash + relay info. Displayed as QR or copyable string.
3. Receiver: pastes ticket -> Tauri command -> iroh-blobs fetches from sender -> verified streaming.
4. Progress: Rust emits Tauri events -> frontend subscribes -> live progress bar.

## Performance Rules

- BLAKE3 for all hashing through iroh-blobs.
- Use iroh-blobs built-in chunking.
- Large file transfers stream directly from disk, with no full-file buffering.
- Frontend progress events should stay throttled to avoid flooding IPC.
- Startup is async; show app state immediately while iroh warms up.

## Security

- QUIC TLS 1.3 through iroh
- Ed25519 identity keypair stored in OS keychain through `keyring` when available, with profile-scoped app-data fallback when unavailable
- Tickets are capability tokens; treat them as secrets
- No telemetry without explicit opt-in

## Commands Reference

```powershell
pnpm tauri dev
pnpm check
pnpm lint
pnpm typecheck
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
pnpm build:windows
```

Same-machine profile test:

```powershell
$env:LIGHTNING_P2P_PROFILE="alice"; .\src-tauri\target\release\lightning-p2p.exe
$env:LIGHTNING_P2P_PROFILE="bob"; .\src-tauri\target\release\lightning-p2p.exe
```
