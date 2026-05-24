# Hardware-dependent launch assets

These are the deliverables Claude can't produce because they need a real
Windows machine, a real Android phone, and a real LAN/WAN transfer in
flight. They're the bottleneck between "code is ready" and "launch."

## 1. Hero demo GIF — highest leverage

**Goal:** ≤12 seconds, ≤8 MB, drop → QR → receive → success-card
moment. Replaces or augments [`public/demo-lightning-p2p.gif`](../../public/demo-lightning-p2p.gif).

**Capture rig:**

- One Windows laptop running `pnpm tauri dev` (or the signed Velopack
  install) with `LIGHTNING_P2P_PROFILE=alice`.
- One second Windows window with `LIGHTNING_P2P_PROFILE=bob`, OR an
  Android phone with the latest APK sideloaded.
- A 200–500 MB media file (camera footage, design export). Pick
  something visually meaningful in case a frame leaks the filename.
- ScreenToGif (Win) or `ffmpeg` for capture; `gifski` for compression.

**Storyboard (12 s):**

| Time | Frame |
|---|---|
| 0.0 s | Cold-start app open, drop zone visible |
| 1.0 s | File drop animation lands; "Reading your selection" skeleton (new) |
| 2.0 s | Staged selection card with file row |
| 2.5 s | "Generating link…" with Loader2 spinner (new) |
| 3.5 s | QR + receive link visible, route chip Direct ready |
| 4.5 s | Switch to receiver; phase chip animates Connecting → Direct |
| 6.0 s | Transferring with live throughput |
| 9.0 s | "Saved to" + Open folder / Send another / Copy summary actions (new) |
| 11.0 s | Cursor hovers small Star-CTA caption (do not click) |
| 12.0 s | Loop start |

**Don'ts:**

- Don't show a real receive ticket. Pre-stage `/receive#t=[hidden ticket]`
  in the visible URL strip.
- Don't show a real home path. Use a profile-scoped install in a
  scratch directory.
- Don't speed-ramp or fake the timing. The plan calls this out as a
  brand violation; if the real transfer is slow, choose a smaller file.

## 2. In-app screenshots — three minimum

Three 1280×720 PNGs in [`public/screenshots/`](../../public/):

1. `send-staged.png` — file dropped + staged selection visible + QR rendered.
2. `transfer-in-flight.png` — TransferCard mid-receive, route Direct, providers ≥ 1, first-byte timing populated.
3. `receive-success.png` — TransferCard in completed state with Open folder / Send another / Copy summary actions visible.

Both light-theme and dark-theme variants if you want them; native shell
is currently dark-only, so dark is canonical.

## 3. Social preview PNG — 1200×630

`public/og-image.png` and `public/github-social-preview.png` already
exist; refresh them only if the visual identity changes. If you do
refresh, follow DESIGN.json tokens: lab-black background, signal-green
for verified state, proof-amber sparingly for caveat.

## 4. Benchmark report — the actual unlock

The single most important asset for breaking the claims guardrail.
Once `docs/reports/v0.5.0-benchmarks.md` exists with real, repeatable
data, [`docs/launch-growth.md`](../launch-growth.md) flips speed
language from "hold" to "approved" — and every launch post in this
directory can stop hedging.

**Required scenarios** (per [`docs/BENCHMARKS.md`](../BENCHMARKS.md)):

- Windows → Windows LAN, 1 GB single file, 5+ runs, median Mbps.
- Windows → Android LAN, 1 GB single file, 5+ runs.
- Android → Windows LAN, 1 GB single file, 5+ runs.
- WAN direct, 1 GB single file, route proof.
- Relay fallback, 1 GB single file, relay URL noted.
- Many small files, 200+ files.
- Huge single file, 10 GB+, with memory peak.
- Android `content://` import time.
- Android MediaStore export time.

**Tooling:**

- [`scripts/benchmark-matrix.ps1`](../../scripts/benchmark-matrix.ps1) generates the CSV scaffold.
- Fill the report from [`docs/benchmark-report-template.md`](../benchmark-report-template.md).
- Commit raw CSVs alongside the report under `docs/reports/raw/<version>/`.

**Comparisons against other tools** are optional in v1 of the report.
If included, list the comparison tool's exact version, route, hardware,
and settings; otherwise skip the comparison.

## 5. Pinned good-first-issues

Not a hardware blocker, but a launch-day need. Create 4–6 issues with
the `good first issue` label so HN/Reddit visitors who star the repo
have a clear contribution surface:

- Light-theme support (deferred from Batch 2 DESIGN.json rollout).
- Add `useLatestReceiveTransfer` selector mirror of `useLatestSendTransfer`.
- macOS packaging spike (clearly scoped, with constraints).
- F-Droid metadata + reproducible-build doc.
- README hero in Spanish / French / Japanese (community can carry).
- Storybook scaffolding for `TransferCard` states.

## Posting-day checklist

After 1–4 are done:

- [ ] Replace README demo GIF reference.
- [ ] Add screenshots to `public/screenshots/` and reference them in [`docs/PRESS_KIT.md`](../PRESS_KIT.md).
- [ ] Link the benchmark report from README, website Download/Benchmarks pages, and SECURITY.md.
- [ ] Update [`docs/launch-growth.md`](../launch-growth.md) "Hold until benchmarks" rows for any claim now backed by data.
- [ ] Verify [`scripts/check-release-state.mjs`](../../scripts/check-release-state.mjs) still passes.
- [ ] Smoke install the Windows installer on a fresh VM.
- [ ] Smoke install the APK on a fresh Android device, verify cert fingerprint.
- [ ] Post HN Tuesday/Wednesday morning Pacific.
- [ ] Drop the Twitter thread + LinkedIn post when the HN post hits page 1.
- [ ] Open the pinned GitHub Discussion for the launch thread.
