# Backup giornaliero dati FitCenter (Windows Task Scheduler).
# Esempio attività pianificata:
#   Programma: powershell.exe
#   Argomenti: -ExecutionPolicy Bypass -File "C:\percorso\FitCenter\vite-fitcenter\apps\api\scripts\backup-fitcenter-data.ps1"
#
# Opzionale: cartella backup su disco esterno / OneDrive
#   $env:FITCENTER_BACKUP_DIR = "D:\Backup\FitCenter"

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ApiRoot = Split-Path -Parent $ScriptDir
Set-Location $ApiRoot

# Copia anche .env (credenziali gestionale) — NON committare questi backup su git pubblico
$env:FITCENTER_BACKUP_INCLUDE_ENV = "1"
$env:FITCENTER_BACKUP_KEEP = if ($env:FITCENTER_BACKUP_KEEP) { $env:FITCENTER_BACKUP_KEEP } else { "14" }

node "$ScriptDir\backup-fitcenter-data.mjs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Backup OK $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
