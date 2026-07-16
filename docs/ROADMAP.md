# Lightning P2P Roadmap

This roadmap follows the public release manifest in
[`src/content/release-manifest.json`](../src/content/release-manifest.json).
Platform, signing, browser, and benchmark claims must match that file and the
linked release evidence.

## Available now

### Stable channel

- Windows v0.4.6 through Velopack, NSIS, MSI, and published checksums.
- Android v0.5.1 as a signed sideload APK with share-target sends and public
  MediaStore destinations.

### v0.8.0 beta channel

- Windows, universal macOS DMG, Linux AppImage/deb/rpm, and CLI artifacts.
- BBR-backed Fast, Extreme, LAN Beast, and Warp profiles.
- Experimental swarm receive and ticket pre-warming.
- Browser send and receive beta using the Rust/WASM transfer engine. Browser
  peers are relay-only, memory-bound, and must remain open during transfer.
- Windows and Android remain the best-tested native paths. macOS and Linux
  artifacts are unsigned community builds until publisher credentials exist.

## Current work

### Reliability and recovery

- Make automatic retry state visible and keep verified iroh-blobs data across
  transient failures.
- Add explicit pause and restart-safe resume without storing raw capability
  tickets in plaintext.
- Complete Android folder publishing and collision tests on physical devices.
- Expand firewall, mDNS, relay, destination, and sender-offline diagnostics.

### Product experience

- Keep Send and Receive as the first two actions, with diagnostics and expert
  tuning available through progressive disclosure.
- Grow Smart Auto from platform-safe defaults only when LAN, WAN, relay, and
  mobile thermal benchmarks justify a change.
- Add Windows Explorer integration and improve QR, paste, nearby, picker, and
  share-sheet entry paths.
- Maintain reduced-motion, keyboard, screen-reader, 200 percent zoom, and
  narrow-phone acceptance coverage.

### Evidence and distribution

- Publish Windows-to-Windows, Windows-to-Android, WAN-direct, relay,
  many-small-file, browser, and 10 GB benchmark reports with raw receipts.
- Complete Winget, Homebrew cask, and AUR packaging after release assets are
  stable and verified.
- Add macOS notarization and broader signing only when publisher credentials
  are available.
- Replace preview artwork with recordings and screenshots from real transfers.

## Explicitly out of scope

- Native iOS during the current 90-day cycle. iPhone users can use the browser
  receiver within the published beta limits.
- Cloud file storage, accounts, chat, media playback, custom chunking, or a
  second networking protocol.
- “Fastest” claims without repeatable cross-device evidence.

## Release gates

A feature moves from beta to stable only after automated checks pass, its
artifacts and links are verified on a clean install, public copy matches the
release manifest, and required hardware evidence is published.
