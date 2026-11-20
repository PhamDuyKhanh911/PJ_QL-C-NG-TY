param(
  [Parameter(Mandatory = $true)][string]$BackupFile,
  [Parameter(Mandatory = $true)][string]$TargetDatabase,
  [Parameter(Mandatory = $true)][string]$ConfirmTargetDatabase,
  [string]$HostName = 'localhost',
  [int]$Port = 5432,
  [string]$Username = 'erp',
  [string]$Password = 'change_me'
)

$ErrorActionPreference = 'Stop'
if ($TargetDatabase -ne $ConfirmTargetDatabase) { throw 'Confirmation does not match the target database name.' }
if ($TargetDatabase -notmatch '^[A-Za-z][A-Za-z0-9_]{2,62}$') { throw 'The target database name is invalid.' }
$ResolvedBackup = (Resolve-Path -LiteralPath $BackupFile).Path
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PostgresBin = Join-Path $ProjectRoot '.tools\pgsql\bin'
$PgRestore = Join-Path $PostgresBin 'pg_restore.exe'
$Psql = Join-Path $PostgresBin 'psql.exe'
$Createdb = Join-Path $PostgresBin 'createdb.exe'
foreach ($required in @($PgRestore, $Psql, $Createdb)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Missing PostgreSQL tool: $required" }
}

$env:PGPASSWORD = $Password
& $PgRestore --list $ResolvedBackup *> $null
if ($LASTEXITCODE -ne 0) { throw 'The backup file is invalid or damaged.' }

$EscapedTarget = $TargetDatabase.Replace("'", "''")
$Exists = (& $Psql --host $HostName --port $Port --username $Username --dbname postgres --tuples-only --no-align --command "SELECT 1 FROM pg_database WHERE datname = '$EscapedTarget'").Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the target PostgreSQL server.' }

if ($Exists -eq '1') {
  $TableCount = (& $Psql --host $HostName --port $Port --username $Username --dbname $TargetDatabase --tuples-only --no-align --command "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')").Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the target database.' }
  if ([int]$TableCount -gt 0) { throw 'The target database is not empty. Restore was stopped to protect existing data.' }
} else {
  & $Createdb --host $HostName --port $Port --username $Username $TargetDatabase
  if ($LASTEXITCODE -ne 0) { throw 'Unable to create the target database.' }
}

& $PgRestore --exit-on-error --no-owner --no-privileges --host $HostName --port $Port --username $Username --dbname $TargetDatabase $ResolvedBackup
if ($LASTEXITCODE -ne 0) { throw 'Database restore failed.' }
Write-Host "Backup restored safely into empty database: $TargetDatabase"
