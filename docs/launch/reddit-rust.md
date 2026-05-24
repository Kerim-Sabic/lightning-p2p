# r/rust

Sub rules check: link posts with code are welcome. Self-promotion is OK
for personal projects with substance. Avoid the "I built X with Rust"
title — lead with what it does.

## Title

```
Lightning P2P – direct file transfer (iroh QUIC + iroh-blobs streaming) wrapped in Tauri v2
```

## Body

```
A free, Apache-2.0 desktop and Android app for direct peer-to-peer file
transfer. Rust backend, Tauri v2 frontend, iroh for QUIC + relay, and
iroh-blobs for BLAKE3-verified streaming. Files never sit in a third-
party bucket.

The interesting parts for r/rust:

- **iroh + iroh-blobs**: streaming receive, no full-file buffering. The
  receiver consumes a custom `ShareTicket` (legacy `blob…` and a new
  `fd2:` multi-provider format) and uses `download_with_opts` against
  `Vec<NodeAddr>` for swarm-style multi-provider downloads.
- **Structured errors**: `AppErrorPayload` schema v1 with 17 stable
  codes, 12 categories, 4 severities, `retryable`, `docs_slug`,
  `redacted_diagnostics`. All Tauri commands return
  `CommandResult<T> = Result<T, Box<AppErrorPayload>>`. The TypeScript
  layer mirrors the type and normalizes legacy strings.
- **Diagnostics redaction**: covers `fd2:`/`blob` tickets, lightning-
  p2p://receive deep links, `?t=` / `?ticket=` params, and home/app-
  data paths. Tested on both sides; 8 edge-case tests including
  unicode whitespace and mixed legacy + fd2 in one line.
- **Tauri v2 on Android**: real APK + AAB build with `apksigner verify`
  in CI, share-target intent filter, MediaStore export, content://
  import. Sender stays online; receiver streams.

Architecture invariants we don't break: all networking via iroh, all
blob transfer via iroh-blobs, all frontend↔backend through Tauri IPC,
no raw sockets, no `unwrap` in library code.

Repo: https://github.com/Kerim-Sabic/lightning-p2p
Security model: https://github.com/Kerim-Sabic/lightning-p2p/blob/main/SECURITY.md
Benchmarks (methodology, no claims yet):
https://github.com/Kerim-Sabic/lightning-p2p/blob/main/docs/BENCHMARKS.md

Feedback on the iroh integration patterns especially welcome.
```
