# Windows installer paths — which file is for whom

Lightning P2P ships three Windows installers in every release. They are
the same app — pick the one that matches your install context. Verify
with [`scripts/verify-release.ps1`](../scripts/verify-release.ps1) before
running, especially the first time.

## Quick pick

| You are… | Use this | Why |
|---|---|---|
| A normal Windows user, want one-click + auto-updates | `LightningP2P-win-Setup.exe` (Velopack) | Single-file bootstrapper, delta updates, modern installer UX |
| A power user who prefers classic NSIS wizards | `LightningP2PSetup.exe` (NSIS) | Same install footprint, traditional NSIS UI, no .NET dependency at runtime |
| IT / managed-deployment / Group Policy / Intune | `LightningP2P.msi` (MSI) | Standard MSI semantics for enterprise deployment tooling |

All three install the same `lightning-p2p.exe` binary into roughly the
same per-user location and share the same WebView2 runtime requirement.

## Versioned aliases

Every release also publishes versioned filenames alongside the stable
aliases, so old downloads stay unique by version:

| Stable alias | Versioned form |
|---|---|
| `LightningP2P-win-Setup.exe` | `Lightning P2P-<version>-win-Setup.exe` (Velopack output) |
| `LightningP2PSetup.exe` | `Lightning P2P_<version>_x64-setup.exe` (NSIS output) |
| `LightningP2P.msi` | `Lightning P2P_<version>_x64_en-US.msi` (MSI output) |

The CI release stage copies whichever versioned file is produced into
the stable alias name so the README install links remain valid across
releases. Source: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
`release-windows-community` and `release-windows-signed` jobs.

## Checksums + signature verification

Every release includes `SHA256SUMS.txt` covering all three installer
artifacts plus the Velopack `.nupkg`, `RELEASES`, and (when signed)
`latest.json` updater manifest.

Verify a downloaded installer locally:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-release.ps1 `
  -Installer .\LightningP2P-win-Setup.exe `
  -Checksums .\SHA256SUMS.txt
```

The script prints:
- File size and SHA256.
- Authenticode signature status (Valid / NotSigned / invalid).
- Signer certificate subject + issuer + thumbprint (when present).
- SHA256SUMS comparison result.

Exit code is 0 on full pass, 1 on hash mismatch or invalid signature.

## Signing status

| Build path | Signature |
|---|---|
| CI `release-windows-signed` (when Azure Trusted Signing secrets present) | Authenticode-signed via Azure Trusted Signing |
| CI `release-windows-community` (no signing secrets) | Unsigned — verify by SHA256 hash and explicit publisher field |

Both paths are first-class. The community path is the default for forks
or community builds; the signed path runs automatically when a release
tag is pushed in the canonical repo with secrets configured.

## What is NOT a Lightning P2P installer

Be cautious of any of the following — they are not produced by this
project:

- Files named `LightningP2P*.exe` from sources other than the official
  GitHub Releases page.
- Bundles claiming Microsoft Store distribution (not yet shipped).
- Bundles claiming portable / no-install behavior (not produced).
- Any installer not matching a SHA256SUMS.txt entry from the same release.

The trust model is documented in
[`docs/download-trust.md`](download-trust.md).

## What we do not do (yet)

- MSIX packaging.
- Microsoft Store submission.
- Per-machine "all users" install variant (current installers are per-user).
- Group Policy templates (.admx/.adml).

These are roadmap items, not shipping. They are explicitly excluded so
the release surface stays small and verifiable.
