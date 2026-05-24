# Lightning P2P benchmark reports

This directory holds **measured** benchmark evidence. Nothing in here is
invented or speculative. If a number is in `summary` or in a CSV row, it
came from running the harness on real hardware.

## Files

- [`automated-local-benchmarks.md`](automated-local-benchmarks.md) — preliminary same-machine harness report. Methodology + scope + how to reproduce. Numbers (if present) come from the most recent `raw/local/latest.json`.
- `raw/local/<unix>-local.json` — every harness run as JSON.
- `raw/local/<unix>-local.csv` — flat CSV per run.
- `raw/local/latest.json` and `raw/local/latest.csv` — copies of the most recent run for quick scripting.

## What lives here vs. what doesn't

| In scope | Out of scope |
|---|---|
| Same-machine loopback throughput from the automated harness | Real Windows ↔ Android transfer numbers |
| Local time-to-ticket, download_ms, export_ms, effective_mbps | WAN / NAT / relay throughput |
| Run count, failures, OS, arch, commit hash, app version | Speed comparisons to LocalSend / PairDrop / WeTransfer |
| Privacy-safe error strings (tickets and home paths redacted) | "Fastest" claims of any kind |

Real-device WAN / Android / relay reports use the methodology in
[`../BENCHMARKS.md`](../BENCHMARKS.md) and the template in
[`../benchmark-report-template.md`](../benchmark-report-template.md). They
are not produced automatically because they need real hardware on
different networks.

## Reproducing the local harness

```powershell
pwsh scripts/run-local-benchmark.ps1                       # smoke, ~30 s
pwsh scripts/run-local-benchmark.ps1 -Profile full -Runs 5 # ~few minutes
```

```bash
scripts/run-local-benchmark.sh
scripts/run-local-benchmark.sh --profile full --runs 5
```

Or via `pnpm`:

```powershell
pnpm bench:local
pnpm bench:local:full
```

The harness writes both raw CSV and pretty JSON. The most recent run is
always available at `raw/local/latest.{csv,json}` for downstream tooling.
