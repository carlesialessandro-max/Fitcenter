#!/usr/bin/env bash
# Backup giornaliero dati FitCenter (cron Linux).
# Esempio crontab (ogni notte alle 23:00):
#   0 23 * * * /percorso/FitCenter/vite-fitcenter/apps/api/scripts/backup-fitcenter-data.sh >> /var/log/fitcenter-backup.log 2>&1
#
# Opzionale in crontab o /etc/environment:
#   export FITCENTER_BACKUP_DIR=/var/backups/fitcenter
#   export FITCENTER_BACKUP_KEEP=14

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$API_ROOT"

export FITCENTER_BACKUP_INCLUDE_ENV="${FITCENTER_BACKUP_INCLUDE_ENV:-1}"
export FITCENTER_BACKUP_KEEP="${FITCENTER_BACKUP_KEEP:-2}"

node "$SCRIPT_DIR/backup-fitcenter-data.mjs"
echo "Backup OK $(date -Iseconds)"
