#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "$0")/.."

: "${AWS_REGION:=ap-northeast-2}"
export AWS_REGION

have_aws=false
if [[ -f .env.aws ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.aws
  set +a
  have_aws=true
fi

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

managed_secrets=(
  GOOGLE_CLIENT_ID=/k8s/common/agent-memory/google-client-id
  GOOGLE_CLIENT_SECRET=/k8s/common/agent-memory/google-client-secret
  EMBEDDING_API_KEY=/k8s/common/agent-memory/embedding-api-key
)

if [[ "$have_aws" == true ]]; then
  command -v aws >/dev/null || { echo "aws CLI is required when .env.aws exists" >&2; exit 1; }
  parameter_json=$(aws ssm get-parameters \
    --names "${managed_secrets[0]#*=}" "${managed_secrets[1]#*=}" "${managed_secrets[2]#*=}" \
    --with-decryption \
    --output json)
  managed_lines=$(printf '%s' "$parameter_json" | python3 -c '
import json, sys

pairs = dict(pair.split("=", 1) for pair in sys.argv[1:])
response = json.load(sys.stdin)
missing = response.get("InvalidParameters") or []
if missing:
    sys.exit("SSM has no parameter named: " + ", ".join(missing))
values = {parameter["Name"]: parameter["Value"].strip("\n") for parameter in response["Parameters"]}
for variable, path in pairs.items():
    value = values[path]
    if "\x27" not in value:
        print(f"{variable}=\x27{value}\x27")
    else:
        escaped = value.replace("\\", "\\\\").replace("\"", "\\\"").replace("$", "$$")
        print(f"{variable}=\"{escaped}\"")
' "${managed_secrets[@]}")

  awk -F= '
    BEGIN {
      managed["GOOGLE_CLIENT_ID"] = 1
      managed["GOOGLE_CLIENT_SECRET"] = 1
      managed["EMBEDDING_API_KEY"] = 1
    }
    !($1 in managed) { print }
  ' .env.secrets > .env.runtime-secrets.tmp
  printf '%s\n' "$managed_lines" >> .env.runtime-secrets.tmp
else
  cp .env.secrets .env.runtime-secrets.tmp
fi
chmod 600 .env.runtime-secrets.tmp
mv .env.runtime-secrets.tmp .env.runtime-secrets

if ! grep -Eq '^BETTER_AUTH_SECRET=.{32,}$' .env.runtime-secrets; then
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
