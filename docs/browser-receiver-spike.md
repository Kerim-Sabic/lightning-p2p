# Browser-receiver feasibility spike — result: GO

**Question:** can Lightning P2P let someone receive a file in any browser, with
no install, keeping the "all transfer is iroh + iroh-blobs, BLAKE3-verified, no
HTTP file server" invariant?

**Answer: yes.** The entire browser data path compiles to `wasm32-unknown-unknown`
and uses the same Rust engine as the app. This de-risks the v0.9.0 headline
feature and scopes the work.

## What was verified (reproducible)

| Check | Result |
|---|---|
| `iroh 1.0.2` + `iroh-blobs 0.103.0` resolve together | ✅ |
| Native build of the receive path (API correctness) | ✅ first-try |
| **`wasm32-unknown-unknown` build of the receive path** | ✅ |
| Standalone `web-receiver/` crate compiles to wasm (release, ~6 MB raw) | ✅ |
| 3 unit tests (ticket-envelope parsing) pass | ✅ |

The browser receive path is exactly:

```rust
let lookup = MemoryLookup::new();
let endpoint = Endpoint::builder(presets::N0).address_lookup(lookup.clone()).bind().await?;
lookup.add_endpoint_info(ticket.addr().clone());          // teach it the sender's relay addr
let store = MemStore::new();
let downloader = store.downloader(&endpoint);
downloader.download(ticket.hash_and_format(), [ticket.addr().id]).await?;  // BLAKE3-verified
let bytes = store.blobs().get_bytes(ticket.hash()).await?;
```

### Build note

`iroh`'s `tls-ring` feature pulls in `ring`, which compiles a little C to wasm,
so a clang targeting `wasm32` must be present. CI's Linux clang works directly;
locally an Android NDK clang via `CC_wasm32_unknown_unknown=<ndk>/clang.exe`
also works. This is an environment requirement, not a blocker — `ring 0.17`
supports wasm32 and n0's own `browser-blobs` example ships on this stack.

## Why the whole app must move to iroh 1.0 first

A 1.0 wasm client **cannot** receive from the app while the app is on iroh
0.35: iroh 0.91 intentionally broke the relay wire protocol ("the last relay
break") and n0 runs separate relay fleets per protocol era. Browsers have no
non-relay path, so both ends must be 1.0.

This migration is **mandatory regardless of the browser feature**: n0 sunsets
public-relay support for 0.35-era clients on **2026-12-31**, after which the
app loses WAN relay connectivity. v0.9.0 does the migration; the browser
receiver rides along.

## Verified iroh 0.35 → 1.0 / iroh-blobs 0.35 → 0.103 API map

Confirmed against the 1.0.2 / 0.103.0 crate sources:

| Concern | 0.35 | 1.0 / 0.103 |
|---|---|---|
| Endpoint build | `Endpoint::builder().discovery_n0()` | `Endpoint::builder(presets::N0)` / `Endpoint::bind(presets::N0)` |
| Out-of-band addrs | `discovery` / `add_node_addr` | `address_lookup` + `MemoryLookup::add_endpoint_info` |
| Identity types | `NodeId` / `NodeAddr` | `EndpointId` / `EndpointAddr` (`.id`, `.addrs`) |
| Readiness / self addr | watchers | `endpoint.online().await`, `endpoint.addr()` |
| Blobs protocol | `Blobs::builder(store).build(&ep)` + `MemClient` | `BlobsProtocol::new(&store, events)` + `api::Store` |
| Store (persistent) | `store::fs::Store` | `iroh_blobs::store::fs` (feature `fs-store`) |
| Store (browser) | n/a | `store::mem::MemStore::new()` |
| Import | `add_from_path` / `scan_path` / `WrapOption` | `store.blobs().add_path(_with_opts)` / `add_bytes` → `AddProgress` (`IntoFuture` → `TagInfo`) |
| Download | `download_with_opts(DownloadOptions{..})` / `DownloadProgress` enum | `store.downloader(&ep).download(HashAndFormat, providers)` (`DownloadProgress: IntoFuture`) |
| Status | `client.status(hash)` → `BlobStatus` | `store.blobs().status(hash)` → `BlobStatus::{Complete,Partial,NotFound}` |
| Read bytes | `read_to_bytes` | `store.blobs().get_bytes(hash)` → `Bytes` |
| Collection | `Collection` (`create_collection`) | `format::collection::Collection::load(root, &store)` + `.iter()` → `(String, Hash)` |
| Ticket | `BlobTicket::new(NodeAddr, Hash, Format)` | `BlobTicket::new(EndpointAddr, Hash, BlobFormat)`, `.hash()`, `.addr()`, `.hash_and_format()`, `FromStr` |
| Congestion tuning | direct `iroh-quinn-proto = 0.13` pin (BBR/CUBIC configs) | **re-verify**: transport-config exposure in 1.0; drop the direct quinn pin |
| ProtocolHandler | 0.35 `ProtocolHandler` trait | **re-verify**: 1.0 `ProtocolHandler` signature (nearby_protocol.rs) |

The two "re-verify" rows are the only unknowns left; everything else is
confirmed. The fd2 ticket envelope survives (it wraps provider `BlobTicket`
strings), but the inner 1.0 `BlobTicket` string format differs from 0.35, so a
v0.9 client can't transfer with ≤v0.8 peers — release notes must say so and the
receiver turns an unparseable ticket into a friendly "sender needs to update".

## Execution plan (v0.9.0)

1. App migration `src-tauri/`: `node/endpoint.rs` (epicenter), `transfer/{sender,receiver,swarm,export,ticket}.rs`, `node/nearby_protocol.rs`, benches. Gate on `benchmark-local` re-baseline; re-validate BBR/Warp claims honestly.
2. Ship `web-receiver/` (already compiles): `wasm-bindgen` → `public/webrx`, built in GitHub Actions (not Netlify) then `netlify-cli deploy`.
3. `src/components/ReceiveHandoffPage.tsx`: "Receive in this browser (beta)" below the native CTA; lazy-import wasm on click; show label+size before fetch; size gate (warn > 500 MB, refuse > ~1-2 GB); save via File System Access API with Blob fallback; "BLAKE3 verified" on completion.
4. `netlify.toml`: `script-src 'wasm-unsafe-eval'`, `connect-src wss://` relay hosts.
5. CLAUDE.md: keep the iroh/iroh-blobs invariants (the browser path IS both); amend "Tauri IPC is the only bridge" to note the WASM receiver runs the same engine in-page, never a server; document relay-only + memory-bound.
