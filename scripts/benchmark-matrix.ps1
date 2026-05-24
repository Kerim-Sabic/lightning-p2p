param(
  [string]$OutputDir = "benchmark-results",
  [int]$Runs = 5,
  [switch]$PreparePayloadsOnly
)

$ErrorActionPreference = "Stop"

function New-TestFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][long]$SizeBytes
  )

  if ((Test-Path -LiteralPath $Path) -and ((Get-Item -LiteralPath $Path).Length -eq $SizeBytes)) {
    return
  }

  $parent = Split-Path -Parent $Path
  if ($parent) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }

  $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  try {
    $stream.SetLength($SizeBytes)
  } finally {
    $stream.Dispose()
  }
}

function New-ManySmallFiles {
  param([string]$Directory)

  New-Item -ItemType Directory -Force -Path $Directory | Out-Null
  for ($i = 1; $i -le 200; $i++) {
    $name = "small-{0:D3}.bin" -f $i
    New-TestFile -Path (Join-Path $Directory $name) -SizeBytes 65536
  }
}

$root = Resolve-Path "."
$output = Join-Path $root $OutputDir
$payloadDir = Join-Path $output "payloads"
$packageJson = Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$appVersion = "v$($packageJson.version)"
New-Item -ItemType Directory -Force -Path $output | Out-Null
New-Item -ItemType Directory -Force -Path $payloadDir | Out-Null

New-TestFile -Path (Join-Path $payloadDir "10mb.bin") -SizeBytes 10485760
New-TestFile -Path (Join-Path $payloadDir "500mb.bin") -SizeBytes 524288000
New-TestFile -Path (Join-Path $payloadDir "1gb.bin") -SizeBytes 1073741824
New-ManySmallFiles -Directory (Join-Path $payloadDir "many-small")

$csvPath = Join-Path $output "$appVersion-benchmark-matrix.csv"
$runbookPath = Join-Path $output "$appVersion-benchmark-runbook.md"

$scenarios = @(
  @{ name = "lan-direct-10mb"; payload = "10mb.bin"; route = "direct"; note = "Windows to Android and Android to Windows on same Wi-Fi" },
  @{ name = "relay-fallback-10mb"; payload = "10mb.bin"; route = "relay"; note = "Use network isolation or relay-only environment" },
  @{ name = "many-small-files"; payload = "many-small"; route = "direct"; note = "Folder send from desktop; record export overhead" },
  @{ name = "locked-phone-500mb"; payload = "500mb.bin"; route = "direct"; note = "Lock phone screen after transfer starts" },
  @{ name = "single-file-1gb"; payload = "1gb.bin"; route = "direct"; note = "Thermal and battery notes required" }
)

$rows = New-Object System.Collections.Generic.List[string]
$rows.Add("version,scenario,run,source,target,payload,expected_route,observed_route,bytes,duration_seconds,throughput_mbps,connect_ms,download_ms,export_ms,result,notes")
foreach ($scenario in $scenarios) {
  for ($run = 1; $run -le $Runs; $run++) {
    $name = $scenario.name
    $payload = $scenario.payload
    $route = $scenario.route
    $note = $scenario.note
    $rows.Add("$appVersion,$name,$run,,,$payload,$route,,,,,,,,,`"$note`"")
  }
}
$rows | Set-Content -LiteralPath $csvPath -Encoding UTF8

$runbook = @"
# Lightning P2P $appVersion Benchmark Runbook

Use this matrix only after the Android APK launch gate passes on a physical phone.

## Payloads

- 10 MB: $payloadDir\10mb.bin
- 500 MB: $payloadDir\500mb.bin
- 1 GB: $payloadDir\1gb.bin
- Many small files: $payloadDir\many-small

## Rules

- Run each scenario at least $Runs times.
- Record observed route from the transfer card or diagnostics bundle.
- Copy diagnostics for every failed or unusually slow transfer.
- Do not publish speed claims unless the CSV contains completed runs and the route is proven.
- Do not modify iroh chunking; optimize UI progress batching and export timing only after baseline data.

## Scenarios

1. LAN direct 10 MB, Windows to Android and Android to Windows.
2. Relay fallback 10 MB.
3. Many small files.
4. 500 MB while the Android phone screen is locked.
5. 1 GB single-file run.

CSV template: $csvPath
"@
$runbook | Set-Content -LiteralPath $runbookPath -Encoding UTF8

Write-Host "Prepared benchmark payloads and CSV template:"
Write-Host "  $csvPath"
Write-Host "  $runbookPath"

if ($PreparePayloadsOnly) {
  exit 0
}

Write-Host ""
Write-Host "Open Lightning P2P on Windows and Android, run each scenario, then fill in the CSV."
