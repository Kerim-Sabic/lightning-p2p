<#
.SYNOPSIS
  Run the automated same-machine Lightning P2P benchmark and write CSV+JSON
  to docs/reports/raw/local/.

.DESCRIPTION
  Builds and runs src-tauri/src/bin/benchmark_local.rs in release mode. The
  binary boots two LightningP2PNode instances in temp dirs (same-machine
  two-profile harness), creates a share, receives it, and records timing
  and throughput metrics for each run.

  This is NOT a real-device or WAN benchmark. It measures the loopback path
  only. Do not use it to justify "fastest" claims or competitor comparisons.

.PARAMETER Runs
  Runs per scenario. Defaults to 3.

.PARAMETER Profile
  "smoke" (10 MB only, CI-friendly) or "full" (adds 100 MB). Defaults to "smoke".

.PARAMETER OutputDir
  Where to write the CSV/JSON. Defaults to docs/reports/raw/local.

.EXAMPLE
  pwsh scripts/run-local-benchmark.ps1
  pwsh scripts/run-local-benchmark.ps1 -Runs 5 -Profile full
#>
[CmdletBinding()]
param(
  [int]$Runs = 3,
  [ValidateSet("smoke","full")][string]$Profile = "smoke",
  [string]$OutputDir = "docs/reports/raw/local"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path "$PSScriptRoot/.."
Set-Location $repoRoot

Write-Host "Lightning P2P automated local benchmark"
Write-Host "  profile=$Profile runs=$Runs output_dir=$OutputDir"
Write-Host ""

Write-Host "Step 1/2: building benchmark-local in release mode..."
$buildArgs = @(
  "build",
  "--manifest-path", "src-tauri/Cargo.toml",
  "--release",
  "--bin", "benchmark-local"
)
& cargo @buildArgs
if ($LASTEXITCODE -ne 0) {
  throw "cargo build failed (exit $LASTEXITCODE)"
}

Write-Host ""
Write-Host "Step 2/2: running benchmark-local..."
$binaryPath = Join-Path $repoRoot "src-tauri/target/release/benchmark-local.exe"
if (-not (Test-Path $binaryPath)) {
  $binaryPath = Join-Path $repoRoot "src-tauri/target/release/benchmark-local"
}
if (-not (Test-Path $binaryPath)) {
  throw "benchmark-local binary not found at $binaryPath"
}

& $binaryPath --runs $Runs --profile $Profile --output-dir $OutputDir | Out-Null
$benchExit = $LASTEXITCODE

$latest = Join-Path $OutputDir "latest.json"
if (Test-Path $latest) {
  Write-Host ""
  Write-Host "Wrote latest report to $latest"
  $report = Get-Content -LiteralPath $latest -Raw | ConvertFrom-Json
  foreach ($s in $report.summary) {
    $median = if ($null -ne $s.median_effective_mbps) { ("{0:N1} Mbps" -f $s.median_effective_mbps) } else { "n/a" }
    Write-Host ("  {0,-22} runs={1} ok={2} fail={3} median={4}" -f $s.scenario, $s.runs, $s.successes, $s.failures, $median)
  }
}

if ($benchExit -ne 0) {
  Write-Warning "benchmark-local exited with $benchExit; report was still written."
  exit $benchExit
}
