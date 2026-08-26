# 운영 가이드

## 실행 모드

로컬 개발은 PostgreSQL과 선택형 MinIO를 Compose로 실행하고 Next.js를 host에서 실행한다. 전체 Compose에서는 하나의 `app` process가 Next.js application을 시작하면서 설정에 따라 migration과 document worker도 시작한다.

```text
로컬 개발
host: pnpm dev ───────────────┐
                             ├──▶ PostgreSQL
Compose: postgres, MinIO ─────┘      └── pg-boss

전체 Compose
app: Next.js + migration + worker ──▶ PostgreSQL
                  └─────────────────▶ MinIO/S3
```

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

로그인 가능한 환경부터 첫 검색까지의 절차는 [시작 가이드](getting-started.md)를 따른다.

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

Compose의 `app` service는 `.env.local`의 Google credential과 접근 정책을 전달하고 local signup, migration, document worker를 활성화하며 `http://localhost:3100`에 노출된다. Migration과 worker는 별도 Compose service가 아니라 `app` process의 Next.js instrumentation에서 시작된다. Google OAuth application의 승인된 redirect URI에는 `http://localhost:3100/api/auth/callback/google`을 등록하라. Object profile 없이 app을 실행하면 document upload에 필요한 S3 endpoint를 별도로 제공해야 한다.

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
| Embedding | `EMBEDDING_MODEL` | 설정 시 Memory, document chunk, Knowledge node embedding과 semantic search 활성화 |
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

다음 설정은 일부만 제공하면 application 시작 시 실패한다.

- `AUTH_PASSWORD_SIGNUP=true`에는 `AUTH_PASSWORD=true`가 필요하다.
- Google은 `GOOGLE_CLIENT_ID`와 `GOOGLE_CLIENT_SECRET`을 함께 설정한다.
- OIDC는 `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`을 함께 설정한다.
- `EMBEDDING_MODEL`에는 `EMBEDDING_BASE_URL`이 필요하다.
- `KNOWLEDGE_EXTRACTION_MODEL`에는 `KNOWLEDGE_EXTRACTION_BASE_URL`이 필요하다.
- Langfuse는 `LANGFUSE_PUBLIC_KEY`와 `LANGFUSE_SECRET_KEY`를 함께 설정한다.
- `LANGFUSE_EXPORT_MODE`는 `batched` 또는 `immediate`만 허용한다.

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

## 운영 topology와 데이터 보호

단일 instance에서는 `MIGRATE_ON_START=true`와 `DOCUMENT_WORKER_ENABLED=true`로 application, migration, worker를 같은 process에서 실행할 수 있다.

여러 application instance를 운영할 때는 다음 구성을 권장한다.

```text
migration job: MIGRATE_ON_START 또는 pnpm db:migrate를 한 번 실행
web instances: MIGRATE_ON_START=false, DOCUMENT_WORKER_ENABLED=false
worker instance: MIGRATE_ON_START=false, DOCUMENT_WORKER_ENABLED=true
```

현재 Docker image의 기본 command는 Next.js server이므로 전용 worker도 HTTP server와 같은 process에서 시작된다. 완전히 분리된 worker-only entry point는 제공하지 않는다. 여러 worker가 같은 pg-boss queue를 처리할 수 있으며 document processing lease가 stale worker의 늦은 상태 변경을 차단한다.

백업은 다음 두 저장 영역을 함께 다뤄야 한다.

- PostgreSQL: 조직, 인증, Memory, revision, document metadata·chunk, Graph, candidate, queue 상태
- S3 호환 storage: 업로드한 원본 문서 object

Database만 복원하고 object storage를 복원하지 않으면 document metadata는 남지만 원본 재처리가 실패할 수 있다. Object storage만 복원하면 권한·상태·chunk·provenance를 복구할 수 없다. 두 저장소의 보존 시점과 복원 절차를 함께 관리하라.

## 장애 대응

### `column ... does not exist` 또는 `relation ... does not exist`

Application code보다 Database migration이 오래된 상태다.

```bash
pnpm db:migrate
```

실행 후 application을 다시 요청하고 `drizzle/meta/_journal.json`의 migration과 대상 Database의 적용 이력을 대조하라. 임의로 table이나 column을 수동 생성하지 마라.

### 브라우저에서 `Unexpected end of JSON input`

이 메시지는 client가 빈 응답이나 JSON이 아닌 오류 응답을 `response.json()`으로 읽을 때 나타나는 2차 오류일 수 있다. 같은 시각의 server log에서 원래 HTTP 오류와 Database·storage 예외를 먼저 확인하라. Network panel에서 status, content type, response body를 확인하고 migration 누락이나 unhandled server error를 해결하라.

### 문서가 `pending`에 머묾

1. `DOCUMENT_WORKER_ENABLED=true`인지 확인한다.
2. Application과 worker가 같은 `DATABASE_URL`을 사용하는지 확인한다.
3. pg-boss 관련 application log를 확인한다.
4. Worker를 다시 시작한 뒤 document 상태를 조회한다.

Worker가 비활성화된 상태에서 upload한 문서는 자동으로 `ready`가 되지 않는다.

### 문서가 `failed` 상태가 됨

1. 응답의 `processingError`와 같은 시각의 application log를 확인한다.
2. `S3_ENDPOINT`, bucket, credential과 network 연결을 확인한다.
3. 파일 MIME type과 UTF-8 text 추출 가능 여부를 확인한다.
4. 원인을 해결한 뒤 retry endpoint나 운영 콘솔의 `다시 처리`를 사용한다.

`pending`, `processing`, `ready` 문서는 retry할 수 없으며 `409`를 반환한다.

### Semantic search가 동작하지 않음

- `EMBEDDING_MODEL`이 없으면 lexical search만 사용하는 것이 정상이다.
- Model을 설정했다면 `EMBEDDING_BASE_URL`과 선택형 credential을 확인한다.
- 저장된 resource와 query가 같은 embedding model을 사용하는지 확인한다.
- Provider가 OpenAI-compatible embeddings API를 지원하는지 확인한다.

Embedding provider 장애는 embedding이 필요한 새 Memory·Knowledge node 생성 또는 문서 처리와 semantic query를 실패시킬 수 있다. Provider를 사용하지 않을 계획이면 `EMBEDDING_MODEL`을 비워 lexical-only 모드로 실행하라.

### AI 후보가 생성되지 않음

1. 문서가 `ready`인지 확인한다.
2. `KNOWLEDGE_EXTRACTION_MODEL`과 `KNOWLEDGE_EXTRACTION_BASE_URL`을 확인한다.
3. Provider가 JSON Schema structured output을 지원하는지 확인한다.
4. `document-knowledge-enrichment` queue 오류를 application log에서 확인한다.
5. 후보 조회 사용자에게 source scope의 `manage` 권한이 있는지 확인한다.

Enrichment 실패는 ready 문서와 기존 문서 검색 상태를 되돌리지 않는다.

### HTTP 오류별 확인 순서

| Status | 확인 항목 |
| --- | --- |
| `400` | UUID, query 범위, JSON·multipart schema |
| `401` | Session 만료, Bearer token 누락·오류 |
| `403` | 조직 membership, organization/team role, resource action |
| `404` | ID와 organization 일치 여부, source를 읽을 수 있는지 여부 |
| `409` | 최신 Memory version, document retry 가능 상태, candidate review 상태 |
| `413` | request와 원본 파일의 10 MiB 제한 |
| `428` | Memory PATCH·DELETE의 `If-Match` header |
| `503` | PostgreSQL 연결과 migration 상태 |

## 배포 전 확인

```bash
pnpm verify
```

`pnpm verify`는 lint, typecheck, architecture, unit test, production build를 실행한다. Database 변경은 `pnpm test:integration`, 화면과 인증 흐름 변경은 `pnpm test:e2e`를 추가한다. 세부 기준은 [AGENTS.md](../AGENTS.md#검증)를 따른다.

운영 배포 전에 다음도 확인하라.

- `BETTER_AUTH_SECRET`과 S3 credential을 개발 기본값에서 교체한다.
- 필요하지 않은 password provider와 signup을 비활성화한다.
- `ALLOWED_EMAIL_DOMAINS`와 `ADMIN_EMAILS`를 운영 정책에 맞춘다.
- Google/OIDC callback URL과 `BETTER_AUTH_URL`을 실제 origin에 맞춘다.
- Migration을 어떤 job 또는 instance가 한 번 적용할지 결정한다.
- Web과 worker process의 `DATABASE_URL`, S3, AI provider 설정을 일치시킨다.
- PostgreSQL과 object storage의 백업·복원 절차를 검증한다.
- `/api/health`와 stdout JSON log 수집을 배포 환경에 연결한다.
- Token, password, 본문, 검색어, embedding 입력·출력이 log에 포함되지 않는지 확인한다.
