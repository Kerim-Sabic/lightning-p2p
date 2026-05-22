# Android Build And Distribution

Status: Android 10+ sideload release is public starting with `v0.4.6`. Play Store distribution remains future work, and BLE/NFC proximity features remain experimental in `v0.5.0`.

## Toolchain

Install the official Tauri mobile prerequisites:

- JDK 17 or newer
- Android SDK Platform
- Android SDK Platform-Tools
- Android SDK Build-Tools
- Android SDK Command-line Tools
- NDK side by side
- Rust Android targets

```powershell
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

On Windows, Tauri expects:

```powershell
[System.Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\path\to\jdk", "User")
[System.Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LocalAppData\Android\Sdk", "User")
[System.Environment]::SetEnvironmentVariable("NDK_HOME", "$env:LocalAppData\Android\Sdk\ndk\<version>", "User")
```

Enable Windows Developer Mode before `pnpm android:build:*` so Tauri can link the compiled Rust shared library into the generated Android project.

## Build Commands

```powershell
pnpm android:init
pnpm android:dev
pnpm android:run
pnpm android:build:debug
pnpm android:build:apk
pnpm android:build:aab
```

Expected outputs are under `src-tauri/gen/android/app/build/outputs/`.

## Signing For Sideload Releases

Create a release keystore outside the repository:

```powershell
keytool -genkeypair `
  -v `
  -keystore "$env:USERPROFILE\.lightning-p2p\android-release.jks" `
  -storetype JKS `
  -keyalg RSA `
  -keysize 4096 `
  -validity 10000 `
  -alias lightning-p2p-release
```

Set signing secrets in the shell or CI secret store:

```powershell
$env:ANDROID_KEYSTORE_PATH="$env:USERPROFILE\.lightning-p2p\android-release.jks"
$env:ANDROID_KEYSTORE_PASSWORD="<store-password>"
$env:ANDROID_KEY_ALIAS="lightning-p2p-release"
$env:ANDROID_KEY_PASSWORD="<key-password>"
pnpm android:build:apk
```

Do not commit the keystore or passwords.

## Sideload Install

1. Build a signed APK with `pnpm android:build:apk`.
2. Connect an Android 10+ phone with USB debugging enabled.
3. Install with:

```powershell
adb install -r src-tauri\gen\android\app\build\outputs\apk\release\app-release.apk
```

4. Open Lightning P2P and test Send, Receive, History, Settings, and system Share -> Lightning P2P.

## Android Constraints

- Transfers can run while the app is backgrounded thanks to the foreground service declared in `AndroidManifest.xml` and started by `MainActivity.kt`. Killing the app from Recents still kills transfers; there is no resume yet.
- mDNS multicast is gated on `WifiManager.MulticastLock`; without this lock most Android devices silently drop multicast packets used by iroh local discovery.
- Single-file receives publish into Android `MediaStore`: images to Pictures, videos to Movies, audio to Music, and other files to Downloads.
- Folder receives still stage app-private until per-file collection publishing is implemented.
- Identity keys prefer platform keychain storage, but Android can fall back to an app-private `iroh-secret-key.hex` file when keychain access is unavailable.
- Networking stays iroh plus iroh-blobs. No HTTP server, WebSocket server, or custom transfer protocol.
- Bluetooth and NFC proximity work is experimental in `v0.5.0` and does not carry file bytes.
- Storage Access Framework `content://` URIs are resolved into app-private cache before iroh-blobs imports them.

## Acceptance Checklist

- Android project scaffolds with `pnpm android:init`.
- Debug build launches on emulator or phone.
- Send, Receive, History, and Settings open on phone width.
- Bottom tab bar navigation works.
- File picker can stage a file for sharing.
- Android share sheet can hand a file into Lightning P2P and auto-create a ticket.
- Receive can paste a ticket and scan a QR code.
- Android-to-Windows LAN direct transfer recorded.
- Windows-to-Android relay fallback transfer recorded.
- Signed APK installs on a physical Android 10+ device.
- AAB builds for Play Internal Testing.

## Play Internal Testing

```powershell
pnpm android:build:aab
```

Upload the generated AAB in Play Console and use Internal testing first. Do not promote to closed/open testing until Android-to-Windows and Windows-to-Android transfers have benchmark notes. The Play listing must not claim speed leadership until the benchmark matrix is filled.
