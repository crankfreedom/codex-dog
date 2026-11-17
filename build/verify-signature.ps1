param(
  [Parameter(Mandatory=$true)][string]$FilePath,
  [Parameter(Mandatory=$true)][string]$PublisherName
)
$ErrorActionPreference = 'Stop'
try {
  if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) { throw 'missing' }
  $signature = Get-AuthenticodeSignature -LiteralPath $FilePath
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) { throw 'invalid' }
  if ($null -eq $signature.SignerCertificate -or $null -eq $signature.TimeStamperCertificate) { throw 'certificate' }
  $name = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  if (-not [System.StringComparer]::Ordinal.Equals($name, $PublisherName)) { throw 'publisher' }
  $codeSigning = $false
  foreach ($extension in $signature.SignerCertificate.Extensions) {
    if ($extension.Oid.Value -eq '2.5.29.37') {
      foreach ($usage in $extension.EnhancedKeyUsages) { if ($usage.Value -eq '1.3.6.1.5.5.7.3.3') { $codeSigning = $true } }
    }
  }
  if (-not $codeSigning) { throw 'usage' }
  Write-Output 'SIGNATURE_VALID'
  exit 0
} catch {
  Write-Output 'SIGNATURE_INVALID'
  exit 75
}
