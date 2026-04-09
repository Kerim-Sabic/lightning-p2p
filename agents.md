# AGENTS.md — FastDrop P2P File Transfer

## Overview
FastDrop is a P2P file sharing app. Rust backend (iroh + Tauri v2), React/TypeScript frontend.
Goal: fastest possible file transfers of any size, directly between devices.

## Build & Test Commands
```bash
# Install dependencies
pnpm install
cd src-tauri && cargo build && cd ..

# Run checks (DO THIS BEFORE EVERY COMMIT)
cargo clippy --all-targets -- -D warnings
cargo test
pnpm lint
pnpm typecheck

# Run app
pnpm tauri dev

# Run specific Rust test
cargo test -p fastdrop -- test_name

# Run benchmarks
cargo bench -p fastdrop
```

## Coding Standards

### Rust
- All code must pass `cargo clippy -- -D warnings` with zero warnings
- No `.unwrap()` in library code. Use `?` with `thiserror` errors.
- Max 400 LOC per file, max 50 LOC per function
- Every public function has a doc comment
- Every module with logic has `#[cfg(test)] mod tests`
- Async: tokio only. Use `#[tokio::test]` for async tests.
- Dependencies: prefer well-maintained crates with >100 GitHub stars

### TypeScript
- Strict mode, zero `any` types
- Functional React components only
- All Tauri IPC calls go through typed wrappers in `src/lib/tauri.ts`
- Tailwind CSS only, no other styling approaches

## Architecture Rules (ENFORCED)
1. Networking = iroh only. No other networking libraries.
2. Blob transfer = iroh-blobs only. No custom chunking/hashing.
3. Frontend ↔ Backend = Tauri IPC only. No HTTP servers, no WebSockets.
4. Frontend = pure presentation. All logic in Rust.
5. Error handling = Result types everywhere. No panics in library code.

## Key Patterns

### Adding a new Tauri command
1. Define in `src-tauri/src/commands/` with `#[tauri::command]`
2. Register in `src-tauri/src/lib.rs` invoke_handler
3. Add typed wrapper in `src/lib/tauri.ts`
4. Write test in Rust

### Transfer lifecycle
Sender: files → iroh-blobs store → BlobTicket (contains NodeId + Hash)
Receiver: ticket → iroh-blobs fetch → BLAKE3 verified streaming → disk
Progress: Rust emits tauri events → frontend subscribes

## Do NOT
- Add new npm dependencies without justification
- Use `any` in TypeScript
- Put business logic in React components
- Use `.unwrap()` or `.expect()` in Rust library code
- Create HTTP endpoints — Tauri IPC handles everything
- Implement custom P2P protocols — iroh handles networking
- Implement custom chunking — iroh-blobs handles it