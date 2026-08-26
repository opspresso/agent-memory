#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "$0")/.."

for file in .env.example .env.secrets.example .env.infrastructure.example; do
  [[ -f "$file" ]] || { echo "$file is missing" >&2; exit 1; }
done

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "created .env; review it and run this script again" >&2
  exit 1
fi

if [[ ! -f .env.secrets ]]; then
  cp .env.secrets.example .env.secrets
  chmod 600 .env.secrets
  echo "created .env.secrets; fill BETTER_AUTH_SECRET and run this script again" >&2
  exit 1
fi

if [[ ! -f .env.infrastructure ]]; then
  cp .env.infrastructure.example .env.infrastructure
  chmod 600 .env.infrastructure
  echo "created .env.infrastructure; set the shared PostgreSQL and MinIO values and run this script again" >&2
  exit 1
fi

if ! grep -Eq '^BETTER_AUTH_SECRET=.{32,}$' .env.secrets; then
  echo "BETTER_AUTH_SECRET must contain at least 32 characters" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
# shellcheck disable=SC1091
source .env.infrastructure
set +a

docker network inspect "$DATA_NETWORK" >/dev/null
docker network inspect "$EDGE_NETWORK" >/dev/null 2>&1 || docker network create "$EDGE_NETWORK" >/dev/null

if [[ "${PULL_IMAGES:-true}" == "true" ]]; then
  docker compose pull
fi
docker compose up -d --remove-orphans
docker compose ps
