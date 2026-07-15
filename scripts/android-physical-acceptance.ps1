param(
  [string]$PackageId = "com.lightningp2p.app",
  [string]$ApkUrl = "https://github.com/Kerim-Sabic/lightning-p2p/releases/download/v0.5.1/LightningP2P-android-latest.apk",
  [string]$ChecksumUrl = "https://github.com/Kerim-Sabic/lightning-p2p/releases/download/v0.5.1/SHA256SUMS-android.txt",
  [string]$LocalApkPath = "",
  [string]$LocalChecksumPath = "",
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

$apkPath = Join-Path $output "LightningP2P-android-under-test.apk"
$checksumPath = Join-Path $output "SHA256SUMS-android.txt"
$logcatPath = Join-Path $output "lightning-p2p-launch-logcat.txt"
$activityPath = Join-Path $output "lightning-p2p-activity-state.txt"

Remove-Item -LiteralPath $apkPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $checksumPath -Force -ErrorAction SilentlyContinue

if (-not [string]::IsNullOrWhiteSpace($LocalApkPath)) {
  $resolvedApk = (Resolve-Path -LiteralPath $LocalApkPath).Path
  Copy-Item -LiteralPath $resolvedApk -Destination $apkPath -Force

  if (-not [string]::IsNullOrWhiteSpace($LocalChecksumPath)) {
    $resolvedChecksum = (Resolve-Path -LiteralPath $LocalChecksumPath).Path
    Copy-Item -LiteralPath $resolvedChecksum -Destination $checksumPath -Force
  }
} else {
  Invoke-WebRequest -Uri $ApkUrl -OutFile $apkPath
  Invoke-WebRequest -Uri $ChecksumUrl -OutFile $checksumPath
}

$hash = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash.ToLowerInvariant()
if (Test-Path -LiteralPath $checksumPath) {
  $checksumText = (Get-Content -LiteralPath $checksumPath -Raw).ToLowerInvariant()
  if ($checksumText -notmatch [regex]::Escape($hash)) {
    throw "APK SHA256 mismatch. Actual: $hash"
  }
  Write-Host "APK SHA256 verified: $hash"
} else {
  Write-Host "No checksum file supplied for local APK. Computed APK SHA256: $hash"
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

$fatalMatches = Select-String -Path $logcatPath -Pattern "FATAL EXCEPTION|AndroidRuntime|SIGSEGV|panic|liblightning|MediaStore publish failed|shared-staging cleanup failed|MediaStore insert returned null" -CaseSensitive:$false
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
Write-Host "  6. Pick a photo via the system file picker -> ticket creates without 'no such file' error."
Write-Host "  7. Receive one JPG, one MP4, one MP3, one PDF -> verify each appears in Pictures/Movies/Music/Downloads via the system Gallery and Files apps."
Write-Host "  8. Open the phone's Gallery -> Share a photo -> Lightning P2P appears in the chooser -> tap -> Send view opens with the photo pre-selected and a QR/link auto-generated."
Write-Host "  9. Launcher icon shows the new two-tone blue mark under both circular and squircle masks."
