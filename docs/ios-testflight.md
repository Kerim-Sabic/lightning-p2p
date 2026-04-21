# iOS TestFlight Prerequisites

Status: prepared, not shipped. iOS cannot be completed from this Windows workspace because it requires macOS, Xcode, CocoaPods, Apple signing, and Apple entitlement review.

## Required Machine

- macOS host
- Xcode, not only Xcode Command Line Tools
- CocoaPods
- Apple Developer Program membership
- Rust iOS targets:

```bash
rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim
```

## Initial Build Steps

```bash
pnpm install
pnpm tauri ios init
pnpm tauri ios dev
pnpm tauri ios build
```

Commit generated iOS project files only after a macOS build is proven locally.

## Apple Multicast Entitlement

LAN discovery on iOS requires the Apple multicast entitlement:

```text
com.apple.developer.networking.multicast
```

Until Apple approves that entitlement, iOS must run without local-network discovery and rely on relay-assisted transfers plus explicit receive links or QR codes.

## TestFlight Checklist

- Apple Developer Team configured.
- Bundle identifier matches `com.lightningp2p.app` or an approved iOS-specific identifier.
- Provisioning profile includes required capabilities.
- Multicast entitlement request submitted and tracked.
- App launches on a physical iPhone.
- Receive link and QR scan work.
- iOS-to-Windows relay fallback transfer works before LAN claims are made.
- iOS-to-Windows LAN direct transfer is tested only after multicast entitlement approval.

## Release Rule

Do not claim iOS is shipped until a macOS/Xcode build has passed, a TestFlight build is uploaded, and at least one physical iPhone has completed a transfer test.
