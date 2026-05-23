## Lightning P2P v0.4.6 - Stable Android polish release

This is the stable public release for Windows and Android sideload users.

### Downloads

| File | Description |
| --- | --- |
| `LightningP2P-win-Setup.exe` | Recommended Windows Velopack one-click installer |
| `LightningP2PSetup.exe` | Classic Windows NSIS installer |
| `LightningP2P.msi` | Windows MSI installer |
| `LightningP2P-android-latest.apk` | Android 10+ sideload APK |
| `SHA256SUMS.txt` | Windows release checksums |
| `SHA256SUMS-android.txt` | Android release checksums and signer information |

### What's new

- Android sends now resolve system file picker and share-sheet `content://` URIs into app-private cache before iroh-blobs imports them.
- Android receives publish single files into normal `MediaStore` collections: Pictures, Movies, Music, or Downloads.
- Lightning P2P appears in the Android system share sheet, so users can share from Gallery, Files, browsers, and other apps.
- Mobile UI polish improves touch targets, first-run guidance, empty states, and smart-routing copy.
- Android minimum version is now Android 10 (API 29).

### Trust and verification

Windows files in this release are community unsigned. Windows Defender SmartScreen
may show an unrecognized-app warning because there is no Authenticode publisher
identity on these artifacts. Verify the SHA256 checksums before installing.

Verify files before installing:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-release.ps1 -Installer .\LightningP2P-win-Setup.exe -Checksums .\SHA256SUMS.txt
(Get-FileHash .\LightningP2P-android-latest.apk -Algorithm SHA256).Hash
Get-Content .\SHA256SUMS-android.txt | Select-String "LightningP2P-android-latest.apk"
```

Android signer certificate SHA-256:

```text
5F:A0:D6:63:46:FF:9C:91:1B:18:D1:2A:5F:77:F1:F0:9B:2D:E2:A7:69:A0:97:68:6C:FC:FA:43:BD:86:29:16
```

### Notes

- The sender must stay online until the receiver finishes.
- Receive tickets are capability tokens; treat them as secrets.
- Relay fallback helps connectivity but is not cloud storage.
- File bytes transfer through iroh QUIC and iroh-blobs with BLAKE3 verification.
- BLE and NFC are not part of this stable release; they are experimental in `v0.5.0`.

Full changelog: https://github.com/Kerim-Sabic/lightning-p2p/compare/v0.4.5...v0.4.6
