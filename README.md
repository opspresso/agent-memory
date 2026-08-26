# Agent Memory

기업 내부 AI Agent가 조직, 팀, 사용자 범위의 기억과 RAG 문서를 안전하게 공유하도록 지원하는 설치형 플랫폼이다. 한 설치 안에서 권한이 허용한 기억만 검색하며 원문, 변경 이력, 유효기간, 출처를 함께 보존한다.

Agent Memory는 독립적으로 사용할 수 있다. 필요하면 형제 프로젝트인 `../agent-studio`와 연동해 Agent 실행·운영 흐름에 장기 기억과 검색 Context를 제공할 수 있다.

## 주요 기능

- 조직·팀·사용자 scope와 멤버십에 따라 읽기·쓰기·관리 권한을 적용한다.
- memory의 출처, revision, 변경 사유, 유효기간, archive 상태, ACL을 보존한다.
- RAG 문서를 S3 호환 스토리지에 저장하고 비동기로 chunk와 선택형 embedding을 생성한다.
- PostgreSQL Full-Text Search와 pgvector로 memory, 문서 chunk, knowledge node를 검색한다.
- memory 또는 문서 chunk를 출처로 갖는 Knowledge Graph를 제공한다.
- 접근 가능한 memory, RAG 문서, Knowledge Graph 결과를 하나의 Context로 검색한다.
- Streamable HTTP MCP로 Agent 검색과 memory 생성을 제공한다.
- Better Auth session·Bearer 인증과 선택형 OIDC·Google·password provider를 지원한다.
- 허용 email domain과 조직 bootstrap admin을 설치 단위로 제한한다.
- Pino 구조화 로그와 선택형 OpenTelemetry·Langfuse 추적을 제공한다.

운영 콘솔에서는 로그인·가입, 첫 조직 생성, 조직 멤버·팀 관리, 통합 검색, 개인 문서 수집, MCP 연결 정보를 제공한다.

## Stack

- Node.js 24, pnpm 11, Next.js 16 App Router, React 19, TypeScript strict, Mantine 9
- Better Auth, Drizzle ORM, PostgreSQL 18, pgvector, PostgreSQL Full-Text Search, pg-boss
- Vercel AI SDK, MCP TypeScript SDK, S3·MinIO, OpenTelemetry, Pino, Langfuse
- Vitest, Testcontainers, Playwright, dependency-cruiser, ESLint, Docker Compose

## 빠른 시작

Node.js 24, pnpm 11, Docker가 필요하다.

```bash
corepack enable
pnpm install
cp .env.example .env.local
docker compose up -d postgres
pnpm db:migrate
AUTH_PASSWORD=true AUTH_PASSWORD_SIGNUP=true pnpm dev
```

애플리케이션은 `http://localhost:3100`, PostgreSQL은 `localhost:5433`에서 열린다. 이 설정은 로컬 가입과 password 로그인을 활성화한다. 외부 인증, 문서 worker, MinIO, 전체 Compose 실행 방법은 [운영 가이드](docs/operations.md)를 참고하라.

`../agent-studio`의 PostgreSQL 17과 포트·볼륨을 공유하지 않으므로 두 프로젝트를 동시에 실행할 수 있다. 데이터 볼륨을 지우는 `docker compose down -v`는 필요한 데이터를 확인하지 않고 실행하지 마라.

## 문서

- [Architecture](docs/architecture.md): 계층 책임, 의존성 방향, 권한·데이터 처리 불변 조건
- [HTTP API와 MCP](docs/api.md): 인증, endpoint, 입력 계약, MCP tool
- [운영 가이드](docs/operations.md): 환경 변수, 로컬·Compose 실행, migration, worker, 관측성
- [AGENTS.md](AGENTS.md): coding agent의 변경 원칙과 검증 기준

## 개발

변경 전 [AGENTS.md](AGENTS.md)를 읽어라. 기본 검증은 다음 명령으로 실행한다.

```bash
pnpm verify
```

Integration과 E2E 검증은 변경 범위에 따라 별도로 실행한다. 자세한 선택 기준은 [AGENTS.md](AGENTS.md#검증)를 따른다.
