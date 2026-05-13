# Release Operations

This document tracks release tasks that cannot be fully automated from the app
repository.

## Release Modes

Lightning P2P supports two Windows release modes.

### Community unsigned

This mode uses no paid signing services, Azure account, certificate, or private
signing secrets.

It builds:

- `LightningP2P-win-Setup.exe`
- `LightningP2PSetup.exe`
- `LightningP2P.msi`
- `SHA256SUMS.txt`

The workflow creates a draft GitHub Release and labels it as an unsigned
community build. SmartScreen warnings are expected. Users should verify the
download source and checksum before installing.

Manual command:

```powershell
gh workflow run ci.yml -f release_mode=community_unsigned
```

### Production signed

This mode is for a verified publisher identity. It uses the existing Tauri
updater signing key plus Microsoft Artifact Signing / Trusted Signing through
`src-tauri/windows/sign-windows.ps1`.

Required repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the private key is encrypted
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TENANT_ID`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_ACCOUNT`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE`

Manual command:

```powershell
gh workflow run ci.yml -f release_mode=production_signed
```

Production release notes must not claim signing until Authenticode verification
passes in CI.

## Publisher Identity

Current bundle publisher placeholder: `Lightning P2P`.

Before Microsoft Store submission or production signing, update the publisher
metadata to match the verified Partner Center or signing identity exactly. A
mismatch between package metadata, certificate subject, and Store identity can
create avoidable trust and review friction.

## Winget

- First package submission <https://github.com/microsoft/winget-pkgs/pull/362516> closed unmerged on May 2, 2026.
- Next action: resubmit after a public release asset is final and verified.
- Package identifier: `LightningP2P.LightningP2P`
- Installer source: the NSIS release asset matching `_x64-setup.exe`
- Follow-up releases: `.github/workflows/winget.yml` opens the auto-PR after each published GitHub release.
- Required repository secret: `WINGET_TOKEN`, a classic PAT with `public_repo` scope on the `microsoft/winget-pkgs` fork.

Before tagging a release, confirm the secret still exists under GitHub
repository settings.

## GitHub Release Asset Verification

After the release workflow finishes, confirm the release contains the artifacts
expected for its mode.

Community unsigned:

- Stable aliases: `LightningP2P-win-Setup.exe`, `LightningP2PSetup.exe`, `LightningP2P.msi`
- Versioned NSIS and MSI installers
- Velopack `*-full.nupkg` and `RELEASES` when generated
- `SHA256SUMS.txt`
- Release notes explicitly state the build is unsigned

Production signed:

- Versioned NSIS installer and `.sig`
- Versioned MSI installer and `.sig`
- Stable aliases: `LightningP2PSetup.exe`, `LightningP2PSetup.exe.sig`, `LightningP2P.msi`, `LightningP2P.msi.sig`
- Velopack `LightningP2P-win-Setup.exe`, `*-full.nupkg`, and `RELEASES`
- `latest.json`
- `SHA256SUMS.txt`
- Release notes state Authenticode signing only after CI verifies it

Verify locally from a clean Windows machine:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-release.ps1 -Installer .\LightningP2P-win-Setup.exe -Checksums .\SHA256SUMS.txt
powershell -ExecutionPolicy Bypass -File .\scripts\verify-release.ps1 -Installer .\LightningP2PSetup.exe -Checksums .\SHA256SUMS.txt
powershell -ExecutionPolicy Bypass -File .\scripts\verify-release.ps1 -Installer .\LightningP2P.msi -Checksums .\SHA256SUMS.txt
```

Tauri `.sig` files are updater integrity signatures and do not replace
Authenticode signing.

## Velopack Clean VM Verification

Run this before announcing the Velopack installer as production-ready.

1. Start a clean Windows 11 VM with no previous Lightning P2P install.
2. Download the `LightningP2P-win-Setup.exe` asset and `SHA256SUMS.txt` from the GitHub Release.
3. Verify checksums and Authenticode status.
4. Run the installer and confirm the app installs per-user, launches, and appears in Apps & Features.
5. Confirm the installed executable exists under `%LOCALAPPDATA%\LightningP2P\current\lightning-p2p.exe`.
6. Confirm the deep link is registered after first launch:

   ```powershell
   reg query HKCU\Software\Classes\lightning-p2p\shell\open\command
   Start-Process "lightning-p2p://receive?source=vm-check"
   ```

7. Confirm the firewall rule was created by the Velopack install hook:

   ```powershell
   netsh advfirewall firewall show rule name="Lightning P2P"
   ```

8. Uninstall from Windows Settings and confirm the firewall rule is removed:

   ```powershell
   netsh advfirewall firewall show rule name="Lightning P2P"
   ```

   A successful uninstall should report that no matching rules exist.
