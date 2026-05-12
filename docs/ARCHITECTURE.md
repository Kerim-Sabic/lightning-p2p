# Lightning P2P Architecture

Lightning P2P has two runtimes:

- **Browser runtime:** marketing site, SEO pages, and receive handoff. It does not transfer files.
- **Native runtime:** Tauri desktop/mobile shell plus Rust transfer engine. Real transfers run here.

Receive handoff links use `/receive#t=<ticket>`. The ticket stays in the URL fragment so it is not sent to the website server in normal HTTP requests.

## Boundaries

| Area | Owner | Notes |
| --- | --- | --- |
| Transfer engine | Rust | iroh endpoint, iroh-blobs import/fetch/export, BLAKE3 verification |
| Discovery | Rust | iroh local-network discovery, nearby-share ALPN protocol, registry state |
| Persistence | Rust | sled history/peer cache, settings JSON, profile-scoped iroh identity |
| UI state | TypeScript | view state, optimistic UX, event subscriptions |
| IPC | Tauri | typed wrappers in `src/lib/tauri.ts`; no frontend direct networking |
| Website SEO/AEO | TypeScript/scripts | `src/content/web-pages.json` plus `scripts/build-web-metadata.mjs` |
| Platform shell | Tauri/Android/iOS | thin platform adapters only |

## Rust Module Map

```text
src-tauri/src/
  commands/      Tauri command handlers and payload mapping
  crypto/        profile-scoped iroh identity key loading
  node/          iroh endpoint, runtime status, nearby discovery/protocol
  storage/       sled database, transfer history, peers, settings
  transfer/      sender, receiver, export, destination, progress, metrics
  telemetry/     tracing setup and diagnostics
  error.rs       application error type
  lib.rs         Tauri setup, managed state, command registration
```

The current crate remains intentionally single-crate. The next architecture step is not a workspace split; it is extracting smaller Rust modules behind the same crate interface so the core remains easy to test and Android can reuse it.

## Transfer Flow

1. React calls a typed Tauri wrapper in `src/lib/tauri.ts`.
2. A Tauri command validates arguments and delegates to Rust transfer code.
3. Sender imports files into iroh-blobs and creates a `BlobTicket`.
4. Receiver parses the ticket, fetches through iroh-blobs, verifies content, and exports to the configured download directory.
5. Rust emits transfer events; React renders progress.
6. Rust persists history/peer records.

The frontend does not choose receive destinations anymore. It asks Rust to receive, and Rust uses the persisted settings snapshot.

## Nearby Discovery Flow

1. The iroh endpoint enables local-network discovery where the platform supports it.
2. A background loop subscribes to iroh discovery events and keeps a candidate map.
3. Candidates are queried over `lightning-p2p/nearby-share/1`.
4. The nearby protocol returns active-share metadata only when local discovery is enabled.
5. The registry normalizes, dedupes, and sorts records before emitting UI updates.
6. If all peer queries fail during a refresh, the previous snapshot is retained to avoid flicker.

Important caveat: the current settings toggle controls nearby share listings and active-share responses. It does not yet rebuild the iroh endpoint to disable all local-network connectivity metadata.

## Identity and Profiles

The iroh endpoint identity is persistent and profile-scoped:

- OS keychain is preferred.
- Keychain account names are scoped by data-directory fingerprint.
- The old global keychain entry is only migrated for the default profile.
- If keychain storage is unavailable, a profile-local `iroh-secret-key.hex` fallback is used.

This prevents `LIGHTNING_P2P_PROFILE=alice` and `LIGHTNING_P2P_PROFILE=bob` from sharing a `NodeId`.

## Android Foundation

The Rust crate already builds as `lib`, `staticlib`, and `cdylib`, and `lib.rs` exposes the Tauri mobile entry point. Android remains alpha until these are verified on real devices:

- file picker/content URI import path
- receive/export path behavior under scoped storage
- QR scanner permission flow
- local-network discovery and multicast behavior
- Windows-to-Android and Android-to-Windows transfers
- signed APK/AAB install path

See [android-alpha.md](android-alpha.md).

## Next Architecture Improvements

- Split `node/nearby.rs` into registry, candidates, and loop modules.
- Split `storage/settings.rs` into model, path resolution, and file persistence modules.
- Add a node supervisor so relay/local-discovery settings can restart the endpoint safely.
- Add event-sink traits so Rust core code is less coupled to Tauri `Window`/`AppHandle`.
- Add IPC contract tests for command names and serialized event payloads.
