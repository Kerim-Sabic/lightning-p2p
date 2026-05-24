# Launch Kit

Pre-written posts for Lightning P2P launches across HN, Reddit, Twitter,
Product Hunt, and LinkedIn. Use them as-is or as starting drafts.

**What you can already point to today (no manual hardware required):**

- The automated same-machine harness at [`docs/reports/automated-local-benchmarks.md`](../reports/automated-local-benchmarks.md) — real, reproducible loopback throughput evidence with raw CSV/JSON.
- `pnpm bench:local` runs that harness in ~30 s on a clean clone.
- The CI `benchmark-local-smoke` job uploads the same evidence on every push.
- [`docs/release-evidence.md`](../release-evidence.md) catalogs every automated check.

**What still holds back "fastest" and competitor claims:** the
real-device WAN / Wi-Fi / Android matrix in
[`docs/BENCHMARKS.md`](../BENCHMARKS.md). The same-machine harness is
loopback only — it does not replace real-device evidence. The rows in
[`docs/launch-growth.md`](../launch-growth.md) labeled "Hold until
benchmarks" stay held.

## Files

- [`hackernews-show-hn.md`](hackernews-show-hn.md) — Show HN title, body, and three prepared replies.
- [`reddit-rust.md`](reddit-rust.md) — r/rust angle.
- [`reddit-opensource.md`](reddit-opensource.md) — r/opensource angle.
- [`reddit-selfhosted.md`](reddit-selfhosted.md) — r/selfhosted angle.
- [`reddit-android.md`](reddit-android.md) — r/android sideload angle.
- [`twitter-thread.md`](twitter-thread.md) — six-tweet thread.
- [`producthunt.md`](producthunt.md) — Product Hunt title, tagline, description, first comment.
- [`linkedin.md`](linkedin.md) — single long-form post.

## Posting checklist

1. The benchmark report at `docs/reports/<version>-benchmarks.md` is published.
2. The README, website, and `public/llms.txt` reference the report.
3. Every claim in the post you're about to send matches the report.
4. No screenshot leaks a real receive ticket. Use `/receive#t=[hidden ticket]`-style placeholders.
5. The GitHub release is tagged, signed (where applicable), and verified locally with `scripts/verify-release.ps1`.
6. The "Verify your download" line is visible in the README first viewport.
7. Pinned GitHub issue templates (`benchmark-submission`, `bug-report`, `feature-request`) exist.
8. The repo's social preview image is up to date.

## Timing notes

- HN: Tuesday or Wednesday morning Pacific. Avoid Mondays (firehose) and Fridays (low engagement).
- Reddit: weekday mornings local to each sub's primary audience. r/rust and r/opensource skew US/EU; r/android is global.
- Product Hunt: launch at midnight Pacific to capture the full day window.
- Twitter / LinkedIn: time to the HN front-page push, not before. Cross-link, do not double-post.

## Reply-readiness

Have honest answers prepared for:

- "How is this different from LocalSend / PairDrop / Croc / Magic Wormhole?"
- "Why no macOS / Linux / iOS yet?"
- "Why should I trust the signed installer?"
- "Where is the benchmark data?"
- "Is the sender required to stay online?"
- "What happens if direct connection fails?"

The honest answer to all of these is in [`SECURITY.md`](../../SECURITY.md),
[`PRIVACY.md`](../../PRIVACY.md), [`docs/BENCHMARKS.md`](../BENCHMARKS.md),
and [`docs/security-model.md`](../security-model.md). Don't improvise — link.
