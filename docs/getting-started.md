# 시작 가이드

이 문서는 로컬에서 인증 가능한 Agent Memory를 시작하고 첫 조직과 Memory를 만든 뒤 검색 결과를 확인하는 절차를 설명한다.

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

`.env.local`에서 개발용 password 로그인과 가입을 활성화하라.

```dotenv
AUTH_PASSWORD=true
AUTH_PASSWORD_SIGNUP=true
```

기본 접근 정책은 다음과 같다.

```dotenv
ALLOWED_EMAIL_DOMAINS=nalbam.com
ADMIN_EMAILS=me@nalbam.com
```

- 가입할 email domain은 `ALLOWED_EMAIL_DOMAINS`에 있어야 한다.
- 첫 조직을 만들 사용자의 email은 `ADMIN_EMAILS`에 있어야 한다.
- 다른 domain이나 email을 사용할 경우 두 값을 함께 변경하라.
- 운영 환경에서는 `.env.example`의 `BETTER_AUTH_SECRET`과 storage credential을 사용하지 마라.

## 2. Database 시작과 migration

```bash
docker compose up -d postgres
pnpm db:migrate
```

PostgreSQL은 `localhost:5433`에서 열린다. Migration이 완료되면 application을 시작하라.

```bash
pnpm dev
```

다른 terminal에서 readiness를 확인하라.

```bash
curl -i http://localhost:3100/api/health
```

정상 상태는 HTTP `200`과 다음 body를 반환한다.

```json
{ "status": "ok" }
```

## 3. 가입과 첫 조직 생성

1. `http://localhost:3100`을 연다.
2. `가입`을 선택한다.
3. `ADMIN_EMAILS`에 등록한 email로 계정을 만든다.
4. 로그인 후 `첫 조직 만들기`에서 이름과 slug를 입력한다.
5. 생성한 사용자는 해당 조직의 `owner`가 된다.

로그인 provider가 화면에 나타나지 않으면 `.env.local`에서 provider 설정을 확인하고 `pnpm dev`를 다시 시작하라. Password 가입에는 `AUTH_PASSWORD=true`와 `AUTH_PASSWORD_SIGNUP=true`가 모두 필요하다.

## 4. 첫 Memory와 검색

현재 운영 콘솔은 검색과 lifecycle 관리에 집중한다. 첫 Memory는 HTTP API나 MCP의 `memory_create`로 생성한다. 브라우저 로그인 상태에서 API를 호출하거나 [HTTP API와 MCP](api.md#memory)의 예시를 사용하라.

Memory를 만든 뒤 운영 콘솔에서 다음 순서로 확인한다.

1. `통합 검색`을 연다.
2. `Memory` 또는 `All Context`를 선택한다.
3. title이나 content에 포함된 검색어를 입력한다.
4. 결과의 scope, 상대 관련도, lexical·vector score와 출처를 확인한다.
5. `Lifecycle`을 열어 현재 version과 revision 이력을 확인한다.

`EMBEDDING_MODEL`을 설정하지 않은 초기 환경에서는 lexical score만 사용한다.

## 5. 문서 수집 활성화

문서 업로드에는 S3 호환 storage가 필요하다. 로컬에서는 MinIO와 bucket 초기화를 실행한다.

```bash
docker compose --profile objects up -d minio minio-init
```

- MinIO API: `http://localhost:9010`
- MinIO console: `http://localhost:9011`
- 기본 bucket: `agent-memory`

`.env.example`을 복사했다면 `DOCUMENT_WORKER_ENABLED=true`이므로 application process가 pg-boss worker를 함께 시작한다. 운영 콘솔의 `문서 수집`에서 UTF-8 text, Markdown, CSV, JSON 또는 XML 파일을 업로드하라.

## 6. 선택 기능 활성화

### Semantic search

OpenAI-compatible embedding endpoint를 설정하면 Memory, document chunk, Knowledge node의 생성과 검색에 embedding을 사용한다.

```dotenv
EMBEDDING_BASE_URL=https://openrouter.ai/api/v1
EMBEDDING_API_KEY=replace-with-provider-key
EMBEDDING_MODEL=openai/text-embedding-3-small
```

`EMBEDDING_MODEL`을 설정할 때 `EMBEDDING_BASE_URL`도 반드시 설정해야 한다.

### AI Knowledge extraction

Ready 문서에서 검토 가능한 graph 후보를 만들려면 structured output을 지원하는 OpenAI-compatible chat completions endpoint를 설정하라.

```dotenv
KNOWLEDGE_EXTRACTION_BASE_URL=https://openrouter.ai/api/v1
KNOWLEDGE_EXTRACTION_API_KEY=replace-with-provider-key
KNOWLEDGE_EXTRACTION_MODEL=provider/structured-output-model
```

후보는 운영 콘솔의 `AI 후보 검토`에서 승인하기 전까지 공유 Knowledge Graph에 나타나지 않는다.

## 다음 단계

- 운영 콘솔과 Graph 사용: [사용자 가이드](user-guide.md)
- HTTP·MCP 통합: [HTTP API와 MCP](api.md)
- 환경 변수와 장애 대응: [운영 가이드](operations.md)
- 권한과 데이터 불변 조건: [Architecture](architecture.md)
