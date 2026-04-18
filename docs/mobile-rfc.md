# Lightning P2P — Mobile (iOS + Android) RFC

Status: **Draft** · Target: phase 2, after desktop P0/P1 PRs land
Authors: @Kerim-Sabic

## 1. Motivation

Lightning P2P today is Windows-only. The single biggest asks from users are:

1. "Does it run on my phone?"
2. "Can I AirDrop between my laptop and my phone?"

Both are answered by shipping iOS and Android builds. The core engine already has the properties we need: [iroh](https://iroh.computer) works on both platforms, iroh-blobs does verified streaming without any desktop-specific assumptions, and Tauri v2 natively supports `tauri ios init` / `tauri android init` against the same Rust crate.

The goal of this RFC is to lock in scope, sequencing, and known risks **before** any mobile work starts, so we don't regress the desktop build while we experiment.

## 2. Non-goals

- Rewriting the app in a cross-platform framework (React Native, Flutter, etc.). Tauri v2 + the existing React frontend is the plan.
- Redesigning the visual language. The design system stays intact. Only layout reflows for phone widths.
- Supporting tablet-specific layouts in v1. iPad/Android tablets render the phone layout.
- Desktop browser support. Desktop remains Tauri-only.
- Publishing to the Mac App Store. macOS desktop is a separate workstream.

## 3. Feasibility summary

| Concern | Status | Notes |
|---|---|---|
| iroh on iOS (outgoing QUIC) | Feasible | Works without a Network Extension; we are a client-initiated peer |
| iroh on Android | Feasible | Full support for `discovery_local_network` |
| iroh-blobs mobile | Feasible | No desktop-only assumptions in the 0.32 API surface we use |
| Tauri v2 iOS | Supported | `tauri ios init` scaffolds Xcode project |
| Tauri v2 Android | Supported | `tauri android init` scaffolds Gradle project |
| `iroh::endpoint::Endpoint::discovery_local_network()` on iOS | **Blocked on entitlement** | Requires `com.apple.developer.networking.multicast`, Apple review required |
| `iroh::endpoint::Endpoint::discovery_local_network()` on Android | Feasible | Standard mDNS works |
| `keyring` crate on iOS | Supported | Uses Keychain |
| `keyring` crate on Android | Needs adapter | Android Keystore integration is partial; may need `tauri-plugin-biometric` or a custom shim |
| File system access | Mobile-sandbox | Use `tauri-plugin-dialog` + `UIDocumentPicker` / `SAF` |
| Background transfers | Out of scope v1 | iOS + Android both require platform-specific background services; foreground-only is acceptable for v1 |

## 4. Architecture

We keep the single Rust crate. `crate-type = ["lib", "staticlib", "cdylib"]` is already correct for both targets (see [Cargo.toml](../src-tauri/Cargo.toml)). The existing module boundaries stay intact.

### Changes required in the Rust crate

- `src/node/endpoint.rs`: gate `discovery_local_network()` behind a `#[cfg(not(target_os = "ios"))]` fallback, or catch its multicast bind failure gracefully and log clearly. On iOS without the multicast entitlement, the app must still function with relay-assisted WAN transfers.
- `src/storage/settings.rs`: on mobile, `dirs::data_dir()` returns the sandboxed app data path — verify the `resolve_app_data_dir()` helper behaves correctly on iOS/Android. The `FASTDROP_PROFILE` env var is moot on mobile; confirm the default path is writable.
- `src/telemetry.rs`: reduce default log level on mobile to `warn` to avoid log spam in TestFlight crash reports.
- `keyring`: wrap in a trait so we can swap implementations per target. On Android, v1 can fall back to a file-backed encrypted key if Keystore wiring slips.

### Changes required in the frontend

- Responsive pass in [src/App.tsx](../src/App.tsx) + each view. Breakpoints: `base` (375–430 px phone), `md` (768+ tablet, deferred), `lg` (current 1024+ desktop).
- The existing sidebar navigation reflows to a bottom tab bar on phone widths. Same items, same icons, same colors — only layout.
- Drag-and-drop stage area in [src/components/SendView.tsx](../src/components/SendView.tsx) becomes a single "Pick files" button on phone (no drag target on touch). Opens the platform file picker via `tauri-plugin-dialog`.
- Receive view gains a "Scan QR" affordance — this is where the QR scanner from PR #3's deferred scope lands. Cameras are universally available on phones.
- `WindowChrome` is hidden on mobile (no custom title bar).

### New Tauri plugins

| Plugin | Purpose | Desktop impact |
|---|---|---|
| `tauri-plugin-os` | Platform detection, version reporting | None |
| `tauri-plugin-clipboard-manager` | Clipboard read/write on mobile (the browser `navigator.clipboard` API is restricted on iOS) | None |
| `tauri-plugin-share` | Hook into the OS share sheet | None |
| `tauri-plugin-biometric` | Optional: biometric gate on first app launch | None |

All of these are additive. Desktop continues to call the same Tauri commands.

## 5. iOS specifics

### Multicast entitlement

`com.apple.developer.networking.multicast` is required for mDNS-based peer discovery on iOS. Apple review is currently 1–2 weeks and may be denied. **We must ship with the entitlement request already approved** before users install the app and discover that LAN peer discovery silently does not work.

**Mitigation if denied:** fall back to relay-assisted connections on iOS LAN. Users can still transfer between an iOS and a Windows device on the same network via the n0 public relay or a custom relay. This is slower but works.

### App Store review risks

Peer-to-peer apps occasionally draw scrutiny around:

- Guideline 4.2 (minimum functionality) — we ship a real, differentiated feature, low risk
- Guideline 5.2 (intellectual property) — "file transfer" is a broad category, low risk
- Guideline 1.5 (safety) — because the app accepts arbitrary incoming data, reviewers may ask about virus scanning / content moderation. Answer: transfers are strictly peer-initiated and cryptographically verified end-to-end. No server, no moderation surface.

Budget: **one to two re-submissions**, 2–3 weeks of calendar time for the first approval.

### Signing and distribution

- $99/year Apple Developer Program membership required
- TestFlight for beta; public release via App Store
- Code-signing certificates stored in repo secrets; fastlane or xcodebuild driven from GitHub Actions

## 6. Android specifics

Android is materially easier than iOS:

- mDNS via `discovery_local_network` works without extra permissions beyond `CHANGE_WIFI_MULTICAST_STATE` (declared in AndroidManifest.xml during `tauri android init`)
- Google Play review typically completes in under 24 hours for this category
- $25 one-time Play Console fee
- F-Droid as a secondary distribution channel — we should ship a reproducible-build configuration to qualify

### Permissions to declare

- `INTERNET`
- `ACCESS_NETWORK_STATE`
- `ACCESS_WIFI_STATE`
- `CHANGE_WIFI_MULTICAST_STATE`
- `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_AUDIO` (Android 13+) for user-initiated file pick
- `CAMERA` (for QR scanning — scoped, optional)

## 7. Milestones

Each milestone is a merge-ready slice of work.

### M1 — Scaffolding (no user-visible change)
- [ ] `pnpm tauri ios init` → Xcode project under `src-tauri/gen/apple`
- [ ] `pnpm tauri android init` → Gradle project under `src-tauri/gen/android`
- [ ] CI: cross-compile check for `aarch64-apple-ios` and `aarch64-linux-android`
- [ ] Rust-side cfg gates for iOS-specific fallbacks

### M2 — Responsive frontend
- [ ] Tailwind breakpoint pass for all four views (Send, Receive, History, Settings)
- [ ] Bottom tab bar replacing sidebar below the `lg` breakpoint
- [ ] Touch-first affordances (no drag target, larger hit areas)
- [ ] Visual regression: desktop layout pixel-identical at `lg` and above

### M3 — Android internal alpha
- [ ] Gradle signing config + debug build
- [ ] First successful transfer: Android → Windows on same LAN
- [ ] First successful transfer: Android → Windows across WAN (via relay)
- [ ] Internal track submission to Play Console

### M4 — iOS TestFlight
- [ ] Provisioning profile with multicast entitlement request filed
- [ ] First successful transfer: iOS → Windows on same LAN (post entitlement approval)
- [ ] First successful transfer: iOS → Windows across WAN (works without entitlement)
- [ ] TestFlight build distributed to ~20 early users

### M5 — Public release
- [ ] Play Store production listing
- [ ] App Store submission
- [ ] README screenshot triptych refreshed with phone captures
- [ ] Release notes and launch post (HN, r/rust, r/opensource)

## 8. Open questions

1. **Should iOS and Android ship as separate repos?** No — single crate, single React frontend, platform differences handled via `#[cfg]` gates in Rust and `runtime.isMobile` checks in React.
2. **Background transfers on v1?** No. Foreground-only is honest and avoids a lot of platform API surface. v2 can tackle iOS `BGProcessingTask` and Android foreground services.
3. **Short codes revisited on mobile?** Yes — 6-word phrases are *genuinely* useful when typing a ticket on a phone keyboard. Reopen the short-codes design when mobile ships, possibly with a small resolver service at `share.lightning-p2p.dev`.
4. **iPad / tablet layout?** Deferred. Phone layout at tablet width is acceptable v1.
5. **macOS desktop?** Separate RFC. Likely trivial (`pnpm tauri dev` on Mac already almost works) but needs signing, notarization, and Sparkle-style updater rework.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Apple multicast entitlement denied | Medium | High (LAN discovery off on iOS) | Relay fallback; clearly documented limitation |
| App Store rejection for content moderation | Low | Medium (2–3 week delay) | Prepared response citing E2E encryption + peer-initiated model |
| `keyring` crate gap on Android | Medium | Low (key storage fallback) | File-backed encrypted key as interim |
| iroh 0.32 mobile regression | Low | High (blocks entire RFC) | Pin iroh version; track n0 team support channels |
| Responsive pass drifts from desktop design | Medium | Medium | Visual regression tests at desktop breakpoint; strict additive-only on phone CSS |

## 10. Decision log

- **2026-04-19**: RFC drafted. Desktop P0/P1 workstreams (PRs #1–#4) merged or in review. Mobile work queued behind them.
