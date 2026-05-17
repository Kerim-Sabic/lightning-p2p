## Lightning P2P v0.5.0 — Android polish + experimental BLE/NFC

This is a pre-release. It is **not** marked as latest or stable: physical-device acceptance is left to early users on their own hardware. The build passes the CI emulator launch smoke and ships with the new content-URI bridge, smart MediaStore routing, system share-target, a refreshed launcher icon, and **experimental** Bluetooth LE proximity discovery + NFC tap-to-transfer.

### What's in this release

- **Send actually works on Android.** Fixed the `io error: no such file or directory` failure caused by the system file picker handing back `content://` SAF URIs. A new JNI bridge resolves those URIs into app-private cache before iroh-blobs sees them.
- **Smart save routing.** Received single files auto-publish into `MediaStore` collections — images to **Pictures**, video to **Movies**, audio to **Music**, other files to **Downloads**. Each lands in a `Lightning P2P` subfolder so received content appears alongside your existing media in Gallery and Files. Folder transfers still stage app-private for this release.
- **System share-target.** Lightning P2P appears in Android's share sheet for image / video / audio / application MIMEs and `*/*`. Tapping it from Gallery / Files / browser opens the app with the file pre-selected and the receive ticket **auto-generated** — zero extra taps.
- **New launcher icon.** The two-tone blue lightning H mark.
- **Mobile UX polish.** Mobile-hero CTAs with 44px+ touch targets, friendly empty states, four-bucket smart-routing info panels in Settings and FirstRun, fixed the mobile tab bar to render all five tabs correctly.
- **Experimental BLE proximity discovery.** Android `BluetoothLeAdvertiser` broadcasts a Lightning P2P service UUID carrying a `NodeId` short-prefix; `BluetoothLeScanner` listens for matching beacons. Windows uses WinRT `BluetoothLEAdvertisementPublisher` + `Watcher`. Discovered peers feed the existing `register_ble_candidate` registry so they appear in the Devices view. **BLE only carries the discovery beacon — file bytes still ride on iroh QUIC + iroh-blobs.**
- **Experimental NFC tap-to-transfer.** Tap two Android phones back-to-back: the sender's active ticket is broadcast as an NDEF message; the receiver's NFC handler parses the ticket and seeds the Receive view. **NFC only carries the ticket — file bytes still ride on iroh QUIC + iroh-blobs.**
- **Same Windows package surface** as prior releases.

### Heads-up: minSdk bump

`minSdk` moved from 24 → 29 (Android 10+). Devices on Android 7.0 – 9.0 will no longer install this build (~3% of the 2026 install base). This trade enables scoped `MediaStore` writes without requesting `WRITE_EXTERNAL_STORAGE` and is required for the modern BLE permission model.

### About AirDrop / Google Quick Share interop

[Google announced](https://blog.google/products-and-platforms/platforms/android/new-android-updates/) Quick Share ↔ AirDrop interop on Pixel 10/9/8A, Galaxy S26, OPPO Find X9/N6, Vivo X300 Ultra (rolling to more). **That is OS-level firmware integration, not an app-level API.** No third-party Android or iOS app can register as an AirDrop receiver or speak AWDL today. Lightning P2P's cross-platform path is the iOS Lightning P2P app on the roadmap — both ends running Lightning P2P, transferring over iroh QUIC. This release does **not** claim AirDrop or Quick Share interop.

### What is verified

- Rust clippy + unit tests
- Frontend lint + typecheck + production build
- Windows package smoke
- Android APK + AAB build
- Android signed release APK verification
- Android signed release APK launches on the CI emulator with no fatal logcat patterns

### What is still pending (experimental gates)

- **Physical Android phone acceptance** against this build. Until a user runs `scripts\android-physical-acceptance.ps1` on a connected phone, treat the APK as a pre-release.
- **BLE proximity discovery** has been emulator-built but not validated on two real phones. The first user to test with two Android phones at close range will surface real-world bugs — please file an issue with the diagnostics dump if BLE discovery does not work for you.
- **NFC tap-to-transfer** has been built but not validated with two physical NFC-capable phones held back-to-back. Same please-report-issues note.

### What this release does **not** claim

- No "perfect on all phones" claim.
- No speed leadership claim.
- No AirDrop / Google Quick Share interop — those are OS-level features no third-party app can hijack today.
- No physical-device proof for BLE or NFC. Both are wired and code-complete but flagged experimental.

### Install

- **Windows:** same path as prior releases — `LightningP2P-win-Setup.exe` or the MSI / NSIS variants.
- **Android (sideload pre-release):** download `LightningP2P-android-latest.apk` and `SHA256SUMS-android.txt`, verify the hash, then install. See the README for the full trust steps.

### Assets

- `LightningP2P-0.5.0-android.apk`
- `LightningP2P-0.5.0-android.aab`
- `LightningP2P-android-latest.apk`
- `SHA256SUMS-android.txt`
- Windows installer assets from the existing workflow mode

### Full roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md). Upcoming work:
- **v0.5.1 — iOS Lightning P2P alpha**: stand up the Tauri iOS shell, reuse the same Rust transfer engine. The real cross-platform unlock.
- **v0.5.2 — iOS share-sheet integration**: iOS Share Extension target so Lightning P2P appears in the iOS share sheet, parallel to the Android share-target intent shipped here.
- **v0.6.x — Quick Share / AirDrop interop (conditional)**: only if Apple or Google ever opens a third-party API for it.
