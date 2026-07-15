#!/usr/bin/env bash
set -euo pipefail

apk_path="${1:?Usage: android-launch-smoke.sh <apk-path> [log-prefix]}"
log_prefix="${2:-android-launch-smoke}"
workspace="${GITHUB_WORKSPACE:-$(pwd)}"
package_name="${ANDROID_APP_ID:-com.lightningp2p.app}"
main_activity="${ANDROID_MAIN_ACTIVITY:-com.lightningp2p.app/.MainActivity}"
wait_seconds="${ANDROID_SMOKE_WAIT_SECONDS:-30}"

logcat_path="${workspace}/logcat-${log_prefix}.txt"
activities_path="${workspace}/activities-${log_prefix}.txt"
process_path="${workspace}/process-${log_prefix}.txt"

collect_android_state() {
  adb logcat -v threadtime -d > "${logcat_path}" || true
  adb shell dumpsys activity activities > "${activities_path}" || true
  adb shell pidof "${package_name}" > "${process_path}" || true
}

trap 'status=$?; if [ "$status" -ne 0 ]; then collect_android_state || true; fi; exit "$status"' EXIT

if [ ! -f "${apk_path}" ]; then
  echo "::error::APK not found at ${apk_path}"
  exit 1
fi

echo "Installing staged Android APK: ${apk_path}"
adb install -r "${apk_path}"

echo "Launching ${main_activity}"
adb logcat -c
adb shell am start -W -n "${main_activity}"

echo "Watching Android process for ${wait_seconds} seconds"
sleep "${wait_seconds}"
collect_android_state

if grep -E 'FATAL EXCEPTION|AndroidRuntime: FATAL|SIGSEGV|signal 11|Rust panic|panicked at|android context was not initialized|Force finishing activity.*com\.lightningp2p\.app|Process com\.lightningp2p\.app.*has died' "${logcat_path}"; then
  echo "::error::Fatal exception, native crash, or Rust panic during Android APK launch"
  tail -n 240 "${logcat_path}"
  exit 1
fi

if [ ! -s "${process_path}" ]; then
  echo "::error::${package_name} process is not running after launch"
  tail -n 240 "${logcat_path}"
  exit 1
fi

if ! grep -Fq "${main_activity}" "${activities_path}"; then
  echo "::error::${main_activity} is not in the activity stack after launch"
  head -n 120 "${activities_path}"
  exit 1
fi

echo "Android APK launch smoke passed."
