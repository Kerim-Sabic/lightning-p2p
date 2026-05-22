# Android Release Runbook

How to generate the Android release keystore, wire it into GitHub Actions, and ship a signed APK + AAB through the `release-android` workflow.

This document is for the project maintainer. End users who only want to install the app should read [android-trust.md](android-trust.md).

## Why a release keystore matters

Android binds every installed app to the public key that signed its APK. Once a user installs Lightning P2P, only updates signed with the same key can be installed over the top — anything else is treated as a different app and rejected by the OS.

There are three signing paths Android understands:

| Signing | What users see | When it's used |
| --- | --- | --- |
| Debug key | "App from an unknown developer" + many devices block install outright | Only for developer machines and CI smoke tests. Never published. |
| Release key (sideload) | Standard "Install unknown apps" prompt, normal first-time UX | This runbook. GitHub Releases distribution. |
| Play App Signing | No warnings, full Play Protect reputation | Future Play Store path. Out of scope for this runbook. |

The `release-android` job at [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) only runs when the four `ANDROID_*` secrets are present. Without them, every release falls back to debug signing inside the smoke-test job and **no APK is published** — the workflow short-circuits to `android_release_mode=skip`.

## One-time keystore generation

Run on your dev machine, not in CI. The keystore lives outside the repo.

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.lightning-p2p" | Out-Null

keytool -genkeypair -v `
  -keystore "$env:USERPROFILE\.lightning-p2p\lightning-p2p-release.jks" `
  -storetype JKS `
  -keyalg RSA `
  -keysize 4096 `
  -validity 10000 `
  -alias lightning-p2p-release `
  -dname "CN=Lightning P2P, O=Kerim Sabic, L=Unknown, S=Unknown, C=US"
```

`keytool` prompts twice for passwords — once for the keystore, once for the key. Use the **same** password for both unless you have a specific reason not to (the CI configuration assumes they may differ but is simpler when they match).

`validity 10000` is ~27 years. Don't shorten this — once the keystore expires you can't ship updates to existing installs.

### Capture the certificate fingerprint

Publish this in the README and [android-trust.md](android-trust.md) so users can verify subsequent releases are signed by the same key.

```powershell
keytool -list -v `
  -keystore "$env:USERPROFILE\.lightning-p2p\lightning-p2p-release.jks" `
  -alias lightning-p2p-release
```

Copy the `SHA-256` fingerprint line (formatted as `XX:XX:...:XX`).

### Back up the keystore

Two copies, both encrypted, both **not** in the repo and **not** in cloud storage that syncs to the dev machine:

1. Password-protected archive on an external drive kept offline.
2. Password-protected archive in a separate, audited password manager (1Password, Bitwarden vault).

Store the keystore password and key password in your password manager **alongside** the archive — losing the password is the same as losing the key.

> **Losing the keystore = losing the ability to ship updates to existing installs.** Sideloaded users would have to uninstall and reinstall, losing app state. This is non-recoverable; back up before you publish the first release.

## Wire it into GitHub Actions

### Encode for the secret

GitHub secrets are text. Convert the binary keystore to base64:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.lightning-p2p\lightning-p2p-release.jks")) `
  | Set-Content -Encoding ascii "$env:USERPROFILE\.lightning-p2p\release.jks.b64"
```

The output file is what you paste into the `ANDROID_KEYSTORE_BASE64` secret.

### Add the four secrets

Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

| Secret name | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Contents of `release.jks.b64` (one long line, no whitespace) |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password from `keytool` |
| `ANDROID_KEY_ALIAS` | `lightning-p2p-release` |
| `ANDROID_KEY_PASSWORD` | Key password from `keytool` (same as keystore if you used one password) |

Once added, never echo them in workflow logs. The CI workflow already redacts them.

#### Helper script (faster path)

[`scripts/set-android-secrets.ps1`](../scripts/set-android-secrets.ps1) automates
the steps above without ever putting the password on the command line or in
shell history. It prompts twice with `Read-Host -AsSecureString` (hidden
input), base64-encodes the keystore in-memory, and pipes each value through
`gh secret set` via stdin.

```powershell
.\scripts\set-android-secrets.ps1
```

The script defaults to the runbook keystore path and the `lightning-p2p-release`
alias. Pass `-KeystorePath` or `-KeyAlias` to override, and `-Repo OWNER/NAME`
when running from outside the repo working tree.

### Verify the workflow picks them up

Trigger CI via `workflow_dispatch` with `release_mode=auto`. The `release-plan` job summary should show:

```
- Android release mode: `signed`
```

If it shows `skip`, at least one secret is missing or empty. The job summary lists which.

## v0.4.6 notes

The v0.4.6 release brings four user-visible Android changes that change how the build is verified:

1. **`minSdk` is now 29** ([`src-tauri/gen/android/app/build.gradle.kts`](../src-tauri/gen/android/app/build.gradle.kts)). The APK no longer installs on Android 7.0-9.0. This is intentional: it lets the app use scoped `MediaStore` writes without requesting `WRITE_EXTERNAL_STORAGE`.
2. **System share-target.** The manifest now declares `ACTION_SEND` / `ACTION_SEND_MULTIPLE` filters so Lightning P2P appears in Android's share sheet for image / video / audio / application MIME types and `*/*`. Verification: open Gallery → Share → Lightning P2P should appear in the chooser → tap → the app opens directly to Send with the file pre-selected and the QR/link auto-generated.
3. **Smart save routing.** Verified single-file receives auto-publish into `MediaStore` collections — images to `Pictures/Lightning P2P`, video to `Movies/Lightning P2P`, audio to `Music/Lightning P2P`, other files to `Downloads/Lightning P2P`. Verification: receive one of each MIME type from a second device, then open the system Gallery / Files app and confirm each file appears in the right collection.
4. **Launcher icon.** The icon source at [`src-tauri/icons/lightning-p2p-source.png`](../src-tauri/icons/lightning-p2p-source.png) should be updated to the new two-tone blue brand mark (≥1024×1024 with art inside the inner 66% safe zone) **before** running `pnpm android:build:apk`. Tauri regenerates all mipmap densities and the adaptive variants on every build, so no other manual edits are needed.

Watch logcat during the smoke launch for these strings; treat them as fatal:
- `MediaStore publish failed`
- `shared-staging cleanup failed`
- `MediaStore insert returned null`

## Release procedure

1. **Bump the version** in three files, all to the same value (e.g. `0.4.6`):
   - [`src-tauri/Cargo.toml`](../src-tauri/Cargo.toml) — `version = "X.Y.Z"`
   - [`package.json`](../package.json) — `"version": "X.Y.Z"`
   - [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) — `"version": "X.Y.Z"`

   The Android `versionCode` and `versionName` are derived from `tauri.properties`, which Tauri regenerates from `tauri.conf.json` on every build — no manual edit needed.

2. **Commit and push** the version bump to a branch, open a PR, merge to `main`.

3. **Tag** the merge commit:

   ```powershell
   git checkout main
   git pull
   git tag -a v0.4.4 -m "Release v0.4.4"
   git push origin v0.4.4
   ```

4. **Watch the workflow.** The tag push triggers CI on `refs/tags/v*`. Expected jobs:
   - `rust`, `frontend`, `windows-package`, `android-package` (smoke + debug APK)
   - `release-plan` (resolves Android signing mode)
   - `release-android` (signed APK + AAB build, only if signing mode is `signed`)
   - `release-windows-community` or `release-windows-signed` (whichever applies)

5. **Verify the GitHub Release.** Open `https://github.com/Kerim-Sabic/lightning-p2p/releases/tag/v0.4.4`:
   - `LightningP2P-0.4.4-android.apk` ✓
   - `LightningP2P-0.4.4-android.aab` ✓
   - `LightningP2P-android-latest.apk` (alias, always points at the newest) ✓
   - `SHA256SUMS-android.txt` ✓

6. **Spot-check the signature.** Download the APK and run:

   ```powershell
   $bt = "$env:LocalAppData\Android\Sdk\build-tools"
   $latest = Get-ChildItem $bt | Sort-Object Name -Descending | Select-Object -First 1
   & "$($latest.FullName)\apksigner.bat" verify --print-certs --verbose LightningP2P-0.4.4-android.apk
   ```

   The `SHA-256` cert fingerprint must match the one captured in step "Capture the certificate fingerprint" above. If it doesn't, **something is wrong** — do not publish; investigate before announcing.

7. **Sanity install** on at least one real device before announcing. Walk through the manual checklist in the [acceptance section below](#manual-acceptance-checklist).

## Key rotation

If the keystore is ever exposed (lost laptop, leaked backup), rotate it. This is a hard rotation — there is no in-place key replacement for sideload distribution.

1. Generate a new keystore using the same `keytool` command, new alias (`lightning-p2p-release-v2`).
2. Update the four GitHub secrets with the new values.
3. Publish a clearly-labeled "key rotation" release. Document in the release notes that **users must uninstall the old app and reinstall** because Android will not accept an update signed with a different key.
4. Update the published SHA-256 fingerprint in README + android-trust.md to the new value.
5. Add a note in [SECURITY.md](../SECURITY.md) referencing the rotation date.

## Tauri release config note

[`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) lists only `["nsis", "msi"]` under `bundle.targets`. This is correct — Android bundling runs through Gradle (`pnpm android:build:apk` / `pnpm android:build:aab`), not the Tauri bundler. Don't expect `tauri build --target android` to do the right thing; the workflow always goes through `android:build:*` scripts.

## Manual acceptance checklist

After CI publishes a signed APK, run through this on at least one real device before announcing the release:

1. Download `LightningP2P-android-latest.apk` and `SHA256SUMS-android.txt` from the GitHub Release.
2. Verify SHA-256 matches.
3. Verify cert fingerprint with `apksigner verify --print-certs`.
4. Sideload on a Pixel or Samsung phone. Confirm:
   - The "Install unknown apps" prompt appears exactly once (this is normal, document this in README).
   - The "Play Protect couldn't verify" dialog appears once and proceeds cleanly.
   - **No** "App not installed" or "App damaged" errors. If either appears, the APK is corrupted or the cert chain is wrong.
5. Launch the app. Grant notification permission when asked so foreground transfers remain visible.
6. Confirm the device-name shown in the Devices view header matches the phone's name (not "Nearby device").
7. Open Lightning P2P on a Windows PC on the same trusted Wi-Fi/LAN. Confirm both devices see each other in Devices within ~10 seconds.
8. Send a 10 MB file PC → phone. Accept. Confirm complete.
9. Send a 500 MB file phone → PC with the phone screen locked halfway through. Confirm transfer survives (foreground service notification stays visible).
10. Confirm Settings shows Bluetooth proximity discovery as experimental for v0.5.0 and does not claim off-Wi-Fi discovery works in the stable v0.4.6 build.
11. Leave off-Wi-Fi BLE discovery validation for the v0.5.0 hardware test plan; BLE peers are not expected to appear in v0.4.6 stable.

If anything in steps 4-11 fails, do not announce the release. File issues for the failures and decide whether to revert the tag or hot-fix.

## Physical device launch smoke script

Run this from PowerShell with one Android phone connected over USB debugging. It tests the public GitHub Release APK, not a local debug build.

```powershell
$ErrorActionPreference = "Stop"
$adb = "$env:LocalAppData\Android\Sdk\platform-tools\adb.exe"
$apkUrl = "https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/LightningP2P-android-latest.apk"
$sumUrl = "https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/SHA256SUMS-android.txt"
$apk = ".\LightningP2P-android-latest.apk"
$sums = ".\SHA256SUMS-android.txt"
$logcat = ".\lightning-p2p-launch-logcat.txt"

& $adb devices
& $adb uninstall com.lightningp2p.app | Out-Host

Invoke-WebRequest -Uri $apkUrl -OutFile $apk
Invoke-WebRequest -Uri $sumUrl -OutFile $sums

$actual = (Get-FileHash $apk -Algorithm SHA256).Hash.ToLowerInvariant()
$expectedLine = Get-Content $sums | Select-String "LightningP2P-android-latest.apk"
if (-not $expectedLine -or $expectedLine.ToString().ToLowerInvariant() -notmatch $actual) {
  throw "APK checksum mismatch. Actual SHA256: $actual"
}

& $adb install -r $apk
& $adb logcat -c
& $adb shell am start -W -n com.lightningp2p.app/.MainActivity
Start-Sleep -Seconds 30
& $adb logcat -v threadtime -d > $logcat

$failures = Select-String -Path $logcat -Pattern "FATAL EXCEPTION|AndroidRuntime|SIGSEGV|signal 11|Rust panic|panicked at|Force finishing activity.*com.lightningp2p.app"
if ($failures) {
  $failures | Format-Table -AutoSize
  throw "Lightning P2P Android launch smoke failed. Full log: $logcat"
}

$activity = & $adb shell dumpsys activity activities
if ($activity -notmatch "com.lightningp2p.app/.MainActivity") {
  throw "MainActivity is not in the activity stack after launch."
}

Write-Host "Launch smoke passed. Full log: $logcat"
```

Then run the transfer matrix before announcing:

1. Cold launch, force close, reopen, rotate, background, foreground: no crash.
2. Settings -> diagnostics copies a useful local bundle.
3. Windows and Android see each other on the same Wi-Fi within about 10 seconds.
4. Windows -> Android 10 MB transfer completes.
5. Android -> Windows 10 MB transfer completes.
6. One 500 MB transfer completes while the phone screen is locked.
7. The website Android APK button downloads `LightningP2P-android-latest.apk` directly.
