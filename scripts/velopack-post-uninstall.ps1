# Velopack post-uninstall hook. Removes the firewall rules added by
# velopack-post-install.ps1. The runtime URL scheme registration lives
# in HKCU and is cleaned up by tauri-plugin-deep-link on next launch
# of a different app with the same scheme, or left harmless otherwise.

$ErrorActionPreference = "Continue"

$ruleName = "Lightning P2P"
& netsh advfirewall firewall delete rule name="$ruleName" 2>&1 | Out-Null

exit 0
