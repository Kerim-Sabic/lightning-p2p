# Android Download Trust

Lightning P2P ships as a sideloaded APK on GitHub Releases. Sideloading is safe when you verify what you downloaded — this document tells you what's normal, what isn't, and how to check.

For Windows downloads, see [download-trust.md](download-trust.md).

## Official sources

Only download Lightning P2P from these places:

- GitHub Releases: <https://github.com/Kerim-Sabic/lightning-p2p/releases>
- Official website: <https://lightning-p2p.netlify.app/>

If you got the APK from anywhere else — a chat attachment, a mirror, a third-party app store — delete it and download again from GitHub.

## What Android will show you during install

Sideloaded apps trigger built-in Android warnings. They do **not** mean the app is unsafe. They mean Android can't outsource trust to the Play Store, so it asks you to confirm the source.

### "Install unknown apps" prompt

The first time you sideload anything from your browser or file manager, Android asks you to grant that specific app permission to install other apps. **This is normal.**

What it looks like (varies by Android version and OEM skin):

> Allow [Chrome / Files / your downloader] to install unknown apps?

Tap **Settings** → toggle **Allow from this source** → return to the install screen. You only have to do this once per downloader app.

### "Play Protect couldn't verify this app"

Play Protect is Google's malware scanner. For apps it hasn't seen before — i.e. anything new and not on the Play Store yet — it shows a dialog like:

> Play Protect doesn't recognize this app's developer. Apps from unknown developers can sometimes be unsafe.

This is the *low-reputation* warning, not a *malware-detected* warning. Tap **Install anyway** if you trust the source. As the install base grows, Play Protect will stop flagging Lightning P2P.

### "App not installed" or "App damaged" — NOT normal

If you see either of these, **something is wrong with your download**:

- The APK was corrupted in transit (incomplete download).
- The APK was tampered with (re-uploaded to a mirror).
- Your device already has a debug build installed under the same package name (uninstall it first).

Don't troubleshoot — re-download from the GitHub Release, verify the SHA-256, and try again.

## Verify the download

Always check the SHA-256 hash and ideally also the signer certificate. Both checks are quick.

### SHA-256 on a desktop, before sideloading

Download the APK and `SHA256SUMS-android.txt` from the **same GitHub Release**.

**Windows PowerShell:**

```powershell
(Get-FileHash .\LightningP2P-android-latest.apk -Algorithm SHA256).Hash
Get-Content .\SHA256SUMS-android.txt | Select-String "LightningP2P-android-latest.apk"
```

The two values must match (case-insensitive).

**macOS / Linux:**

```bash
shasum -a 256 LightningP2P-android-latest.apk
grep LightningP2P-android-latest.apk SHA256SUMS-android.txt
```

If they don't match, **delete the APK and re-download**. Do not install.

### SHA-256 directly on the phone

Without a PC, you can still verify from an Android phone using [Termux](https://termux.dev/) or any "file hash" app from the Play Store:

```bash
# Termux
pkg install coreutils
sha256sum ~/storage/downloads/LightningP2P-android-latest.apk
```

Compare against the `SHA256SUMS-android.txt` line for `LightningP2P-android-latest.apk`.

### Signer certificate (optional, recommended)

Every Lightning P2P release is signed with the same release keystore. The
published SHA-256 cert fingerprint is:

```
5F:A0:D6:63:46:FF:9C:91:1B:18:D1:2A:5F:77:F1:F0:9B:2D:E2:A7:69:A0:97:68:6C:FC:FA:43:BD:86:29:16
```

Once you've verified one release against this value, every future release
should show the same fingerprint.

From an Android SDK install on your PC:

```powershell
$bt = "$env:LocalAppData\Android\Sdk\build-tools"
$latest = Get-ChildItem $bt | Sort-Object Name -Descending | Select-Object -First 1
& "$($latest.FullName)\apksigner.bat" verify --print-certs --verbose LightningP2P-android-latest.apk
```

Look for the line:

```
Signer #1 certificate SHA-256 digest: <fingerprint>
```

The fingerprint must match the one in [README.md Android section](../README.md#android). If it doesn't, **do not install** — the APK is signed with a different key than this project publishes.

## What if Play Protect flags Lightning P2P as harmful?

Lightning P2P is open source — the Rust transfer engine, Tauri shell, and frontend are all in this repo. If Play Protect ever flags Lightning P2P as *harmful* (not the routine "unverified developer" warning, but a hard "blocked for your safety" red banner), one of three things is happening:

1. **You downloaded a tampered APK.** Verify SHA-256 against the GitHub Release. If it doesn't match, delete and re-download from the official source.
2. **A false positive.** Google's heuristics occasionally flag legitimate apps. File an issue at <https://github.com/Kerim-Sabic/lightning-p2p/issues> with the exact wording of the warning so it can be reported to Google.
3. **The release keystore has been compromised and a maintainer hasn't published the rotation notice yet.** Check [SECURITY.md](../SECURITY.md) — a key rotation will be announced there if it happens. Do not install in the meantime.

## Why we don't have a Microsoft Store / Play Store listing yet

Both stores eliminate sideload warnings entirely but require:

- **Play Store**: $25 developer account, Play App Signing key migration, privacy policy URL, content rating, data-safety form, screenshots, Google Play Console review.
- **Microsoft Store**: Partner Center business identity verification, MSIX packaging.

Both are on the roadmap. For now, GitHub Releases + this trust document is the recommended path.

## Summary — your trust checklist

Every install:

- [ ] Downloaded from <https://github.com/Kerim-Sabic/lightning-p2p/releases>
- [ ] SHA-256 matches `SHA256SUMS-android.txt`
- [ ] Cert fingerprint (optional) matches the published value in README
- [ ] "Install unknown apps" prompt accepted *once* per downloader
- [ ] "Play Protect couldn't verify" dismissed — this is expected
- [ ] App installs without "damaged" or "not installed" errors
