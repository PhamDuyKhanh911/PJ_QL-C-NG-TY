param(
  [Parameter(Mandatory = $true)][string]$PublicUrl,
  [string]$OrganizationName = 'Doanh nghiep',
  [string]$OrganizationCode = 'COMPANY',
  [string]$AdminEmail = 'phamduykhanh911@gmail.com',
  [string]$OutputFile = '.env.production'
)

$ErrorActionPreference = 'Stop'
$uri = $null
if (-not [Uri]::TryCreate($PublicUrl, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -notin @('http', 'https')) {
  throw 'PublicUrl phai la URL day du, vi du https://erp.tenmien.com hoac http://IP_MAY_CHU.'
}
if ($OrganizationCode -notmatch '^[A-Za-z0-9_-]{2,30}$') { throw 'OrganizationCode chi gom chu, so, gach ngang hoac gach duoi.' }
if ($AdminEmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw 'AdminEmail khong hop le.' }

function New-SecureValue([int]$Bytes = 48) {
  $buffer = New-Object byte[] $Bytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$target = if ([IO.Path]::IsPathRooted($OutputFile)) { [IO.Path]::GetFullPath($OutputFile) } else { [IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputFile)) }
if (Test-Path -LiteralPath $target) { throw "Tep da ton tai: $target. Khong tu dong ghi de khoa bao mat hien co." }
$values = [ordered]@{
  PUBLIC_URL = $PublicUrl.TrimEnd('/')
  POSTGRES_DB = 'enterprise_management'
  POSTGRES_USER = 'erp'
  POSTGRES_PASSWORD = New-SecureValue 36
  JWT_SECRET = New-SecureValue 64
  CHANNEL_CREDENTIAL_KEY = New-SecureValue 64
  BOOTSTRAP_ORGANIZATION_NAME = $OrganizationName.Trim()
  BOOTSTRAP_ORGANIZATION_CODE = $OrganizationCode.Trim().ToUpperInvariant()
  BOOTSTRAP_ADMIN_EMAIL = $AdminEmail.Trim().ToLowerInvariant()
  BOOTSTRAP_ADMIN_PASSWORD = New-SecureValue 24
}
$content = ($values.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join [Environment]::NewLine
[IO.File]::WriteAllText($target, $content + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
Write-Host "Da tao cau hinh production: $target"
Write-Host 'Tep chua mat khau quan tri ban dau. Hay luu trong kho bi mat va khong dua len Git.'
Write-Host 'Chay kiem tra: powershell -ExecutionPolicy Bypass -File .\scripts\check-production-readiness.ps1'
