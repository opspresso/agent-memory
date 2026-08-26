# AGENTS.md

이 저장소에서 coding agent가 지켜야 할 프로젝트별 규칙이다. `CLAUDE.md`는 이 파일을 가리키는 symlink다.

## Development status and compatibility

This project is under active development. Backward compatibility is not required unless the
user explicitly requests it. Prefer the clean current-state design over compatibility shims;
breaking changes to APIs, configuration, schemas, and stored data formats are allowed. Any
operation that destroys existing data or git history still requires explicit user approval and
the applicable safety checks.

## 프로젝트 역할

Agent Memory는 `../agent-studio`와 형제 프로젝트다. Agent Studio의 실행 기능을 이 저장소로 옮기지 말고, 여러 Agent가 공유하는 장기 memory, RAG 문서, Knowledge Graph, Context 검색에 집중하라.

작업 전에 목적에 맞는 문서를 읽어라.

- 제품과 시작 방법: [README.md](README.md)
- 계층과 설계 불변 조건: [docs/architecture.md](docs/architecture.md)
- HTTP·MCP 계약: [docs/api.md](docs/api.md)
- 환경과 실행 절차: [docs/operations.md](docs/operations.md)

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

- 모든 조직 resource는 route의 `organizationId`, 인증 사용자, 조직 멤버십을 함께 검증하라. 요청 body의 tenant 식별자를 신뢰하지 마라.
- organization scope 쓰기·관리는 `admin`과 `owner`만 허용하라. team scope는 해당 팀 멤버에게, user scope는 본인에게만 허용하라. team `manage`는 `manager` 이상으로 제한하라.
- 브라우저 mutation은 trusted same-origin만 허용하고 Agent 요청은 Bearer 인증을 사용하라.
- memory 수정과 archive는 `If-Match` version을 요구해 낙관적 동시성 제어를 유지하라.
- Knowledge Graph의 source는 정확히 하나의 memory 또는 document chunk를 참조하게 하라. source를 읽을 수 없는 사용자의 연결을 허용하거나 source보다 넓은 scope로 승격하지 마라.
- 검색 결과는 권한을 다시 적용하고 archived·만료·미래 유효 memory와 처리되지 않은 문서를 제외하라.
- 로그와 telemetry에 password, token, 검색어, memory·문서 본문, embedding 입력·출력을 기록하지 마라.

## 변경 절차

- 변경 전 관련 route, schema, use case, domain 정책, repository, 테스트를 함께 읽어라.
- API 입력을 바꾸면 Zod schema, route, 공개 응답 변환, API 문서, 관련 테스트를 함께 갱신하라.
- database schema를 바꾸면 `src/infrastructure/database/schema/`를 수정하고 `pnpm db:generate`로 migration을 생성하라. 생성된 `drizzle/` migration과 snapshot을 임의로 편집하지 마라.
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
| migration 생성 | `pnpm db:generate` 후 migration diff 검토와 `pnpm test:integration` |

`pnpm verify`는 lint, typecheck, architecture, unit test, production build를 순서대로 실행한다. Integration test는 Testcontainers와 Docker가 필요하며 E2E test는 Playwright Chromium이 필요하다.
