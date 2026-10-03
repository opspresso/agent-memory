# 시작 가이드

새 로컬 설치에서 로그인하고 첫 자료를 검색하려는 사용자를 위한 절차다. 기본 구성은 외부 AI 없이 키워드 검색을 제공한다. 기존 설치를 변경하거나 복원하려면 [운영 가이드](operations.md)를 따른다.

| 순서 | 완료 확인 |
| --- | --- |
| [1. 설정 준비](#1-의존성과-환경-설정) | 로그인 수단과 최초 운영자 이메일을 설정했다. |
| [2. 서버 실행](#2-로컬-인프라-시작과-database-초기화) | `/api/health`가 HTTP `200`과 모든 검사값 `ok`를 반환한다. |
| [3. 로그인](#3-최초-운영자-준비와-가입-요청) | 최초 owner로 통합 검색 화면을 연다. |
| [4. Memory 생성](#4-첫-memory와-검색) | 저장한 Memory를 검색하고 본문을 읽는다. |
| [5. 문서 수집](#5-문서-수집-활성화) | 문서가 `ready`가 되고 검색 결과에 나타난다. |
| [6. AI 설정](#6-선택-기능-활성화) | 필요한 선택 기능에 모델을 연결했다. |
| [7. MCP 연결](#7-서비스에서-기억-저장회상잊기) | 기억을 저장·회상하고 보관 처리한다. |

## 준비 사항

- Node.js `>=24 <25`
- pnpm `>=11 <12`
- Docker와 Docker Compose

설치된 버전을 확인하라.

```bash
node --version
pnpm --version
docker version
docker compose version
```

## 1. 의존성과 환경 설정

저장소 루트에서 실행한다. `.env.local`이 이미 있으면 복사하지 말고 기존 파일을 사용한다.

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
```

`.env.local`의 `BETTER_AUTH_SECRET`을 32자 이상의 임의 값으로 바꾸고, 개발용 password 로그인과 가입을 활성화하라.

```dotenv
AUTH_PASSWORD=true
AUTH_PASSWORD_SIGNUP=true
```

최초 owner가 될 운영자의 실제 이메일을 지정한다. 필요하면 로그인할 수 있는 이메일 도메인도 제한한다.

```dotenv
ALLOWED_EMAIL_DOMAINS=
ADMIN_EMAILS=your-admin@example.com
```

- `ALLOWED_EMAIL_DOMAINS`가 비어 있거나 미설정이면 모든 이메일 도메인을 허용한다. 제한하려면 허용할 도메인을 쉼표로 구분한다.
- 최초 owner가 될 사용자의 email은 `ADMIN_EMAILS`에 있어야 한다.
- `ADMIN_EMAILS`는 실제 운영자 email로 바꾸고, domain 제한을 설정했다면 해당 email의 domain을 허용 목록에 포함하라.
- 운영 환경에서는 `.env.example`의 `BETTER_AUTH_SECRET`과 storage credential을 사용하지 마라.

## 2. 로컬 인프라 시작과 Database 초기화

저장소 루트의 `compose.yaml`로 PostgreSQL·MinIO·Neo4j를 실행한다. `pnpm db:init`은 `.env.local`의 DB 주소를 사용하며 shell의 `DATABASE_URL`이 있으면 우선한다. [DB 초기화](operations.md#database-초기화)에서 대상 DB와 초기화 조건을 확인하라.

```bash
docker compose up --wait postgres minio neo4j
docker compose run --rm minio-init
pnpm db:init
```

각 명령의 완료 조건은 다음과 같다. 실패하면 다음 명령을 실행하기 전에 원인을 해결한다.

| 명령 | 완료 조건 |
| --- | --- |
| `docker compose up --wait …` | PostgreSQL·MinIO·Neo4j가 모두 `healthy`다. |
| `docker compose run --rm minio-init` | `agent-memory` bucket이 준비됐다. 이미 있으면 그대로 사용한다. |
| `pnpm db:init` | `Database schema is ready.`를 출력한다. 기존 DB의 스키마가 다르면 변경 없이 실패한다. |

PostgreSQL은 `localhost:5433`, Neo4j Bolt는 `127.0.0.1:7687`에서 열린다. 준비가 끝나면 앱을 host에서 시작한다.

```bash
pnpm dev
```

다른 terminal에서 readiness를 확인하라.

```bash
curl -i http://localhost:3100/api/health
```

정상 상태는 HTTP `200`과 다음 body를 반환한다.

```json
{ "status": "ok", "checks": { "database": "ok", "schema": "ok", "neo4j": "ok" } }
```

## 3. 최초 운영자 준비와 가입 요청

1. `http://localhost:3100`을 연다.
2. `가입`을 선택한다.
3. `ADMIN_EMAILS`에 등록한 이메일로 계정을 만든다.
4. 통합 검색 화면이 열리는지 확인한다. 새 설치에서는 이 계정이 최초 `owner`다.

조직 이름은 `설정`에서 바꿀 수 있다. 이후 사용자는 첫 콘솔 접속 시 가입 요청을 등록한다. 운영자는 `회원`에서 요청을 승인한다. 승인받은 사용자는 콘솔을 새로고침한다. 승인 대기 중에는 지식에 접근할 수 없으며, 차단·제거된 사용자는 다시 로그인해도 복구되지 않는다.

최초 owner 준비는 active owner가 없는 설치에만 적용한다. Owner가 이미 있다면 `ADMIN_EMAILS`에 포함된 신규 사용자도 운영자 승인을 받아야 한다. Google·OIDC와 운영 환경의 password 가입 제한은 [운영 가이드](operations.md#환경-변수)를 확인하라.

로그인 수단이 화면에 없으면 다음 순서로 확인한다.

1. `.env.local`에서 해당 로그인 수단의 설정을 확인한다. Password 가입에는 `AUTH_PASSWORD=true`와 `AUTH_PASSWORD_SIGNUP=true`가 모두 필요하다.
2. 기존 설치라면 전역 설정에서 값의 출처를 확인한다. [DB override](operations.md#database-설정-override)가 환경 변수보다 우선한다.
3. 설정을 바꿨다면 `pnpm dev`를 다시 시작한다.

## 4. 첫 Memory와 검색

운영 콘솔의 `Memory → 새 Memory`에서 종류·제목·내용·공유 범위를 입력해 첫 Memory를 만든다. 기본값은 개인 범위이며 조직·팀 범위는 쓰기 권한에 따라 선택한다. Agent는 HTTP API나 MCP의 `remember`로 같은 기능을 사용한다.

Memory를 만든 뒤 운영 콘솔에서 다음 순서로 확인한다.

1. `통합 검색`을 연다.
2. `Memory` 또는 `모든 지식`을 선택한다.
3. title이나 content에 포함된 검색어를 입력한다.
4. 결과를 선택해 공유 범위, 전체 내용과 출처를 확인한다.
5. 수정·관리 권한이 있으면 상세의 `수정`과 `Version 이력` 탭을 사용한다.

`EMBEDDING_MODEL`을 설정하지 않았다면 키워드 일치 점수만 사용한다. 결과가 없으면 먼저 저장한 제목의 단어로 검색한다.

## 5. 문서 수집 활성화

문서 업로드에는 S3 호환 storage가 필요하다. 로컬 Compose는 Agent Memory 전용 MinIO를 사용한다.

- MinIO API: `http://localhost:9010`
- MinIO console: `http://localhost:9011`
- 기본 bucket: `agent-memory`

`.env.example`을 복사했다면 `DOCUMENT_WORKER_ENABLED=true`이므로 application process가 pg-boss worker를 함께 시작한다.

1. 다음 내용의 UTF-8 `handbook.md` 파일을 준비한다.

   ```markdown
   # Release policy
   Deploy after verification.
   ```

2. 운영 콘솔의 `문서 수집`에서 파일을 업로드한다. 첫 테스트는 개인 scope를 사용한다.
3. 문서가 `ready`가 되면 상세의 처리된 원문을 확인한다.
4. 통합 검색의 `Documents`에서 `Release`를 검색해 근거 chunk를 연다.

지원 파일은 UTF-8 text, Markdown, CSV, JSON, XML이다. PDF·Office 변환과 URL 원격 수집은 제공하지 않는다.

| 문서 상태 | 다음 행동 |
| --- | --- |
| `pending`이 계속됨 | `DOCUMENT_WORKER_ENABLED`와 worker 실행 로그를 확인한다. |
| `failed` | 상세의 오류와 저장소 연결을 확인한다. 원인을 해결한 뒤 재처리한다. |
| `ready` | 처리된 본문을 열고 검색한다. AI 추출·검증의 완료 여부는 Graph 화면에서 따로 확인한다. |

## 6. 선택 기능 활성화

새 env 설정은 application을 재시작한 뒤 반영된다. DB override가 있으면 env보다 우선한다. 아래 model ID는 예시이며 실제 provider가 제공하는 model과 지원 계약을 지정하라.

### Semantic search

OpenAI-compatible embedding endpoint를 설정하면 Memory, document chunk, Knowledge node의 생성과 검색에 embedding을 사용한다.

```dotenv
EMBEDDING_BASE_URL=https://openrouter.ai/api/v1
EMBEDDING_API_KEY=replace-with-provider-key
EMBEDDING_MODEL=openai/text-embedding-3-small
```

`EMBEDDING_MODEL`을 설정할 때 `EMBEDDING_BASE_URL`도 반드시 설정해야 한다. 기존 자료를 자동으로 재색인하지 않으므로 가능하면 자료를 넣기 전에 model을 정하라. Memory는 제목·본문을 수정하면 현재 설정으로 embedding을 갱신한다. 기존 ready 문서 전체의 재처리 API는 제공하지 않는다.

### Context reranking

통합 Context 검색(`context_search`)과 Memory 회상(`recall`)의 1차 후보를 다시 정렬하려면 OpenRouter 또는 vLLM-compatible reranker를 설정하라.

```dotenv
RERANKER_BASE_URL=https://openrouter.ai/api/v1
RERANKER_API_KEY=replace-with-provider-key
RERANKER_MODEL=voyageai/rerank-2.5-lite
```

Reranker는 권한 필터가 끝난 후보만 받는다. 설정하지 않거나 provider가 실패하면 통합 검색과 Memory 회상은 기존 hybrid 순위를 사용한다.

### AI Knowledge extraction

개체를 먼저 식별하고 그 개체 사이의 관계를 별도 요청으로 추출한다. 자동 검증은 원문 근거와 개체 자격·종류를 확인하고, 불확실한 항목은 검토 화면에 남긴다. 추출과 다른 검증 모델을 사용하려면 전역 설정의 `독립 검증 모델` 또는 `KNOWLEDGE_VERIFICATION_BASE_URL`·`KNOWLEDGE_VERIFICATION_MODEL`을 함께 설정하라. 설정하지 않으면 추출 모델을 사용한다. [평가 절차](operations.md#추출기-평가)로 실제 모델의 결과를 비교할 수 있다.

Ready 문서에서 검토 가능한 graph 후보를 만들려면 structured output을 지원하는 OpenAI-compatible chat completions endpoint를 설정하라.

```dotenv
KNOWLEDGE_EXTRACTION_BASE_URL=https://openrouter.ai/api/v1
KNOWLEDGE_EXTRACTION_API_KEY=replace-with-provider-key
KNOWLEDGE_EXTRACTION_MODEL=provider/structured-output-model
```

설정 후 새로 수집한 문서에서 지식 후보를 만든다. 별도 AI 검증과 원문 인용·권한 검사를 통과한 지식은 Graph에 자동 반영한다. 불확실한 지식은 `AI 후보 검토`에서 확인한다.

기존 `ready` 문서를 처리하려면 `AI 자동 검토 실행`을 선택한다. 이 작업은 관리 가능한 문서의 미추출 청크와 미완료 검토를 대기열에 등록한다.

- 저장된 추출은 다시 추출하지 않고 재사용한다.
- 미완료 후보의 평가가 현재 검토 정책과 같으면 재사용한다.
- 평가가 없거나 검토 정책이 오래됐으면 새 평가를 요청한다.

Graph 화면의 처리 진척과 `AI 후보 검토 → 처리 내역`에서 결과를 확인한다.

## 7. 서비스에서 기억 저장·회상·잊기

1. 조직 admin·owner로 `Agent 연결`을 열고 Agent token을 생성한다.
2. 신뢰된 서비스의 MCP client에 표시된 `/api/mcp` URL과 `Authorization: Bearer <token>`을 설정한다. 실제 token은 client의 secret 저장 기능으로 주입하라.
3. `remember`로 organization scope의 Memory를 만들고 반환된 ID·version을 보관한다.
4. `recall`로 해당 기억을 회상한다. RAG·Graph까지 검색하려면 `context_search`를 사용한다.
5. 더 이상 회상하지 않을 기억은 ID와 현재 version을 `forget`에 전달한다. 성공 후에는 일반 검색·회상에서 제외되지만 원본·revision은 보존된다.

사용자 위임 없는 Agent token은 organization scope만 허용한다. 개인·팀 scope가 필요한 서비스는 [MCP 사용자 위임 계약](api.md#mcp)을 따라야 한다. Agent Studio에서는 같은 화면의 등록 템플릿을 사용하고 version에 서버를 직접 연결하라.

정확한 도구 입력·응답과 예시는 [HTTP API와 MCP](api.md#mcp)를 따른다.

## 다음 단계

- 운영 콘솔과 Graph 사용: [사용자 가이드](user-guide.md)
- HTTP·MCP 통합: [HTTP API와 MCP](api.md)
- 환경 변수와 장애 대응: [운영 가이드](operations.md)
- 권한과 데이터 불변 조건: [Architecture](architecture.md)
