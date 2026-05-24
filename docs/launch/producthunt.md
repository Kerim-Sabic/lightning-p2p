# Product Hunt

## Title (≤40 chars)

```
Lightning P2P
```

## Tagline (≤60 chars)

```
Send huge files device-to-device. No cloud. No account.
```

Alternates:

- `Direct file transfer for Windows + Android, no cloud upload`
- `Peer-to-peer file transfer that respects your bytes`

## Description (≤260 chars on the card)

```
Free, open-source desktop + Android app for direct peer-to-peer file
transfer. Rust + Tauri + iroh QUIC + BLAKE3 verification. No cloud
upload, no account, no artificial size cap. Signed installers. Apache-
2.0. Sender stays online; bytes stream peer-to-peer.
```

## Topics

`Open Source`, `Developer Tools`, `Productivity`, `File Sharing`,
`Privacy`.

## Gallery

- 1280×720 hero: app at the moment a 1 GB transfer is mid-stream,
  Direct route chip lit, signal-green tone.
- 1280×720: receive success card (Saved to, Open folder, Send another).
- 1280×720: Windows installer screen (Velopack).
- 1280×720: Android share-target → ticket → QR.
- Demo MP4 (≤30 s): cold start → drop file → QR → receiver scans →
  streaming → success.

## Maker's first comment (post immediately after submission)

```
Hey 👋

Lightning P2P is the result of needing to move a 6 GB video from a
Windows laptop to an Android phone across networks without uploading
to anyone in the middle. WeTransfer would have retained it on a third-
party bucket. LocalSend doesn't traverse NAT. Croc and Magic Wormhole
are CLI-only. So I built the path I wanted.

The transfer engine is iroh (QUIC + relay fallback) and iroh-blobs
(BLAKE3-verified streaming) under a Tauri v2 + React 19 shell. The
Rust backend owns all networking, verification, and persistence; the
frontend is purely presentational.

Honest about scope:
- Windows and Android are the stable targets today.
- macOS, Linux, and iOS are on the roadmap, not shipping.
- No external security audit yet.
- We refuse to publish "fastest" claims without a measured benchmark
  report. The methodology is at docs/BENCHMARKS.md; the first report
  lands with v0.5.0.

Apache-2.0, fully open source: https://github.com/Kerim-Sabic/lightning-p2p

Happy to answer anything technical or product. The trickiest design
problem was the multi-provider ShareTicket + structured error model
that the entire frontend UX hangs off of.

Thanks for taking a look 🙏
```

## Pinned FAQ replies

- "Is the source open?" → Apache-2.0, repo linked above.
- "Will it work between my Mac and my phone?" → macOS is roadmap; Windows + Android today.
- "Is this end-to-end encrypted?" → QUIC TLS through iroh. The receiver verifies every chunk with BLAKE3. The ticket is the capability; treat it as a secret.
- "Does my file ever touch a server?" → No. iroh's relay can carry bytes when direct dialing fails, but the relay is connectivity help, not storage.
