param([string]$EnvironmentFile = '.env.production')

$ErrorActionPreference = 'Stop'
$target = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { [IO.Path]::GetFullPath($EnvironmentFile) } else { [IO.Path]::GetFullPath((Join-Path (Get-Location) $EnvironmentFile)) }
if (-not (Test-Path -LiteralPath $target)) { throw "Khong tim thay $target. Hay chay prepare-production.ps1 truoc." }
$values = @{}
foreach ($line in Get-Content -LiteralPath $target -Encoding UTF8) {
  if (-not $line.Trim() -or $line.TrimStart().StartsWith('#')) { continue }
  $parts = $line.Split('=', 2)
  if ($parts.Count -eq 2) { $values[$parts[0].Trim()] = $parts[1].Trim() }
}
$required = @('PUBLIC_URL','POSTGRES_DB','POSTGRES_USER','POSTGRES_PASSWORD','JWT_SECRET','CHANNEL_CREDENTIAL_KEY','BOOTSTRAP_ORGANIZATION_NAME','BOOTSTRAP_ORGANIZATION_CODE','BOOTSTRAP_ADMIN_EMAIL','BOOTSTRAP_ADMIN_PASSWORD')
$errors = @()
foreach ($name in $required) { if (-not $values[$name]) { $errors += "Thieu $name" } }
foreach ($name in @('POSTGRES_PASSWORD','JWT_SECRET','CHANNEL_CREDENTIAL_KEY','BOOTSTRAP_ADMIN_PASSWORD')) { if ($values[$name] -and $values[$name].Length -lt 24) { $errors += "$name phai co it nhat 24 ky tu" } }
if ($values['PUBLIC_URL'] -match 'example|YOUR_|localhost') { $errors += 'PUBLIC_URL van la gia tri mau/local' }
if ($values.Values -match 'GENERATE_WITH|replace_with|change_me') { $errors += 'Cau hinh van chua khoa hoac mat khau mau' }
if ($errors.Count) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }

$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) {
  & docker compose --env-file $target -f docker-compose.production.yml config --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Docker Compose production khong hop le.' }
  Write-Host 'PASS: Docker Compose production hop le.'
} else {
  Write-Warning 'May hien tai chua co Docker; se kiem tra Docker Compose tren VPS.'
}
Write-Host 'PASS: Khong con khoa mac dinh hoac URL mau.'
Write-Host 'READY: Co the chay docker compose --env-file .env.production -f docker-compose.production.yml up -d --build'
