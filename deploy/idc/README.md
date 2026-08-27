# IDC 배포

단일 Linux 호스트에서 Agent Memory application만 Docker Compose로 실행한다. PostgreSQL instance와 MinIO service는 Agent Studio와 공유하고, `agent_memory` database와 `agent-memory` bucket으로 데이터를 격리한다. 공용 Caddy도 공유하므로 PostgreSQL·MinIO·TLS endpoint를 중복 배포하지 않는다.

## 설치

```bash
sudo mkdir -p /opt/compose/apps/agent-memory
sudo chown "$USER":"$USER" /opt/compose/apps/agent-memory
cp -a deploy/idc/. /opt/compose/apps/agent-memory/
cd /opt/compose/apps/agent-memory
scripts/deploy.sh
```

첫 실행은 `.env`, `.env.secrets`, `.env.infrastructure`를 생성한 뒤 중단한다. 값을 검토하고 `BETTER_AUTH_SECRET`과 `METRICS_BEARER_TOKEN`을 각각 `openssl rand -base64 32`로 설정하라. `.env.infrastructure`에는 공유 PostgreSQL의 `agent_memory` database URL과 공유 MinIO credential·endpoint를 넣는다.

Agent Studio와 같은 AWS credential을 `.env.aws`에 두면 deploy script가 아래 SSM Parameter Store 값을 매번 읽어 `.env.runtime-secrets`를 생성한다. `.env.runtime-secrets`는 직접 편집하지 않는다. 네 parameter 중 하나라도 없으면 빈 값으로 배포하지 않고 즉시 실패한다.

- `GOOGLE_CLIENT_ID`: `/k8s/common/agent-memory/google-client-id`
- `GOOGLE_CLIENT_SECRET`: `/k8s/common/agent-memory/google-client-secret`
- `EMBEDDING_API_KEY`: `/k8s/common/agent-memory/embedding-api-key`
- `KNOWLEDGE_EXTRACTION_API_KEY`: `/k8s/common/agent-memory/knowledge-extraction-api-key`

```bash
cp .env.aws.example .env.aws
chmod 600 .env.aws
```

Agent Studio의 `agent-studio` IAM user를 함께 사용하려면 `terraform-env-demo/demo/9-agent-studio/85-idc.tf`의 `agent-studio-idc-ssm-read` 정책에 `arn:aws:ssm:<region>:<account>:parameter/k8s/common/agent-memory/*`를 추가해 적용하라. 기존 `/agent-studio/*` 권한만으로는 이 경로를 읽을 수 없다.

공유 PostgreSQL에 database를 한 번 생성하라. 기존 운영 database와 table은 건드리지 않는다.

```bash
docker exec -it agent-studio-postgres-1 createdb -U agent_studio agent_memory
```

공유 edge network를 만들고 `agent-studio.compose.override.yaml`을 Agent Studio 설치 경로의 `compose.override.yaml`로 복사하라. 이렇게 해야 Agent Studio가 Caddy를 재생성해도 shared-edge 연결과 Agent Memory site mount가 유지된다. Agent Studio의 `Caddyfile`에는 site import를 한 번 추가하라.

```bash
docker network create opspresso-edge
cp agent-studio.compose.override.yaml ../agent-studio/compose.override.yaml
grep -qxF 'import /etc/caddy/sites/*.caddy' ../agent-studio/Caddyfile || \
  echo 'import /etc/caddy/sites/*.caddy' >> ../agent-studio/Caddyfile
docker compose --project-directory ../agent-studio up -d caddy
docker exec agent-studio-caddy-1 caddy reload --config /etc/caddy/Caddyfile
```

이후 `scripts/deploy.sh`를 실행한다. Script가 `agent-memory` service를 공유 data·edge network에 연결하고 `agent-memory` bucket을 멱등 생성한다.

Registry를 거치지 않고 host에 미리 load한 image로 최초 설치를 검증할 때만 `PULL_IMAGES=false`를 사용하라. 이후 업데이트는 registry의 immutable tag를 pull하라.

## 업데이트와 확인

`.env`의 `AGENT_MEMORY_IMAGE`를 배포할 immutable tag로 바꾸고 실행하라.

```bash
scripts/deploy.sh
docker compose ps
docker compose logs --tail=100 agent-memory
curl -fsS https://memory.opspresso.com/api/health
```

`latest`는 최초 확인용이다. 운영 업데이트는 `v0.1.0` 같은 release tag를 고정하라.

## 지표 수집

Application은 database 조회 없이 동작하지만 Bearer token을 요구하는 Prometheus endpoint `GET /api/metrics`를 제공한다. `.env.secrets`의 `METRICS_BEARER_TOKEN`과 같은 값을 Alloy service 환경 변수 `AGENT_MEMORY_METRICS_TOKEN`으로 설정하라. [Alloy scrape 설정](alloy-agent-memory.alloy)을 Agent Studio가 관리하는 `/etc/alloy/config.alloy`에 합친 뒤 검증하고 reload하라.

```bash
sudo alloy validate /etc/alloy/config.alloy
sudo systemctl reload alloy
curl -fsS -H "Authorization: Bearer $METRICS_BEARER_TOKEN" https://memory.opspresso.com/api/metrics
```

Grafana에서는 `up{job="agent-memory"}`가 `1`인지 확인한다. Endpoint는 build version과 process CPU·memory·event-loop, document worker 활성 상태만 노출하며 organization, 사용자, 검색어, Memory·문서 본문을 label이나 값에 포함하지 않는다.

## 백업

PostgreSQL dump와 MinIO object를 함께 보관하라.

```bash
scripts/backup.sh
```

기본 위치는 `/opt/compose/backup/agent-memory`이며 7일이 지난 backup directory를 제거한다. `.env.secrets`, `.env.aws`, `.env.infrastructure`는 별도 secret manager에서 복구해야 한다. `.env.runtime-secrets`는 deploy script가 다시 생성한다. Database와 object storage 중 하나만 복원하면 document metadata와 원본이 불일치한다.
