# Release Checklist

Use this before promoting a public Lightning P2P release.

## Always

- [ ] `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` use the release version.
- [ ] `CHANGELOG.md` has the release section moved out of `Unreleased`.
- [ ] GitHub Release tag matches the app version.
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm build`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- [ ] `pnpm build:windows`
- [ ] README, website, and release notes avoid "fastest", "unlimited", "military-grade", and impossible privacy claims.
- [ ] Security copy says tickets are capability tokens.
- [ ] Browser copy says `/receive#t=<ticket>` is handoff only.

## Community Unsigned Release

- [ ] Trigger the workflow with `release_mode=community_unsigned` or push a tag without production signing secrets.
- [ ] Confirm the GitHub Release is a draft before publishing.
- [ ] Confirm release notes clearly say "unsigned community build".
- [ ] Confirm release notes warn that SmartScreen may show an unrecognized-app warning.
- [ ] Confirm release notes do not claim Authenticode signing or SmartScreen bypass.
- [ ] `LightningP2P-win-Setup.exe` exists.
- [ ] `LightningP2PSetup.exe` exists.
- [ ] `LightningP2P.msi` exists.
- [ ] `SHA256SUMS.txt` exists.
- [ ] `scripts/verify-release.ps1` reports checksum match.
- [ ] Unsigned artifacts report `Unsigned`, not `Signed but invalid`.

Verification command:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-release.ps1 -Installer .\LightningP2PSetup.exe -Checksums .\SHA256SUMS.txt
```

## Production Signed Release

- [ ] Trigger the workflow with `release_mode=production_signed` or push a tag with all production signing secrets present.
- [ ] Tauri updater signing key is configured.
- [ ] Microsoft Trusted Signing secrets are configured.
- [ ] Authenticode verification passes for `lightning-p2p.exe`, NSIS, MSI, and Velopack setup artifacts.
- [ ] Tauri updater metadata exists and is uploaded.
- [ ] `.sig` files are uploaded only when generated.
- [ ] Release notes claim signing only after Authenticode verification passes.
- [ ] Publisher identity matches the verified Microsoft Store/signing identity.

Current publisher placeholder: `Lightning P2P`.

TODO before production signing or Store submission: update publisher metadata to
match the verified legal Store/signing identity exactly.

## Clean Windows VM Verification

- [ ] Download installer and `SHA256SUMS.txt` from GitHub Releases.
- [ ] Run `scripts/verify-release.ps1`.
- [ ] Install on a clean Windows 11 VM.
- [ ] Confirm app launches.
- [ ] Confirm send and receive work.
- [ ] Confirm `/receive#t=<ticket>` handoff opens the desktop app without leaking the ticket to the website server.
- [ ] Confirm nearby discovery firewall behavior is understandable.
- [ ] Confirm uninstall removes the app.
- [ ] Confirm Velopack firewall rule is removed after uninstall.

## Promotion

- [ ] GitHub social preview uploaded.
- [ ] Topics reviewed.
- [ ] Launch issues pinned.
- [ ] SEO sitemap submitted.
- [ ] Benchmark claims backed by public reports.
- [ ] Community unsigned releases are promoted only with clear trust documentation.
