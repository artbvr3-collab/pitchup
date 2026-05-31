#!/bin/sh
# MODULE: deploy.entrypoint
# PURPOSE: Apply pending DB migrations, then start the standalone server.
# LAYER: infrastructure / deploy (Layer 10a)
#
# `prisma migrate deploy` is idempotent and fast when nothing is pending, so it
# is safe to run on every container start. It MUST succeed before the server
# boots — a server against an unmigrated schema is a bug, so we fail fast
# (set -e) and let compose restart-policy retry once the DB is reachable.
set -e

echo "[entrypoint] prisma migrate deploy..."
prisma migrate deploy --schema=./prisma/schema.prisma
echo "[entrypoint] migrations up to date — starting: $*"

exec "$@"
