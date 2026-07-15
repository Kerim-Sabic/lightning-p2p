# r/rust — v0.8.0 rehearsal post (available now)

> Post this **now** (v0.8.0 is out), well before the v0.9.0 Show HN. It's a
> low-key "progress" share, not a launch: it seeds r/rust, surfaces early
> issues, and lets you practice replying before the one-shot HN moment.
> r/rust likes honest engineering progress and dislikes marketing — match
> that tone. Weekday morning US/EU.

## Title

```
Lightning P2P v0.8.0 — my Rust/iroh file-transfer app now runs on Windows, macOS, Linux, Android, and a CLI from one codebase
```

## Body

```
Sharing a progress update rather than a launch — the big one (in-browser
receiver via WASM) is still cooking.

Lightning P2P is a direct P2P file-transfer app: iroh for QUIC transport,
iroh-blobs for content-addressed, BLAKE3-verified streaming. No cloud
upload, no account. Apache-2.0.

v0.8.0 is the "everywhere" release. What was interesting to build in Rust:

- One engine, five front-ends. The transfer core (src-tauri/src/node +
  transfer) is GUI-independent, so the Tauri desktop app, the Android
  build, and a new `lightning-p2p-cli` all call the same
  create_share / receive_ticket paths. Tickets are byte-identical across
  all of them.
- The CLI is a separate console binary, not arg-sniffing in the GUI exe —
  the GUI uses the Windows GUI subsystem and can't write to stdout, which
  would silently break `lightning-p2p-cli send file | ...` piping. Small
  thing, easy to get wrong.
- macOS/Linux "just worked" at the code level because the networking was
  already cfg-gated cleanly; the work was bundle targets + CI runners +
  window-chrome polish (native traffic lights vs. the custom titlebar).
- A gnarly one: on Android, tao 0.35 stopped initializing ndk-context, so
  the first JNI call aborted the app under panic=abort. Fix was to install
  the (JavaVM, Context) pair myself from MainActivity via a typed JNI
  export and make every bridge helper fail soft. CI now launches the
  release APK on an emulator and greps logcat for the exact signature.

Try the CLI in ~1 min:
    lightning-p2p-cli send some-file        # prints a ticket to stdout
    lightning-p2p-cli receive <ticket> -o . # BLAKE3-verified into ./

Repo (source, releases, benchmarks, security model):
https://github.com/Kerim-Sabic/lightning-p2p

Not claiming speed leadership — there's a reproducible loopback bench in
the repo but no real-device WAN matrix yet, so I don't quote competitor
numbers. Feedback on the CLI ergonomics and the multi-target build setup
especially welcome.
```

## Prepared replies

### Q: "Why iroh over libp2p / plain QUIC / WebRTC?"

> iroh gave me direct-first QUIC with relay fallback and NAT traversal in
> one crate, plus iroh-blobs for content-addressed BLAKE3 streaming so I'm
> not reinventing chunking/resume. It also compiles to WASM, which is what
> makes the upcoming in-browser receiver possible on the same engine —
> that sold me over rolling my own or using WebRTC data channels.

### Q: "How big is the CLI binary / what are the deps?"

> It's behind a `cli` feature (clap only pulls in for that build), shipped
> as a standalone tarball per platform, not bundled into the installers.
> Reuses the whole existing engine so there's no duplicate transfer logic.

### Q: "macOS build signed?"

> Community builds are unsigned right now (right-click → Open, or
> `xattr -cr`); notarization is tracked as an issue. Windows has an
> Authenticode-signed path via Azure Trusted Signing; Android APKs are
> keystore-signed with a published cert fingerprint.
```
