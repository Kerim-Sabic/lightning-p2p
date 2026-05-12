## Summary

Brief description of the changes.

## Changes

- User-facing behavior changes
- Docs, branding, or release text updates
- Implementation notes or follow-up work

## User-Facing Impact

- [ ] README and docs updated for any visible branding or behavior change
- [ ] Release notes or installer text updated if packaging changed
- [ ] SHA256 checksum or release asset notes updated if applicable
- [ ] Website route metadata, AEO copy, and internal links updated if public copy changed
- [ ] Security wording stays precise: no fake speed, privacy, audit, or signing claims

## Checklist

- [ ] `pnpm check` passes, or equivalent targeted checks are listed below
- [ ] `pnpm build` passes if the website, metadata, or release surface changed
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` passes for Rust changes
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` passes for Rust changes
- [ ] `pnpm lint && pnpm typecheck` passes for frontend changes
- [ ] Tested manually in dev mode (`pnpm tauri dev`)
- [ ] Browser/native runtime split and `/receive#t=<ticket>` handoff still work
