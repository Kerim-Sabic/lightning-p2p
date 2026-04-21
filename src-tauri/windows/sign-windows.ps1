param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$required = @(
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_TENANT_ID",
  "AZURE_TRUSTED_SIGNING_ENDPOINT",
  "AZURE_TRUSTED_SIGNING_ACCOUNT",
  "AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE"
)

foreach ($name in $required) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
    throw "$name is required for Authenticode code signing."
  }
}

trusted-signing-cli `
  -e $env:AZURE_TRUSTED_SIGNING_ENDPOINT `
  -a $env:AZURE_TRUSTED_SIGNING_ACCOUNT `
  -c $env:AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE `
  -d "Lightning P2P" `
  $Path

if ($LASTEXITCODE -ne 0) {
  throw "Trusted Signing failed for $Path."
}
