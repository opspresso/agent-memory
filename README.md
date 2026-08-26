# Agent Memory

기업 내부 AI Agent가 조직, 팀, 사용자 범위의 기억과 RAG 문서를 안전하게 공유하도록 지원하는 설치형 플랫폼이다. 한 설치 안에서 권한이 허용한 기억만 검색하며, 원문·변경 이력·유효기간·출처를 함께 보존한다.

`../agent-studio`와 형제 프로젝트다. Agent Studio가 Agent 실행과 운영을 담당한다면 이 저장소는 Agent가 공통으로 사용하는 장기 기억과 검색 Context를 담당한다.

## 주요 기능

- 조직·팀·사용자 scope와 멤버십에 따른 읽기·쓰기·관리 권한을 적용한다.
- 관리자는 조직 규칙을 관리하고, 팀과 사용자는 자신의 범위에 memory를 저장한다.
- memory의 출처, revision, 변경 사유, 유효기간, archive 상태, ACL을 보존한다.
- RAG 문서를 S3 호환 스토리지에 저장하고 pg-boss worker로 chunk와 선택형 embedding을 생성한다.
- PostgreSQL Full-Text Search와 pgvector를 조합해 memory, 문서 chunk, knowledge node를 검색한다.
- knowledge node/edge를 원본 memory 또는 문서 chunk와 권한 안전하게 연결한다.
- 통합 Context 검색에서 접근 가능한 memory, RAG 문서, Knowledge Graph 결과를 함께 정렬한다.
- Streamable HTTP MCP로 Agent 검색과 memory 생성을 제공한다.
- Better Auth session·Bearer 인증과 선택형 OIDC·Google·password provider를 지원한다.
- Pino 구조화 로그와 선택형 OpenTelemetry·Langfuse 추적을 제공한다.

운영 콘솔에서는 로그인·가입, 첫 조직 생성, 조직 멤버·팀 관리, 통합 검색, 개인 문서 수집, MCP 연결 정보를 제공한다. 조직 owner와 admin은 멤버 역할과 팀을 관리하며, team manager는 자신이 관리하는 팀에 기존 조직 멤버를 배정할 수 있다.

## Stack

- Node.js 24, pnpm 11, Next.js 16 App Router, React 19, TypeScript strict, Mantine 9
- Better Auth 1.7, Drizzle ORM, node-postgres, PostgreSQL 18, pgvector, PostgreSQL Full-Text Search, pg-boss
- Vercel AI SDK, Zod 4, MCP TypeScript SDK, S3·MinIO, OpenTelemetry, Pino, Langfuse
- Vitest, Testcontainers, Playwright, dependency-cruiser, ESLint boundaries, Docker Compose

## 빠른 시작

Node.js 24와 pnpm 11이 필요하다.

```bash
corepack enable
pnpm install
cp .env.example .env.local
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

애플리케이션은 `http://localhost:3100`, PostgreSQL은 `localhost:5433`에서 열린다. `../agent-studio`의 PostgreSQL 17과 포트·볼륨을 공유하지 않으므로 두 프로젝트를 동시에 실행할 수 있다. 데이터 볼륨을 지우는 `docker compose down -v`는 실행하지 마라.

`BETTER_AUTH_SECRET`은 운영 환경에서 32자 이상의 무작위 값으로 교체한다. 기업 인증은 `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`을 함께 설정하고 필요하면 `OIDC_SCOPES`를 지정한다. Google 로그인을 사용하려면 `GOOGLE_CLIENT_ID`와 `GOOGLE_CLIENT_SECRET`을 함께 설정한다.

Password 인증은 `AUTH_PASSWORD=true`로 명시적으로 켠다. Self-signup은 별도 플래그인 `AUTH_PASSWORD_SIGNUP=true`가 함께 있을 때만 열린다. Docker Compose의 app service는 loopback에만 노출되는 로컬 개발용이므로 두 플래그를 켜며, 운영 배포에서는 필요한 provider만 활성화한다.

문서 수집에 MinIO가 필요하면 object profile과 bucket 초기화 작업을 함께 켠다.

```bash
docker compose --profile objects up -d minio minio-init
```

MinIO API는 `localhost:9010`, console은 `localhost:9011`에서 열린다. 로컬 Next.js에서 수집 worker까지 실행하려면 `.env.local`의 `DOCUMENT_WORKER_ENABLED`를 `true`로 바꾸거나 다음처럼 실행한다.

```bash
DOCUMENT_WORKER_ENABLED=true pnpm dev
```

Docker Compose 전체 구성을 사용하려면 `docker compose --profile objects up -d`를 실행한다. Compose의 app service는 migration과 document worker를 시작하고 `http://localhost:3100`에 노출된다.

## Memory와 검색

Memory API는 `rule`, `experience`, `decision`, `preference`, `fact` 종류를 지원한다. 조직 scope 쓰기는 owner와 admin만 가능하고, 팀 scope는 해당 팀 멤버, 사용자 scope는 본인만 쓸 수 있다. 별도 ACL로 팀이나 사용자에게 `read`, `write`, `manage` 권한을 부여할 수 있다.

수정과 archive에는 현재 version을 요구해 낙관적 동시성 제어를 적용한다. revision 조회는 `manage` 권한이 필요하다. 검색은 아직 유효하고 archive되지 않은 memory만 반환한다.

`EMBEDDING_MODEL`을 설정하면 Vercel AI SDK와 AI Gateway를 통해 embedding을 생성해 semantic search를 결합한다. 설정하지 않으면 PostgreSQL Full-Text Search만 사용한다. embedding 입력과 출력은 telemetry에 기록하지 않는다.

Embedding 차원은 특정 model에 고정하지 않는다. `vector` 컬럼에는 `embedding_model`을 함께 저장해 서로 다른 model의 값을 섞지 않는다. model별 차원과 ANN partial index는 embedding 정책을 정한 뒤 추가한다.

## 문서 수집과 Knowledge Graph

문서 업로드는 UTF-8 `text/plain`, Markdown, CSV, JSON, XML을 지원하며 파일당 최대 크기는 10 MiB다. 원본은 S3 호환 스토리지에 저장하고 pg-boss worker가 비동기로 정규화, chunk 분할, 선택형 embedding을 처리한다. 실패한 수집 작업은 retry API로 다시 대기열에 넣을 수 있다.

Knowledge Graph는 PostgreSQL의 scope별 node와 edge로 저장한다. node와 edge는 하나의 memory 또는 문서 chunk를 source로 참조할 수 있다. 호출자가 source를 읽을 수 있어야 하며, source보다 넓은 scope로 graph 정보를 승격할 수 없다.

## HTTP API와 MCP

모든 조직 API는 Better Auth session 또는 Bearer token과 조직 멤버십을 확인한다. 브라우저 mutation은 same-origin 요청만 허용하고 Bearer 요청은 Agent 호출로 처리한다.

- `/api/organizations`: 첫 조직 생성과 접근 가능한 조직 조회
- `/api/organizations/:organizationId/members`, `/teams`: 조직 멤버·팀 관리
- `/api/organizations/:organizationId/memories`: memory 생성과 검색
- `/api/organizations/:organizationId/memories/:memoryId`: 조회·수정·archive
- `/api/organizations/:organizationId/memories/:memoryId/versions`: revision 조회
- `/api/organizations/:organizationId/documents`: 문서 업로드와 RAG 검색
- `/api/organizations/:organizationId/knowledge/*`: graph 생성·검색·neighborhood 조회
- `/api/organizations/:organizationId/context/search`: memory·RAG·graph 통합 검색
- `/api/organizations/:organizationId/mcp`: Streamable HTTP MCP

MCP에는 다음 여섯 도구가 있다.

- `context_search`: 전체 Context 통합 검색
- `memory_search`, `memory_create`: memory 검색과 생성
- `document_search`: RAG 문서 검색
- `knowledge_search`, `knowledge_neighborhood`: graph 검색과 탐색

Better Auth 로그인 응답의 `set-auth-token` header 값을 `Authorization: Bearer <token>`으로 전달한다.

## 관측성과 상태 확인

Pino는 검색 작업명, 조직 ID, 결과 수, 처리 시간을 구조화해 기록한다. retrieval 관측 필드에는 검색어와 본문을 포함하지 않는다. `LANGFUSE_PUBLIC_KEY`와 `LANGFUSE_SECRET_KEY`를 함께 설정하면 OpenTelemetry와 Langfuse 추적을 활성화한다. `LANGFUSE_EXPORT_MODE`는 `batched` 또는 `immediate`를 사용한다.

`GET /api/health`는 database readiness를 확인하고 `Cache-Control: no-store` 응답을 반환한다. 정상일 때 `200`, database를 사용할 수 없을 때 `503`을 반환한다.

## 검증

```bash
pnpm lint
pnpm typecheck
pnpm architecture
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

`pnpm verify`는 Docker가 필요 없는 lint, typecheck, architecture, unit test, production build를 실행한다. `pnpm test:integration`은 Testcontainers로 PostgreSQL 18 + pgvector를 새로 띄워 migration, 저장소 동작, 조직 격리 제약을 검사한다. `pnpm test:e2e`는 Chromium에서 익명 landing, theme 전환, local signup 표시를 검사한다. 데이터베이스 스키마를 바꾼 뒤에는 `pnpm db:generate`로 migration을 생성하고 unit·integration 검사를 모두 실행하라.

## 디렉터리

```text
src/
├── app/             Next.js 화면과 HTTP 진입점
├── application/     use case와 orchestration
├── domain/          순수 TypeScript entity, 규칙, repository port
└── infrastructure/  PostgreSQL, object storage, queue, 외부 SDK adapter
```

Domain과 application은 third-party package에 의존하지 않는다. Infrastructure는 domain port를 구현하고 application을 import하지 않는다. App은 infrastructure를 직접 선택하지 않고 조립된 application use case를 호출한다.
