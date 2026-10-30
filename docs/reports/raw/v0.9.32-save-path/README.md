# v0.9.32 receive save path: copy vs hard link

Raw `benchmark-local` reports (schema v2) behind the v0.9.32 changelog entry
"Save received files and folders without writing them a second time".

## What was compared

| Label | Build | Save step |
| --- | --- | --- |
| `v0.9.31-copy` | app version 0.9.31 | Copies every verified file out of the transfer store |
| `v0.9.32-link` | the save path merged in #67 (source equal to `ba3ff87`) | Hard-links the store's verified file into place |

The `commit_hash` field in these reports is the checkout's `HEAD` when the run
executed, not the source of the binary, so both builds report `2b0d043`. Use
`app_version` and the file name to tell them apart.

## Environment

- Linux x86_64 cloud VM, 4 vCPU (Intel Xeon @ 2.80 GHz), virtio disk.
- Release profile with `lto = false` and `codegen-units = 16` (faster local
  builds; both binaries built the same way).
- `--profile full --runs 1`, one process per run, the two builds alternating.

## Medians

| Scenario | Runs | Save (`export_ms`), copy → link | Total receive, copy → link |
| --- | ---: | ---: | ---: |
| `same_machine_1gb` | 4 + 4 | 7,857 ms → **2 ms** | 14,374 ms → **6,688 ms** |
| `same_machine_100mb` | 3 + 3 | 950 ms → **4 ms** | 1,596 ms → **646 ms** |
| `same_machine_many_small` (200 × 100 KB) | 3 + 3 | 135 ms → **14 ms** | 321 ms → **221 ms** |

`time_to_ticket_ms` is the sender's import and is not part of the receive
total.

## Caveats

Same-machine loopback only: not WAN, not Wi-Fi, not relay, and not two
devices. The save step only links when the save folder is on the same volume
as the app's data; other volumes, files of 16 KiB or less, content still
pinned by a share or a paused receive, and Android keep copying. On a disk
faster than this VM's, the copy cost (and so the gain) is smaller. Do not
quote these numbers as a comparison with other apps.
