# Lightning P2P Roadmap

This roadmap is intentionally conservative. It avoids fake speed, security, or platform claims.

## Promotion Release: v0.4.1

- Ship the polished README and website.
- Publish release notes that use "no artificial file-size cap" and avoid speed leadership claims.
- Verify installer aliases: `LightningP2P-win-Setup.exe`, `LightningP2PSetup.exe`, and `LightningP2P.msi`.
- Verify Authenticode, updater signatures, and `SHA256SUMS.txt` on a clean Windows machine.
- Resubmit winget after signed release assets are live.

## Reliability

- Add endpoint restart supervisor for relay/local-discovery settings.
- Improve nearby discovery diagnostics in Settings.
- Move flaky LAN/multicast smoke tests to ignored/manual test suites.
- Add deterministic nearby registry/protocol tests.
- Add IPC contract tests for command/event payloads.
- Add cancellation through receive export.

## Android Alpha

- Verify debug build on a physical Android device.
- Validate file picker/content URI import behavior.
- Validate app-private receive/export behavior under scoped storage.
- Record Android-to-Windows and Windows-to-Android transfer notes.
- Narrow Android permissions and FileProvider paths after real-device file flow is known.
- Add Android CI smoke coverage once the local toolchain path is stable.

## Platform Expansion

- macOS packaging spike.
- Linux packaging spike.
- iOS feasibility after multicast entitlement and file picker strategy are clear.

## Product UX

- Pause/resume transfer UX.
- Clear history and peer cache controls.
- Better transfer diagnostics for direct vs relay path.
- Optional pairing/approval for nearby discovery metadata.
- Benchmark report UI once repeatable results exist.

## Growth

- Add a real updated demo capture after the next polished build.
- Fill benchmark reports before making speed claims.
- Keep README first screen short and proof-oriented.
- Publish honest comparison pages and docs.
- Encourage good first issues around packaging, diagnostics, tests, and accessibility.
