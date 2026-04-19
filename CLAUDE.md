# CLAUDE.md — Lightning P2P (internal crate name: `fastdrop`)

## Project Identity
Lightning P2P is a P2P file sharing application built for maximum transfer speed.
Rust backend (iroh + Tauri v2) with React/TypeScript frontend.

**Naming note:** the public product name is **Lightning P2P**. The internal Rust
crate is still named `fastdrop` (see `src-tauri/Cargo.toml` and the output binary
`fastdrop.exe`). Both names refer to the same project. Do not rename the crate
unless explicitly asked — binary path and historical `FASTDROP_PROFILE` env var
still use `fastdrop`.

## Architecture Invariants — NEVER VIOLATE
- ALL networking goes through iroh. No raw sockets, no WebRTC, no HTTP file transfer.
- iroh-blobs handles ALL blob transfer. Don't reinvent chunking/hashing/resumption.
- Tauri IPC is the ONLY bridge between frontend and backend. No HTTP servers.
- Frontend is PURELY presentational. Zero business logic in TypeScript.
- Every Tauri command returns a typed Result. No unwrap() in command handlers.

## Rust Conventions
- Edition 2021, MSRV 1.78+
- `#![deny(clippy::all, clippy::pedantic)]` in lib.rs
- All async code uses tokio runtime (iroh requires it)
- Error handling: `thiserror` for library errors, `anyhow` only in main/CLI
- No `.unwrap()` or `.expect()` in library code — use `?` operator
- Modules: one file per concern, max 400 LOC, functions max 50 LOC
- All public APIs have doc comments with examples
- Tests: `#[cfg(test)]` module in every file with >20 LOC of logic

## TypeScript Conventions
- Strict mode, no `any`, no `as` casts except in typed Tauri invoke wrappers
- Functional components only, hooks for all state
- Zustand for global state, no prop drilling beyond 2 levels
- All Tauri invokes wrapped in typed async functions in `src/lib/tauri.ts`
- Tailwind only — no inline styles, no CSS modules

## Key Libraries — USE THESE, DON'T REINVENT
- `iroh` — P2P endpoint, connection management, NAT traversal
- `iroh-blobs` — content-addressed blob transfer (BLAKE3 verified streaming)
- `tauri` v2 — desktop shell + IPC
- `sled` or `redb` — local storage
- `tracing` + `tracing-subscriber` — structured logging
- `clap` — CLI argument parsing

## Transfer Flow (the critical path — understand this)
1. Sender: User drops files → Tauri command → iroh-blobs adds to store → returns BlobTicket
2. Ticket: Contains NodeId + Hash + relay info. Displayed as QR or copyable string.
3. Receiver: Pastes ticket → Tauri command → iroh-blobs fetches from sender → verified streaming
4. Progress: Rust emits Tauri events → frontend subscribes → live progress bar

## Performance Rules
- BLAKE3 for ALL hashing (iroh-blobs handles this)
- Use iroh-blobs' built-in chunking — it's optimized for verified streaming
- Large file transfers: iroh-blobs streams directly from disk, no full-file buffering
- Frontend: throttle progress events to 10Hz max (don't flood the IPC bridge)
- Startup: iroh endpoint binding is async — show skeleton UI immediately

## Testing Strategy
- Unit: Rust modules with `#[tokio::test]` for async, standard `#[test]` for pure logic
- Integration: Two iroh nodes in-process, transfer blobs, verify integrity
- E2E: `tauri-driver` or manual QA script
- Property tests: `proptest` for serialization roundtrips
- Benchmarks: `criterion` for hashing throughput, transfer throughput

## Security
- E2E encrypted via QUIC TLS 1.3 (iroh handles this)
- Ed25519 identity keypair stored in OS keychain via `keyring` crate
- Tickets are capability tokens — treat them as secrets
- Rate limit incoming connections in iroh endpoint config
- No telemetry without explicit opt-in

## Git Discipline
- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `ci:`
- Every commit must compile and pass `cargo clippy` + `cargo test`
- PR = one logical change. No mega-PRs.

## Commands Reference
```bash
# Development
pnpm tauri dev          # Run app in dev mode
cargo test              # Run Rust tests
cargo clippy            # Lint Rust
pnpm lint               # Lint TypeScript
pnpm typecheck          # TypeScript type checking

# Build
pnpm tauri build        # Production build

# CLI (if built)
cargo run -p fastdrop-cli -- send ./myfile.zip
cargo run -p fastdrop-cli -- receive <ticket>
```