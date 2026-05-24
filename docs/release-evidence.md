# Release evidence — what's automated, what's manual

Catalog of every automated check that produces verifiable evidence about a
Lightning P2P release. The point: nothing in here requires a human to
type numbers into a CSV. Each row links to the script or workflow that
generates the evidence on every push.

## TL;DR

| Surface | Automated? | Where |
|---|---|---|
| Rust clippy `-D warnings` | yes | CI `rust` job + `pnpm check:rust` |
| Rust unit + integration tests | yes (lib gated on Windows) | CI `rust` job |
| TypeScript typecheck | yes | CI `frontend` job + `pnpm typecheck` |
| ESLint | yes | CI `frontend` job + `pnpm lint` |
| Vitest | yes (CI gap until this batch — see below) | `pnpm test` |
| Release-state version sync | yes (CI gap until this batch) | `scripts/check-release-state.mjs` |
| Same-machine benchmark | **yes (new)** | `scripts/run-local-benchmark.ps1` / `.sh` |
| Windows installer build (NSIS + MSI) | yes | CI `windows-package` job |
| Velopack signed installer | yes (when secrets present) | CI `release-windows-signed` |
| Windows checksum + signature verification | yes | CI `release-windows-*` jobs |
| Android APK build | yes | CI `android-package` |
| Android AAB build | yes | CI `android-package` |
| Android emulator launch smoke | yes | CI `android-emulator-smoke` |
| Android signed APK/AAB | yes (when secrets present) | CI `release-android` |
| `apksigner verify` with cert print | yes | CI `release-android` |
| Real WAN / NAT / Wi-Fi numbers | **no — needs real hardware** | [`BENCHMARKS.md`](BENCHMARKS.md) methodology |
| Windows ↔ Android cross-device transfer | **no — needs real hardware** | manual smoke checklist |
| External security audit | **no — explicit caveat in SECURITY.md** | — |

## What changed in this batch

1. **Benchmark binary**: `src-tauri/src/bin/benchmark_local.rs` boots two
   `LightningP2PNode` instances in temp dirs (the same-machine
   `LIGHTNING_P2P_PROFILE=alice` ↔ `bob` story), runs the real
   `sender::create_share` + `receiver::receive_ticket` paths, and emits
   privacy-safe CSV + JSON evidence. Runs via `pnpm bench:local`.
2. **CI vitest job**: `pnpm test` runs on every PR (was missing).
3. **CI release-state job**: `pnpm check:release-state` runs on every PR (was missing).
4. **CI benchmark smoke job**: `pnpm bench:local` runs on every push, uploads `docs/reports/raw/local/latest.{csv,json}` as an artifact.

## What it does NOT prove

The same-machine harness measures loopback throughput in a single
process. It does **not** measure:

- WAN throughput.
- NAT traversal time-to-first-byte.
- Relay-fallback throughput.
- Real Wi-Fi or wired physical layer.
- Android `content://` import time.
- Android MediaStore export time.
- iOS anything.
- Battery, thermal, or radio costs.

Those numbers can only come from real-device runs documented in
[`BENCHMARKS.md`](BENCHMARKS.md) and recorded with the template at
[`benchmark-report-template.md`](benchmark-report-template.md). The
claims-guardrail in [`launch-growth.md`](launch-growth.md) holds back
every speed-leadership claim until a real-device report exists. Do not
quote local harness numbers as "Lightning P2P transfer speed" — quote
them only as "same-machine loopback throughput on the harness."

## How to reproduce every line of evidence locally

```powershell
# Code-quality gates
pnpm check                  # release-state + frontend (lint/tc/test/build) + rust (test + clippy)
pnpm check:baseline         # adds cargo fmt --check; skips Windows-gated integration tests

# Same-machine benchmark
pnpm bench:local            # 1 scenario × 3 runs (~30 s)
pnpm bench:local:full       # 2 scenarios × 5 runs (a few minutes)

# Windows installer artifacts (local dry run; uses local Tauri toolchain)
pnpm build:windows

# Android APK + AAB local build (needs Android SDK + NDK)
pnpm android:build:apk
pnpm android:build:aab
```

After any release tag, CI produces:

- `lightning-p2p-windows-smoke-bundle` (NSIS + MSI from `windows-package`).
- `lightning-p2p-windows-release-stage` (Velopack + NSIS + MSI + SHA256SUMS, signed or community).
- `lightning-p2p-android-smoke` (debug APK + AAB).
- `lightning-p2p-android-release` (signed APK + AAB + SHA256SUMS + apksigner cert printout, when secrets present).
- `lightning-p2p-local-benchmark` (latest local-harness CSV/JSON from the smoke job introduced in this batch).
