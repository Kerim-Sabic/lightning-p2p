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

### v0.9.18 beta channel

- Windows, universal macOS DMG, Linux AppImage/deb/rpm, and CLI artifacts.
- Lightning Chat in the Windows and Android apps plus the `/chat` Web lounge.
- Encrypted direct messages, nearby iroh chat, and a Windows Bluetooth mesh.
- BBR-backed Fast, Extreme, LAN Beast, and Warp profiles.
- Experimental swarm receive and ticket pre-warming.
- Active transfer progress remains visible across app views in a persistent
  tray with phase, speed, pause state, and a shortcut to Activity.
- Incoming Flick offers are namespaced by authenticated sender identity to
  prevent offer identifier collisions across peers.
- Legacy transfer stores are preserved and the node starts with a compatible
  store rather than stalling during initialization. Slow storage initialization
  is allowed to finish safely instead of being aborted while the database is
  opening. Flick gestures work with mouse, touch, and stylus input, and show the
  sender's approximate screen-relative direction on arrival.
- Browser receive startup keeps active receives alive while the receiver view
  initializes, and legacy memory imports are bounded to prevent oversized
  fallback allocations.
- Browser send and receive beta using the Rust/WASM transfer engine. Browser
  peers are relay-only and must remain open during transfer. Sending is
  memory-bound with a 2 GiB cap; receive streams to disk where the File System
  Access API is available and otherwise has a 128 MiB aggregate memory cap.
- Windows and Android remain the best-tested native paths. macOS and Linux
  artifacts are unsigned community builds until publisher credentials exist.

## Current work

### Reliability and recovery

- Keep verified iroh-blobs data across transient failures and validate legacy
  store recovery against an older installed app's real transfer database.
- Receive pause and restart-safe resume are implemented on `main`; native
  credential-store validation across supported platforms remains.
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
- Cloud file storage, accounts, hosted message history, media playback, custom
  transfer chunking, or a second file-transfer protocol.
- “Fastest” claims without repeatable cross-device evidence.

## Release gates

A feature moves from beta to stable only after automated checks pass, its
artifacts and links are verified on a clean install, public copy matches the
release manifest, and required hardware evidence is published.
