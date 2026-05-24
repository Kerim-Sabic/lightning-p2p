# Code Quality Notes

These notes summarize the launch-readiness audit and the changes made in this pass.

## Current Implementation Pass

- Added a release-state check that keeps package, Cargo, Tauri, stable release, experimental release, README, website metadata, and roadmap copy aligned.
- Added [BENCHMARKS.md](BENCHMARKS.md) as the public benchmark evidence index and changed the benchmark matrix helper to use the current package version dynamically.
- Aligned Android receive copy with current behavior: single-file receives publish to MediaStore buckets where possible, while folder receives remain app-private.
- Hid raw receive handoff tickets by default and documented that revealing/copying the raw ticket is sensitive.
- Added diagnostic redaction for ticket-like strings in frontend, Rust, and Android log tails before bundles are copied.
- Baseline checks after this pass: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check:release-state`, `cargo fmt --check`, `cargo test --lib`, and `cargo clippy --all-targets -- -D warnings` pass. The same non-integration baseline is available as `pnpm check:baseline`.
- The full Rust integration harness in `tests/transfer_test.rs` is compiled out on Windows. The manifest-less Cargo test executable imported `TaskDialogIndirect` from `comctl32.dll` before the Rust test harness started and exited with `STATUS_ENTRYPOINT_NOT_FOUND` (`0xc0000139`). Non-Windows `cargo test` still runs the end-to-end iroh transfer harness; Windows transfer coverage should use packaged-app smoke tests until a Cargo test host can embed the same Common Controls v6 activation context as the Tauri app.

## Fixed In This Pass

- Profile-scoped iroh identities: `LIGHTNING_P2P_PROFILE=alice` and `bob` no longer share the same keychain identity by default.
- App-data fallback identity files are profile-local and ignored by git.
- Share ticket creation no longer requires relay readiness when direct addresses are available.
- Raw receive tickets are no longer logged at info level during send.
- Receive destination selection moved out of React and into Rust settings-backed receive commands.
- Settings updates now serialize through the write lock instead of snapshotting under a read lock.
- Settings writes now go through a temp file and replace step.
- Invalid settings JSON is preserved as `settings.json.corrupt-*` before defaults are regenerated.
- Nearby discovery ignores self-discovery items, validates protocol versions, resubscribes when LAN discovery streams end, and keeps the previous snapshot when every peer query times out.
- `LightningP2PNode` no longer exposes its sled database as a public field.
- Android Tauri mobile entry point is present.
- Package metadata now pins Node/pnpm expectations and adds `pnpm check`.

## Highest Priority Remaining Issues

1. **Endpoint restart supervisor.** Relay mode and full local-network discovery changes are persisted, but the running endpoint is not rebuilt. Add a `NodeSupervisor` that can shut down/restart endpoint/router/discovery safely.
2. **Nearby discovery privacy.** Nearby active shares expose metadata to trusted LAN peers. Add an approval/pairing flow before exposing labels/hashes if this becomes a stronger privacy goal.
3. **Module size.** `node/nearby.rs`, `storage/settings.rs`, `transfer/receiver.rs`, and `transfer/progress.rs` are still larger than the preferred module size.
4. **Cancellation during export.** Receive cancellation is honored during download, but large export work still needs a cancellation token.
5. **Default test speed.** Full `cargo test` on Windows can take a long time because integration tests compile and start real iroh endpoints. Move multicast LAN smoke tests and large-directory transfer tests to ignored/manual suites.
6. **Android storage.** Android content URI import/export behavior still needs real-device validation and likely platform-specific adapter work.

## Testing Gaps To Fill Next

- IPC contract tests for command names and serialized `TransferEvent`/settings/nearby payloads.
- Nearby registry tests for dedupe, stable sorting, disabled-discovery clearing, and route-hint merge behavior.
- Settings tests for legacy JSON defaults, profile env path behavior, and path rejection when the destination is an existing file.
- Sender tests for empty selections, empty directories, and stable source summaries.
- Receiver tests for route-kind inference and error categorization.
- Manual LAN discovery smoke test on two Windows devices with firewall enabled and disabled.

## Architecture Smells Removed

- Frontend-owned receive destination path.
- Public database field on the node runtime.
- Global iroh keychain identity across profiles.
- Non-atomic settings writes.
- Raw ticket logging.

## Architecture Smells Still Present

- Tauri command/event primitives are still mixed into some core transfer flows.
- `AppState` is a service bag; a supervisor boundary would make lifecycle clearer.
- Local discovery settings do not yet control endpoint construction after startup.
- Android is wired as a foundation, not a proven shared-core mobile app yet.
