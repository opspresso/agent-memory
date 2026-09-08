# Agent Memory

Agent Memory는 설치당 하나의 조직에서 서비스와 AI Agent가 장기 기억을 공유하는 독립 실행형 Context 플랫폼이다. MCP로 기억을 저장·회상·잊고, RAG 문서와 provenance 기반 Knowledge Graph를 함께 관리한다. 운영 콘솔과 HTTP API도 같은 권한 정책과 application use case를 사용한다. Agent Studio는 선택적으로 연결하는 실행 플랫폼이며, Agent 실행·채팅·도구 조립은 이 저장소의 역할이 아니다.

## 핵심 흐름

| 목적 | 제공 기능 |
| --- | --- |
| 장기 기억 | MCP `remember`로 저장, `recall`로 관련 Memory 회상, `forget`으로 archive |
| 문서 지식 | 파일 업로드 → 원본 저장 → worker 추출·chunk 생성 → 검색 |
| Knowledge Graph | Memory·문서 chunk를 근거로 관계를 구성하고, AI 문서 후보는 사람이 검토한 뒤 반영 |
| 통합 검색 | `context_search`로 Memory·문서·Graph를 함께 검색 |

Memory, 문서, Graph에는 개인·팀·조직 scope를 적용한다. 일반 사용자는 첫 콘솔 접속 시 가입 요청을 등록하고 운영자 승인 후 지식에 접근한다. 조직 Agent token만 사용하는 서비스는 조직 범위로 제한되며, 사용자 위임은 [MCP 인증 계약](docs/api.md#mcp)을 따른다.

Embedding을 설정하지 않아도 키워드 검색을 사용할 수 있다. 선택형 embedding은 의미 검색을, reranker는 통합 검색과 Memory 회상의 재정렬을 제공한다. 문서 원본과 변경 이력을 보존하는 archive는 영구 삭제와 다르다.

## 빠른 시작

Node.js 24, pnpm 11, Docker가 필요하다. 아래는 새 로컬 설치의 기본 Compose 구성을 사용하는 절차다.

```bash
corepack enable
pnpm install
cp .env.example .env.local
```

`.env.local`의 `BETTER_AUTH_SECRET`을 32자 이상의 임의 값으로 바꾸고, 로컬 로그인과 최초 운영자 계정을 설정하라.

```dotenv
AUTH_PASSWORD=true
AUTH_PASSWORD_SIGNUP=true
ADMIN_EMAILS=your-admin@example.com
```

```bash
docker compose up -d postgres minio minio-init
pnpm db:migrate
pnpm dev
```

`http://localhost:3100`에서 지정한 운영자 email로 가입하라. 설치에 active owner가 없으면 이 사용자가 최초 owner가 된다. 다른 사용자의 요청은 `회원` 화면에서 승인한다.

`.env.local`의 DB 주소를 변경했다면 migration 전에 같은 값을 shell의 `DATABASE_URL`에도 지정해야 한다. Drizzle CLI는 `.env.local`을 자동으로 읽지 않는다. Google·OIDC 사용, 환경 설정 우선순위, 첫 Memory·문서·MCP 연결은 [시작 가이드](docs/getting-started.md)를 따른다.

## 운영 콘솔

콘솔은 통합 검색, Memory 읽기·수정·이력, 문서 업로드·재처리, Graph 탐색, AI 후보 검토, 회원·팀·조직 설정, Agent 연결을 제공한다. 읽기·쓰기·관리 권한에 따라 사용할 수 있는 작업이 달라진다.

화면별 절차는 [사용자 가이드](docs/user-guide.md), 로그인 없이 읽을 수 있는 제품 안내는 `/guide`에서 확인한다.

## 기술 구성

- Next.js App Router, TypeScript strict, React, Mantine
- Better Auth, Drizzle, PostgreSQL·pgvector, pg-boss
- S3 호환 object storage, OpenAI-compatible embedding·reranker·extraction adapter
- HTTP API, Streamable HTTP MCP, Pino, OpenTelemetry·Langfuse

정확한 runtime·의존성 버전은 [package.json](package.json)과 [pnpm-lock.yaml](pnpm-lock.yaml), 계층과 불변 조건은 [아키텍처](docs/architecture.md)를 기준으로 한다.

## 문서

| 하려는 작업 | 문서 |
| --- | --- |
| 로컬 설치부터 첫 검색·서비스 연결까지 | [시작 가이드](docs/getting-started.md) |
| 콘솔에서 지식을 관리하고 권한을 이해하기 | [사용자 가이드](docs/user-guide.md) |
| HTTP 또는 MCP client 구현 | [HTTP API와 MCP](docs/api.md) |
| 배포·환경 설정·backup·장애 대응 | [운영 가이드](docs/operations.md) |
| 내부 책임·데이터 흐름·불변 조건 확인 | [Architecture](docs/architecture.md) |
| 화면 구조·상호작용·UI 검증 확인 | [Workspace UI](docs/ui-workspace.md) |
| 저장소 변경 규칙 확인 | [AGENTS.md](AGENTS.md) |

## 개발 검증

```bash
pnpm verify
```

이 명령은 lint, typecheck, architecture, unit test, production build를 실행한다. DB·repository 변경에는 `pnpm test:integration`, 화면·브라우저 흐름 변경에는 `pnpm test:e2e`를 추가한다. 인증 E2E는 폐기 가능한 별도 DB와 `E2E_AUTHENTICATED=true`가 필요하다. [검증 절차](docs/operations.md#배포-전-확인)를 따른다.

Pull request와 `main` push CI는 DB migration, 위 전체 검사, PostgreSQL integration test, 인증 E2E를 실행한다.

## 데이터 보호

로컬 Compose의 PostgreSQL·MinIO volume은 Agent Memory 전용이다. `docker compose down -v`는 데이터를 삭제한다.

운영 배포는 `../dockpad`가 담당하며 서비스 주소는 `https://memory.opspresso.com/`이다. 이 저장소의 Release workflow는 image를 게시하고 `../argocd-env-demo`의 alpha version 목록에 tag를 전달한다. IDC rollout과 backup·복원 절차는 [운영 가이드](docs/operations.md#배포-형태)를 따른다. EKS는 현재 배포·검증 대상이 아니다.
