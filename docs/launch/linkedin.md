# LinkedIn — single long-form post

Audience skews older and more privacy-/compliance-conscious than HN or
Reddit. Lead with the no-cloud-upload privacy angle, then the technical
proof.

## Post

```
Most file transfer today routes your bytes through someone else's
storage bucket. Email attachments cap out, cloud drives need accounts
and leave a retention link behind, and LAN-only apps don't work
between networks.

I just open-sourced Lightning P2P — a direct peer-to-peer file
transfer app for Windows and Android. The sender keeps the file. The
receiver pulls verified bytes. Nothing sits in a third-party bucket.

What's under the hood:
• Rust transfer engine on iroh QUIC with relay fallback
• BLAKE3 content-addressed verification on every chunk
• Tauri v2 desktop + Android shell with React 19
• Authenticode-signed Windows installers, published Android signer
  cert fingerprint, SHA256 checksums for every release
• Apache-2.0 license, full source on GitHub

What it deliberately is not:
• A hosted cloud product
• Marketed as "the fastest" — speed claims wait for the public
  benchmark report we're publishing with v0.5.0
• An audited security product — there is no external audit yet
• A macOS / Linux / iOS app — those are roadmap

If you've ever needed to move a 5 GB build, a raw camera dump, or a
patient case file between two of your own devices without uploading
to anyone first, this is for you.

Repo + downloads: github.com/Kerim-Sabic/lightning-p2p

Open to thoughtful feedback, especially from anyone working in
healthcare IT, legal, M&E, or any field where "uploaded to a cloud
bucket" is itself the wrong answer.
```

## Hashtags (3–5; LinkedIn caps recommended visible usage)

`#OpenSource` `#Privacy` `#Rust` `#FileTransfer` `#PeerToPeer`
