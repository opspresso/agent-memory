# 운영 가이드

## 실행 모드

로컬 개발은 PostgreSQL만 Compose로 실행하고 Next.js를 host에서 실행한다. 전체 Compose는 application, migration, document worker, PostgreSQL과 선택형 MinIO를 함께 실행한다.

### 로컬 개발

Node.js 24, pnpm 11, Docker가 필요하다.

```bash
corepack enable
pnpm install
cp .env.example .env.local
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Application은 `http://localhost:3100`, PostgreSQL은 `localhost:5433`에서 열린다. `.env.local`의 Google 또는 OIDC 설정을 사용하며, password 로그인이 필요하면 `AUTH_PASSWORD`와 `AUTH_PASSWORD_SIGNUP`을 `true`로 설정하라.

문서 수집을 개발하려면 MinIO와 bucket 초기화를 실행하고 worker를 켜라.

```bash
docker compose --profile objects up -d minio minio-init
pnpm dev
```

MinIO API는 `localhost:9010`, console은 `localhost:9011`에서 열린다. `.env.example`은 document worker를 기본 활성화하므로 이를 복사한 `.env.local`에서는 별도 실행 변수가 필요하지 않다.

### 전체 Compose

```bash
docker compose --env-file .env.local --profile objects up -d --build
```

Compose의 app service는 `.env.local`의 Google credential과 접근 정책을 전달하고 local signup, migration, document worker를 활성화하며 `http://localhost:3100`에 노출된다. Google OAuth application의 승인된 redirect URI에는 `http://localhost:3100/api/auth/callback/google`을 등록하라. Object profile 없이 app을 실행하면 document upload에 필요한 S3 endpoint를 별도로 제공해야 한다.

Agent Studio의 PostgreSQL 17과 포트·volume을 공유하지 않는다. `docker compose down -v`는 PostgreSQL과 MinIO 데이터를 제거하므로 필요한 데이터와 대상 project를 확인하기 전에는 실행하지 마라.

## 환경 변수

`.env.example`을 기준으로 환경별 값을 설정하라.

| 그룹 | 변수 | 역할 |
| --- | --- | --- |
| Database | `DATABASE_URL` | PostgreSQL 연결 문자열 |
| Startup | `MIGRATE_ON_START` | Node.js runtime 시작 시 migration 실행 |
| Worker | `DOCUMENT_WORKER_ENABLED` | 같은 process에서 pg-boss document worker 시작 |
| Auth | `BETTER_AUTH_SECRET` | Better Auth secret, 32자 이상 |
| Auth | `BETTER_AUTH_URL` | Application base URL과 trusted origin |
| Auth | `AUTH_PASSWORD` | Email/password 로그인 활성화 |
| Auth | `AUTH_PASSWORD_SIGNUP` | Self-signup 활성화. `AUTH_PASSWORD=true`가 함께 필요 |
| Auth | `ALLOWED_EMAIL_DOMAINS` | 로그인 허용 email domain의 comma-separated 목록. 기본값 `nalbam.com` |
| Auth | `ADMIN_EMAILS` | 첫 조직을 만들 수 있는 email의 comma-separated 목록. 기본값 `me@nalbam.com` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google provider. 두 값을 함께 설정 |
| OIDC | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Generic OIDC provider. 세 값을 함께 설정 |
| OIDC | `OIDC_SCOPES` | 공백으로 구분한 scope. 기본값 `openid email profile` |
| Embedding | `EMBEDDING_BASE_URL` | OpenAI-compatible API base URL. OpenRouter는 `https://openrouter.ai/api/v1` 사용 |
| Embedding | `EMBEDDING_API_KEY` | Embedding provider의 Bearer credential. 인증 없는 local endpoint에서는 생략 가능 |
| Embedding | `EMBEDDING_MODEL` | 설정 시 memory와 document semantic search 활성화 |
| Knowledge extraction | `KNOWLEDGE_EXTRACTION_BASE_URL` | OpenAI-compatible chat completions API base URL |
| Knowledge extraction | `KNOWLEDGE_EXTRACTION_API_KEY` | Extraction provider의 Bearer credential. 인증 없는 local endpoint에서는 생략 가능 |
| Knowledge extraction | `KNOWLEDGE_EXTRACTION_MODEL` | 설정 시 ready 문서에서 reviewable graph candidate 생성 |
| Object storage | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` | S3 호환 endpoint와 bucket |
| Object storage | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3 credential |
| Object storage | `S3_FORCE_PATH_STYLE` | MinIO 같은 path-style endpoint 사용 여부 |
| Logging | `LOG_LEVEL` | Pino log level, 기본값 `info` |
| Telemetry | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | Langfuse 활성화. 두 값을 함께 설정 |
| Telemetry | `LANGFUSE_BASE_URL` | Self-hosted 또는 cloud endpoint |
| Telemetry | `LANGFUSE_EXPORT_MODE` | `batched` 또는 `immediate` |
| Telemetry | `LANGFUSE_TRACING_ENVIRONMENT` | Trace 환경 이름 |

`ALLOWED_EMAIL_DOMAINS`는 정확한 domain만 허용하며 subdomain을 자동 허용하지 않는다. 명시적으로 빈 값으로 설정하면 모든 domain을 허용한다. `ADMIN_EMAILS`는 조직 bootstrap 권한만 제어하고 기존 조직의 tenant role을 우회하지 않는다. 빈 값으로 설정하면 누구도 새 조직을 만들 수 없다.

운영에서는 `.env.example`과 Compose의 개발용 credential을 사용하지 말고 secret manager에서 주입하라. Password provider가 필요하지 않으면 비활성화하고 OIDC 또는 Google만 구성하라.

## Database와 migration

Schema source는 `src/infrastructure/database/schema/`, 생성된 migration은 `drizzle/`에 있다.

Document processing claim은 DB에 lease ID를 저장한다. Worker 재시작이나 장기 작업으로 stale claim이 재발급된 경우 이전 worker의 complete·fail 갱신은 거부된다. Knowledge provenance migration은 기존 node·edge의 Memory·chunk source를 별도 source relation으로 backfill한다.

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:studio
```

- Schema를 바꿀 때만 `pnpm db:generate`를 실행하고 생성된 SQL과 snapshot을 함께 검토하라.
- Application과 별도 migration job을 운영하면 `MIGRATE_ON_START=false`를 유지하라.
- 단일 instance 로컬 환경에서는 `MIGRATE_ON_START=true`로 시작 전에 migration을 적용할 수 있다.
- Schema와 tenant constraint 변경은 `pnpm test:integration`으로 실제 PostgreSQL 18 + pgvector에서 검증하라.

## 문서 worker와 object storage

업로드 API는 원본을 S3 호환 storage에 기록한 뒤 pg-boss job을 queue에 넣고 `202`를 반환한다. Worker가 비활성화되어 있으면 문서는 `pending`에 머무른다.

- Worker는 application과 같은 `DATABASE_URL`, S3 설정, embedding·knowledge extraction 설정을 사용해야 한다.
- 시작 전에 bucket이 존재하는지 확인하라. Compose에서는 `minio-init`이 `agent-memory` bucket을 만든다.
- 실패한 문서는 API나 console에서 retry할 수 있다. 반복 실패는 document의 `processingError`와 application log를 확인하라.
- `EMBEDDING_MODEL`을 설정하지 않으면 chunk는 lexical search만 사용한다.
- `KNOWLEDGE_EXTRACTION_MODEL`을 설정하면 ingestion과 분리된 `document-knowledge-enrichment` queue가 ready chunk를 분석한다. 분석 실패는 문서 상태를 되돌리지 않으며 pg-boss가 재시도한다.
- AI 분석은 candidate만 생성한다. Source scope의 `manage` 권한을 가진 사용자가 운영 콘솔이나 API에서 승인해야 Knowledge Graph에 반영된다.

OpenRouter를 사용하려면 `.env.local`에 다음 값을 설정하라.

```dotenv
EMBEDDING_BASE_URL=https://openrouter.ai/api/v1
EMBEDDING_API_KEY=replace-with-openrouter-key
EMBEDDING_MODEL=openai/text-embedding-3-small
KNOWLEDGE_EXTRACTION_BASE_URL=https://openrouter.ai/api/v1
KNOWLEDGE_EXTRACTION_API_KEY=replace-with-openrouter-key
KNOWLEDGE_EXTRACTION_MODEL=provider/structured-output-model
```

OpenAI-compatible local endpoint를 사용하려면 embedding과 knowledge extraction base URL을 해당 server의 `/v1` base URL로 바꾸고 provider가 요구하는 model ID를 지정하라. 인증이 필요하지 않으면 대응 API key를 비워 둬도 된다. Extraction endpoint는 JSON Schema structured output을 지원해야 한다.

## 상태 확인과 관측성

```bash
curl -i http://localhost:3100/api/health
```

Health endpoint는 database에 `select 1`을 실행한다. 정상은 `200`과 `status: "ok"`, database 연결 실패는 `503`과 `status: "unavailable"`을 반환하며 응답은 cache하지 않는다.

Pino log는 stdout에 JSON으로 기록한다. Retrieval log에는 operation, organization ID, result count, duration만 포함하고 query와 본문은 기록하지 않는다.

Langfuse는 public key와 secret key를 모두 설정할 때 활성화된다. `LANGFUSE_EXPORT_MODE` 기본값은 일반 runtime에서 `batched`, Vercel에서 `immediate`다.

## 배포 전 확인

```bash
pnpm verify
```

`pnpm verify`는 lint, typecheck, architecture, unit test, production build를 실행한다. Database 변경은 `pnpm test:integration`, 화면과 인증 흐름 변경은 `pnpm test:e2e`를 추가한다. 세부 기준은 [AGENTS.md](../AGENTS.md#검증)를 따른다.
