# r/android

Sub rules check: app launches are allowed in [App] flair when there's
substance and the source is open. Lead with what it does for Android
users, not the stack.

## Title

```
[App] Lightning P2P – send large files between Android and Windows without uploading
```

## Body

```
Lightning P2P is a free, open-source app for direct peer-to-peer file
transfer. The Android side is built specifically around how Android
users actually share files: system share target, content:// import
from the file picker, and MediaStore routing on receive so files land
in the right bucket.

What you get on Android:

- System share target. Pick "Lightning P2P" from any app's share menu
  (Gallery, Files, etc.) and you get a receive link without setup.
- Smart save destinations. Pictures go to Pictures, videos to Movies,
  audio to Music, other files to Downloads / Lightning P2P.
- Direct-first with WAN fallback. Not LAN-only — works between an
  Android phone and a Windows laptop on different networks.
- Sideload-friendly install. Signed APK + AAB, with the signer cert
  SHA-256 fingerprint published in the README so you can verify with
  apksigner before installing.

Sideload trust:

- The published fingerprint is in docs/android-trust.md.
- "App damaged" on install means tampering or corruption — re-verify
  the SHA256SUMS file.
- Play Protect may warn "low reputation" for new releases; that's
  Play Protect's reputation engine, not a malware signal.

Not on the Play Store yet — sideload only for now. APK + AAB on every
GitHub Release.

Repo: https://github.com/Kerim-Sabic/lightning-p2p
Android trust doc: https://github.com/Kerim-Sabic/lightning-p2p/blob/main/docs/android-trust.md
```
