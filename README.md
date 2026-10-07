# Agent Memory

Agent Memory는 사람과 AI Agent가 조직의 장기 기억과 문서 지식을 공유하는 설치형 서비스다. 한 설치에서 하나의 조직을 관리한다. 독립적으로 사용하거나 Agent Studio에 연결할 수 있다.

운영 콘솔, HTTP API, MCP는 같은 권한 정책을 사용한다. Agent 실행·채팅·도구 조립은 Agent Studio가 담당한다.

## 핵심 흐름

| 하려는 일 | 제공 기능 |
| --- | --- |
| 결정·규칙·경험 기억하기 | MCP `remember`로 저장하고 `recall`로 회상한다. `forget`은 기억을 보관 처리한다. |
| 문서에서 근거 찾기 | 파일을 업로드하면 worker가 본문을 추출하고 검색용 조각을 만든다. |
| 지식 사이의 관계 확인하기 | Knowledge Graph에서 개체·관계와 그 근거인 Memory·문서를 함께 읽는다. |
| 모든 지식 검색하기 | `context_search`로 Memory·문서·Graph를 함께 검색한다. |

자료의 공유 범위는 개인·팀·조직 중에서 선택한다. 신규 사용자는 운영자 승인을 받아야 조직 지식을 사용할 수 있다.

키워드 검색은 외부 AI 없이 동작한다. 의미 검색, 결과 재정렬, 문서의 AI 지식 추출은 모델을 설정하면 사용할 수 있다. 문서의 `ready`는 검색 준비 완료를 뜻한다. AI 추출·검증은 그 이후에도 계속될 수 있다.

## 문서

| 독자와 작업 | 읽을 문서 |
| --- | --- |
| 처음 설치하고 첫 자료를 검색하려는 사용자 | [시작 가이드](docs/getting-started.md) |
| 콘솔에서 Memory·문서·Graph를 관리하는 사용자 | [사용자 가이드](docs/user-guide.md) |
| HTTP·MCP client를 구현하는 개발자 | [HTTP API와 MCP](docs/api.md) |
| 설정·배포·장애 복구를 담당하는 운영자 | [운영 가이드](docs/operations.md) |
| 계층·권한·저장 계약을 변경하는 개발자 | [아키텍처](docs/architecture.md) |
| 화면을 구현하거나 검증하는 개발자 | [지식 워크스페이스 UI](docs/ui-workspace.md) |
| 저장소에서 작업하는 coding agent | [프로젝트 지침](AGENTS.md) |

## 빠른 시작

**새 로컬 설치와 빈 DB를 기준으로 한다.** Node.js 24, pnpm 11, Python 3.12–3.14, Docker와 Docker Compose가 필요하다. PostgreSQL·MinIO·Neo4j는 Compose에서 실행하고, 앱은 host에서 실행한다. Neo4j는 필수 구성 요소다.

### 1. 의존성과 설정 준비

저장소 루트에서 실행한다. `.env.local`이 이미 있으면 복사하지 말고 기존 설정을 확인한다.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm parser:install
cp .env.example .env.local
```

`.env.local`에서 `BETTER_AUTH_SECRET`을 32자 이상의 임의 값으로 바꾼다. 로컬 로그인과 가입을 켜고 최초 운영자의 실제 이메일을 지정한다.

```dotenv
AUTH_PASSWORD=true
AUTH_PASSWORD_SIGNUP=true
ADMIN_EMAILS=your-admin@example.com
```

### 2. 인프라와 앱 실행

각 명령이 성공한 뒤 다음 명령을 실행한다.

```bash
docker compose up --wait postgres minio neo4j
docker compose run --rm minio-init
pnpm db:init
pnpm dev
```

`pnpm db:init`은 `.env.local`을 읽는다. Shell에 `DATABASE_URL`이 있으면 그 값을 우선한다. 빈 DB를 초기화하거나 기존 스키마가 현재 코드와 같은지 확인한다. 스키마가 다르면 데이터를 변경하지 않고 실패한다. 이때는 [DB 초기화 절차](docs/operations.md#database-초기화)를 확인한다.

### 3. 실행 확인과 첫 로그인

다른 terminal에서 확인한다.

```bash
curl -i http://localhost:3100/api/health
```

HTTP `200`이고 `database`, `schema`, `neo4j`가 모두 `ok`이면 앱을 사용할 수 있다. 실패하면 [장애 대응](docs/operations.md#장애-대응)을 따른다.

`http://localhost:3100`에서 `ADMIN_EMAILS`에 지정한 이메일로 가입한다. 활성 owner가 없는 새 설치에서는 이 계정이 최초 owner가 된다. 이후 사용자의 가입 요청은 `회원` 화면에서 승인한다.

첫 Memory·문서·MCP 연결은 [시작 가이드](docs/getting-started.md#4-첫-memory와-검색)를 따른다. 로그인 없이 제품 흐름을 읽으려면 `/guide`를 연다.

## 용어

| 용어 | 이 프로젝트에서의 의미 |
| --- | --- |
| Memory | 결정·규칙·경험처럼 다시 사용할 지식. 본문, 출처, 유효기간과 변경 이력을 보존한다. |
| MCP | Agent가 서비스의 도구를 호출하는 연결 규약. 이 서비스의 주소는 `/api/mcp`다. |
| RAG·chunk | RAG는 검색한 자료를 답변의 근거로 활용하는 방식이다. Chunk는 검색과 출처 확인에 쓰는 문서 본문 조각이다. |
| Knowledge Graph | 개체(node)와 관계(edge)를 연결한 지식 구조. 각 지식은 Memory 또는 문서 조각을 근거로 갖는다. |
| 출처(provenance) | 지식의 근거가 된 Memory 또는 문서 조각과의 연결. |
| 공유 범위(scope) | 자료를 개인·팀·조직 중 어디에 공유할지 정하는 값. |
| Embedding·reranker | Embedding은 의미 검색에 쓰는 수치 표현이다. Reranker는 검색 후보의 관련도를 다시 평가해 순서를 정하는 모델이다. |
| 보관(archive) | 원본과 이력을 남기면서 일반 검색에서 제외하는 처리. 영구 삭제와 다르다. |

## 기술 구성

- 화면·API: Next.js App Router, TypeScript strict, React, Mantine, Better Auth
- 저장·처리: PostgreSQL·pgvector, Drizzle, pg-boss, S3 호환 저장소, Neo4j
- 선택형 AI: OpenAI-compatible embedding·reranker·지식 추출 adapter
- 관측: Pino, OpenTelemetry·Langfuse, Prometheus metrics

버전은 [package.json](package.json)과 [pnpm-lock.yaml](pnpm-lock.yaml), 구성 요소의 책임은 [아키텍처](docs/architecture.md)를 기준으로 한다.

## 개발 검증

```bash
pnpm verify
```

스키마 SQL 일치, lint, typecheck, 계층 규칙, 단위 테스트, production build를 검사한다. DB 변경에는 통합 테스트를, 화면 변경에는 E2E를 추가한다. 실행 조건은 [배포 전 확인](docs/operations.md#배포-전-확인)을 따른다. PR·release tag CI도 전체 검사와 인증 E2E를 실행한다.

추출 모델의 품질을 비교하려면 [추출기 평가](docs/operations.md#추출기-평가)를 따른다.

## 데이터 보호

서버는 기존 데이터를 자동 삭제하거나 구버전 형식으로부터 변환하지 않는다. 스키마 변경 시 운영자는 쓰기를 중단하고 승인된 범위에서 DB를 초기화한다. 보존이 필요하면 백업·복원 범위를 정한다. 백업 없이 초기화하도록 승인한 환경에는 해당 결정을 적용한다.

`docker compose down -v`는 로컬 전용 PostgreSQL·MinIO·Neo4j 데이터를 삭제한다. 일반 종료에는 `docker compose down`을 사용한다.

Alpha는 k3s, prod는 EKS에 배포한다. 두 환경은 Argo CD 자동 Sync를 사용하므로 GitOps의 image tag 갱신이 rollout으로 이어진다. Prod는 GitHub Environment 승인 후 갱신한다. 배포 순서와 완료 기준은 [운영 가이드](docs/operations.md#릴리즈와-환경별-배포)를 따른다.
