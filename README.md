# Agent Memory

Agent Memory는 여러 AI Agent가 조직 경계 안에서 장기 Memory, RAG 문서, Knowledge Graph를 안전하게 공유하도록 지원하는 설치형 Context 플랫폼이다. 독립적으로 실행하거나 Agent Studio 같은 실행 환경에 HTTP API와 MCP로 연결할 수 있다.

## 핵심 흐름

```text
사용자·Agent
   ├── Memory 저장 ───────────────────────────────┐
   ├── 문서 업로드 → chunk → embedding(optional) ─┼──▶ 통합 Context 검색
   └── 문서 chunk → AI 후보 → 사람 검토 → Graph ─┘
```

- 모든 resource에 organization과 `organization`, `team`, `user` scope를 적용한다.
- Memory의 출처, revision, 변경 사유, 유효기간, archive 상태, ACL을 보존한다.
- 원본 문서를 S3 호환 storage에 저장하고 pg-boss worker가 chunk와 선택형 embedding을 생성한다.
- PostgreSQL Full-Text Search와 선택형 pgvector를 결합해 후보를 찾고, 선택형 reranker로 Memory, 문서 chunk, Knowledge node의 통합 순위를 정한다.
- Knowledge node와 edge마다 읽을 수 있는 Memory 또는 document chunk provenance를 요구한다.
- AI가 추출한 graph 후보는 scope 관리자가 승인하기 전까지 공유 Graph에 반영하지 않는다.
- 운영 콘솔, HTTP API, Streamable HTTP MCP가 같은 application operation과 권한 정책을 사용한다.

## 빠른 시작

Node.js 24, pnpm 11, Docker가 필요하다.

```bash
corepack enable
pnpm install
cp .env.example .env.local
```

이 저장소는 application image와 localdev 설정만 소유한다. IDC 배포는 `../dockpad`, EKS/Kubernetes 배포는 `../argocd-env-demo`가 관리한다. Release workflow의 GitOps tag 전달은 유지한다.

로컬에서 로그인하려면 `.env.local`에서 password provider와 signup을 활성화하라.

```dotenv
AUTH_PASSWORD=true
AUTH_PASSWORD_SIGNUP=true
```

그다음 Database migration과 application을 실행하라.

```bash
docker compose up -d postgres minio minio-init
pnpm db:migrate
pnpm dev
```

`http://localhost:3100`에서 가입한 뒤 첫 조직을 생성한다. 가입 email은 `ALLOWED_EMAIL_DOMAINS`에 포함되고 첫 조직 생성자는 `ADMIN_EMAILS`에 포함되어야 한다.

로그인 전후에 `http://localhost:3100/guide`에서 제품 사용 흐름과 기능별 설명을 확인할 수 있다.

이 명령은 독립된 `agent-memory-local` PostgreSQL 18과 MinIO를 시작하고 `agent-memory` bucket을 멱등하게 만든다.

설치부터 첫 Memory 검색까지의 전체 절차는 [시작 가이드](docs/getting-started.md)를 따른다.

## 운영 콘솔

운영 콘솔은 다음 작업을 제공한다.

- 좌측 메뉴와 상단 메뉴로 구성된 셸에서 조직을 전환하며 작업
- Memory·문서·Knowledge Graph 통합 검색과 검색 근거 확인
- Memory revision 생성, version 이력 확인, archive
- 개인·팀·조직 범위 문서 업로드
- 검색·종류 필터·관계 집중을 제공하는 Knowledge Graph 관계 지도 탐색
- AI graph 후보의 source·entity·relationship 검토와 승인·거절
- 최초 로그인 시 가입할 조직 선택, 조직 정책에 따른 즉시 활성화 또는 승인 대기
- 조직 회원 목록에서 role·status(승인·차단)·팀 배정 관리, 팀 생성·이름 변경·삭제
- 조직 설정에서 신규 회원 정책·기본 팀 관리, 조직 생성(전역 admin)·삭제(owner)
- MCP 연결 정보 확인

## 기술 구성

- Node.js 24, pnpm 11, Next.js 16 App Router, React 19, TypeScript strict, Mantine 9
- Better Auth, Drizzle ORM, PostgreSQL 18, pgvector, PostgreSQL Full-Text Search, pg-boss
- OpenAI-compatible embedding·rerank·structured extraction API, S3·MinIO
- MCP TypeScript SDK, OpenTelemetry, Pino, Langfuse
- Vitest, Testcontainers, Playwright, dependency-cruiser, ESLint, Docker Compose

## 문서

| 문서 | 대상 | 내용 |
| --- | --- | --- |
| [시작 가이드](docs/getting-started.md) | 처음 설치하는 사용자 | 인증 가능한 로컬 환경, 첫 조직, 첫 검색, 선택 기능 활성화 |
| [사용자 가이드](docs/user-guide.md) | 운영자·Agent 통합 개발자 | 콘솔, Memory lifecycle, 문서, Graph, AI 검토, MCP 연결 |
| [Architecture](docs/architecture.md) | 개발자·보안 검토자 | 계층, 요청 경계, 권한, 데이터 흐름, 불변 조건 |
| [HTTP API와 MCP](docs/api.md) | API·Agent 통합 개발자 | 인증, endpoint, 요청·응답, 오류, 실행 예시 |
| [운영 가이드](docs/operations.md) | 배포·운영 담당자 | 환경 변수, topology, migration, worker, 관측성, 장애 대응 |
| [AGENTS.md](AGENTS.md) | Coding agent | 변경 원칙과 검증 기준 |

## 개발 검증

```bash
pnpm verify
```

`pnpm verify`는 lint, typecheck, architecture, unit test, production build를 실행한다. Database 변경에는 `pnpm test:integration`, 화면·인증 변경에는 `pnpm test:e2e`를 추가한다. 자세한 기준은 [AGENTS.md](AGENTS.md#검증)를 따른다.

Pull request와 `main` push CI는 PostgreSQL 18·pgvector service에서 migration, `pnpm verify`, integration test, 인증 E2E를 모두 실행한다.

## 데이터 보호

PostgreSQL 18과 MinIO volume은 Agent Memory 전용이다. `docker compose down -v`는 두 volume을 삭제하므로 데이터와 대상을 확인하지 않고 실행하지 마라.
