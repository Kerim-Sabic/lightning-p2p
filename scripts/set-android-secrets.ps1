<#
.SYNOPSIS
  Encodes a local Android release keystore as base64 and pushes it together
  with the keystore/key passwords and alias into the four GitHub Actions
  secrets the release-android workflow reads.

.DESCRIPTION
  Reads the .jks from -KeystorePath (defaults to the runbook location), prompts
  twice for the passwords with Read-Host -AsSecureString so the values are
  never echoed and never appear in shell history, and pipes each value into
  `gh secret set` via stdin so the secret content is also kept out of the
  process command line.

  Run from PowerShell (not bash) so the SecureString prompt works.

.PARAMETER KeystorePath
  Path to the .jks file. Defaults to %USERPROFILE%\.lightning-p2p\lightning-p2p-release.jks
  which matches docs/android-release-runbook.md.

.PARAMETER KeyAlias
  The keytool alias used when the keystore was generated. Defaults to
  "lightning-p2p-release", matching the runbook.

.PARAMETER Repo
  GitHub repo to set the secrets on, in OWNER/REPO form. Defaults to whatever
  `gh repo view` resolves from the current working directory.

.EXAMPLE
  PS> .\scripts\set-android-secrets.ps1
#>

[CmdletBinding()]
param(
  [string]$KeystorePath = "$env:USERPROFILE\.lightning-p2p\lightning-p2p-release.jks",
  [string]$KeyAlias = "lightning-p2p-release",
  [string]$Repo = ""
)

$ErrorActionPreference = "Stop"

function Read-PlainSecret {
  param([string]$Prompt)
  $secure = Read-Host -Prompt $Prompt -AsSecureString
  if (-not $secure) {
    throw "No value entered for $Prompt"
  }
  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  } finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Set-GhSecret {
  param([string]$Name, [string]$Value, [string]$Repo)
  if (-not $Value) {
    throw "Refusing to set $Name with an empty value"
  }
  $repoArg = @()
  if ($Repo) { $repoArg = @("--repo", $Repo) }
  # Pipe via stdin so the value never appears in the gh command line.
  $Value | gh secret set $Name @repoArg
  if ($LASTEXITCODE -ne 0) {
    throw "gh secret set $Name failed with exit code $LASTEXITCODE"
  }
  Write-Host "  $Name set." -ForegroundColor Green
}

if (-not (Test-Path $KeystorePath)) {
  Write-Host "Keystore not found at $KeystorePath" -ForegroundColor Red
  Write-Host "Generate it first per docs/android-release-runbook.md (the keytool -genkeypair step)." -ForegroundColor Yellow
  exit 1
}

$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
  throw "gh CLI not found on PATH. Install GitHub CLI (https://cli.github.com/) before running this script."
}

Write-Host "Encoding $KeystorePath to base64..." -ForegroundColor Cyan
$bytes = [IO.File]::ReadAllBytes($KeystorePath)
$b64 = [Convert]::ToBase64String($bytes)
Write-Host "  Keystore size: $($bytes.Length) bytes; base64 length: $($b64.Length) chars." -ForegroundColor DarkGray

Write-Host ""
Write-Host "Prompting for keystore + key passwords (input is hidden):" -ForegroundColor Cyan
$storePass = Read-PlainSecret "Keystore password"
$keyPass   = Read-PlainSecret "Key password (press Enter to reuse the keystore password)"
if ([string]::IsNullOrEmpty($keyPass)) {
  $keyPass = $storePass
  Write-Host "  Reusing keystore password for the key password." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Setting GitHub Actions secrets..." -ForegroundColor Cyan
Set-GhSecret -Name "ANDROID_KEYSTORE_BASE64"   -Value $b64       -Repo $Repo
Set-GhSecret -Name "ANDROID_KEYSTORE_PASSWORD" -Value $storePass -Repo $Repo
Set-GhSecret -Name "ANDROID_KEY_ALIAS"         -Value $KeyAlias  -Repo $Repo
Set-GhSecret -Name "ANDROID_KEY_PASSWORD"      -Value $keyPass   -Repo $Repo

# Best-effort clearing of the plaintext password variables in this session.
$storePass = $null
$keyPass   = $null
[GC]::Collect()

Write-Host ""
Write-Host "Done. Verify with: gh secret list" -ForegroundColor Green
