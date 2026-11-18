$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$NodeRoot = Join-Path $ProjectRoot '.tools\node-v22.23.5-win-x64'
$PostgresRoot = Join-Path $ProjectRoot '.tools\pgsql'
$DataRoot = Join-Path $ProjectRoot '.data'
$PostgresData = Join-Path $DataRoot 'postgres'
$LogRoot = Join-Path $DataRoot 'logs'
$RunRoot = Join-Path $DataRoot 'run'

foreach ($required in @(
  (Join-Path $NodeRoot 'node.exe'),
  (Join-Path $NodeRoot 'pnpm.cmd'),
  (Join-Path $PostgresRoot 'bin\pg_ctl.exe'),
  (Join-Path $PostgresData 'PG_VERSION')
)) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "Missing local component: $required"
  }
}

New-Item -ItemType Directory -Path $LogRoot, $RunRoot -Force | Out-Null
$env:Path = "$NodeRoot;$env:Path"
$env:DATABASE_URL = 'postgresql://erp:change_me@localhost:5432/enterprise_management?schema=public'
$env:JWT_SECRET = 'local-dev-secret-change-before-production-2026'
$env:WEB_ORIGIN = 'http://localhost:3000'
$env:NEXT_PUBLIC_API_URL = 'http://localhost:4000/api'

& (Join-Path $PostgresRoot 'bin\pg_isready.exe') -h localhost -p 5432 *> $null
if ($LASTEXITCODE -ne 0) {
  & (Join-Path $PostgresRoot 'bin\pg_ctl.exe') -D $PostgresData -l (Join-Path $LogRoot 'postgres.log') -o '"-p 5432"' start
}

& (Join-Path $NodeRoot 'pnpm.cmd') --filter '@erp/api' exec prisma migrate deploy
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }

try { Invoke-RestMethod -Uri 'http://localhost:4000/api/health' -TimeoutSec 2 | Out-Null } catch {
  $api = Start-Process -FilePath (Join-Path $NodeRoot 'pnpm.cmd') -ArgumentList @('--filter','@erp/api','dev') -WorkingDirectory $ProjectRoot -RedirectStandardOutput (Join-Path $LogRoot 'api.out.log') -RedirectStandardError (Join-Path $LogRoot 'api.err.log') -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath (Join-Path $RunRoot 'api.pid') -Value $api.Id
}

try { Invoke-WebRequest -Uri 'http://localhost:3000/login' -UseBasicParsing -TimeoutSec 2 | Out-Null } catch {
  $web = Start-Process -FilePath (Join-Path $NodeRoot 'pnpm.cmd') -ArgumentList @('--filter','@erp/web','dev') -WorkingDirectory $ProjectRoot -RedirectStandardOutput (Join-Path $LogRoot 'web.out.log') -RedirectStandardError (Join-Path $LogRoot 'web.err.log') -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath (Join-Path $RunRoot 'web.pid') -Value $web.Id
}

Write-Host 'Local services are running:'
Write-Host '  Web: http://localhost:3000/login'
Write-Host '  API: http://localhost:4000/api/health'
