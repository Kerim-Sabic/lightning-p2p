# r/selfhosted

Sub rules check: tools that reduce reliance on third-party clouds are
on-topic. Be honest that this is one-shot transfer, not sync — don't
position it against Syncthing or Nextcloud.

## Title

```
Lightning P2P – send files between your machines without uploading to anyone
```

## Body

```
Lightning P2P is a free, Apache-2.0 desktop and Android app for direct
peer-to-peer file transfer. The point: when you need to move a file
between two of your own devices, you should not have to upload it to
anyone first.

How it fits a self-hosted setup:

- No external service required. No account, no relay you have to run,
  no third-party storage. iroh provides a public relay infrastructure
  as fallback when direct dialing fails — that's the only outside
  component, and only if direct doesn't work.
- Streaming transfer with BLAKE3 verification. The receiver does not
  trust the path; every chunk is content-addressed and checked.
- Signed Windows installer (Authenticode), published Android signer
  cert fingerprint, SHA256SUMS for every release, verify-release.ps1
  script — so you can validate what you're installing on your own
  iron.
- The sender stays online during the transfer. This is one-shot
  transfer, not a sync daemon. Use Syncthing if you need sync.

What it doesn't do:

- It is not a replacement for Nextcloud / Syncthing / Seafile.
- The macOS / Linux / iOS clients are not stable yet.
- There is no self-hosted relay knob in the UI yet — you can disable
  relay fallback in settings and force direct-only, but you cannot
  point at your own custom relay through the GUI today.
- No published real-device speed numbers yet. The automated same-
  machine harness lives at docs/reports/automated-local-benchmarks.md;
  a full WAN/Wi-Fi/Android matrix needs real hardware and is pending.

Repo: https://github.com/Kerim-Sabic/lightning-p2p
Threat model: https://github.com/Kerim-Sabic/lightning-p2p/blob/main/SECURITY.md
```
