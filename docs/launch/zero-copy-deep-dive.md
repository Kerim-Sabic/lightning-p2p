# Deep-dive post: zero-copy on both ends (v0.9.32)

> Long-form technical post for Hacker News (as a regular link post, not Show
> HN), r/rust, lobste.rs, or dev.to. Every number links to committed raw data.
> Keep the caveats in; they are the reason the numbers are believable.

## Title options

- `Saving a 1 GB download in 2 ms: zero-copy transfers on a content-addressed store`
- `We were writing every received file twice. Here's how hard links fixed it`
- `Zero-copy sends and saves in a Rust P2P app (iroh-blobs, Tauri)`

## Post

Lightning P2P moves files directly between devices: the sender imports files
into a local [iroh-blobs](https://github.com/n0-computer/iroh-blobs) store,
hands the receiver a ticket (node ID + BLAKE3 root hash), and the receiver
streams verified chunks into its own store before saving them where the user
wants them.

That design has a hidden cost on both ends. Before v0.9.32, a 1 GB transfer
wrote the payload to disk **three** times and never gave two of those copies
back:

1. the sender copied the file into its store before it could hash it;
2. the receiver wrote verified chunks into its store;
3. the receiver copied the finished file out of the store into Downloads;
4. and both store copies stayed forever, because nothing ever told garbage
   collection what to keep.

### Sends: hash in place

iroh-blobs can import a file by reference (`ImportMode::TryReference`): it
hashes the file where it is and records the path instead of copying the
bytes. Desktop shares now do that; Android keeps copying, because picked and
shared files are staged in a cache folder the platform layer deletes after
the share is prepared. We also overlapped the relay wait with hashing.
Together, time-to-ticket for 1 GB dropped from 18.3 s to 6.0 s on our test
VM.

### Saves: the move that never ran

The first attempt at fixing step 3 used iroh-blobs' export with
`ExportMode::TryReference`, which renames the store's data file to the
target instead of copying it. Tests passed, and the benchmark barely moved.

The reason: every share the app creates is a *collection*: a hash sequence of
(name, blob) pairs, even when it holds one file. The move only applied to
raw single-blob tickets, which real transfers never produce. The tests had
exercised the path directly and missed that.

Extending the rename to collections exposed a deeper problem. After the
rename, the store's entry points at the exported path. Collection saves then
rename children from a scratch folder into the final tree, and every rename
leaves the store holding a dangling path. Worse, a later receive of the same
content would see a "complete" entry, skip the download, and fail on export.

### Hard links instead

The fix is simpler than the move: leave the store alone.

The file store keeps every verified blob above 16 KiB as one plain file
(`PathOptions::data_path`). The save step now hard-links that file into the
private scratch folder and publishes it exactly as before. The store keeps
its own name for the data, the user gets a second name for the same inode,
and when garbage collection later drops the store entry, only the store's
name disappears. Nothing ever points at a path that moved.

A file is still copied when:

- it is 16 KiB or smaller (those live inline in the store database);
- another pin uses the same content (a share, a paused receive, or older
  content), so editing a saved file in place can never change bytes a share
  serves;
- the save folder is on another volume, or the link fails for any reason;
- the device is Android.

### Garbage collection that actually runs

Fixing step 4 needed pins: `share/<root>` for every share,
`receive/<id>` for in-flight and resumable receives, and `legacy/<hash>` for
everything already in the store when retention shipped, so no existing share
lost data. GC stays gated closed until that one-time migration finishes.

Then we found that iroh-blobs' GC loop *sleeps before its first run*. A
10-minute interval means a user who opens the app, receives a file, and
closes it within 10 minutes never gets anything collected. The collector now
wakes every 10 s. A wake costs nothing unless a receive was released since
the last run, and it waits for releases to settle so a burst of transfers is
collected once, after it ends.

### Numbers

Same-machine harness, v0.9.31 (copy) vs v0.9.32 (hard link), 4-vCPU Linux
VM, medians of alternating runs
([raw data](https://github.com/Kerim-Sabic/lightning-p2p/tree/main/docs/reports/raw/v0.9.32-save-path)):

| Receive | Save step | Whole receive |
| --- | ---: | ---: |
| 1 GB | 7,857 ms → 2 ms | 14,374 ms → 6,688 ms |
| 100 MB | 950 ms → 4 ms | 1,596 ms → 646 ms |
| 200 × 100 KB | 135 ms → 14 ms | 321 ms → 221 ms |

These are loopback numbers: no Wi-Fi, no WAN, no relay, one machine. On a
faster disk the copy we removed costs less, so the gain is smaller. They say
nothing about how Lightning P2P compares with other apps.

### Tests that pin the behaviour

- A linked save shares the store file's inode; a missing store file falls
  back to a copy.
- In a folder save, large children are linked, while pinned and inline
  children are copied.
- With the real GC running, a released receive is reclaimed, the store's data
  file is deleted, and the saved file is still intact.

### Known limits

- On Windows, if a saved file is open without delete sharing when GC runs,
  the store's name for it cannot be removed and lingers in app data.
- A saved file edited in place within the ~10–20 s before collection also
  changes the store's copy until it is collected.

Code: [`transfer/export.rs`](https://github.com/Kerim-Sabic/lightning-p2p/blob/main/src-tauri/src/transfer/export.rs),
[`node/retention.rs`](https://github.com/Kerim-Sabic/lightning-p2p/blob/main/src-tauri/src/node/retention.rs).
Lightning P2P is Apache-2.0: https://github.com/Kerim-Sabic/lightning-p2p
