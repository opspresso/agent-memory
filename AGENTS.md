# AGENTS.md

이 저장소에서 coding agent가 지켜야 할 프로젝트별 규칙이다. `CLAUDE.md`는 이 파일을 가리키는 symlink다.

## 개발 상태와 호환성

이 프로젝트는 개발 중이다. 사용자가 요구하지 않으면 하위 호환성을 유지하지 않는다. 호환용 우회 코드보다 현재 설계에 맞는 구현을 우선한다. API·설정·스키마·저장 형식은 변경할 수 있지만, 기존 데이터나 Git 이력을 삭제하려면 사용자의 명시적 승인이 필요하다.

## 문서 작성 원칙

ISO 24495-1처럼 **쉽게 찾고 이해하고 사용할 수 있게**, ASD-STE100처럼 **짧고 명확하며 모호하지 않게** 작성합니다.

[ISO 24495-1](https://www.iso.org/standard/78907.html)의 [독자 중심 원칙](https://www.iplfederation.org/iso-standard/)과 [ASD-STE100의 명확한 기술 문장 작성 원칙](https://www.asd-ste100.org/STE_faq.html)을 다음과 같이 적용한다. 한국어 문서에는 영어 통제 어휘를 강제하지 않고, 뜻이 분명한 문장과 일관된 용어를 사용한다.

| 원칙 | 작성·검토 기준 |
| --- | --- |
| 필요한 정보 제공(relevant) | 대상 독자와 하려는 작업을 먼저 밝힌다. 작업에 필요한 조건·권한·제약을 포함하고, 관계없는 내용과 중복 설명은 줄인다. |
| 찾기 쉬운 구성(findable) | 결론과 시작 위치를 앞에 둔다. 작업을 나타내는 제목, 목적별 링크, 실행 순서에 맞춘 절차를 사용한다. |
| 이해하기 쉬운 표현(understandable) | 익숙하고 구체적인 말로 누가 무엇을 하는지 쓴다. 한 문단에는 한 주제를 담고, 필요한 전문 용어는 처음 나올 때 설명한다. |
| 활용하기 쉬운 안내(usable) | 실행 위치·선행 조건·입력값·기대 결과를 명시한다. 실패 시 확인할 항목과 다음 행동을 안내한다. |

- `README.md`는 제품 선택과 시작 위치를, 시작 가이드는 최초 성공 절차를, 사용자 가이드는 화면 작업을 설명한다. API·아키텍처·운영 문서는 각 독자에게 필요한 계약과 판단 근거를 제공한다.
- UI 이름, 파일 경로, 명령어, API 식별자와 상태값은 실제 구현과 같은 표기를 유지한다. 낯선 용어를 지우면서 권한·동시성·데이터 보존 조건을 바꾸지 마라.
- 한 문장에는 한 가지 핵심 내용을, 절차의 한 단계에는 한 가지 주된 행동을 쓴다. 주체·대상·조건을 명시하고 같은 개념에는 같은 용어를 사용한다. 설명과 실행 지시를 구분한다.
- 구현 요청·설계 문서는 **Goal → Requirements → Constraints → Acceptance Criteria**를 중심으로 쓴다. 목표, 필요한 동작, 지켜야 할 제약, 관찰 가능한 완료 조건을 명확히 하되 구현 방법은 필요한 만큼만 제한한다. API 참조와 운영 가이드는 독자의 조회·실행 순서에 맞춘 구조를 사용한다.
- 순서가 있는 작업은 번호 목록으로, 비교·대응 관계는 표로 정리한다. 긴 문서를 단순히 짧게 만드는 것보다 독자가 작업을 완료할 수 있는지를 우선한다.
- 문서를 바꾼 뒤 링크·앵커·예시를 확인하고, 독자의 작업을 하나 골라 시작 조건부터 완료 확인까지 따라가며 검토하라. 실제 사용자 검증을 하지 않았다면 했다고 보고하지 마라.

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
- 릴리즈 workflow는 검증 후 tag의 GitHub Release와 image를 게시하고 alpha의 버전 목록·image tag를 갱신한다. Prod dispatch에는 GitHub Environment 승인이 필요하다. 사용자가 prod 승인과 전체 배포를 명시적으로 위임했다면 그 범위에서 직접 진행하고 각 환경의 rollout·health까지 확인하라. 이미 받은 승인을 다시 요청하지 마라.
- `../argocd-env-demo`가 Helm과 Argo CD 설정을 소유한다. k3s는 alpha(`https://memory.opsp.dev/`), EKS는 prod(`https://memory.opspresso.com/`)다. `agent-memory-k3s`와 `agent-memory-eks-demo`는 자동 Sync를 사용하므로 image tag 갱신이 운영 rollout으로 이어진다. 스키마가 바뀌면 배포 전에 [DB 초기화 절차](docs/operations.md#database-초기화)와 승인 범위를 확인하라. 초기화는 명시적으로 승인된 Memory 데이터에만 적용하고, 백업 없이 초기화하도록 승인받은 범위에서는 백업을 만들지 않는다.
- k3s에서는 PostgreSQL·MinIO 인프라를 Agent Studio와 공유하되 database(`agent_studio`, `agent_memory`)와 bucket(`agent-studio-static`, `agent-memory`)을 분리한다. Neo4j는 `agent-memory` namespace의 전용 서비스를 사용한다. Application image와 로컬 Compose는 각 앱이 소유하며, 릴리즈의 alpha image tag 전달을 유지한다.

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

`pnpm verify`는 현재 schema SQL의 일치를 확인하는 db:check, lint, typecheck, architecture, unit test, production build를 순서대로 실행한다. Integration test는 Testcontainers와 Docker가 필요하며 E2E test는 Playwright Chromium이 필요하다.
