# Velopack post-install hook.
# Mirrors the firewall rules installed by the NSIS template so direct
# iroh peer connections can work on first launch when Windows allows the
# rule to be created. Rules are scoped to the installed binary; runtime
# startup registers the lightning-p2p:// deep link via tauri-plugin-deep-link.

$ErrorActionPreference = "Continue"

$installDir = $env:VELOPACK_INSTALL_DIR
if (-not $installDir) {
    $installDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$exePath = Join-Path $installDir "current\fastdrop.exe"
if (-not (Test-Path $exePath)) {
    $fallback = Join-Path $installDir "fastdrop.exe"
    if (Test-Path $fallback) {
        $exePath = $fallback
    }
}

$ruleName = "Lightning P2P"

& netsh advfirewall firewall delete rule name="$ruleName" 2>&1 | Out-Null
& netsh advfirewall firewall add rule name="$ruleName" dir=in action=allow program="$exePath" enable=yes profile=any 2>&1 | Out-Null
& netsh advfirewall firewall add rule name="$ruleName" dir=out action=allow program="$exePath" enable=yes profile=any 2>&1 | Out-Null

exit 0
