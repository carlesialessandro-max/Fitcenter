# Backup notturno SQL gestionale (.bak) → NAS + MEGA, con cancellazione dei vecchi.
# Esempio Utilità di pianificazione (dopo il dump SQL, es. 01:30 come copydaily):
#   Programma: powershell.exe
#   Argomenti: -ExecutionPolicy Bypass -File "C:\fitcenter\vite-fitcenter\vite-fitcenter\apps\api\scripts\backup-gestionale.ps1"
#
# In apps/api/.env:
#   GESTIONALE_BACKUP_SRC=C:\percorso\dei\bak
#   GESTIONALE_BACKUP_DIR=\\ls220d3b7\share\societa\CONDIVISA\ALESSANDRO\backup gestionale
#   GESTIONALE_BACKUP_KEEP=2          # ultimi 2 file .bak
#   GESTIONALE_BACKUP_FOLDERS=1       # una sola cartella su NAS/MEGA
#   MEGA_EMAIL / MEGA_PASSWORD (stessi di FitCenter)
#   MEGA_GESTIONALE_FOLDER=Gestionale-backup
#
# MEGASync: togli la cartella dei .bak dalla sincronizzazione, altrimenti MEGA si riempie di nuovo.

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ApiRoot = Split-Path -Parent $ScriptDir
Set-Location $ApiRoot

if (-not $env:GESTIONALE_BACKUP_KEEP) { $env:GESTIONALE_BACKUP_KEEP = "2" }
if (-not $env:GESTIONALE_BACKUP_FOLDERS) { $env:GESTIONALE_BACKUP_FOLDERS = "1" }

node "$ScriptDir\backup-gestionale.mjs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Backup gestionale OK $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
