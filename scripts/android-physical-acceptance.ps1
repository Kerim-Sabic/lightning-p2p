param(
  [string]$PackageId = "com.lightningp2p.app",
  [string]$ApkUrl = "https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/LightningP2P-android-latest.apk",
  [string]$ChecksumUrl = "https://github.com/Kerim-Sabic/lightning-p2p/releases/latest/download/SHA256SUMS-android.txt",
  [string]$OutputDir = "android-acceptance-results",
  [switch]$CleanInstall
)

$ErrorActionPreference = "Stop"

function Resolve-Adb {
  $command = Get-Command "adb" -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  foreach ($root in @($env:ANDROID_SDK_ROOT, $env:ANDROID_HOME)) {
    if (-not [string]::IsNullOrWhiteSpace($root)) {
      $candidate = Join-Path $root "platform-tools\adb.exe"
      if (Test-Path -LiteralPath $candidate) {
        return $candidate
      }
    }
  }

  throw "adb is required. Install Android platform-tools or set ANDROID_SDK_ROOT."
}

function Get-ConnectedDeviceIds {
  & $script:AdbPath devices |
    Select-Object -Skip 1 |
    Where-Object { $_ -match "\tdevice$" } |
    ForEach-Object { ($_ -split "\t")[0] }
}

$script:AdbPath = Resolve-Adb

$devices = @(Get-ConnectedDeviceIds)
if ($devices.Count -eq 0) {
  throw "No physical Android device is connected. Enable USB debugging and accept the device prompt."
}
if ($devices.Count -gt 1) {
  throw "More than one Android device is connected. Keep one device attached for this gate."
}

$output = Join-Path (Resolve-Path ".") $OutputDir
New-Item -ItemType Directory -Force -Path $output | Out-Null

$apkPath = Join-Path $output "LightningP2P-android-latest.apk"
$checksumPath = Join-Path $output "SHA256SUMS-android.txt"
$logcatPath = Join-Path $output "lightning-p2p-launch-logcat.txt"
$activityPath = Join-Path $output "lightning-p2p-activity-state.txt"

Invoke-WebRequest -Uri $ApkUrl -OutFile $apkPath
Invoke-WebRequest -Uri $ChecksumUrl -OutFile $checksumPath

$hash = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash.ToLowerInvariant()
$expectedLine = Get-Content -LiteralPath $checksumPath | Select-String "LightningP2P-android-latest.apk"
if (-not $expectedLine) {
  throw "Checksum file does not contain LightningP2P-android-latest.apk."
}
if ($expectedLine.ToString().ToLowerInvariant() -notmatch $hash) {
  throw "APK SHA256 mismatch. Actual: $hash"
}

if ($CleanInstall) {
  & $script:AdbPath uninstall $PackageId | Out-Null
}

& $script:AdbPath install -r $apkPath
& $script:AdbPath logcat -c
$startOutput = & $script:AdbPath shell am start -W -n "$PackageId/.MainActivity"
$startOutput | Set-Content -LiteralPath (Join-Path $output "lightning-p2p-am-start.txt") -Encoding UTF8
Start-Sleep -Seconds 30
& $script:AdbPath logcat -v threadtime -d | Set-Content -LiteralPath $logcatPath -Encoding UTF8
& $script:AdbPath shell dumpsys activity activities | Set-Content -LiteralPath $activityPath -Encoding UTF8

$fatalMatches = Select-String -Path $logcatPath -Pattern "FATAL EXCEPTION|AndroidRuntime|SIGSEGV|panic|liblightning" -CaseSensitive:$false
if ($fatalMatches) {
  $fatalMatches | Select-Object -First 20
  throw "Launch smoke failed. Fatal Android/Rust patterns were found in $logcatPath."
}

$foreground = Select-String -Path $activityPath -Pattern "$PackageId/.MainActivity|mResumedActivity|topResumedActivity" -CaseSensitive:$false
if (-not $foreground) {
  throw "MainActivity was not visible in activity state after launch. See $activityPath."
}

Write-Host "APK installed and launched without fatal logcat patterns."
Write-Host "Artifacts:"
Write-Host "  $apkPath"
Write-Host "  $checksumPath"
Write-Host "  $logcatPath"
Write-Host "  $activityPath"
Write-Host ""
Write-Host "Manual gates still required before release:"
Write-Host "  1. Force close, reopen, rotate, background, foreground: no crash."
Write-Host "  2. Settings -> Copy diagnostics returns useful Android/Rust/frontend logs."
Write-Host "  3. Windows -> Android 10 MB transfer completes."
Write-Host "  4. Android -> Windows 10 MB transfer completes."
Write-Host "  5. One 500 MB transfer completes while the phone screen is locked."
