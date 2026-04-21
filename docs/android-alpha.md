# Android Alpha Build And Distribution

Status: Android alpha foundation. Windows desktop remains the supported public release. Android is for internal testing and sideload/beta validation until real device transfer results are recorded.

## Toolchain

Install the official Tauri mobile prerequisites:

- JDK 17 or newer
- Android SDK Platform
- Android SDK Platform-Tools
- Android SDK Build-Tools
- Android SDK Command-line Tools
- NDK Side by side
- Rust targets:

```powershell
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

On Windows, Tauri expects:

```powershell
[System.Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\path\to\jdk", "User")
[System.Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LocalAppData\Android\Sdk", "User")
[System.Environment]::SetEnvironmentVariable("NDK_HOME", "$env:LocalAppData\Android\Sdk\ndk\<version>", "User")
```

Restart the terminal or refresh environment variables before building.

On Windows, enable Developer Mode before `pnpm android:build:*`. Tauri links the compiled Rust shared library into the generated Android project, and Windows blocks that symlink step unless Developer Mode or equivalent symlink privilege is enabled.

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

## Signing For Sideload Alpha

Create a release keystore outside the repository:

```powershell
keytool -genkeypair `
  -v `
  -keystore "$env:USERPROFILE\.lightning-p2p\android-alpha.jks" `
  -storetype JKS `
  -keyalg RSA `
  -keysize 4096 `
  -validity 10000 `
  -alias lightning-p2p-alpha
```

Set signing secrets in the shell or CI secret store:

```powershell
$env:ANDROID_KEYSTORE_PATH="$env:USERPROFILE\.lightning-p2p\android-alpha.jks"
$env:ANDROID_KEYSTORE_PASSWORD="<store-password>"
$env:ANDROID_KEY_ALIAS="lightning-p2p-alpha"
$env:ANDROID_KEY_PASSWORD="<key-password>"
pnpm android:build:apk
```

Do not commit the keystore or passwords. Without these variables, release artifacts may be unsigned; debug builds use the Android debug key.

## Sideload Install

1. Build a signed APK with `pnpm android:build:apk`.
2. Connect an Android phone with USB debugging enabled.
3. Install with:

```powershell
adb install -r src-tauri\gen\android\app\build\outputs\apk\release\app-release.apk
```

4. Open Lightning P2P and test Send, Receive, History, and Settings.

## Play Internal Testing

1. Build the Play artifact:

```powershell
pnpm android:build:aab
```

2. Upload the generated AAB in Play Console.
3. Use Internal testing first. Do not promote to closed/open testing until Android-to-Windows and Windows-to-Android transfers have benchmark notes.
4. The Play listing must not claim "fastest in the world" until the benchmark matrix is filled.

## Alpha Constraints

- Foreground-only transfers. Keep the app open, the screen awake, and the sender online.
- Receives save to Lightning P2P app-private storage for the alpha.
- Public Downloads export is a later milestone.
- Networking stays iroh plus iroh-blobs. No HTTP server, WebSocket server, or custom transfer protocol.
- Android local discovery remains enabled; relay fallback must also be tested.

## Acceptance Checklist

- Android project scaffolds with `pnpm android:init`.
- Debug build launches on emulator or phone.
- Send, Receive, History, and Settings open on phone width.
- Bottom tab bar navigation works.
- File picker can stage a file for sharing.
- Receive can paste a ticket and scan a QR code.
- Android-to-Windows LAN direct transfer recorded.
- Windows-to-Android relay fallback transfer recorded.
- Signed APK installs on a physical device.
- AAB builds for Play Internal Testing.
