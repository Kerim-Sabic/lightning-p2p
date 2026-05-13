# Download Trust

Lightning P2P is a young open-source Windows app. Early releases may show
Microsoft Defender SmartScreen prompts, especially when a build is unsigned or
has not yet built download reputation.

This document explains what that means and how to verify a download before
installing it.

## Official Sources

Use only these sources for public builds:

- GitHub Releases: <https://github.com/Kerim-Sabic/lightning-p2p/releases>
- Official website: <https://lightning-p2p.netlify.app/>
- Future Microsoft Store listing, once documented in this repository

If you do not trust the source or checksum, do not install.

## Why Windows May Show A Warning

Windows Defender SmartScreen checks app reputation before allowing downloaded
files to run. Microsoft documents two main signals: publisher reputation and
file-hash reputation. Unsigned files have the most friction. Signed files can
still show a warning until the publisher and exact file hash build reputation.

Microsoft Store distribution is the cleanest no-warning path because Store apps
are signed by Microsoft after certification. That is a future distribution goal;
it is not complete today.

References:

- <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation>
- <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options>
- <https://learn.microsoft.com/en-us/windows/msix/package/sign-msix-package-guide>

## Release Types

### Unsigned Community Builds

Unsigned community builds are free to produce and useful for open-source testing,
but they may show "Windows protected your PC" or "unrecognized app" prompts.

For unsigned builds:

- verify the download source
- verify `SHA256SUMS.txt`
- check Authenticode status so you know whether the file is signed
- install only if you intentionally trust the source

Unsigned does not mean malicious, but it does mean Windows cannot verify a
publisher identity for that file.

### Signed Production Builds

Signed builds use Authenticode signing when the release workflow has a trusted
signing identity configured. Signed builds should show a verified publisher, but
new files can still show SmartScreen prompts until reputation builds.

Signed builds must still include checksums.

### Microsoft Store Builds

Microsoft Store distribution is the preferred long-term trust path because the
Store signs packages after certification. Store distribution has manual Partner
Center requirements and is not complete yet. See [store-readiness.md](store-readiness.md).

## Verify A Download

Download the installer and `SHA256SUMS.txt` from the same GitHub Release.

From PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-release.ps1 -Installer .\LightningP2PSetup.exe -Checksums .\SHA256SUMS.txt
```

The script prints:

- file name
- size
- SHA256 hash
- Authenticode signature status
- checksum comparison result

Expected results:

- `Signed + Valid`: Authenticode signature is valid.
- `Unsigned`: the file is not signed; verify source and checksum carefully.
- `Signed but invalid`: do not install.
- Checksum mismatch: do not install.

## What Not To Do

- Do not install from random mirrors, chat attachments, or reuploaded files.
- Do not trust a screenshot of a checksum; download `SHA256SUMS.txt` from the release.
- Do not assume a SmartScreen warning means the file is safe or unsafe by itself.
- Do not install if the hash does not match.
- Do not install if Authenticode reports an invalid signature.

## Maintainer Notes

The current bundle publisher is `Lightning P2P`. Before a Microsoft Store or
production signed release, the publisher identity should be updated to match the
verified Microsoft Partner Center or signing identity exactly.
