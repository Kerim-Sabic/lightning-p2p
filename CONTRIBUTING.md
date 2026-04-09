# Contributing to Lightning P2P

Thanks for contributing.

This project is opinionated on architecture because peer-to-peer desktop apps become messy fast when networking, UI logic, and storage concerns bleed into each other.

## First Read

Before making changes, read:

- [`agents.md`](./agents.md)
- [`README.md`](./README.md)

## Project Rules

These are enforced project-wide:

- networking is `iroh` only
- blob transfer is `iroh-blobs` only
- frontend and backend talk through Tauri IPC only
- React stays presentation-focused
- Rust owns transfer logic, persistence, and validation
- no `.unwrap()` in Rust library code
- no `any` in TypeScript

## Local Setup

### Prerequisites

```powershell
winget install Rustlang.Rustup
npm install -g pnpm
```

### Install dependencies

```powershell
pnpm install
```

### Run the app

```powershell
pnpm tauri dev
```

## Before Opening a Pull Request

Run all required checks:

```powershell
pnpm lint
pnpm typecheck
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

If you change transfer performance or transport behavior, also run:

```powershell
cargo bench --manifest-path src-tauri/Cargo.toml --bench transfer_bench -- --noplot
```

## What Makes a Good PR

A strong PR in this repo usually has:

- one clear purpose
- a short problem statement
- tests for new logic
- no unrelated formatting churn
- no architectural drift from the rules above

## PR Checklist

- code is scoped to one problem
- Rust changes pass clippy with `-D warnings`
- tests pass locally
- public functions have doc comments
- files stay reasonably small
- README or docs are updated if behavior changed

## Areas Where Help Is Valuable

- transport performance
- receive/export throughput
- pause/resume transfer support
- Windows packaging and updater flow
- integration test coverage
- UX polish for send, receive, history, and settings

## Reporting Issues

When filing a bug, include:

- operating system and version
- whether you used `pnpm tauri dev` or a packaged build
- sender and receiver environment
- ticket type: file or directory
- expected behavior
- actual behavior
- logs or screenshots when available

## Style Notes

### Rust

- use `Result`
- prefer `?`
- avoid panics in library code
- keep modules focused

### TypeScript

- keep business logic out of React components
- use typed wrappers in `src/lib/tauri.ts`
- keep state updates in hooks and stores

## Questions Before Large Work

If you want to change:

- protocol flow
- transfer persistence model
- packaging behavior
- application navigation

open an issue or draft PR first.

That avoids wasted work and keeps the repo moving in a coherent direction.
