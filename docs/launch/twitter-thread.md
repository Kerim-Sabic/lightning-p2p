# Twitter / X — six-tweet thread

Hold every speed claim until the benchmark report is linked from the
website. Image suggestions noted under each tweet.

## Tweet 1 — hook

```
Send huge files between your devices. Directly. No cloud upload. No
account. No size cap.

Lightning P2P is an open-source desktop + Android app that streams
files peer-to-peer over iroh QUIC with BLAKE3 verification.

🧵
```

Image: 60s demo GIF (≤8 MB, ≤12 s).

## Tweet 2 — the problem

```
Cloud-drive uploads leave files in someone else's bucket. LAN-only
apps don't traverse NAT. CLI tools aren't normal-user-friendly. AirDrop
is Apple-only.

Lightning P2P fills the Windows + Android gap with a direct-first path
across LAN and WAN.
```

Image: side-by-side comparison strip (Lightning vs cloud/LAN/CLI/AirDrop).

## Tweet 3 — proof, not slogans

```
Real trust signals:
- Authenticode-signed Windows installers (Azure Trusted Signing)
- Published Android signer cert fingerprint
- SHA256SUMS for every release artifact
- verify-release.ps1 one-command verifier
- Automated same-machine benchmark harness in CI before any "fastest" claim

(link to README install + verify section + docs/release-evidence.md)
```

Image: screenshot of the verify command output.

## Tweet 4 — stack credit

```
Built with Rust + Tauri v2 + React 19. Transfer engine is iroh + iroh-
blobs — content-addressed streaming, no full-file buffering, BLAKE3
on every chunk.

Massive credit to @n0compute / @iroh_io for QUIC + relay infrastructure.
```

Image: 30-second architecture diagram clip.

## Tweet 5 — honest about scope

```
What it isn't:
- Audited (no external security audit yet)
- macOS / Linux / iOS-ready (roadmap)
- A sync tool (it's one-shot transfer)
- Faster than X (a same-machine harness ships in CI; real-device WAN
  numbers are still pending)

Everything is in SECURITY.md + the claims guardrail.
```

Image: snippet from `docs/BENCHMARKS.md` claims-guardrail section.

## Tweet 6 — close + link

```
Apache-2.0, GitHub-first, ships installers + sideload APK for every
release.

Repo: https://github.com/Kerim-Sabic/lightning-p2p
Download: https://github.com/Kerim-Sabic/lightning-p2p/releases/latest

Try it on a 1 GB file. See what direct-first actually feels like.
```

Image: success card screenshot (file saved, route Direct, time-to-first-byte).
