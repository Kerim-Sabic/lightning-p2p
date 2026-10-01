# web-receiver

The browser receive engine used by Lightning's `/receive` handoff page. The
same iroh + iroh-blobs transfer code runs as WebAssembly in the page and
BLAKE3-verifies received content.

This is not a file-hosting backend. Browser peers are relay-only: iroh's relay
forwards encrypted QUIC traffic when the receiver cannot connect directly.
The sender must stay online while the receiver downloads; the relay does not
store files for later delivery.

Standalone crate on purpose: it pins the iroh 1.0 / iroh-blobs 0.103 line (the
only line with browser support) with its own lockfile, independent of the
desktop/mobile app in `src-tauri/`.

## Status

- ✅ Built for `wasm32-unknown-unknown` and loaded lazily when a receiver
  chooses browser receive.
- ✅ Current browsers with the File System Access API and the streamed WASM
  methods can receive verified chunks directly into the selected file sink,
  with backpressure.
- ✅ Other browsers use a memory-backed compatibility path with a conservative
  128 MiB aggregate receive limit. The app checks actual incoming data against
  that limit; sender-declared sizes are not trusted as the enforcement boundary.

## Constraints (surfaced in the UI)

- **Relay-only**: browser peers cannot hole-punch, so the relay forwards
  encrypted traffic. It provides connectivity, not cloud file storage.
- **Compatibility receive is memory-backed**: browsers without a supported
  writable sink or a cached engine with streaming methods use the 128 MiB
  aggregate cap. Reloading may be required after an engine update.
- **The sender stays online**: browser receive is an active peer transfer, not
  asynchronous delivery.

## Build

`ring` compiles a little C for wasm, so a clang targeting wasm32 must be on
PATH (CI's Linux clang works out of the box; locally, an Android NDK clang via
`CC_wasm32_unknown_unknown` also works).

```bash
cargo build --target wasm32-unknown-unknown --release
wasm-bindgen --target web --weak-refs \
  --out-dir ../public/webrx \
  target/wasm32-unknown-unknown/release/web_receiver.wasm
wasm-opt -Os -o ../public/webrx/web_receiver_bg.wasm ../public/webrx/web_receiver_bg.wasm
```

The receive page lazy-imports the generated module only when the user opts into
browser receive, so the multi-MB wasm never touches the marketing page budget.

## JS surface

- `inspect_ticket(ticket): string` — label and declared size, without fetching
  payload bytes.
- `WebReceiver.spawn(): Promise<WebReceiver>` — binds the browser endpoint.
- `receiver.prepare_streamed_collection(ticket, progressCallback)` — fetches
  and verifies bounded collection metadata, then returns file names, hashes,
  and authenticated sizes.
- `receiver.stream_blob_to(hash, size, chunkCallback)` — streams Bao-verified
  chunks to an async sink and waits for each write before reading the next.
- `receiver.fetch(ticket, maxBytes, progressCallback)` — bounded,
  memory-backed compatibility path; returns the root hash.
- `receiver.read_blob_range(hashHex, offset, length)` — reads bounded ranges
  for streaming saves from the fetched in-memory store when the current engine
  does not support direct sink streaming.
- `receiver.cancel()` — closes the endpoint and interrupts an in-flight
  receive.
