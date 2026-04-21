# Release Operations

This checklist tracks release tasks that cannot be fully automated from the app repository.

## Winget

- First package submission: https://github.com/microsoft/winget-pkgs/pull/362516
- Package identifier: `LightningP2P.LightningP2P`
- Installer source: the NSIS release asset matching `_x64-setup.exe`
- Follow-up releases: `.github/workflows/winget.yml` opens the auto-PR after each published GitHub release.
- Required repository secret: `WINGET_TOKEN`, a classic PAT with `public_repo` scope on the `microsoft/winget-pkgs` fork.

Before tagging a release, confirm the secret still exists under GitHub repository settings.

## Windows Code Signing

Release builds use Microsoft Artifact Signing / Trusted Signing through
`src-tauri/windows/sign-windows.ps1`. The release workflow fails before
publishing if any required signing secret is missing.

Required repository secrets:

- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TENANT_ID`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_ACCOUNT`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE`

If Microsoft identity validation blocks Trusted Signing, replace the release
`signCommand` with the EV certificate issuer's `signtool` command and keep the
same Authenticode verification step in CI.

## GitHub Release Asset Verification

After the release workflow finishes, confirm the release contains:

- Versioned NSIS installer and `.sig`
- Versioned MSI installer and `.sig`
- Stable aliases: `LightningP2PSetup.exe`, `LightningP2PSetup.exe.sig`, `LightningP2P.msi`, `LightningP2P.msi.sig`
- Velopack `*-Setup.exe`, `*-full.nupkg`, and `RELEASES`
- `latest.json`
- `SHA256SUMS.txt`

Then verify signatures locally from a clean Windows machine:

```powershell
Get-AuthenticodeSignature .\LightningP2P-win-Setup.exe
Get-AuthenticodeSignature .\Lightning.P2P_<version>_x64-setup.exe
Get-AuthenticodeSignature .\Lightning.P2P_<version>_x64_en-US.msi
```

Each Authenticode status should be `Valid`. Tauri `.sig` files are separate
updater integrity signatures and do not replace Authenticode signing.

## Velopack Clean VM Verification

Run this on the next tagged release before announcing the Velopack installer as production-ready.

1. Start a clean Windows 11 VM with no previous Lightning P2P install.
2. Download the `*-Setup.exe` Velopack asset from the GitHub release. This is
   the primary public installer after signing and clean-VM verification.
3. Run the installer and confirm the app installs per-user, launches, and appears in Apps & Features.
4. Confirm the installed executable exists under `%LOCALAPPDATA%\LightningP2P\current\fastdrop.exe`.
5. Confirm the deep link is registered after first launch:

   ```powershell
   reg query HKCU\Software\Classes\lightning-p2p\shell\open\command
   Start-Process "lightning-p2p://receive?source=vm-check"
   ```

6. Confirm the firewall rule was created by the Velopack install hook:

   ```powershell
   netsh advfirewall firewall show rule name="Lightning P2P"
   ```

   The inbound and outbound rules should point at the installed `fastdrop.exe`.

7. Uninstall from Windows Settings and confirm the firewall rule is removed:

   ```powershell
   netsh advfirewall firewall show rule name="Lightning P2P"
   ```

   A successful uninstall should report that no matching rules exist.
