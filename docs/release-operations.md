# Release Operations

This checklist tracks release tasks that cannot be fully automated from the app repository.

## Winget

- First package submission: https://github.com/microsoft/winget-pkgs/pull/362516
- Package identifier: `LightningP2P.LightningP2P`
- Installer source: the NSIS release asset matching `_x64-setup.exe`
- Follow-up releases: `.github/workflows/winget.yml` opens the auto-PR after each published GitHub release.
- Required repository secret: `WINGET_TOKEN`, a classic PAT with `public_repo` scope on the `microsoft/winget-pkgs` fork.

Before tagging a release, confirm the secret still exists under GitHub repository settings.

## GitHub Release Asset Verification

After the release workflow finishes, confirm the release contains:

- Versioned NSIS installer and `.sig`
- Versioned MSI installer and `.sig`
- Stable aliases: `LightningP2PSetup.exe`, `LightningP2PSetup.exe.sig`, `LightningP2P.msi`, `LightningP2P.msi.sig`
- Velopack `*-Setup.exe`, `*-full.nupkg`, and `RELEASES`
- `latest.json`
- `SHA256SUMS.txt`

## Velopack Clean VM Verification

Run this on the next tagged release before announcing the Velopack installer as production-ready.

1. Start a clean Windows 11 VM with no previous Lightning P2P install.
2. Download the `*-Setup.exe` Velopack asset from the GitHub release.
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
