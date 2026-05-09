# Release Checklist

Use this before promoting a public Lightning P2P release.

## Version And Assets

- [ ] `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` use the release version.
- [ ] `CHANGELOG.md` has the release section moved out of `Unreleased`.
- [ ] GitHub Release tag matches the app version.
- [ ] `LightningP2P-win-Setup.exe` exists.
- [ ] `LightningP2PSetup.exe` exists.
- [ ] `LightningP2P.msi` exists.
- [ ] `SHA256SUMS.txt` exists.
- [ ] Tauri updater metadata exists when updater artifacts are enabled.

## Signing

- [ ] Tauri updater signing key is configured.
- [ ] Microsoft Trusted Signing secrets are configured.
- [ ] Authenticode verification passes for `lightning-p2p.exe`, NSIS, MSI, and Velopack setup artifacts.
- [ ] Local docs say "signing support" unless the specific release artifacts have been verified.

## Public Copy

- [ ] README points to real release assets or `/releases/latest`.
- [ ] Website download links resolve.
- [ ] No "fastest", "unlimited", "military-grade", or impossible privacy claims.
- [ ] Security copy says tickets are capability tokens.
- [ ] Browser copy says `/receive#t=<ticket>` is handoff only.

## Verification

- [ ] `pnpm build`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `cargo build --manifest-path src-tauri/Cargo.toml`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- [ ] Clean Windows VM install, deep link, firewall rule, send, receive, uninstall

## Promotion

- [ ] GitHub social preview uploaded.
- [ ] Topics reviewed.
- [ ] Launch issues pinned.
- [ ] SEO sitemap submitted.
- [ ] Benchmark claims backed by public reports.
