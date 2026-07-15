# web-receiver

The "receive in any browser" feature: the Lightning P2P transfer engine
(iroh + iroh-blobs, BLAKE3-verified) compiled to WebAssembly and run in the
page. No server backend — the browser dials the sender directly over iroh's
relay-over-WebSocket transport.

Standalone crate on purpose: it pins the iroh 1.0 / iroh-blobs 0.103 line (the
only line with browser support) with its own lockfile, independent of the
desktop/mobile app in `src-tauri/`.

## Status

- ✅ Compiles to `wasm32-unknown-unknown` (release artifact ~6 MB raw; ~1.5-2 MB
  after `wasm-bindgen` + `wasm-opt` + gzip).
- ⏳ Wired into the receive page and shipped once the app itself is on iroh 1.0
  (a browser peer can only receive from a 1.0 sender — iroh 0.91 broke the relay
  wire protocol). See `docs/browser-receiver-spike.md`.

## Constraints (surfaced in the UI)

- **Relay-only**: browsers have no hole punching, so transfers go through the
  relay. Expect lower throughput than the native direct path.
- **Memory-bound**: the blob lives in wasm memory (`MemStore`), so the receive
  page gates on ticket size before fetching.

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

- `inspect_ticket(ticket): string` — `{"label","size"}` JSON, fetches nothing
  (feeds the pre-fetch size gate).
- `WebReceiver.spawn(): Promise<WebReceiver>` — bind the endpoint + store.
- `receiver.fetch(ticket): Promise<string>` — download (BLAKE3-verified),
  returns the root hash hex.
- `receiver.read_blob(hashHex): Promise<Uint8Array>` — bytes for saving via the
  File System Access API (Chromium) or a Blob download (Firefox/Safari).
