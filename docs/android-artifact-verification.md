# Android artifact verification — automated checks

How to verify a Lightning P2P Android artifact (APK or AAB) outside of
the in-app trust card. The trust model itself lives in
[`android-trust.md`](android-trust.md); this doc is the operational
checklist for verifying a downloaded file before installation.

## TL;DR

```powershell
pwsh scripts/verify-android-artifact.ps1 `
  -Artifact .\LightningP2P-android-latest.apk `
  -Checksums .\SHA256SUMS-android.txt
```

```bash
bash scripts/verify-android-artifact.sh \
  --artifact ./LightningP2P-android-latest.apk \
  --checksums ./SHA256SUMS-android.txt
```

Both scripts:
1. Hash the artifact with SHA256.
2. Compare against the matching line in `SHA256SUMS-android.txt`.
3. Run `apksigner verify --print-certs --verbose` (APK only).
4. Print `aapt2 dump badging` (APK only) so you can confirm package name
   and permission set match what the manifest declares.
5. Run `bundletool validate` (AAB only).

Missing SDK tools are reported as "skipped" — they do not fail the run.
The SHA256 + checksum file comparison is always performed.

## Tools the scripts will use if available

| Tool | Used for | Install hint |
|---|---|---|
| `sha256sum` (Linux/macOS) / `Get-FileHash` (Windows) | Hash | Already present on every modern OS |
| `apksigner` | APK signature + cert SHA-256 | Comes with Android SDK build-tools |
| `aapt2` | APK package metadata | Comes with Android SDK build-tools |
| `bundletool` | AAB validation | https://github.com/google/bundletool/releases |

On a Windows machine with the Android SDK installed (the typical
maintainer workstation), all three tools are in
`<Android SDK>/build-tools/<version>/`. Add that directory to PATH for
the scripts to detect them.

## Expected signer fingerprint

The published Lightning P2P APK signer certificate SHA-256 is:

```
5F:A0:D6:63:46:FF:9C:91:1B:18:D1:2A:5F:77:F1:F0:9B:2D:E2:A7:69:A0:97:68:6C:FC:FA:43:BD:86:29:16
```

When `apksigner verify --print-certs --verbose` runs, the `Signer #1
certificate SHA-256 digest` line should match. If it does not, the APK
was not signed by the published key — do not install it.

This fingerprint is also published in the README and in
[`android-trust.md`](android-trust.md).

## CI coverage of the same checks

The CI workflows already run the same verification automatically:

- `android-package` job ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml))
  builds debug APK + AAB on every push.
- `android-emulator-smoke` job validates the package launches on an
  API 30 emulator.
- `release-android` job builds the signed APK + AAB, runs
  `apksigner verify --print-certs`, and writes the published cert
  fingerprint to `SHA256SUMS-android.txt` as a header.

The local scripts duplicate the CI's verification so users can verify
downloads on their own machines without trusting the CI logs.

## When verification fails

| Failure | Likely cause | Action |
|---|---|---|
| SHA256 mismatch | Wrong file, corrupted download, or tampering | Re-download and re-verify. If still mismatched, report via SECURITY.md |
| `apksigner verify` returns non-zero | APK was modified post-signing, or re-signed by a different key | Do not install. Fetch a fresh copy from GitHub Releases |
| Cert SHA-256 does not match published fingerprint | APK signed by a different key | Do not install |
| `bundletool validate` non-zero | AAB structurally invalid | Do not upload to Play Console. Report via GitHub Issues |
| "App damaged" on install | Tampering or transfer corruption | Re-verify the SHA256 hash before retrying |

Sideload-related Play Protect warnings ("low reputation") are not
malware signals — see [`android-trust.md`](android-trust.md) for the
full context.

## What this does not check

- That the device firmware is uncompromised.
- That the device hasn't already been rooted.
- That the device's network can reach iroh relays.
- That the device has enough free disk space for received files.

Those are device-level concerns; the verification scripts only attest
to the APK / AAB file itself matching the published artifact + signer.
