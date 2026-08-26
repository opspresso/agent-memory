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

첫 실행은 `.env`, `.env.secrets`, `.env.infrastructure`를 생성한 뒤 중단한다. 값을 검토하고 `BETTER_AUTH_SECRET`을 `openssl rand -base64 32`로 설정하라. `.env.infrastructure`에는 공유 PostgreSQL의 `agent_memory` database URL과 공유 MinIO credential·endpoint를 넣는다.

Agent Studio와 같은 AWS credential을 `.env.aws`에 두면 deploy script가 아래 SSM Parameter Store 값을 매번 읽어 `.env.runtime-secrets`를 생성한다. `.env.runtime-secrets`는 직접 편집하지 않는다. 세 parameter 중 하나라도 없으면 빈 값으로 배포하지 않고 즉시 실패한다.

- `GOOGLE_CLIENT_ID`: `/k8s/common/agent-memory/google-client-id`
- `GOOGLE_CLIENT_SECRET`: `/k8s/common/agent-memory/google-client-secret`
- `EMBEDDING_API_KEY`: `/k8s/common/agent-memory/embedding-api-key`

```bash
cp .env.aws.example .env.aws
chmod 600 .env.aws
```

Agent Studio의 `agent-studio` IAM user를 함께 사용하려면 `terraform-env-demo/demo/9-agent-studio/85-idc.tf`의 `agent-studio-idc-ssm-read` 정책에 `arn:aws:ssm:<region>:<account>:parameter/k8s/common/agent-memory/*`를 추가해 적용하라. 기존 `/agent-studio/*` 권한만으로는 이 경로를 읽을 수 없다.

공유 PostgreSQL에 database를 한 번 생성하라. 기존 운영 database와 table은 건드리지 않는다.

```bash
docker exec -it agent-studio-postgres-1 createdb -U agent_studio agent_memory
```

공유 edge network를 만들고 `agent-studio.compose.override.yaml`을 Agent Studio 설치 경로의 `compose.override.yaml`로 복사하라. 이렇게 해야 Agent Studio가 Caddy를 재생성해도 shared-edge 연결이 유지된다. `Caddyfile.shared-edge`의 site block도 기존 Caddyfile에 합쳐 reload하라.

```bash
docker network create opspresso-edge
cp agent-studio.compose.override.yaml ../agent-studio/compose.override.yaml
docker compose --project-directory ../agent-studio up -d caddy
docker exec agent-studio-caddy-1 caddy reload --config /etc/caddy/Caddyfile
```

이후 `scripts/deploy.sh`를 실행한다. Script가 app을 공유 data·edge network에 연결하고 `agent-memory` bucket을 멱등 생성한다.

Registry를 거치지 않고 host에 미리 load한 image로 최초 설치를 검증할 때만 `PULL_IMAGES=false`를 사용하라. 이후 업데이트는 registry의 immutable tag를 pull하라.

## 업데이트와 확인

`.env`의 `AGENT_MEMORY_IMAGE`를 배포할 immutable tag로 바꾸고 실행하라.

```bash
scripts/deploy.sh
docker compose ps
docker compose logs --tail=100 app
curl -fsS https://memory.opspresso.com/api/health
```

`latest`는 최초 확인용이다. 운영 업데이트는 `v0.1.0` 같은 release tag를 고정하라.

## 백업

PostgreSQL dump와 MinIO object를 함께 보관하라.

```bash
scripts/backup.sh
```

기본 위치는 `/opt/compose/backup/agent-memory`이며 7일이 지난 backup directory를 제거한다. `.env.secrets`, `.env.aws`, `.env.infrastructure`는 별도 secret manager에서 복구해야 한다. `.env.runtime-secrets`는 deploy script가 다시 생성한다. Database와 object storage 중 하나만 복원하면 document metadata와 원본이 불일치한다.
