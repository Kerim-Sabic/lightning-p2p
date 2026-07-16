#!/usr/bin/env bash
# Rebuilds the browser-receiver WASM engine and refreshes the committed
# artifacts under public/webrx/. Run this whenever web-receiver/src changes.
#
# Netlify has no Rust toolchain, so the built glue + wasm are committed and
# shipped as static assets; `pnpm build` copies public/webrx into dist/webrx.
#
# Requirements:
#   - rustup target: wasm32-unknown-unknown  (rustup target add wasm32-unknown-unknown)
#   - wasm-bindgen-cli 0.2.126                (must match the wasm-bindgen crate)
#   - clang, for ring's wasm C. Linux/macOS usually have it on PATH. On Windows,
#     the Android NDK ships one; point CC at it, e.g.:
#       export CC_wasm32_unknown_unknown="$ANDROID_NDK/toolchains/llvm/prebuilt/windows-x86_64/bin/clang.exe"
#       export AR_wasm32_unknown_unknown="$ANDROID_NDK/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-ar.exe"
#       export CFLAGS_wasm32_unknown_unknown="--target=wasm32-unknown-unknown"
#
# Optional: wasm-opt (binaryen) to shrink the binary further; skipped if absent.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE="$ROOT/web-receiver"
OUT="$ROOT/public/webrx"

echo "==> building web-receiver -> wasm32-unknown-unknown (release)"
( cd "$CRATE" && cargo build --target wasm32-unknown-unknown --release )

echo "==> wasm-bindgen --target web -> $OUT"
mkdir -p "$OUT"
wasm-bindgen --target web --out-dir "$OUT" --no-typescript \
  "$CRATE/target/wasm32-unknown-unknown/release/web_receiver.wasm"

if command -v wasm-opt >/dev/null 2>&1; then
  echo "==> wasm-opt -Os"
  wasm-opt -Os "$OUT/web_receiver_bg.wasm" -o "$OUT/web_receiver_bg.wasm"
else
  echo "==> wasm-opt not found; skipping size optimization (optional)"
fi

echo "==> done:"
ls -l "$OUT"
