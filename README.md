# Agent Memory

기업 내부 AI Agent가 조직, 팀, 사용자 범위의 기억과 RAG 문서를 안전하게 공유하도록 지원하는 설치형 플랫폼이다. 한 설치 안에서 권한이 허용한 기억만 검색하며, 원문·변경 이력·유효기간·출처를 함께 보존한다.

`../agent-studio`와 형제 프로젝트다. Agent Studio가 Agent 실행과 운영을 담당한다면 이 저장소는 Agent가 공통으로 사용하는 장기 기억과 검색 Context를 담당한다.

## 현재 구현

- Next.js 16 App Router, React 19, Mantine 9 기반 UI
- `app → application → domain ← infrastructure` 의존 방향
- ESLint와 dependency-cruiser 기반 레이어 경계 검사
- 조직·팀·사용자와 멤버십 모델
- Better Auth 기반 session과 Drizzle 저장소, 선택형 OIDC·Google·password provider
- 조직·팀·사용자 scope 권한 정책과 same-origin mutation 검사
- 조직·팀·사용자 범위의 memory, revision, ACL, 출처, 유효기간 모델
- RAG 문서·chunk, PostgreSQL Full-Text Search, pgvector 저장 모델
- PostgreSQL 기반 knowledge node/edge와 원본 memory/chunk 역참조
- PostgreSQL 18 + pgvector 0.8.6, 선택형 MinIO Docker Compose

Embedding 차원은 아직 특정 model에 고정하지 않는다. 현재 `vector` 컬럼은 서로 다른 model의 값을 섞지 않도록 `embedding_model`을 함께 저장하며, embedding 정책을 정한 뒤 model별 차원과 ANN partial index를 추가한다.

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

MinIO가 필요하면 별도 profile을 켠다.

```bash
docker compose --profile objects up -d minio
```

MinIO API는 `localhost:9010`, console은 `localhost:9011`에서 열린다.

## 검증

```bash
pnpm lint
pnpm typecheck
pnpm architecture
pnpm test
pnpm test:integration
pnpm build
```

`pnpm verify`는 Docker가 필요 없는 게이트를 실행한다. `pnpm test:integration`은 Testcontainers로 PostgreSQL 18 + pgvector를 새로 띄워 migration과 조직 격리 제약을 검사한다. 데이터베이스 스키마를 바꾼 뒤에는 `pnpm db:generate`로 migration을 생성하고 두 검사를 모두 실행하라.

## 디렉터리

```text
src/
├── app/             Next.js 화면과 HTTP 진입점
├── application/     use case와 orchestration
├── domain/          순수 TypeScript entity, 규칙, repository port
└── infrastructure/  PostgreSQL, object storage, queue, 외부 SDK adapter
```

Domain과 application은 third-party package에 의존하지 않는다. Infrastructure는 domain port를 구현하고 application을 import하지 않는다. App은 infrastructure를 직접 선택하지 않고 조립된 application use case를 호출한다.
