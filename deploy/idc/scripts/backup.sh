#!/usr/bin/env bash

set -euo pipefail
umask 077

cd "$(dirname "$0")/.."

destination="${1:-/opt/compose/backup/agent-memory}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$destination/$timestamp"
mkdir -p "$target"

set -a
# shellcheck disable=SC1091
source .env.infrastructure
set +a

docker run --rm --network "$DATA_NETWORK" postgres:18-alpine \
  pg_dump "$DATABASE_URL" -Fc > "$target/agent-memory.dump"
docker run --rm --network "$DATA_NETWORK" --env-file .env.infrastructure --entrypoint /bin/sh \
  --volume "$target:/backup" minio/mc:RELEASE.2025-08-13T08-35-41Z \
  -c 'mc alias set shared "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null && mc mirror "shared/$S3_BUCKET" /backup/objects'

find "$destination" -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf -- {} +
echo "$target"
