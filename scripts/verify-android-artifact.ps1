<#
.SYNOPSIS
  Verify a downloaded Lightning P2P Android artifact (APK or AAB).

.DESCRIPTION
  Performs whichever of the following are available on the current host:
    - SHA256 hash + checksum-file comparison
    - apksigner verify --print-certs --verbose  (APK only)
    - aapt2 dump badging (best-effort metadata print; APK only)
    - bundletool validate  (AAB only)

  All Android SDK tools are optional. Missing tools produce a "skipped"
  status, not a failure, so the script still surfaces the hash + checksum
  result on a fresh machine.

.PARAMETER Artifact
  Path to LightningP2P-android-latest.apk or LightningP2P-<version>-android.aab.

.PARAMETER Checksums
  Optional path to SHA256SUMS-android.txt. When provided, the artifact's
  hash is compared against the matching line.

.PARAMETER SkipSdkChecks
  Skip the apksigner / aapt / bundletool steps even when they are available.
  Useful when verifying on a machine without Android SDK installed and you
  want a clean exit code from the hash check alone.

.EXAMPLE
  pwsh scripts/verify-android-artifact.ps1 -Artifact .\LightningP2P-android-latest.apk -Checksums .\SHA256SUMS-android.txt
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Artifact,
  [string]$Checksums,
  [switch]$SkipSdkChecks
)

$ErrorActionPreference = "Stop"

function Write-Section {
  param([string]$Title)
  Write-Host ""
  Write-Host "== $Title =="
}

function Resolve-Required {
  param([string]$Path, [string]$Label)
  $resolved = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
  if (-not $resolved) { throw "$Label not found: $Path" }
  return $resolved.Path
}

function Find-Tool {
  param([string]$Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Get-ChecksumEntry {
  param([string]$ChecksumsPath, [string]$FileName)
  $matches = @()
  foreach ($line in Get-Content -LiteralPath $ChecksumsPath) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
    if ($trimmed -match "^(?<hash>[a-fA-F0-9]{64})\s+\*?(?<name>.+)$") {
      $entryName = [System.IO.Path]::GetFileName($Matches["name"].Trim())
      if ($entryName -eq $FileName) {
        $matches += [pscustomobject]@{ Hash = $Matches["hash"].ToLowerInvariant(); Name = $entryName }
      }
    }
  }
  if ($matches.Count -eq 0) { throw "No SHA256SUMS-android.txt entry found for $FileName." }
  if ($matches.Count -gt 1) { throw "Multiple SHA256SUMS-android.txt entries found for $FileName; refusing to guess." }
  return $matches[0]
}

try {
  $artifactPath = Resolve-Required -Path $Artifact -Label "Artifact"
  $item = Get-Item -LiteralPath $artifactPath
  $extension = $item.Extension.ToLowerInvariant()

  if ($extension -ne ".apk" -and $extension -ne ".aab") {
    throw "Artifact must be a .apk or .aab file; got '$extension'."
  }

  $hash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()

  Write-Section "File"
  Write-Host "Name: $($item.Name)"
  Write-Host "Path: $artifactPath"
  Write-Host "Size: $($item.Length) bytes"
  Write-Host "SHA256: $hash"

  if ($Checksums) {
    $checksumsPath = Resolve-Required -Path $Checksums -Label "Checksums"
    $entry = Get-ChecksumEntry -ChecksumsPath $checksumsPath -FileName $item.Name

    Write-Section "SHA256SUMS-android.txt"
    Write-Host "Expected: $($entry.Hash)"
    Write-Host "Actual:   $hash"
    if ($entry.Hash -ne $hash) {
      throw "SHA256 mismatch for $($item.Name). Do not install this file."
    }
    Write-Host "Result: checksum match"
  }

  if ($SkipSdkChecks) {
    Write-Host ""
    Write-Host "Skipping Android SDK checks (-SkipSdkChecks)."
    exit 0
  }

  if ($extension -eq ".apk") {
    Write-Section "apksigner verify"
    $apksigner = Find-Tool -Name "apksigner"
    if (-not $apksigner) { $apksigner = Find-Tool -Name "apksigner.bat" }
    if ($apksigner) {
      & $apksigner verify --print-certs --verbose "$artifactPath"
      if ($LASTEXITCODE -ne 0) { throw "apksigner verify failed (exit $LASTEXITCODE)." }
    } else {
      Write-Host "Status: skipped (apksigner not in PATH). Install Android build-tools to enable."
    }

    Write-Section "aapt2 dump badging"
    $aapt2 = Find-Tool -Name "aapt2"
    if ($aapt2) {
      & $aapt2 dump badging "$artifactPath"
      if ($LASTEXITCODE -ne 0) { Write-Warning "aapt2 dump badging exited $LASTEXITCODE." }
    } else {
      Write-Host "Status: skipped (aapt2 not in PATH). Install Android build-tools to enable."
    }
  } else {
    Write-Section "bundletool validate"
    $bundletool = Find-Tool -Name "bundletool"
    if ($bundletool) {
      & $bundletool validate --bundle "$artifactPath"
      if ($LASTEXITCODE -ne 0) { throw "bundletool validate failed (exit $LASTEXITCODE)." }
    } else {
      Write-Host "Status: skipped (bundletool not in PATH). Install from https://github.com/google/bundletool/releases to enable."
    }
  }

  Write-Host ""
  Write-Host "Verification completed."
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
