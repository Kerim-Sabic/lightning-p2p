# Show HN — Lightning P2P

## Title (≤80 chars)

```
Show HN: Lightning P2P – direct P2P file transfer for Windows and Android
```

Alternates if the slot is taken:

- `Show HN: Lightning P2P – send huge files without cloud upload (Rust + iroh)`
- `Show HN: Lightning P2P – Rust + Tauri + iroh QUIC, no cloud, no account`

## Body (≤2000 chars; HN strips formatting except links)

```
Hi HN — Lightning P2P is a free, Apache-2.0 desktop and Android app that
sends files directly between two devices over iroh QUIC, with BLAKE3
verification on every chunk. No cloud upload. No account. No artificial
file-size cap.

It exists because I kept hitting the same wall: a 6 GB video that needed
to go from a Windows laptop to an Android phone in a different country.
WeTransfer would upload + retain it on a third-party bucket. LocalSend
only works on LAN. Croc and Magic Wormhole are CLI-only. AirDrop is
Apple-only. iroh's QUIC + relay-fallback finally makes direct-first
transfer practical across NAT, so I wrapped it in Tauri v2 with a
React 19 UI.

What it is:
- Rust backend (iroh + iroh-blobs streaming, no full-file buffering).
- Direct-first across LAN and WAN; relay fallback when direct fails.
- BLAKE3 content-addressed verification on every chunk.
- Windows installers: signed Velopack (delta updates), NSIS, MSI.
- Android APK + AAB with published signer cert fingerprint.
- Browser receive-handoff page that drops you back into the native app.

What it is not:
- A hosted cloud bucket. The sender stays online; bytes stream peer-to-peer.
- Audited. No external security audit yet.
- Cross-platform-complete. macOS / Linux / iOS are roadmap.
- Faster than X. We refuse to claim speed leadership without a published
  benchmark report; the methodology is in docs/BENCHMARKS.md and the
  first matrix run lands with v0.5.0.

Source, releases, security model, threat model, and roadmap:
https://github.com/Kerim-Sabic/lightning-p2p

Happy to answer anything about iroh, Tauri v2 on Windows + Android, the
signing flow, the diagnostics-redaction layer, or the anti-hype claims
guardrail.
```

## Prepared replies

### Q: "How is this different from LocalSend / PairDrop / Croc?"

> LocalSend is excellent on LAN but doesn't traverse NAT. PairDrop runs
> in the browser and relies on a WebRTC relay; Lightning P2P uses iroh
> QUIC with relay fallback and a native installer, so the threat model
> and trust surface are different. Croc is CLI-only and uses PAKE
> phrases; Lightning P2P trades the code phrase for QR + handoff link
> and a real native UI. We're not faster until we publish the benchmark
> report (docs/BENCHMARKS.md).

### Q: "Why should I trust an unsigned installer?"

> Windows installers are Authenticode-signed via Azure Trusted Signing
> when our signed CI path runs. The community path produces an unsigned
> build with SHA256SUMS and a verify-release.ps1 script — verification
> is one command. Android APKs are signed with our keystore; the
> signer certificate SHA-256 is published in the README and in
> docs/android-trust.md, and we ship `apksigner verify` instructions.

### Q: "What happens to my files if I lose connectivity mid-transfer?"

> The transfer fails with a structured error (sender_offline,
> connection_timeout, or relay_unavailable depending on phase). The
> partial bytes stay local on the receiver; you can retry from the
> same ticket while the sender is still online. iroh-blobs handles
> resumable streaming; we surface that to the UI via a Retry hint when
> the error code is marked retryable.
