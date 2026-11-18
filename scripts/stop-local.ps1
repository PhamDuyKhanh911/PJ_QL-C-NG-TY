$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RunRoot = Join-Path $ProjectRoot '.data\run'
$PostgresRoot = Join-Path $ProjectRoot '.tools\pgsql'
$PostgresData = Join-Path $ProjectRoot '.data\postgres'

foreach ($service in @('api', 'web')) {
  $pidFile = Join-Path $RunRoot "$service.pid"
  if (Test-Path -LiteralPath $pidFile) {
    $processId = [int](Get-Content -LiteralPath $pidFile -Raw)
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $pidFile -Force
  }
}

$pgCtl = Join-Path $PostgresRoot 'bin\pg_ctl.exe'
if ((Test-Path -LiteralPath $pgCtl) -and (Test-Path -LiteralPath (Join-Path $PostgresData 'PG_VERSION'))) {
  & $pgCtl -D $PostgresData stop -m fast
}

Write-Host 'Local services stopped.'
