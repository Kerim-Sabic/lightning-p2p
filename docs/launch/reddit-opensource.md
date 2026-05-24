# r/opensource

## Title

```
Lightning P2P – Apache-2.0 file transfer app for Windows + Android, no cloud upload
```

## Body

```
Lightning P2P is an Apache-2.0 open-source app that moves files directly
between your devices. No cloud upload, no account, no artificial file-
size cap. Built for the cases where you wouldn't want WeTransfer or a
shared drive in the loop.

Why it might matter to people here:

- The sender keeps the file. Bytes never sit in a third-party bucket
  or behind a retention link.
- Cross-network. Direct QUIC where it works, relay-assisted only when
  direct dialing fails. Not LAN-only.
- Trust surface is real. Signed Windows installers (Authenticode via
  Azure Trusted Signing), published Android signer cert fingerprint,
  SHA256SUMS for every artifact, and a verify-release.ps1 script.
- Anti-hype claims guardrail. We refuse to publish "fastest" or
  comparison claims without measured, reproducible data. An automated
  same-machine harness (docs/reports/automated-local-benchmarks.md)
  runs on every CI push and produces raw CSV/JSON. Real-device WAN +
  Android numbers are still pending and are explicitly held.

What it isn't:

- Not audited. No external security audit has been published.
- Not multiplatform (yet). Windows and Android are the stable targets.
  macOS / Linux / iOS are on the roadmap.
- Not a sync tool. It's a one-shot transfer flow with a receive ticket.

Open contributions welcome — there's a contributing guide and a release
checklist. Good-first-issue labels are getting populated this month.

Repo: https://github.com/Kerim-Sabic/lightning-p2p
Privacy + threat model: https://github.com/Kerim-Sabic/lightning-p2p/blob/main/SECURITY.md
```
