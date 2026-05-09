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

- [ ] `cargo clippy` passes with no warnings
- [ ] `cargo test` passes
- [ ] `pnpm lint && pnpm typecheck` passes
- [ ] Tested manually in dev mode (`pnpm tauri dev`)
- [ ] Browser/native runtime split and `/receive#t=<ticket>` handoff still work
