# Agent Memory

Agent Memory는 설치당 하나의 조직에서 서비스와 AI Agent가 장기 기억을 공유하는 독립 실행형 Context 플랫폼이다. MCP로 기억을 저장·회상·잊고, RAG 문서와 provenance 기반 Knowledge Graph를 함께 관리한다. 운영 콘솔과 HTTP API도 같은 권한 정책과 application use case를 사용한다. Agent Studio는 선택적으로 연결하는 실행 플랫폼이며, Agent 실행·채팅·도구 조립은 이 저장소의 역할이 아니다.

## 핵심 흐름

| 목적 | 제공 기능 |
| --- | --- |
| 장기 기억 | MCP `remember`로 저장, `recall`로 관련 Memory 회상, `forget`으로 archive |
| 문서 지식 | 파일 업로드 → 원본 저장 → worker 추출·chunk 생성 → 검색 |
| Knowledge Graph | Memory·문서 chunk를 근거로 관계를 구성하고, AI 검증 기준을 통과한 지식은 자동 반영하고 불확실한 후보만 사람이 검토 |
| 통합 검색 | `context_search`로 Memory·문서·Graph를 함께 검색 |

Memory, 문서, Graph에는 개인·팀·조직 scope를 적용한다. 일반 사용자는 첫 콘솔 접속 시 가입 요청을 등록하고 운영자 승인 후 지식에 접근한다. 조직 Agent token만 사용하는 서비스는 조직 범위로 제한되며, 사용자 위임은 [MCP 인증 계약](docs/api.md#mcp)을 따른다.

Embedding을 설정하지 않아도 키워드 검색을 사용할 수 있다. 선택형 embedding은 의미 검색을, reranker는 통합 검색과 Memory 회상의 재정렬을 제공한다. 문서의 `ready` 상태는 검색 준비 완료를 뜻하며 Graph 추출·검증 완료와는 다르다. 문서 원본과 변경 이력을 보존하는 archive는 영구 삭제와 다르다.

## 빠른 시작

Neo4j가 노드·관계의 topology를 저장하고 관계 지도와 MCP neighborhood의 탐색을 수행한다. PostgreSQL은 계정·문서·출처·승인 원장을 보존한다. 승인 원장의 변경은 탐색 전에 Neo4j에 원자적으로 동기화하며, 반환할 자료의 현재 권한과 출처 상태는 PostgreSQL에서 다시 확인한다. Neo4j는 필수 실행 구성 요소이며 시작 및 health check에서 연결을 확인한다.

Node.js 24, pnpm 11, Docker와 Docker Compose가 필요하다. 로컬 개발은 루트 `compose.yaml`로 PostgreSQL·MinIO·Neo4j를 실행하고, Next.js는 host의 `pnpm dev`로 실행한다. 새 로컬 설치는 다음 절차를 따른다.

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
docker compose up --wait postgres minio neo4j
docker compose run --rm minio-init
pnpm db:init
pnpm dev
```

`http://localhost:3100`에서 지정한 운영자 email로 가입하라. 설치에 active owner가 없으면 이 사용자가 최초 owner가 된다. 다른 사용자의 요청은 `회원` 화면에서 승인한다.

`pnpm db:init`은 `.env.local`을 읽으며 shell의 `DATABASE_URL`이 있으면 우선한다. 빈 DB만 초기화하고 현재 schema와 다른 기존 DB는 변경 없이 거부한다. Google·OIDC 사용, 환경 설정 우선순위, 첫 Memory·문서·MCP 연결은 [시작 가이드](docs/getting-started.md)를 따른다.

## 운영 콘솔

콘솔은 통합 검색, Memory 읽기·수정·이력, 문서 업로드·재처리, Graph 탐색, AI 후보 검토, 회원·팀·조직 설정, Agent 연결을 제공한다. 읽기·쓰기·관리 권한에 따라 사용할 수 있는 작업이 달라진다.

화면별 절차는 [사용자 가이드](docs/user-guide.md), 로그인 없이 읽을 수 있는 제품 안내는 `/guide`에서 확인한다.

## 기술 구성

- Next.js App Router, TypeScript strict, React, Mantine
- Better Auth, Drizzle, PostgreSQL·pgvector, pg-boss, Neo4j
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

지식 추출기는 개체와 관계를 두 단계로 추출하고, 개체 자격·종류·원문 근거를 별도로 검증한다. `pnpm eval:knowledge --variants entity-first --verify`로 합성 진단 사례를 현재 모델에서 평가한다. LlamaIndex 비교와 결과 해석은 [추출기 평가 절차](docs/operations.md#추출기-평가)를 따른다.

```bash
pnpm verify
```

이 명령은 현재 schema SQL과 TypeScript schema의 일치 검사, lint, typecheck, architecture, unit test, production build를 실행한다. DB·repository 변경에는 `pnpm test:integration`, 화면·브라우저 흐름 변경에는 `pnpm test:e2e`를 추가한다. 인증 E2E는 폐기 가능한 별도 DB와 `E2E_AUTHENTICATED=true`가 필요하다. [검증 절차](docs/operations.md#배포-전-확인)를 따른다.

Pull request와 release tag CI는 빈 DB 초기화, 위 전체 검사, PostgreSQL·Neo4j integration test, 인증 E2E를 실행한다.

## 데이터 보호

누적 migration과 구버전 데이터 변환은 제공하지 않는다. 현재 스키마는 `database/schema.sql`로 관리하며, 스키마가 달라지면 배포 전에 백업·쓰기 중단·명시적 초기화가 필요하다. 계정·설정 보존은 운영자가 별도로 수행하며 서버가 기존 데이터를 자동 삭제하거나 변환하지 않는다. [DB 초기화 절차](docs/operations.md#database-초기화)를 따른다.

로컬 Compose의 PostgreSQL·MinIO·Neo4j volume은 Agent Memory 전용이다. `docker compose down -v`는 데이터를 삭제한다.

운영 환경은 AWS EC2의 k3s이며 서비스 주소는 `https://memory.opspresso.com/`이다. 이 저장소의 Release workflow는 image를 게시하고 `../argocd-env-demo`의 alpha version 목록에 tag를 전달한다. Argo CD 자동 동기화는 해제되어 있으므로 DB 준비 후 수동 Sync로 운영에 반영한다. 배포와 backup·복원 절차는 [운영 가이드](docs/operations.md#배포-형태)를 따른다. EKS는 현재 배포·검증 대상이 아니다.
