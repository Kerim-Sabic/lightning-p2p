#!/usr/bin/env bash
# Verify a downloaded Lightning P2P Android artifact (APK or AAB).
# Mirrors verify-android-artifact.ps1. All Android SDK tools are optional.
set -euo pipefail

ARTIFACT=""
CHECKSUMS=""
SKIP_SDK_CHECKS="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact)
      ARTIFACT="$2"
      shift 2
      ;;
    --checksums)
      CHECKSUMS="$2"
      shift 2
      ;;
    --skip-sdk-checks)
      SKIP_SDK_CHECKS="true"
      shift
      ;;
    --help|-h)
      cat <<EOF
Usage: $(basename "$0") --artifact <path.apk|path.aab> [--checksums <SHA256SUMS-android.txt>] [--skip-sdk-checks]
EOF
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$ARTIFACT" ]]; then
  echo "--artifact is required" >&2
  exit 2
fi

if [[ ! -f "$ARTIFACT" ]]; then
  echo "Artifact not found: $ARTIFACT" >&2
  exit 1
fi

EXT="${ARTIFACT##*.}"
EXT_LOWER="$(echo "$EXT" | tr '[:upper:]' '[:lower:]')"
if [[ "$EXT_LOWER" != "apk" && "$EXT_LOWER" != "aab" ]]; then
  echo "Artifact must be a .apk or .aab file; got '$EXT_LOWER'." >&2
  exit 1
fi

NAME="$(basename "$ARTIFACT")"
SIZE="$(wc -c <"$ARTIFACT" | tr -d ' ')"
HASH="$(sha256sum "$ARTIFACT" | awk '{print $1}')"

echo "== File =="
echo "Name: $NAME"
echo "Path: $ARTIFACT"
echo "Size: $SIZE bytes"
echo "SHA256: $HASH"

if [[ -n "$CHECKSUMS" ]]; then
  if [[ ! -f "$CHECKSUMS" ]]; then
    echo "Checksums file not found: $CHECKSUMS" >&2
    exit 1
  fi
  EXPECTED="$(awk -v n="$NAME" 'NF>=2 && $1 ~ /^[a-fA-F0-9]{64}$/ { name=$2; sub(/^\*/,"",name); if (name == n) print tolower($1) }' "$CHECKSUMS")"
  if [[ -z "$EXPECTED" ]]; then
    echo "No SHA256SUMS-android.txt entry found for $NAME" >&2
    exit 1
  fi
  echo
  echo "== SHA256SUMS-android.txt =="
  echo "Expected: $EXPECTED"
  echo "Actual:   $HASH"
  if [[ "$EXPECTED" != "$HASH" ]]; then
    echo "SHA256 mismatch for $NAME. Do not install this file." >&2
    exit 1
  fi
  echo "Result: checksum match"
fi

if [[ "$SKIP_SDK_CHECKS" == "true" ]]; then
  echo
  echo "Skipping Android SDK checks (--skip-sdk-checks)."
  exit 0
fi

run_if_present() {
  local label="$1"; shift
  local tool="$1"; shift
  echo
  echo "== $label =="
  if command -v "$tool" >/dev/null 2>&1; then
    "$tool" "$@"
  else
    echo "Status: skipped ($tool not in PATH)."
  fi
}

if [[ "$EXT_LOWER" == "apk" ]]; then
  run_if_present "apksigner verify" apksigner verify --print-certs --verbose "$ARTIFACT"
  run_if_present "aapt2 dump badging" aapt2 dump badging "$ARTIFACT"
else
  run_if_present "bundletool validate" bundletool validate --bundle "$ARTIFACT"
fi

echo
echo "Verification completed."
