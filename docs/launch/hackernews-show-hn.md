# Show HN — Lightning P2P (v0.9.0 launch)

> Launch **after v0.9.0 ships** (the in-browser receiver is the differentiator
> and pre-empts HN's first objection, "both sides need your app"). Use the
> v0.8.0 r/rust rehearsal (`reddit-rust-v0.8-rehearsal.md`) first. HN is
> one-shot — don't spend it before the browser receiver is live.

## Title (≤80 chars)

```
Show HN: Lightning P2P – send a file, receive it in any browser, no account
```

Alternates if the slot is taken:

- `Show HN: Lightning P2P – P2P file transfer that receives in the browser (Rust/iroh)`
- `Show HN: Lightning P2P – the same Rust engine on desktop, phone, and in-browser`

## Body (≤2000 chars; HN strips formatting except links)

```
Hi HN — Lightning P2P sends files directly between devices over iroh QUIC,
BLAKE3-verified on every chunk. No cloud upload, no account, no file-size
cap. Free, Apache-2.0.

The thing I'm proudest of in this release: you can receive a file in any
browser with nothing installed. The receive page runs the exact same Rust
transfer engine (iroh + iroh-blobs) compiled to WebAssembly, dials the
sender directly over iroh's relay, and verifies BLAKE3 in the tab. There is
no HTTP file server in the middle — the bytes never touch our infrastructure.

It started because I kept hitting the same wall: a 6 GB video from a Windows
laptop to an Android phone in another country. WeTransfer uploads and retains
it on someone else's bucket. LocalSend is LAN-only. croc/Wormhole are
CLI-only. AirDrop is Apple-only. iroh's QUIC + relay-fallback makes
direct-first transfer practical across NAT, so I wrapped it in Tauri and,
now, WASM.

Ships everywhere:
- Desktop: Windows (Velopack/NSIS/MSI), macOS (universal DMG), Linux
  (AppImage/deb/rpm).
- Android APK with a published signer fingerprint.
- CLI: `lightning-p2p-cli send big.iso` prints a ticket to stdout; pipe it.
- Browser: open the receive link, receive in the tab. No install.

What it isn't:
- A hosted bucket. The sender stays online; bytes stream peer-to-peer
  (browser peers are relay-only, so expect LAN/direct to be faster).
- Audited. No external security audit yet.
- "Fastest." I refuse to claim speed leadership without a real-device
  benchmark matrix. There's a reproducible loopback harness in-repo
  (pnpm bench:local); it is not a WAN or competitor claim.

Source, releases, security + threat model, benchmarks:
https://github.com/Kerim-Sabic/lightning-p2p

Happy to go deep on compiling iroh to WASM, the relay-only browser trade-off,
Tauri v2 across four OSes + Android, or the anti-hype claims guardrail.
```

## Prepared replies

### Q: "If it's in the browser, where do the bytes actually go?"

> Directly from the sender to your tab. The receive page is the Rust
> iroh/iroh-blobs engine compiled to WebAssembly; it opens an iroh
> connection (relay-over-WebSocket in the browser) straight to the sender
> and verifies each BLAKE3 chunk in-page. Our site serves static files and
> the wasm bundle — it never sees your file bytes, and there's no HTTP
> upload/download server. Browser peers are relay-only (no hole punching in
> a tab), so the native app's direct path is faster for big transfers.

### Q: "How is this different from LocalSend / PairDrop / croc / Wormhole?"

> LocalSend is great on LAN but doesn't traverse NAT. PairDrop is browser +
> WebRTC; we use iroh QUIC with relay fallback and ship a native engine that
> also compiles to WASM, so desktop, phone, CLI, and browser all run the
> same Rust code. croc and Magic Wormhole are CLI-only PAKE tools — we have
> a CLI too (`lightning-p2p-cli`), but also a GUI, QR/handoff links, and the
> in-browser receiver. On speed: there's a reproducible in-repo loopback
> harness; real-device WAN/Wi-Fi numbers and competitor comparisons need a
> matrix I haven't published, so I don't claim them.

### Q: "Why should I trust an unsigned installer?"

> Windows installers are Authenticode-signed via Azure Trusted Signing on
> the signed CI path; the community path is unsigned with SHA256SUMS and a
> one-command verify-release.ps1. macOS community builds are unsigned
> (right-click → Open or `xattr -cr`), notarization is tracked. Android APKs
> are signed with our keystore; the signer cert SHA-256 is in the README
> with `apksigner verify` steps.

### Q: "What happens if I lose connectivity mid-transfer?"

> The transfer fails with a structured error (sender_offline /
> connection_timeout / relay_unavailable by phase). Partial verified bytes
> stay in the receiver's store, so re-pasting the same ticket resumes and
> only fetches what's missing (iroh-blobs is content-addressed). The native
> app surfaces a Retry hint when the error is retryable.

### Q: "Isn't the whole app on an unmaintained iroh version?" (pre-empt)

> This release is the iroh 1.0 migration — the browser receiver is only
> possible on the 1.0 line, and iroh's 1.0 gives a wire-stability guarantee
> so a v1 desktop and a v1 browser interoperate regardless of minor version.
