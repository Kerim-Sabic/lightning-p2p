# Automated local benchmark — not a full real-device report

**Scope:** same-machine loopback only. **Not** Windows ↔ Android. **Not** WAN.
**Not** relay. **Not** Wi-Fi. **Not** physical-layer or NAT traversal. Do not
quote these numbers as "Lightning P2P transfer speed" — quote them as
"same-machine loopback throughput on the automated harness."

The numbers below come from running [`src-tauri/src/bin/benchmark_local.rs`](../../src-tauri/src/bin/benchmark_local.rs)
against the real `LightningP2PNode` + `sender::create_share` +
`receiver::receive_ticket` paths. Two nodes boot in temp dirs (the same-
machine `LIGHTNING_P2P_PROFILE=alice` ↔ `bob` story, just without env vars
or a GUI), the share is created on the sender, parsed into a `ShareTicket`,
and the receiver downloads + verifies + exports to disk. iroh-blobs handles
streaming with BLAKE3 verification on every chunk; the receive route is
reported by the real `ReceiveOutcome.route_kind`.

The raw CSV and JSON for every run live at
[`raw/local/`](raw/local/). The most recent run is always at
[`raw/local/latest.json`](raw/local/latest.json) and
[`raw/local/latest.csv`](raw/local/latest.csv).

## How to reproduce

```powershell
pnpm bench:local            # 1 scenario × 3 runs, ~30 s
pnpm bench:local:full       # 2 scenarios × 5 runs, ~few minutes
```

```bash
scripts/run-local-benchmark.sh --profile smoke --runs 3
scripts/run-local-benchmark.sh --profile full --runs 5
```

CI runs the smoke profile on every push and uploads the result as the
`lightning-p2p-local-benchmark` artifact.

## What the harness measures

| Field | Meaning |
|---|---|
| `time_to_ticket_ms` | Wall time from `sender::create_share` start to a parsed `ShareTicket`. Bounded by content import + ticket encoding. |
| `connect_ms` | `ReceiveOutcome.connect_ms` — time to first successful peer contact. Includes endpoint negotiation. |
| `download_ms` | `ReceiveOutcome.download_ms` — time spent streaming bytes into the local blob store with BLAKE3 verification. |
| `export_ms` | `ReceiveOutcome.export_ms` — time to write verified bytes from the blob store to the destination file. |
| `total_ms` | Wall time from `receiver::receive_ticket` start to return. Strict superset of connect + download + export. |
| `effective_mbps` | `bytes * 8 / 1_000_000 / total_seconds`. Conservative — uses total elapsed, not download-only. |
| `route_kind` | `ReceiveOutcome.route_kind`, lowercased. Loopback always reports `direct`. |
| `success` | Whether the run completed without error. |
| `error` | Privacy-safe error string with tickets stripped, when present. |

## Most-recent run (committed copy)

Run identity (from [`raw/local/latest.json`](raw/local/latest.json)):

- App version: 0.5.0
- Commit: 6b82ab9a0e49
- OS / arch: windows / x86_64
- Harness: `same-machine-two-profile`
- Transport: `iroh-loopback`
- Runs per scenario: 3
- Failures: 0

Summary table (medians across the 3 successful runs per scenario):

| Scenario | Bytes | Median total | Median download | Median export | Median effective |
|---|---:|---:|---:|---:|---:|
| `same_machine_10mb` | 10 485 760 | 276 ms | 268 ms | 7 ms | 303.78 Mbps |
| `same_machine_100mb` | 104 857 600 | 1 130 ms | 1 122 ms | 7 ms | 742.10 Mbps |

Read the per-run rows in [`raw/local/latest.csv`](raw/local/latest.csv) for
the full distribution including time_to_ticket and connect_ms. A second
sample run (the 10 MB CSV at `raw/local/<earlier>-local.csv`) confirms
the ~300 Mbps median is stable across invocations.

These numbers were generated from one Windows dev machine. They will
vary on other hardware, with different storage, under contention, or
across cold-cache vs warm-cache scenarios. They are a regression baseline
for the loopback path, **not** a real-world transfer speed claim.

## What this report does NOT prove

- **WAN throughput.** No two machines, no NAT, no internet path.
- **Wi-Fi or Ethernet throughput.** Loopback bypasses the NIC.
- **Relay fallback.** Loopback never touches the relay code path.
- **Windows ↔ Android transfer.** No Android device.
- **Sender-online behavior over time.** Runs are short.
- **Memory peak with very large files.** Largest scenario here is 100 MB.
- **Many-small-files routing on Android.** Single-file scenarios only.
- **Comparison against LocalSend / PairDrop / WeTransfer.** No measured
  competitor runs are part of this harness.
- **Speed leadership of any kind.** Same-machine loopback is the wrong
  surface to compare across products. The claims-guardrail in
  [`../launch-growth.md`](../launch-growth.md) explicitly holds back
  "fastest" and competitor language until a real-device report exists.

## When to use this report

- Catching local-path regressions across releases. If a code change moves
  the median 100 MB total_ms from ~1.1 s to ~3.0 s, the harness will
  surface it; CI uploads `lightning-p2p-local-benchmark` per push so a
  reviewer can compare.
- Sanity-checking that the multi-provider, structured-error, and
  diagnostics-redaction refactors did not regress the loopback path.
- Demonstrating that BLAKE3 verification and the iroh-blobs streaming
  path can saturate fast loopback IO without buffering full files.

## When NOT to use this report

- In marketing copy, README hero, or any claim involving real users.
- In comparison pages against other transfer tools.
- In benchmarks attached to release notes — those still need
  [`../BENCHMARKS.md`](../BENCHMARKS.md) methodology with real hardware.

The next-level evidence (real Windows ↔ Android, WAN, relay) requires
real devices on real networks. The methodology is fixed in
[`../BENCHMARKS.md`](../BENCHMARKS.md); the template is at
[`../benchmark-report-template.md`](../benchmark-report-template.md).
