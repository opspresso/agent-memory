# 시작 가이드

이 문서는 새 로컬 설치에서 로그인 → 첫 Memory 검색 → 문서 수집 → 서비스의 MCP 연결까지 진행하는 절차다. 기본 구성은 외부 AI 없이 키워드 검색을 제공한다. 기존 설치의 배포·복원은 [운영 가이드](operations.md)를 따른다.

## 준비 사항

- Node.js `>=24 <25`
- pnpm `>=11 <12`
- Docker와 Docker Compose

설치된 버전을 확인하라.

```bash
node --version
pnpm --version
docker version
```

## 1. 의존성과 환경 설정

```bash
corepack enable
pnpm install
cp .env.example .env.local
```

`.env.local`의 `BETTER_AUTH_SECRET`을 32자 이상의 임의 값으로 바꾸고, 개발용 password 로그인과 가입을 활성화하라.

```dotenv
AUTH_PASSWORD=true
AUTH_PASSWORD_SIGNUP=true
```

최초 owner가 될 실제 운영자 email과 선택형 domain 제한을 지정하라.

```dotenv
ALLOWED_EMAIL_DOMAINS=
ADMIN_EMAILS=your-admin@example.com
```

- `ALLOWED_EMAIL_DOMAINS`가 비어 있거나 미설정이면 모든 email domain으로 가입할 수 있다. 제한하려면 허용 domain을 comma-separated 목록으로 설정한다.
- 최초 owner가 될 사용자의 email은 `ADMIN_EMAILS`에 있어야 한다.
- `ADMIN_EMAILS`는 실제 운영자 email로 바꾸고, domain 제한을 설정했다면 해당 email의 domain을 허용 목록에 포함하라.
- 운영 환경에서는 `.env.example`의 `BETTER_AUTH_SECRET`과 storage credential을 사용하지 마라.

## 2. Database 시작과 migration

아래 명령은 기본 Compose DB 주소를 사용한다. 사용자 지정 DB를 쓰면 먼저 [migration 환경 설정](operations.md#database와-migration)에 따라 shell의 `DATABASE_URL`도 지정하라.

```bash
docker compose up -d postgres minio minio-init
pnpm db:migrate
```

PostgreSQL은 `localhost:5433`에서 열린다. MinIO 초기화 서비스는 `agent-memory` bucket을 멱등하게 만든다. Migration이 완료되면 application을 시작하라.

```bash
pnpm dev
```

다른 terminal에서 readiness를 확인하라.

```bash
curl -i http://localhost:3100/api/health
```

정상 상태는 HTTP `200`과 다음 body를 반환한다.

```json
{ "status": "ok", "checks": { "database": "ok" } }
```

## 3. 최초 운영자 준비와 가입 요청

1. `http://localhost:3100`을 연다.
2. `가입`을 선택한다.
3. `ADMIN_EMAILS`에 등록한 email로 계정을 만든다.
4. 서버가 준비한 기본 조직의 최초 `owner`가 되어 통합 검색 화면으로 이동한다. 조직 이름은 `설정`에서 변경한다.
5. 이후 사용자는 계정을 만들거나 Google·OIDC로 로그인한 뒤 첫 콘솔 접속 시 가입 요청이 접수된다. 승인 대기 중에는 지식에 접근할 수 없다.
6. 운영자는 `회원`에서 승인 대기 요청을 확인하고 `승인`을 선택한다. 사용자는 승인 후 콘솔을 새로고침해 이용한다. 차단·제거된 사용자는 다시 로그인해도 자동으로 복구되지 않는다.

최초 owner 준비는 active owner가 없는 설치에만 적용한다. Owner가 이미 있다면 `ADMIN_EMAILS`에 포함된 신규 사용자도 운영자 승인을 받아야 한다. Google·OIDC와 운영 환경의 password 가입 제한은 [운영 가이드](operations.md#환경-변수)를 확인하라.

로그인 provider가 화면에 나타나지 않으면 `.env.local`에서 provider 설정을 확인하고 `pnpm dev`를 다시 시작하라. 기존 설치의 [DB override](operations.md#database-설정-override)는 env보다 우선하므로 전역 설정에서 값의 출처를 확인하고 필요하면 override를 reset하라. Password 가입에는 `AUTH_PASSWORD=true`와 `AUTH_PASSWORD_SIGNUP=true`가 모두 필요하다.

## 4. 첫 Memory와 검색

운영 콘솔의 `Memory → 새 Memory`에서 종류·제목·내용·공유 범위를 입력해 첫 Memory를 만든다. 기본값은 개인 범위이며 조직·팀 범위는 쓰기 권한에 따라 선택한다. Agent는 HTTP API나 MCP의 `remember`로 같은 기능을 사용한다.

Memory를 만든 뒤 운영 콘솔에서 다음 순서로 확인한다.

1. `통합 검색`을 연다.
2. `Memory` 또는 `모든 지식`을 선택한다.
3. title이나 content에 포함된 검색어를 입력한다.
4. 결과를 선택해 공유 범위, 전체 내용과 출처를 확인한다.
5. 수정·관리 권한이 있으면 상세의 `수정`과 `Version 이력` 탭을 사용한다.

`EMBEDDING_MODEL`을 설정하지 않은 초기 환경에서는 lexical score만 사용한다.

## 5. 문서 수집 활성화

문서 업로드에는 S3 호환 storage가 필요하다. localdev는 Agent Memory 전용 MinIO를 사용한다.

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

현재 지원 파일은 UTF-8 text, Markdown, CSV, JSON, XML이다. PDF·Office 변환이나 URL 원격 수집은 이 업로드 경로에서 제공하지 않는다. `pending`에 머물면 worker, `failed`이면 오류와 storage 연결을 확인하라. 재시도는 failed 문서만 가능하다.

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

Ready 문서에서 검토 가능한 graph 후보를 만들려면 structured output을 지원하는 OpenAI-compatible chat completions endpoint를 설정하라.

```dotenv
KNOWLEDGE_EXTRACTION_BASE_URL=https://openrouter.ai/api/v1
KNOWLEDGE_EXTRACTION_API_KEY=replace-with-provider-key
KNOWLEDGE_EXTRACTION_MODEL=provider/structured-output-model
```

설정 후 수집되는 문서의 chunk에서 후보를 만든다. 기존 ready 문서를 자동으로 탐색해 후보를 채우지는 않는다. 후보는 운영 콘솔의 `AI 후보 검토`에서 승인하기 전까지 공유 Knowledge Graph에 나타나지 않는다.

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
