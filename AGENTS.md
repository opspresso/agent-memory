# AGENTS.md

이 저장소에서 coding agent가 지켜야 할 프로젝트별 규칙이다. `CLAUDE.md`는 이 파일을 가리키는 symlink다.

## Development status and compatibility

This project is under active development. Backward compatibility is not required unless the
user explicitly requests it. Prefer the clean current-state design over compatibility shims;
breaking changes to APIs, configuration, schemas, and stored data formats are allowed. Any
operation that destroys existing data or git history still requires explicit user approval and
the applicable safety checks.

## 프로젝트 역할

Agent Memory는 독립적으로 실행할 수 있으며 Agent Studio와 선택적으로 연동할 수 있는 형제 프로젝트다. Agent Studio의 실행 기능을 이 저장소로 옮기지 말고, 여러 Agent가 공유하는 장기 Memory, RAG 문서, Knowledge Graph, Context 검색에 집중하라.

작업 전에 목적에 맞는 문서를 읽어라.

- 제품과 시작 방법: [README.md](README.md)
- 계층과 설계 불변 조건: [docs/architecture.md](docs/architecture.md)
- HTTP·MCP 계약: [docs/api.md](docs/api.md)
- 환경과 실행 절차: [docs/operations.md](docs/operations.md)

## 형제 프로젝트 역할과 소유 경계

형제 저장소와 연동할 때 아래 역할을 기준으로 변경 위치를 선택하고, 상세 계약은 각 저장소의 README와 설계 문서에서 다시 확인하라.

| 저장소 | 역할과 소유 범위 |
| --- | --- |
| `../agent-studio` | 기업 내부 설치형 Agent 실행 플랫폼이다. Project·version·publish, LLM/tool loop, subagent, chat, MCP·skill binding, 채널 연동, 비용·trace, 실행 artifact를 소유한다. 한 설치는 한 기업이며 필수 경로는 폐쇄망에서도 동작한다. |
| `../agent-memory` | 설치당 단일 조직을 사용하는 독립 실행 가능한 Context 플랫폼이다. MCP 기억 저장·회상·잊기, 장기 Memory·revision·ACL, RAG 문서·chunk, provenance 기반 Knowledge Graph, AI 후보 검토, 통합 검색과 HTTP/MCP를 소유한다. |
| `../agent-models` | 모델 family·provider offering, 가격, context/output 한도, capability, `id`와 `wireId`의 정적 JSON 카탈로그를 소유한다. 모델 실행 서버가 아니며 Studio는 카탈로그를 소비하고 offline snapshot을 유지한다. |
| `../agent-plugins` | Agent Studio용 도메인별 plugin 콘텐츠를 소유한다. `plugin.json`, `mcp.json`, `skills/*/SKILL.md`와 참고 자료를 묶으며 기존 agent-skills·agent-tools를 대체한다. Sync와 실행은 Studio가 담당한다. |
| `../mcp-document` | 원본 bytes를 받아 Office·한글 문서를 읽고 구조를 검사하며 Markdown·행 데이터로 문서와 XLSX를 생성하는 MCP 서버다. URL fetch·영속 저장·PDF 읽기는 호출자가 담당하고, 생성 파일은 MCP resource bytes로 반환한다. |
| `../mcp-youtube` | YouTube 자막과 동영상 metadata를 제공하는 MCP 서버다. `get_transcript`와 `get_video_info`를 소유하며 자막과 metadata의 근거를 구분한다. |
| `../dockpad` | 단일 호스트 Docker Compose 배포·운영 관리자다. Studio·Memory·MCP의 독립 배포, 공통 Caddy·PostgreSQL·MinIO, health check·backup과 DGX Spark의 LLM·embedding·reranker 운영을 소유한다. |

- 서비스의 Memory 저장·회상·잊기는 Agent Memory의 MCP `remember`, `recall`, `forget`이 소유한다. Plugin의 `memory` 연결은 설치의 `/api/mcp` URL과 Bearer credential을 사용한다. RAG 문서와 Knowledge Graph도 Agent Memory에서 관리한다.
- Studio의 capability catalog 검색과 Agent Memory의 조직 지식 검색을 구분하라. Agent 실행 기능은 Studio에, 공유 Memory·RAG·Graph 기능은 Agent Memory에 둔다.
- Plugin은 사용 지침과 MCP 선언을, 설치 측은 credential·서비스 URL·model 선택·version binding을 소유한다. Studio용 skill은 shell·filesystem·network를 직접 사용할 수 있다고 가정하지 않는다.
- IDC 배포는 사용자가 `../dockpad`에서 직접 명령한다. `릴리즈` 요청은 tag·GitHub Release·image 게시·alpha version 목록 갱신까지만 허용한다. IDC 배포를 릴리즈 완료 조건으로 삼지 마라. 별도의 명시적 지시 없이 Dockpad 배포, 운영 서비스 재시작·재생성 등 운영 변경을 실행하지 마라.
- 운영 배포 대상은 IDC이며 `../dockpad`로 배포한다. 서비스 주소는 `https://memory.opspresso.com/`이다. EKS는 중지 상태이므로 릴리즈 검증에 EKS·Argo CD 접속을 요구하지 마라.
- IDC에서는 PostgreSQL·MinIO 인프라를 공유하되 database(`agent_studio`, `agent_memory`)와 bucket(`agent-studio`, `agent-memory`)을 분리한다. Application image와 localdev는 각 앱, IDC 배포는 Dockpad가 소유한다. `../argocd-env-demo`는 Dockpad가 읽는 image version 목록을 제공하므로 release의 tag 전달은 유지한다.

## Toolchain

- Node.js `>=24 <25`와 pnpm `>=11 <12`를 사용하라.
- package manager는 pnpm만 사용하고 `pnpm-lock.yaml`을 유지하라.
- Next.js App Router, TypeScript strict, Mantine의 기존 구조와 패턴을 따르라.
- 새 의존성보다 표준 기능과 현재 의존성을 우선하라.

## 계층 규칙

- `src/domain`: 순수 TypeScript entity, 정책, repository port를 둔다. application, infrastructure, app, lib, third-party package에 의존하지 마라.
- `src/application`: use case와 orchestration을 둔다. domain에만 의존하고 infrastructure, app, third-party package를 import하지 마라.
- `src/infrastructure`: database, object storage, queue, AI, observability adapter를 둔다. application과 app을 import하지 마라.
- `src/app`: 화면과 HTTP entry point만 둔다. infrastructure를 직접 import하지 마라.
- `src/lib`: 인증, HTTP 변환, composition root를 둔다. application use case와 infrastructure adapter의 조립은 이 경계에서 수행하라.
- 순환 의존성을 만들지 마라. `pnpm architecture`로 dependency-cruiser 규칙을 확인하라.

## 보안과 데이터 불변 조건

- 모든 조직 resource는 서버가 결정한 설치 조직, 인증 사용자, 조직 멤버십을 함께 검증하라. 공개 API에서 조직 식별자를 받지 마라. 요청 body의 tenant 식별자를 신뢰하지 마라.
- 일반 사용자의 첫 콘솔 접속은 `pending` 가입 요청으로 처리하고 운영자 승인 후에만 `active` 멤버로 접근을 허용하라. 최초 owner bootstrap 외에 로그인만으로 권한을 부여하거나 blocked·removed 멤버십을 복구하지 마라.
- 기본 scope 정책에서 organization 쓰기·관리는 `admin`과 `owner`만 허용하라. team scope는 해당 팀 멤버와 조직 관리자에게, user scope는 본인에게만 허용하라. team `manage`는 팀 `manager` 또는 조직 관리자로 제한하라. Memory의 명시적 user·team access grant는 별도 정책으로 적용하며, 모든 경로에서 활성 조직 멤버십을 요구하라.
- 브라우저 mutation은 trusted same-origin만 허용하고 Agent 요청은 Bearer 인증을 사용하라.
- Memory 수정과 archive는 HTTP `If-Match`, MCP `forget`은 `expectedVersion`으로 현재 version을 요구해 낙관적 동시성 제어를 유지하라.
- Knowledge Graph의 source는 정확히 하나의 memory 또는 document chunk를 참조하게 하라. source를 읽을 수 없는 사용자의 연결을 허용하거나 source보다 넓은 scope로 승격하지 마라.
- 검색 결과는 권한을 다시 적용하고 archived·만료·미래 유효 memory와 처리되지 않은 문서를 제외하라.
- 로그와 telemetry에 password, token, 검색어, memory·문서 본문, embedding 입력·출력을 기록하지 마라.

## 변경 절차

- 변경 전 관련 route, schema, use case, domain 정책, repository, 테스트를 함께 읽어라.
- API 입력을 바꾸면 Zod schema, route, 공개 응답 변환, API 문서, 관련 테스트를 함께 갱신하라.
- database schema를 바꾸면 `src/infrastructure/database/schema/`를 수정하고 `pnpm db:generate`로 현재 스키마 `database/schema.sql`을 생성하라. 생성 파일은 임의로 편집하지 마라. 누적 migration·이전 데이터 변환은 유지하지 않으며 schema 변경 배포 전에는 명시적으로 데이터를 초기화하라.
- 새 동작과 버그 수정에는 가장 낮은 계층의 결정적 테스트를 추가하라. database constraint나 tenant 격리는 integration test로 검증하라.
- 환경 변수나 실행 흐름을 바꾸면 `.env.example`, `compose.yaml`, `docs/operations.md`의 정합성을 확인하라.
- HTTP 또는 MCP 계약을 바꾸면 `docs/api.md`를 갱신하라. 계층이나 불변 조건을 바꾸면 `docs/architecture.md`를 갱신하라.

## 검증

모든 변경은 최소한 다음 검사를 통과시켜라.

```bash
pnpm lint
pnpm typecheck
pnpm architecture
pnpm test
```

변경 범위에 따라 추가 검사를 실행하라.

| 변경 | 추가 검사 |
| --- | --- |
| production code, build 설정, dependency | `pnpm build` |
| database schema, repository, tenant constraint | `pnpm test:integration` |
| 화면, 인증·가입 흐름, browser interaction | `pnpm test:e2e` |
| schema SQL 생성 | `pnpm db:generate` 후 SQL diff·`pnpm db:check`와 `pnpm test:integration` |

`pnpm verify`는 lint, typecheck, architecture, unit test, production build를 순서대로 실행한다. Integration test는 Testcontainers와 Docker가 필요하며 E2E test는 Playwright Chromium이 필요하다.
