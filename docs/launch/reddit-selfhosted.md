# r/selfhosted

Sub rules check: tools that reduce reliance on third-party clouds are
on-topic. Be honest that this is one-shot transfer, not sync — don't
position it against Syncthing or Nextcloud.

## Title

```
Lightning P2P – move files between your machines without uploading to anyone (now with a CLI)
```

## Body

```
Lightning P2P is a free, Apache-2.0 P2P file-transfer tool. The point:
when you need to move a file between two of your own devices, you should
not have to upload it to anyone first.

The bit for this crowd — a real CLI:

    lightning-p2p-cli send backup.tar.zst   # prints a ticket to stdout
    lightning-p2p-cli receive <ticket> -o /mnt/data

Ticket to stdout, everything else to stderr, so it pipes cleanly
(`... | qrencode -t ansiutf8`, or straight into another box over SSH).
Same iroh + iroh-blobs engine as the GUI, BLAKE3-verified, direct-first
with relay fallback across NAT.

How it fits a self-hosted setup:

- No external service required. No account, no relay you have to run,
  no third-party storage. iroh's public relay is fallback-only, used
  only when direct dialing fails.
- Content-addressed + BLAKE3. The receiver doesn't trust the path;
  every chunk is verified. Interrupted? Re-paste the ticket, it resumes
  and only fetches what's missing.
- Ships for Windows, macOS (universal DMG), Linux (AppImage/deb/rpm),
  Android, plus the CLI tarballs. SHA256SUMS + verify-release.ps1 for
  every release; Android APK signer fingerprint published.
- Sender stays online during the transfer. This is one-shot transfer,
  not a sync daemon — use Syncthing if you need sync.

What it doesn't do:

- Not a replacement for Nextcloud / Syncthing / Seafile.
- macOS/Linux are fresh (v0.8.0) and unsigned community builds.
- No custom-relay knob in the GUI yet (you can force direct-only).
- No published real-device speed numbers — there's a reproducible
  loopback harness in-repo, but a WAN/Wi-Fi/Android matrix needs real
  hardware and is pending, so I don't quote competitor numbers.

Coming next: receive a file in any browser with nothing installed (the
same Rust engine compiled to WASM). Happy to talk about that too.

Repo: https://github.com/Kerim-Sabic/lightning-p2p
Threat model: https://github.com/Kerim-Sabic/lightning-p2p/blob/main/SECURITY.md
```
