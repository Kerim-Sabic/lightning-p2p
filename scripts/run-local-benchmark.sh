#!/usr/bin/env bash
# Run the automated same-machine Lightning P2P benchmark and write CSV+JSON
# to docs/reports/raw/local/.
#
# See scripts/run-local-benchmark.ps1 for the canonical Windows entrypoint.
# This file mirrors that script for Linux/macOS CI runners.
set -euo pipefail

RUNS=3
PROFILE="smoke"
OUTPUT_DIR="docs/reports/raw/local"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --runs)
      RUNS="$2"
      shift 2
      ;;
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --help|-h)
      cat <<EOF
Usage: $(basename "$0") [--runs N] [--profile smoke|full] [--output-dir <path>]
EOF
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "Lightning P2P automated local benchmark"
echo "  profile=$PROFILE runs=$RUNS output_dir=$OUTPUT_DIR"
echo

echo "Step 1/2: building benchmark-local in release mode..."
cargo build \
  --manifest-path src-tauri/Cargo.toml \
  --release \
  --bin benchmark-local

echo
echo "Step 2/2: running benchmark-local..."

BINARY="src-tauri/target/release/benchmark-local"
if [[ ! -x "$BINARY" && -x "${BINARY}.exe" ]]; then
  BINARY="${BINARY}.exe"
fi

"$BINARY" --runs "$RUNS" --profile "$PROFILE" --output-dir "$OUTPUT_DIR" >/dev/null
EXIT_CODE=$?

LATEST="$OUTPUT_DIR/latest.json"
if [[ -f "$LATEST" ]] && command -v jq >/dev/null 2>&1; then
  echo
  echo "Wrote latest report to $LATEST"
  jq -r '.summary[] | "  \(.scenario) runs=\(.runs) ok=\(.successes) fail=\(.failures) median=\(.median_effective_mbps) Mbps"' "$LATEST"
fi

exit "$EXIT_CODE"
