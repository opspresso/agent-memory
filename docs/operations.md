# 운영 가이드

## 실행 모드

이 문서는 설치 설정, 서버 시작, 문서 처리, 배포, 장애 복구를 다룬다. 최초 가입과 콘솔 사용은 [시작 가이드](getting-started.md), HTTP·MCP 요청 계약은 [API 문서](api.md)를 따른다.

| 운영 작업 | 위치 |
| --- | --- |
| 로컬 실행·IDC 릴리즈 | [배포 형태](#배포-형태) |
| 설정값·필수 조합·override | [환경 변수](#환경-변수) |
| 초기화 대상 확인 | [Database 초기화](#database-초기화) |
| Worker·queue·종료 | [문서 worker와 object storage](#문서-worker와-object-storage) |
| Health·metrics·로그 | [상태 확인과 관측성](#상태-확인과-관측성) |
| 역할 분리·backup·복원 | [운영 topology와 데이터 보호](#운영-topology와-데이터-보호) |
| 장애 복구·배포 검증 | [장애 대응](#장애-대응), [배포 전 확인](#배포-전-확인) |

로컬 개발은 독립된 `agent-memory-local` PostgreSQL 18·MinIO를 사용하고 Next.js를 host에서 직접 실행한다.

```text
로컬 개발
host: pnpm dev ───────────────┐
                             ├──▶ PostgreSQL
Compose: postgres, MinIO ─────┘      └── pg-boss
```

## 배포 형태

배포 환경마다 application image는 같고 infrastructure 연결 방식만 다르다.

| 환경 | Application | PostgreSQL·Object storage | 진입점 |
| --- | --- | --- | --- |
| Local 개발 | host `pnpm dev` | 독립 `agent-memory-local` PostgreSQL 18·MinIO | `http://localhost:3100` |
| IDC (운영) | `../dockpad` | 배포 저장소가 소유 | `https://memory.opspresso.com/` |
| EKS (중지) | 배포·검증 대상에서 제외 | — | — |

이 저장소는 IDC Compose나 Kubernetes manifest를 보관하지 않는다. Release workflow는 image 게시 후 `argocd-env-demo`에 tag만 전달한다.

IDC에서 PostgreSQL process와 MinIO service를 Agent Studio와 공유하더라도 데이터 경계는 합치지 마라. Agent Memory는 별도 `agent_memory` database와 `agent-memory` bucket을 사용한다. 이렇게 하면 compute·storage service 운영은 공유하면서 schema, backup, 복원 단위는 분리된다.

### 릴리즈와 IDC 배포

릴리즈는 tag·GitHub Release·image 게시·alpha version 목록 갱신까지다. IDC 배포는 사용자가 `../dockpad`에서 직접 명령하는 별도 작업이다. Agent는 릴리즈 요청만으로 Dockpad 배포나 운영 서비스 재시작·재생성을 실행하지 않는다.

릴리즈는 다음 순서로 진행한다.

1. `v*` tag push가 `.github/workflows/release.yml`을 시작한다. GitHub-hosted Ubuntu 24.04 runner에서 `pnpm verify`, PostgreSQL integration, 인증 E2E를 실행한다.
2. 검증 후 GitHub Release 생성과 image build가 독립 job으로 실행된다. Image는 ECR·GHCR에 `<tag>`와 `latest`로 게시한다.
3. Image 게시 성공 후 GitHub App installation token으로 `argocd-env-demo`에 project `agent-memory`, container `app`, phase `alpha`의 GitOps dispatch를 보낸다. Dockpad가 읽는 alpha image version 목록이 갱신됐는지 확인한다.

릴리즈 완료 후 IDC 배포가 필요하면 사용자가 다음 절차를 직접 수행한다.

1. 다음 명령으로 IDC의 기존 설치를 백업하고 배포 설정을 동기화한 뒤 Agent Memory image tag를 갱신한다.

   ```bash
   ../dockpad/scripts/remote.sh deploy-selected alpha agent-memory
   ```

2. 실제 container image와 `https://memory.opspresso.com/api/health`, 공개 화면의 version을 확인한다.

Release 완료 조건은 workflow 성공, ECR·GHCR image 게시, alpha version 목록 갱신이다. IDC rollout은 별도 사용자 작업이며 릴리즈 완료 조건에 포함하지 않는다. EKS는 중지 상태이므로 Argo CD sync나 EKS 접속은 요구하지 않는다.

선택 배포는 다른 서비스의 image tag를 유지한다. 다만 Dockpad는 공통 Compose 설정도 적용하므로 다른 서비스가 같은 버전으로 재기동될 수 있다. 백업·health check 역시 공유 설치를 대상으로 한다.

### 로컬 개발

Node.js 24, pnpm 11, Docker가 필요하다.

```bash
corepack enable
pnpm install
cp .env.example .env.local
```

서버를 시작하기 전에 `.env.local`의 `BETTER_AUTH_SECRET`과 `ADMIN_EMAILS`를 설정하고 로그인 수단을 하나 이상 활성화하라. 로컬 password 가입은 다음 두 설정이 모두 필요하다. Google 또는 OIDC를 사용하면 해당 provider의 필수값을 대신 설정한다.

```dotenv
AUTH_PASSWORD=true
AUTH_PASSWORD_SIGNUP=true
```

```bash
docker compose up --wait postgres minio
docker compose run --rm minio-init
```

`up --wait`가 PostgreSQL·MinIO의 health를 확인하고 `run --rm minio-init`이 bucket 생성을 완료한 뒤 schema 초기화와 서버를 실행하라. 앞 명령이 실패하면 이후 단계로 진행하지 마라. DB 주소를 기본 Compose 값에서 바꿨다면 먼저 [CLI의 환경 변수 처리](#database-초기화)를 확인한다.

```bash
pnpm db:init
pnpm dev
```

| 대상 | 로컬 주소 |
| --- | --- |
| Application | `http://localhost:3100` |
| PostgreSQL | `localhost:5433` |
| MinIO API / console | `http://localhost:9010` / `http://localhost:9011` |

`.env.example`은 document worker와 전용 MinIO 설정을 기본 활성화한다. 기존 DB를 재사용하면 [Database 설정 override](#database-설정-override)가 `.env.local`보다 우선한다. `docker compose down -v`는 PostgreSQL·MinIO volume을 삭제하므로 데이터를 확인하지 않고 실행하지 마라.

## 화면 언어

화면은 English(`en`)와 한국어(`ko`)를 지원한다. URL에는 locale segment를 넣지 않는다. Header의 언어 메뉴에서 선택하면 `agent-memory-locale` cookie에 1년간 저장하고 현재 route를 다시 rendering한다.

첫 요청은 다음 우선순위로 언어를 결정한다.

1. 유효한 `agent-memory-locale` cookie
2. `Accept-Language`에서 quality value가 가장 높은 지원 언어
3. English

English catalogue인 `src/app/_i18n/messages/en.ts`가 message key의 source다. 사용자 화면 문구를 추가하면 같은 key를 `src/app/_i18n/messages/ko.ts`에도 추가하라. Korean catalogue는 English key type을 따르므로 누락된 번역은 `pnpm typecheck`에서 실패한다. API와 domain error, resource 이름, model·status 같은 protocol 값은 번역하지 않는다.

## 환경 변수

`.env.example`을 기준으로 환경별 값을 설정하라. 샘플은 bootstrap, 인증·접근 정책, 문서 worker·quota, object storage, AI 기능·호출 제한, 관측성, 개발·빌드 순으로 구분한다. 주석 처리된 선택 항목은 해당 기능을 사용할 때 활성화한다. 최초 실행 전에 secret과 관리자 email을 바꾸고 Google·OIDC·password 중 최소 한 개의 로그인 수단을 설정하라.

### Bootstrap과 빌드

| 그룹 | 변수 | 역할 |
| --- | --- | --- |
| Database | `DATABASE_URL` | PostgreSQL 연결 문자열 |
| Startup | `NODE_ENV` | `production`이면 운영 필수 변수 검증을 활성화 |
| Build | `NEXT_DIST_DIR` | Next.js 출력 디렉터리. 기본값 `.next`, Playwright 서버는 `.next-e2e` 사용 |

### 인증과 접근 정책

| 그룹 | 변수 | 역할 |
| --- | --- | --- |
| Auth | `BETTER_AUTH_SECRET` | Better Auth secret, 32자 이상. 조직 Agent token·설정 override의 암호화 root. 변경 시 기존 암호문 복호화 불가 |
| Auth | `BETTER_AUTH_URL` | Application base URL과 trusted origin. Public production origin은 HTTPS 필수 |
| Auth | `AUTH_PASSWORD` | Email/password 로그인 활성화 |
| Auth | `AUTH_PASSWORD_SIGNUP` | Self-signup 활성화. `AUTH_PASSWORD=true`가 함께 필요하며 loopback 이외의 production에서는 허용하지 않음 |
| Auth | `ALLOWED_EMAIL_DOMAINS` | 로그인 허용 email domain의 comma-separated 목록. 미설정 또는 빈 값이면 모든 domain 허용 |
| Auth | `ADMIN_EMAILS` | 최초 owner와 전역 설정 관리자를 지정하는 email의 comma-separated 목록. 기본값 `me@nalbam.com` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google provider. 두 값을 함께 설정 |
| OIDC | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Generic OIDC provider. 세 값을 함께 설정 |
| OIDC | `OIDC_SCOPES` | 공백으로 구분한 scope. 기본값 `openid email profile` |

### 문서 처리와 저장소

| 그룹 | 변수 | 역할 |
| --- | --- | --- |
| Worker | `DOCUMENT_WORKER_ENABLED` | 같은 process에서 pg-boss document worker 시작 |
| Worker | `KNOWLEDGE_ENRICHMENT_CONCURRENCY` | 동시 enrichment job 수. 기본 `4`, 범위 `1–16`, `AI_PROVIDER_MAX_CONCURRENCY` 이하로 제한 |
| Document quota | `DOCUMENT_STORAGE_QUOTA_BYTES` | Organization별 누적 원본 크기 상한. 기본값 1 GiB(`1073741824`) |
| Document quota | `DOCUMENT_PENDING_QUOTA` | Organization별 `pending`·`processing` 문서 합산 상한. 기본값 `100` |
| Document quota | `DOCUMENT_UPLOADS_PER_USER_PER_HOUR` | 사용자별 organization 문서 업로드 시간당 상한. 기본값 `100` |
| Object storage | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` | S3 호환 endpoint와 bucket |
| Object storage | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3 credential |
| Object storage | `S3_FORCE_PATH_STYLE` | MinIO 같은 path-style endpoint 사용 여부 |

### AI 기능과 호출 제한

| 그룹 | 변수 | 역할 |
| --- | --- | --- |
| Embedding | `EMBEDDING_BASE_URL` | OpenAI-compatible API base URL. OpenRouter는 `https://openrouter.ai/api/v1` 사용 |
| Embedding | `EMBEDDING_API_KEY` | Embedding provider의 Bearer credential. 인증 없는 local endpoint에서는 생략 가능 |
| Embedding | `EMBEDDING_MODEL` | 설정 시 Memory, document chunk, Knowledge node embedding과 semantic search 활성화 |
| Reranker | `RERANKER_BASE_URL` | `/rerank`를 제공하는 OpenRouter 또는 vLLM-compatible API base URL |
| Reranker | `RERANKER_API_KEY` | Reranker provider의 선택형 Bearer credential |
| Reranker | `RERANKER_MODEL` | 설정 시 권한 필터된 통합 Context·Memory 회상 후보의 2차 정렬 활성화 |
| Reranker | `RERANKER_TIMEOUT_MS` | Reranker 요청 timeout. 기본값 `5000` |
| Reranker | `RERANKER_MIN_SCORE` | 선택형 relevance 하한. `0`부터 `1` 사이이며 미설정 시 순위만 적용 |
| Knowledge extraction | `KNOWLEDGE_EXTRACTION_BASE_URL` | OpenAI-compatible chat completions API base URL |
| Knowledge extraction | `KNOWLEDGE_EXTRACTION_API_KEY` | Extraction provider의 Bearer credential. 인증 없는 local endpoint에서는 생략 가능 |
| Knowledge extraction | `KNOWLEDGE_EXTRACTION_LANGUAGE` | 생성하는 설명·사건 이름의 언어. `ko`(기본: 한국어), `source`(원문 언어), `en`(영어). 고유명·별칭·인용은 원문 표기를 보존 |
| Knowledge extraction | `KNOWLEDGE_EXTRACTION_MODEL` | 설정 시 ready 문서에서 reviewable graph candidate 생성 |
| AI provider | `AI_PROVIDER_MAX_CONCURRENCY` | Instance에서 동시에 실행할 embedding·reranker·extraction 요청 수. 기본값 `8` |
| AI provider | `AI_PROVIDER_REQUESTS_PER_MINUTE` | Instance가 분당 실행할 embedding·reranker·extraction 요청의 합산 상한. 기본값 `120` |
| AI provider | `AI_ORGANIZATION_REQUESTS_PER_MINUTE` | PostgreSQL에서 공유하는 organization별 분당 AI 요청 상한. 기본값 `120` |
| AI provider | `AI_USER_REQUESTS_PER_MINUTE` | PostgreSQL에서 공유하는 organization 내 사용자별 분당 AI 요청 상한. 기본값 `30` |

### 관측성

| 그룹 | 변수 | 역할 |
| --- | --- | --- |
| Logging | `LOG_LEVEL` | Pino log level, 기본값 `info` |
| Metrics | `METRICS_BEARER_TOKEN` | Prometheus scrape Bearer token. 32자 이상이며 미설정 시 endpoint 비활성화 |
| Telemetry | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | Langfuse 활성화. 두 값을 함께 설정 |
| Telemetry | `LANGFUSE_BASE_URL` | Self-hosted 또는 cloud endpoint |
| Telemetry | `LANGFUSE_EXPORT_MODE` | `batched` 또는 `immediate`. Vercel runtime(`VERCEL` 자동 설정)에서는 기본값 `immediate` |
| Telemetry | `LANGFUSE_TRACING_ENVIRONMENT` | Trace 환경 이름 |

`ALLOWED_EMAIL_DOMAINS`는 미설정하거나 빈 값이면 모든 domain을 허용한다. 목록을 설정하면 정확한 domain만 허용하며 subdomain을 자동 허용하지 않는다. `ADMIN_EMAILS`는 최초 owner bootstrap과 전역 설정 관리 권한만 제어하고 조직의 membership·role을 우회하지 않는다. 초기 설치 전에 실제 운영자 email을 지정하라. 전역 admin도 active owner가 이미 있으면 다른 신규 사용자처럼 승인을 기다린다.

### 필수 조건과 시작 검증

설정 저장과 서버 시작은 `src/lib/runtime-configuration.ts`의 같은 검증기를 사용한다. 형식과 설정 조합을 검증하며, 외부 provider의 실제 로그인 성공이나 storage·AI endpoint의 연결 성공까지 보장하지 않는다.

| 검사 | 조건 |
| --- | --- |
| 모든 환경의 로그인 | Google·OIDC·password 중 최소 한 개 활성화 |
| Production bootstrap | DB를 읽기 전에 `DATABASE_URL`, `BETTER_AUTH_SECRET` 필요 |
| Production 유효 설정 | 위 두 값과 `BETTER_AUTH_URL`, `ADMIN_EMAILS`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` 필요. Override 대상은 DB에서 제공해도 됨 |
| Production 인증 | Secret 32자 이상. Loopback 이외의 application origin은 HTTPS이며 password self-signup 금지 |
| HTTP endpoint URL | 인증·S3·AI·Langfuse URL은 credential을 포함하지 않는 절대 HTTP(S) 주소. PostgreSQL 연결 문자열에는 이 규칙을 적용하지 않음 |
| Boolean | `AUTH_PASSWORD`, `AUTH_PASSWORD_SIGNUP`, `DOCUMENT_WORKER_ENABLED`, `S3_FORCE_PATH_STYLE`은 설정 시 `true` 또는 `false` |
| 양의 정수 | AI 호출·document quota와 `RERANKER_TIMEOUT_MS`는 1 이상의 안전한 정수 |
| 선택 점수 | `RERANKER_MIN_SCORE`는 `0`부터 `1` 사이 |
| 관측성 | Metrics token은 설정 시 32자 이상. `LOG_LEVEL`은 `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`. Langfuse export mode는 `batched` 또는 `immediate` |

다음 설정은 함께 제공해야 한다.

| 기능 | 필수 조합 |
| --- | --- |
| Password 가입 | `AUTH_PASSWORD_SIGNUP=true`이면 `AUTH_PASSWORD=true` |
| Google | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` |
| OIDC | `OIDC_ISSUER` + `OIDC_CLIENT_ID` + `OIDC_CLIENT_SECRET` |
| S3 credential | `S3_ACCESS_KEY_ID` + `S3_SECRET_ACCESS_KEY` |
| Embedding | `EMBEDDING_MODEL`을 설정하면 `EMBEDDING_BASE_URL` 필요 |
| Reranker | `RERANKER_BASE_URL` + `RERANKER_MODEL` |
| Knowledge extraction | `KNOWLEDGE_EXTRACTION_LANGUAGE` | 생성하는 설명·사건 이름의 언어. `source`(기본: 원문 언어), `ko`(한국어), `en`(영어). 고유명·별칭·인용은 원문 표기를 보존 |
| Knowledge extraction | `KNOWLEDGE_EXTRACTION_MODEL`을 설정하면 `KNOWLEDGE_EXTRACTION_BASE_URL` 필요 |
| Langfuse | `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` |

`ALLOWED_EMAIL_DOMAINS`는 production에서도 선택 항목이다. 공개 production에서 email verification delivery를 제공하지 않으므로 password self-signup은 사용할 수 없다. 운영 사용자는 Google·OIDC 또는 사전 생성한 password 계정을 사용한다. 개발 credential은 secret manager에서 주입한 운영값으로 교체하라.

### Database 설정 override

전역 admin은 계정 메뉴의 `설정`에서 조직 가입 여부와 관계없이 애플리케이션 설정을 관리한다. 조직 이름·기본 팀·온톨로지는 별도의 조직 설정에 속한다.

설정값을 결정하는 순서는 다음과 같다.

1. `app_settings` singleton row의 override
2. 서버 시작 시 읽은 process environment — 로컬 Next.js는 `.env.local`, 컨테이너는 배포 환경에서 제공
3. 해당 설정을 사용하는 adapter의 기본값 또는 비활성 상태

화면은 각 값의 출처를 표시한다. Override가 있으면 env만 수정하고 재시작해도 해당 값은 바뀌지 않는다. Env로 복귀하려면 override를 reset한다. 빈 문자열은 reset이 아니며 `ALLOWED_EMAIL_DOMAINS`에 빈 override를 저장하면 env의 제한 목록이 있어도 모든 domain을 허용한다. 빈 log level·Langfuse export mode·S3 endpoint 등은 거부한다.

| 적용 단위 | 변수 | 반영 시점 |
| --- | --- | --- |
| Bootstrap env | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `NODE_ENV` | DB 접근·복호화·시작 방식에 먼저 필요. Override 불가 |
| 요청 시 다시 읽는 설정 | `ALLOWED_EMAIL_DOMAINS`, `ADMIN_EMAILS`, `METRICS_BEARER_TOKEN` | 저장한 instance에서 즉시 적용. 다른 instance는 최대 5초 cache 후 반영 |
| Process 초기화 설정 | 인증 provider, AI, document worker·quota, S3, logging, telemetry 등 나머지 설정 | 사용하는 모든 instance 재시작 필요 |
| Framework·검사 환경 | `NEXT_DIST_DIR`, `NEXT_RUNTIME`, `NEXT_PHASE`, `VERCEL`, `CI`, `E2E_*` 등 | 전역 설정 화면에서 관리하지 않음 |

설정 저장은 DB transaction에서 최신 전역 관리자 권한을 확인하고 직렬화해 동시 변경을 보존한다. Embedding·reranker·knowledge extraction endpoint를 바꿀 때 기존 credential이 있으면 대응 API key를 명시적으로 입력하거나 빈 값으로 제거해야 한다. Endpoint와 API key를 함께 reset하면 env의 쌍으로 복귀한다.

#### 암호화와 root secret 복구

Secret override와 조직 Agent token 원문은 `BETTER_AUTH_SECRET`에서 각각 분리해 파생한 key로 암호화한다. 설정 화면과 API에는 secret override를 마스킹해서 반환한다.

- Root secret을 변경하면 기존 secret override를 복호화할 수 없어 서버 시작이 실패할 수 있다. Env에 새 provider key를 넣어도 기존 DB override가 우선하므로 이를 우회하지 못한다.
- 조직 Agent token의 인증은 hash 검증이므로 root secret 변경만으로 폐기되지 않는다. 기존 token 원문의 reveal은 실패한다. Token 폐기는 별도의 관리 작업이다.
- 교체 전에 기존 key로 설정을 복구할 절차와 각 provider credential을 확보하라. 자동 key rotation·기존 암호문 재암호화 기능은 제공하지 않는다.
- DB 복원에 사용할 당시 root secret은 DB·object backup과 별도 secret manager에서 보존한다.

### AI provider 연결

다음은 OpenRouter 연결 형식의 샘플이다. 사용하는 기능만 활성화하고 실제 지원 model ID를 지정하라. 로컬 env 또는 전역 설정에 입력한 뒤 관련 instance를 재시작한다.

```dotenv
EMBEDDING_BASE_URL=https://openrouter.ai/api/v1
EMBEDDING_API_KEY=replace-with-openrouter-key
EMBEDDING_MODEL=openai/text-embedding-3-small
RERANKER_BASE_URL=https://openrouter.ai/api/v1
RERANKER_API_KEY=replace-with-openrouter-key
RERANKER_MODEL=voyageai/rerank-2.5-lite
RERANKER_TIMEOUT_MS=5000
KNOWLEDGE_EXTRACTION_BASE_URL=https://openrouter.ai/api/v1
KNOWLEDGE_EXTRACTION_API_KEY=replace-with-openrouter-key
KNOWLEDGE_EXTRACTION_MODEL=provider/structured-output-model
```

OpenAI-compatible local endpoint를 사용하려면 embedding, reranker, knowledge extraction base URL을 해당 server의 `/v1` base URL로 바꾸고 provider가 요구하는 model ID를 지정하라. Reranker endpoint는 OpenRouter 또는 vLLM의 `documents`, `query`, `top_n` 요청과 `index`, `relevance_score` 응답 계약을 지원해야 한다. 인증이 필요하지 않으면 대응 API key를 비워 둬도 된다. Extraction endpoint는 JSON Schema structured output을 지원해야 한다.

한국어 지식 추출은 설정 → AI → 지식 추출 언어에서 한국어를 선택하거나 `KNOWLEDGE_EXTRACTION_LANGUAGE=ko`로 설정한다. Application·worker를 재시작해야 반영된다. 모델 프롬프트가 생성하는 설명과 사건 이름의 언어를 지정하며, 원문에 있는 고유명·별칭과 근거 인용은 번역하지 않는다. Kind·predicate는 기존 온톨로지 식별자를 유지한다. 설정 변경은 이후 새 추출에 적용되며, 기존 후보·승인된 지식과 재사용하는 추출 결과를 자동 번역하거나 재생성하지 않는다.

Embedding, reranker, knowledge extraction, ontology suggestion은 instance별 동시 실행·분당 호출 제한과 PostgreSQL의 조직·사용자 분당 quota를 공유한다. Replica를 늘려도 같은 조직·사용자의 durable quota는 늘어나지 않는다. Provider account 전체 예산은 별도로 관리한다.

#### 기존 데이터와 model 변경

AI 설정의 활성화·model 교체·재시작은 기존 resource를 자동으로 재처리하지 않는다.

| 대상 | Embedding·후보를 생성하는 시점 | 기존 데이터의 영향 |
| --- | --- | --- |
| Memory | 생성 또는 title·content를 포함한 revision | 재시작만으로 기존 vector를 다시 만들지 않음. Embedding을 끈 상태에서 title·content를 수정하면 해당 Memory의 기존 vector 제거 |
| Document chunk | 문서 ingestion | 기존 `ready` 문서의 chunk를 재생성하지 않음. Retry API는 `failed` 문서만 허용 |
| Knowledge node | Node 생성 | 기존 node를 일괄 재embedding하지 않음 |
| AI graph candidate | Ingestion 뒤 chunk별 enrichment job | Model을 나중에 켜도 기존 `ready` 문서를 자동 순회하지 않음 |

Semantic search는 query와 같은 model 이름으로 저장된 vector를 사용한다. Model을 교체하면 이전 model의 resource는 lexical 검색에는 남지만 새 query vector와의 semantic 비교에는 사용되지 않는다. 기존 데이터의 일괄 reindex·ready 문서 재처리 endpoint는 제공하지 않는다. 운영 model 변경 전에 기존 데이터 처리 범위를 결정하라.

### 서버 시작 순서

`src/instrumentation.ts`의 Node.js runtime은 다음 순서로 초기화한다.

1. Production bootstrap 설정을 검사한다.
2. 빈 DB를 초기화하거나 기존 schema fingerprint를 확인한다. 일치하지 않으면 설정 override·worker 준비 전에 시작을 중단한다.
3. DB의 secret override를 복호화하고 유효 설정을 검증한 뒤 process environment에 적용한다.
4. 설치의 단일 조직을 초기화하고 production 설정을 확인한다.
5. Telemetry와 종료 handler를 준비하고 `DOCUMENT_WORKER_ENABLED=true`이면 worker를 시작한다.

따라서 worker를 끈 web instance도 DB·schema 초기화·설정 override가 정상이어야 시작할 수 있다. 여러 instance의 역할 분리는 [운영 topology](#운영-topology와-데이터-보호)를 따른다.

## Database 초기화

Schema source는 `src/infrastructure/database/schema/`, 현재 schema의 생성 SQL은 `database/schema.sql`이다. 누적 migration과 이전 데이터 변환은 제공하지 않는다. 서버는 빈 DB에만 현재 schema를 생성하며, 기존 DB의 fingerprint가 다르면 데이터를 변경하지 않고 시작을 거부한다. 초기화는 transaction과 advisory lock으로 보호하므로 동시 시작에도 한 번만 생성한다.

| 명령 | 용도 |
| --- | --- |
| `pnpm db:generate` | 현재 schema 전체 SQL 생성 |
| `pnpm db:check` | 생성 SQL과 TypeScript schema의 일치 검사 |
| `pnpm db:init` | 빈 DB 초기화 또는 기존 fingerprint 확인 |
| `pnpm db:studio` | 지정한 DB를 조회·편집하는 Drizzle Studio 실행 |

`db:init`은 `.env.local`을 읽고 이미 설정된 `DATABASE_URL`을 우선한다. 주소가 없으면 실패하며 기본 DB를 선택하지 않는다. `db:generate`와 `db:check`는 DB에 연결하지 않는다. Drizzle Studio는 `.env`와 shell의 `DATABASE_URL`을 사용하므로 실제 대상을 먼저 확인하라.

초기화는 `application_schema`에 생성 SQL의 SHA-256 fingerprint를 기록한다. 내용이 없는 DB에서만 테이블을 생성하고, fingerprint가 일치하는 DB는 유지한다. 표식 없이 기존 테이블이 있거나 fingerprint가 다르면 시작을 거부한다. 스키마 호환성이 없는 릴리즈를 기존 DB에 바로 배포하지 마라.

배포 이미지에는 `node scripts/init-database.mjs` 명령도 포함한다. Web·worker 시작 전에 schema만 초기화하고 보존 데이터를 복원할 때 사용한다.

Schema를 변경하면 배포 전에 application·worker를 중단하고 DB·전용 bucket·queue를 명시적으로 초기화한다. 계정·설정 보존이 필요하면 초기화 전에 별도 보존·복원 범위를 결정한다. 공유 Agent Studio DB·bucket은 초기화 대상에 포함하지 않는다. Application 시작에는 자동 DROP·ALTER·backfill이 없다. 임의 DDL에 의한 schema drift는 fingerprint 검사만으로 탐지하지 않는다.

## 문서 worker와 object storage

### 업로드와 처리

업로드 API는 원본을 S3 호환 storage에 기록한 뒤 pg-boss job을 queue에 넣고 `202`를 반환한다. Worker가 비활성화되어 있으면 문서는 `pending`에 머무른다.

원본을 저장한 뒤 document row를 만드는 transaction이 organization advisory lock 아래에서 누적 storage, `pending`·`processing` backlog, 사용자별 최근 1시간 업로드 수를 함께 검사한다. 한도를 넘으면 row를 만들지 않고 방금 저장한 object를 제거하며 API는 `429`를 반환한다. 여러 application replica가 같은 PostgreSQL quota를 공유한다.

- Worker는 application과 같은 `DATABASE_URL`, S3 설정, embedding·knowledge extraction 설정을 사용해야 한다.
- 시작 전에 bucket이 존재하는지 확인하라. Compose에서는 `minio-init`이 `agent-memory` bucket을 만든다.
- 실패한 문서는 retry API로 다시 처리할 수 있다. 반복 실패는 document의 `processingError`와 application log를 확인하라.
- 추출 결과가 512 chunks를 넘으면 provider 호출 전에 실패한다. 이 한도는 작업량을 제한하며 S3·DB 지연을 포함한 전체 처리 시간이 15분 lease 안에 끝남을 보장하지는 않는다. 원본을 더 작은 문서로 나눈 뒤 다시 업로드하라.
- `EMBEDDING_MODEL`을 설정하지 않으면 chunk는 lexical search만 사용한다.
- `KNOWLEDGE_EXTRACTION_MODEL`을 설정하면 ingestion과 분리된 `document-knowledge-enrichment-v2` queue가 ready chunk를 분석한다. 분석 실패는 문서 상태를 되돌리지 않으며 pg-boss가 재시도한다.
- AI 추출 후 같은 모델·endpoint를 사용하는 별도 검증 요청으로 원문 근거·유용성·충돌을 평가한다. 명시적이고 유용하며 인용 검증과 정책을 통과한 항목은 자동 승인한다. 불확실한 항목은 수동 검토로 남기고 근거 없는·사소한 항목은 자동 제외한다. 검증 요청도 AI quota를 소비하며 실패하면 자동 반영하지 않고 enrichment job을 재시도한다. 검증 대상 원문과 제안은 유지하고, 참고할 기존 개체 개요는 개체당 2,000자로 제한해 출처 누적으로 요청이 계속 커지는 것을 막는다.
- 기본 자동 검토는 문서 생성자의 현재 active membership과 source scope `manage` 권한을 요구한다. 검토 화면의 일괄 실행은 인증된 요청자를 job에 기록하며 worker가 그 권한을 다시 확인한다. 저장된 추출과 assessment는 재사용한다. 재추출을 위한 구버전 호환 경로는 없으며 worker 실행이 필요하다.

### Queue와 종료

| Queue | 작업 단위 | Retry 설정 |
| --- | --- | --- |
| `document-ingestion-v2` | Document ID별 exclusive job | 최대 3회, 초기 지연 5초와 backoff |
| `document-knowledge-enrichment-v2` | Chunk ID별 exclusive job | 최대 5회, 초기 지연 15초와 backoff |

두 queue의 job expiration과 document processing lease는 15분이다. Worker가 처리 claim을 다시 얻으면 새 lease ID를 사용하며 이전 worker의 늦은 complete·fail은 거부된다. 문서 retry API의 성공은 enqueue를 뜻하며 즉시 `ready`로 바뀌는 것은 아니다.

Process가 `SIGTERM` 또는 `SIGINT`를 받으면 새 document job 수신을 중단하고 진행 중인 job을 최대 30초 동안 drain한 뒤 Database pool과 telemetry exporter를 순서대로 종료한다. Cleanup 일부가 실패해도 나머지 단계는 계속 실행하며 process는 실패 exit code를 반환한다.

Container image는 `NEXT_MANUAL_SIG_HANDLE=true`로 Next.js 기본 signal handler를 끄고 이 종료 절차가 signal 처리를 담당한다. 기본 handler를 두면 Next.js가 drain 도중 process를 종료한다. 대신 진행 중인 HTTP 응답은 기다리지 않으므로 배포 전에 endpoint에서 instance를 먼저 제외하라. Orchestrator의 종료 유예 시간은 drain보다 길어야 하며 구체 값은 배포 저장소가 소유한다.

## 상태 확인과 관측성

```bash
curl -i http://localhost:3100/api/health
```

### Health와 metrics

| Endpoint | 인증과 응답 | 확인하는 범위 |
| --- | --- | --- |
| `GET /api/health` | 인증 불필요. 정상 `200`, DB·schema 초기화 실패 `503`, cache 안 함 | DB 연결과 현재 schema fingerprint 검사 |
| `GET /api/metrics` | `METRICS_BEARER_TOKEN`과 일치하는 Bearer 필요. 미설정·잘못된 인증은 `404` | Build version, worker 활성 설정, process CPU·memory·event loop delay |

Health의 `200`은 DB 연결과 현재 schema fingerprint가 일치임을 뜻한다. 수동 schema 변경, S3 접근, worker 소비 상태나 AI provider 정상 여부는 보장하지 않는다. Metrics의 worker 값도 실제 처리 진척이 아닌 활성 설정이다. 배포 후에는 document 상태·queue log·필요한 provider 연결을 별도로 확인하라. Metrics token은 조직 Agent token·사용자 session과 다른 전용 credential이다.

### 로그와 trace

Pino log는 stdout에 JSON으로 기록한다. 일반 예외의 message는 버리고 type·code만 기록한다. Provider·storage adapter의 고정 operational error는 안전한 message·code와 message 없는 bounded cause type chain을 기록해 HTTP status, 실패 operation, 외부 예외 종류를 구분한다. Retrieval log에는 operation, organization ID, result count, duration만 포함하고 query와 본문은 기록하지 않는다.

Langfuse는 public key와 secret key를 모두 설정할 때 활성화된다. `LANGFUSE_EXPORT_MODE` 기본값은 일반 runtime에서 `batched`, Vercel에서 `immediate`다.

## 운영 topology와 데이터 보호

단일 instance에서는 `DOCUMENT_WORKER_ENABLED=true`로 application과 worker를 같은 process에서 실행할 수 있다. 빈 DB 초기화는 서버 시작 시 수행한다.

여러 application instance를 운영할 때는 다음 구성을 권장한다.

```text
initialization job: pnpm db:init (선택)
web instances: DOCUMENT_WORKER_ENABLED=false
worker instance: DOCUMENT_WORKER_ENABLED=true
```

이 구성에서는 `DOCUMENT_WORKER_ENABLED`의 DB override를 reset하고 각 process environment에서 값을 지정해야 한다. 같은 DB의 override는 web·worker 모두에 우선 적용되므로 역할별 값을 덮어쓴다.

현재 Docker image의 기본 command는 Next.js server이므로 전용 worker도 HTTP server와 같은 process에서 시작된다. 완전히 분리된 worker-only entry point는 제공하지 않는다. 여러 worker가 같은 pg-boss queue를 처리할 수 있으며 document processing lease가 stale worker의 늦은 상태 변경을 차단한다.

Worker는 `document-ingestion-v2`와 `document-knowledge-enrichment-v2`를 소비한다. 자동 queue 이관은 제공하지 않는다. DB를 초기화할 때는 pg-boss schema의 작업도 함께 정리한다. `failed` 문서만 retry API로 등록할 수 있으며 `pending`·`processing` 문서는 상태·lease와 원본을 확인한 뒤 별도 복구 절차를 결정한다.

### 백업과 복원

백업은 다음 두 저장 영역을 함께 다뤄야 한다.

- PostgreSQL: 조직, 인증, Memory, revision, document metadata·chunk, Graph, candidate, queue 상태, 암호화된 설정 override와 Agent token
- S3 호환 storage: 업로드한 원본 문서 object

Database만 복원하고 object storage를 복원하지 않으면 document metadata는 남지만 원본 재처리가 실패할 수 있다. Object storage만 복원하면 권한·상태·chunk·provenance를 복구할 수 없다. 두 저장소의 보존 시점과 복원 절차를 함께 관리하라. 암호화된 설정과 Agent token을 복원하려면 백업 당시의 `BETTER_AUTH_SECRET`도 필요하다. 이 값은 DB·object backup과 별도의 secret manager에서 보존하라.

Dockpad의 백업은 두 application DB와 두 bucket, 공유 host 설정을 순서대로 복사한다. DB dump와 object mirror 전체를 하나의 transaction으로 묶지 않으므로 쓰기 중에는 두 저장소의 시점이 달라질 수 있다. 일관된 복원 지점이 필요하면 web과 worker의 쓰기를 함께 중단하는 운영 절차를 마련하라.

### 삭제와 원본 보존

팀 삭제는 PostgreSQL resource만 cascade 삭제하고 S3 호환 storage의 문서 원본 object는 제거하지 않는다. PostgreSQL metadata가 사라지기 전에 대상 object를 식별하거나 별도로 구성한 object storage lifecycle로 제거하라. 조직 삭제 UI·API는 제공하지 않는다. 운영자가 DB를 직접 초기화할 때도 object storage와 queue의 정리는 별도로 관리해야 한다.

회원 제거는 membership을 `removed` tombstone으로 전환해 user scope의 document metadata와 원본 object key를 보존하므로 storage orphan을 만들지 않는다. 제거된 사용자는 운영자가 다시 추가해 active membership을 복원하기 전까지 해당 resource에 접근할 수 없다.

## 장애 대응

### `column ... does not exist` 또는 `relation ... does not exist`

Schema fingerprint 불일치 또는 application과 초기화 CLI가 서로 다른 DB를 사용했는지 확인한다. [CLI 환경 변수 처리](#database-초기화)에 따라 대상 `DATABASE_URL`을 먼저 일치시킨다.

```bash
pnpm db:init
```

빈 DB는 현재 schema로 초기화한다. 기존 schema가 다르면 백업·중단·명시적 초기화 후 다시 배포하라. 임의로 table이나 column을 수동 생성하거나 fingerprint를 덮어쓰지 마라.

### 브라우저에서 `Unexpected end of JSON input`

이 메시지는 client가 빈 응답이나 JSON이 아닌 오류 응답을 `response.json()`으로 읽을 때 나타나는 2차 오류일 수 있다. 같은 시각의 server log에서 원래 HTTP 오류와 Database·storage 예외를 먼저 확인하라. Network panel에서 status, content type, response body를 확인하고 schema 초기화 누락이나 unhandled server error를 해결하라.

### 문서가 `pending`에 머묾

1. Env와 DB override를 합친 `DOCUMENT_WORKER_ENABLED=true`가 실제 worker instance에 적용됐는지 확인한다.
2. Application과 worker가 같은 `DATABASE_URL`을 사용하는지 확인한다.
3. pg-boss 관련 application log를 확인한다.
4. Worker를 다시 시작한 뒤 document 상태를 조회한다.

Worker가 비활성화된 상태에서 upload한 문서는 자동으로 `ready`가 되지 않는다.

### 문서가 `failed` 상태가 됨

1. 응답의 `processingError`와 같은 시각의 application log를 확인한다.
2. `S3_ENDPOINT`, bucket, credential과 network 연결을 확인한다.
3. 파일 MIME type과 UTF-8 text 추출 가능 여부를 확인한다.
4. 원인을 해결한 뒤 retry endpoint를 사용한다.

`pending`, `processing`, `ready` 문서는 retry할 수 없으며 `409`를 반환한다.

### Semantic search가 동작하지 않음

- `EMBEDDING_MODEL`이 없으면 lexical search만 사용하는 것이 정상이다.
- Model을 설정했다면 `EMBEDDING_BASE_URL`과 선택형 credential을 확인한다.
- 저장된 resource와 query가 같은 embedding model을 사용하는지 확인한다.
- Provider가 OpenAI-compatible embeddings API를 지원하는지 확인한다.

Embedding provider 장애는 embedding이 필요한 새 Memory·Knowledge node 생성 또는 문서 처리와 semantic query를 실패시킬 수 있다. Provider를 사용하지 않을 계획이면 `EMBEDDING_MODEL`을 비워 lexical-only 모드로 실행하라. Reranker 장애는 통합 검색·Memory 회상을 실패시키지 않고 권한 필터가 적용된 hybrid 순위로 복귀한다. 반복 fallback은 `context reranking unavailable` log와 provider 상태를 확인하라.

모든 embedding, reranker, extraction, ontology suggestion 호출은 instance-local concurrency·minute limit를 먼저 거친 뒤 PostgreSQL의 organization·user minute bucket을 소비한다. 여러 replica와 background worker가 같은 durable quota를 공유하며 초과 요청은 `429` 또는 queue retry로 처리한다. Reranker의 quota 초과는 예외적으로 hybrid 순위 복귀로 처리한다. Bucket은 입력·본문 없이 organization ID와 내부 principal key, minute, count만 저장하고 하루가 지난 row를 후속 요청에서 정리한다.

### AI 후보가 생성되지 않음

1. 문서가 `ready`인지 확인한다.
2. `KNOWLEDGE_EXTRACTION_MODEL`과 `KNOWLEDGE_EXTRACTION_BASE_URL`을 확인한다.
3. Provider가 JSON Schema structured output을 지원하는지 확인한다.
4. `document-knowledge-enrichment-v2` queue 오류를 application log에서 확인한다.
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
| `413` | JSON body의 1 MiB 제한 또는 문서 upload request·원본 파일 제한 |
| `422` | strict ontology의 미등록 node kind·edge predicate |
| `428` | Memory PATCH·DELETE의 `If-Match` header |
| `429` | AI instance·organization·user quota와 `Retry-After` header, 또는 document storage·backlog·upload quota |
| `503` | PostgreSQL 연결·schema 초기화 상태 또는 온톨로지 AI 제안 model 설정 |

## 단일 조직 설치

서버 시작 시 조직이 없으면 `default` slug와 `Agent Memory` 이름으로 생성한다. 기존 조직이 하나면 ID·이름·멤버십·데이터를 그대로 사용한다. 두 개 이상이면 서버 시작을 중단한다. 기존 다중 조직 설치는 운영자가 조직별 독립 DB·bucket으로 분리하거나 보존할 데이터를 정리한 후 시작하라. 자동 병합·삭제는 수행하지 않는다.

가입 후 첫 콘솔 접속은 설치 조직에 대한 가입 요청으로 처리한다. active owner가 없는 경우 `ADMIN_EMAILS`의 사용자가 최초 owner가 된다. 다른 사용자의 가입은 pending 요청으로 처리되며 운영자 승인 후에만 활성 멤버가 된다. blocked·removed membership은 자동으로 복구하지 않는다. 모든 공개 HTTP endpoint는 조직 slug를 받지 않으며 MCP 주소는 `/api/mcp`다.

## 배포 전 확인

```bash
pnpm verify
```

`pnpm verify`는 `db:check`로 현재 schema SQL의 일치를 확인한 뒤 lint, typecheck, architecture, unit test, production build를 실행한다. Database 변경은 `pnpm test:integration`, 화면과 인증 흐름 변경은 `pnpm test:e2e`를 추가한다. 세부 기준은 [AGENTS.md](../AGENTS.md#검증)를 따른다.

### 인증 E2E

| 조건 | 이유 |
| --- | --- |
| `E2E_AUTHENTICATED=true` | 미설정하면 가입·승인·회원 관리·Memory lifecycle을 skip하고 공개 화면만 검사 |
| 이름이 `_e2e` 또는 `_test`로 끝나는 별도 DB | Fixture가 `TRUNCATE organizations, users CASCADE`로 데이터를 초기화하므로 개발·운영 DB 사용 금지 |
| 같은 `DATABASE_URL`로 사전 schema 초기화 | 테스트 서버와 fixture가 동일 schema 사용 |
| Worker 하나 | 인증 시나리오의 초기화 충돌 방지. Playwright config에서 자동 적용 |
| Port 3110 확보 | 로컬에서는 기존 서버를 재사용할 수 있으므로 다른 설정의 서버를 먼저 종료 |

다음 예시는 폐기 가능한 E2E 전용 PostgreSQL을 시작한다.

```bash
docker run --detach --name agent-memory-e2e \
  --publish 127.0.0.1:5434:5432 \
  --env POSTGRES_DB=agent_memory_e2e \
  --env POSTGRES_USER=agent_memory \
  --env POSTGRES_PASSWORD=agent_memory \
  pgvector/pgvector:0.8.6-pg18-trixie
docker exec agent-memory-e2e pg_isready -U agent_memory -d agent_memory_e2e
```

`pg_isready`가 성공한 뒤 같은 shell에서 schema 초기화와 인증 E2E를 실행한다. Playwright는 별도 `.next-e2e`에 production build를 만들고 port 3110에서 서버를 실행한다.

```bash
export DATABASE_URL=postgresql://agent_memory:agent_memory@127.0.0.1:5434/agent_memory_e2e
pnpm db:init
pnpm exec playwright install chromium
E2E_AUTHENTICATED=true DOCUMENT_WORKER_ENABLED=false pnpm test:e2e
```

`pnpm test:integration`은 Docker의 별도 Testcontainers PostgreSQL에 현재 schema를 초기화해 검사한다. 위 E2E DB를 재사용하지 않는다. CI는 두 검사를 모두 활성화한다.

### 운영 설정 점검

운영 배포 전에 다음도 확인하라.

- `BETTER_AUTH_SECRET`과 S3 credential을 개발 기본값에서 교체한다.
- 필요하지 않은 password provider와 signup을 비활성화한다.
- `ALLOWED_EMAIL_DOMAINS`와 `ADMIN_EMAILS`를 운영 정책에 맞춘다.
- Google/OIDC callback URL과 `BETTER_AUTH_URL`을 실제 origin에 맞춘다.
- Schema가 달라지면 배포 전 초기화·보존 범위를 결정한다.
- Web과 worker process의 `DATABASE_URL`, S3, AI provider 설정을 일치시킨다.
- 외부 reranker를 사용하면 권한 필터된 query와 후보 본문이 provider에 전달되므로 조직의 data retention 정책과 맞는지 확인한다.
- PostgreSQL과 object storage의 백업·복원 절차를 검증한다.
- `/api/health`와 stdout JSON log 수집을 배포 환경에 연결한다.
- Token, password, 본문, 검색어, embedding·reranker 입력과 출력이 log에 포함되지 않는지 확인한다.

### 수집 receipt 보존

초기화한 schema는 멱등 Memory 생성과 내부 문서 업로드를 위한 `ingestion_receipts` 테이블을 포함한다. Receipt는 resource와 함께 backup한다. Archive 이후 재생성을 막는 기록이므로 임의 TTL로
제거하지 않는다. 클라이언트는 document_ingest_status의 processingAttempts를 retry 요청의
expectedAttempts로 전달하고, 같은 요청의 응답 유실 시 동일한 key와 횟수를 재사용한다.
