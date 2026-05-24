# Lightning P2P Benchmarks

Lightning P2P is designed for high-throughput direct transfer, but the project
does not claim speed leadership without repeatable public benchmark data.

Use this page as the evidence index. A benchmark is publishable only when it
includes the app version, commit hash, build type, hardware, route kind, file
set, run count, median result, failures, and caveats.

## Current Claim Status

- Public speed leadership claim: not published.
- Public benchmark report: not published yet.
- Methodology template: [benchmark-report-template.md](benchmark-report-template.md).
- Matrix helper: [`scripts/benchmark-matrix.ps1`](../scripts/benchmark-matrix.ps1).

Approved wording before a report exists:

> Lightning P2P is designed for high-throughput direct transfer, but public
> speed claims require repeatable benchmark reports.

Do not use wording such as "fastest", "speed leader", or "beats LocalSend" until
the linked benchmark data supports the exact claim.

## Required Scenarios

Record at least five runs per scenario unless the report explains why fewer
runs were possible.

| Scenario | File set | Required notes |
| --- | --- | --- |
| Windows to Windows LAN | 1 GB single file | Route kind, direct address count, median Mbps |
| Windows to Android LAN | 1 GB single file | Android battery/thermal notes and save destination |
| Android to Windows LAN | 1 GB single file | Share-target or picker source and import time |
| Android to Android | 1 GB single file | Mark unsupported if not validated |
| WAN direct | 1 GB single file | ISP/network details and route proof |
| Relay fallback | 1 GB single file | Relay URL, failures, median Mbps |
| Many small files | 200+ files | Import time, download time, export time |
| Huge file | 10 GB or larger | Disk, memory peak, sender-online caveat |
| Android Gallery share | Large video | `content://` import time and foreground state |
| Android MediaStore receive | JPG, MP4, MP3, PDF | Final bucket and folder receives caveat |

## Metrics To Capture

- Time from app launch to interactive.
- Time from file drop/share intent to ticket generated.
- Time from receive ticket to connection attempt.
- Time to first byte.
- Download duration, export duration, and effective Mbps.
- Route kind: direct, relay, mixed, or unknown.
- Provider counts: total, direct, relay.
- Memory peak and CPU notes for large transfers.
- Android import/export time and battery/thermal notes.
- Failure count and exact recovery path.

## Publishing Rules

- Publish raw notes and filled CSV next to the report.
- Include failed runs; do not average them away.
- Separate LAN direct, WAN direct, and relay fallback results.
- Do not compare against other tools without listing their version, settings,
  route, and test hardware.
- Keep limitations visible: sender must stay online, tickets are capabilities,
  and relay fallback is connectivity help, not cloud storage.
