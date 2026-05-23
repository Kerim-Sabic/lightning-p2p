# Lightning P2P Press Kit

Use this page when writing about Lightning P2P, listing it in directories, or
posting it to developer communities. Keep claims specific and verifiable.

## Short Description

Lightning P2P is a free Apache-2.0 peer-to-peer file transfer app for Windows
and Android. It sends files directly between devices with iroh QUIC,
iroh-blobs, BLAKE3 verification, no account, no cloud upload, and no artificial
file-size cap.

## Tagline

Direct peer-to-peer file transfer for Windows and Android. No cloud upload. No
account. No artificial file-size cap.

## Stable Release

- Current stable: `v0.4.6`
- Stable release URL: <https://github.com/Kerim-Sabic/lightning-p2p/releases/latest>
- Experimental pre-release: `v0.5.0` for BLE/NFC discovery and ticket handoff
- License: Apache-2.0
- Citation: [CITATION.cff](../CITATION.cff)

## What Makes It Different

- It is direct-first: file bytes stream from sender to receiver instead of being
  uploaded to a hosted cloud storage link.
- It uses iroh for encrypted QUIC connectivity and relay-assisted fallback.
- It uses iroh-blobs for BLAKE3-verified content-addressed transfer.
- It ships Windows installers and an Android 10+ sideload APK with checksums.
- It has no account, no email capture, no paid tier, and no artificial file-size
  cap.

## Accurate Comparison Copy

### AirDrop For Windows

Lightning P2P is an AirDrop-style app for Windows and Android users who want
direct file transfer outside the Apple ecosystem. It does not claim Apple
AirDrop protocol compatibility.

### WeTransfer Alternative

WeTransfer creates hosted cloud links. Lightning P2P keeps the file on the
sender and lets the receiver pull verified bytes directly while the sender is
online.

### LocalSend Alternative

LocalSend is broader cross-platform LAN sharing today. Lightning P2P focuses on
Windows and Android direct-first LAN/WAN transfer with iroh QUIC, relay fallback,
and BLAKE3 verification.

### Magic Wormhole Alternative

Magic Wormhole is a strong CLI tool. Lightning P2P gives Windows and Android
users a graphical app with QR/link ticket handoff, transfer history, and native
installers.

## Claims To Avoid

- Do not claim Apple AirDrop compatibility.
- Do not claim third-party security audit coverage.
- Do not claim speed leadership without a published benchmark report.
- Do not say files never touch infrastructure; relay and discovery infrastructure
  can help connectivity. Say there is no hosted cloud file upload step.
- Do not say Windows artifacts are always Authenticode-signed. Community builds
  may be unsigned; checksums are published.

## Official Links

- Website: <https://lightning-p2p.netlify.app/>
- GitHub: <https://github.com/Kerim-Sabic/lightning-p2p>
- Latest release: <https://github.com/Kerim-Sabic/lightning-p2p/releases/latest>
- Security model: [SECURITY.md](../SECURITY.md)
- Privacy: [PRIVACY.md](../PRIVACY.md)
- Roadmap: [ROADMAP.md](ROADMAP.md)

## Suggested Community Post

Title:

```text
Lightning P2P: open-source direct file transfer for Windows and Android, no cloud upload
```

Body:

```text
I built Lightning P2P, a free Apache-2.0 file transfer app for Windows and
Android. It uses Rust, Tauri, iroh QUIC, iroh-blobs, and BLAKE3 verification.

The goal is simple: send large files directly between devices without creating
an account, uploading to a hosted cloud link, or hitting an artificial file-size
cap. Windows installers and an Android 10+ sideload APK are available from
GitHub Releases with SHA256 checksums.

Current stable release: v0.4.6.
Experimental v0.5.0 adds BLE/NFC ticket handoff, but file bytes still move over
iroh QUIC.

GitHub: https://github.com/Kerim-Sabic/lightning-p2p
Website: https://lightning-p2p.netlify.app/
```

## Assets

- README demo: [public/demo-lightning-p2p.gif](../public/demo-lightning-p2p.gif)
- Social preview candidate:
  [public/github-social-preview.png](../public/github-social-preview.png)
- Open Graph image: [public/og-image.png](../public/og-image.png)
- Logo: [public/site-logo.png](../public/site-logo.png)
