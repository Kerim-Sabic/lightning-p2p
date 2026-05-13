param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Installer,

  [Parameter(Mandatory = $false)]
  [ValidateNotNullOrEmpty()]
  [string]$Checksums
)

$ErrorActionPreference = "Stop"

function Write-Section {
  param([string]$Title)
  Write-Host ""
  Write-Host "== $Title =="
}

function Resolve-ExistingPath {
  param(
    [string]$Path,
    [string]$Label
  )

  $resolved = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
  if (-not $resolved) {
    throw "$Label not found: $Path"
  }

  return $resolved.Path
}

function Get-ChecksumEntry {
  param(
    [string]$ChecksumsPath,
    [string]$FileName
  )

  $entries = @()
  foreach ($line in Get-Content -LiteralPath $ChecksumsPath) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    if ($trimmed -match "^(?<hash>[a-fA-F0-9]{64})\s+\*?(?<name>.+)$") {
      $entryName = [System.IO.Path]::GetFileName($Matches["name"].Trim())
      if ($entryName -eq $FileName) {
        $entries += [pscustomobject]@{
          Hash = $Matches["hash"].ToLowerInvariant()
          Name = $entryName
        }
      }
    }
  }

  if ($entries.Count -eq 0) {
    throw "No SHA256SUMS.txt entry found for $FileName."
  }

  if ($entries.Count -gt 1) {
    throw "Multiple SHA256SUMS.txt entries found for $FileName; refusing to guess."
  }

  return $entries[0]
}

try {
  $installerPath = Resolve-ExistingPath -Path $Installer -Label "Installer"
  $installerItem = Get-Item -LiteralPath $installerPath
  $hash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()

  Write-Section "File"
  Write-Host "Name: $($installerItem.Name)"
  Write-Host "Path: $installerPath"
  Write-Host "Size: $($installerItem.Length) bytes"
  Write-Host "SHA256: $hash"

  Write-Section "Authenticode"
  if (Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue) {
    $signature = Get-AuthenticodeSignature -LiteralPath $installerPath
    Write-Host "Status: $($signature.Status)"

    if ($signature.SignerCertificate) {
      Write-Host "Subject: $($signature.SignerCertificate.Subject)"
      Write-Host "Issuer: $($signature.SignerCertificate.Issuer)"
      Write-Host "Thumbprint: $($signature.SignerCertificate.Thumbprint)"
    }

    switch ($signature.Status) {
      "Valid" {
        Write-Host "Result: Signed + Valid"
      }
      "NotSigned" {
        Write-Host "Result: Unsigned"
      }
      default {
        Write-Host "Result: Signed but invalid"
        throw "Authenticode signature is not valid: $($signature.Status) $($signature.StatusMessage)"
      }
    }
  } else {
    Write-Host "Result: Authenticode check unavailable on this PowerShell host."
  }

  if ($Checksums) {
    $checksumsPath = Resolve-ExistingPath -Path $Checksums -Label "Checksums"
    $entry = Get-ChecksumEntry -ChecksumsPath $checksumsPath -FileName $installerItem.Name

    Write-Section "SHA256SUMS.txt"
    Write-Host "Expected: $($entry.Hash)"
    Write-Host "Actual:   $hash"

    if ($entry.Hash -ne $hash) {
      throw "SHA256 mismatch for $($installerItem.Name). Do not install this file."
    }

    Write-Host "Result: checksum match"
  }

  Write-Host ""
  Write-Host "Verification completed."
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
