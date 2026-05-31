#!/bin/sh
# MODULE: deploy.backup
# PURPOSE: Nightly Postgres backup for the self-hosted `db` service. Dumps to a
#          gzipped, date-stamped file under ./backups and prunes dumps >14 days.
# LAYER: infrastructure / deploy (Layer 10c)
# USAGE:  ./deploy/backup.sh    (invoked by the host crontab — see crontab.example)
set -e

# Run from the compose project root (this script lives in ./deploy).
cd "$(dirname "$0")/.."

# Load POSTGRES_USER / POSTGRES_DB names from .env (defaults match compose).
if [ -f ./.env ]; then
  set -a
  . ./.env
  set +a
fi
PG_USER="${POSTGRES_USER:-pitchup}"
PG_DB="${POSTGRES_DB:-pitchup}"

BACKUP_DIR=./backups
mkdir -p "$BACKUP_DIR"
OUT="$BACKUP_DIR/pitchup-$(date +%F).sql.gz"

# -T: no TTY (cron has none). pg_dump connects via the container's local socket
# (trust auth for the superuser), so no password is needed.
docker compose exec -T db pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$OUT"
echo "[backup] wrote $OUT"

# Retention: drop dumps older than 14 days.
find "$BACKUP_DIR" -name 'pitchup-*.sql.gz' -mtime +14 -delete
echo "[backup] pruned dumps older than 14 days"
