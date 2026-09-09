# Architecture

Agent Memory는 여러 Agent가 공유하는 장기 Memory와 검색 Context를 설치의 단일 조직 안에서 제공한다. 이 문서는 구현 계층과 데이터 불변 조건을 설명한다. 요청·응답 규격은 [API 문서](api.md), 환경 변수·배포·복원은 [운영 가이드](operations.md)를 따른다.

## System context

```text
사람 ──▶ 운영 콘솔 ──────────────┐
                                 ▼
AI Agent ──▶ HTTP API / MCP ──▶ Next.js application
                                      │
                  ┌───────────────────┼──────────────────┐
                  ▼                   ▼                  ▼
            PostgreSQL            pg-boss           S3-compatible
       Memory·chunk·Graph       document jobs       document objects
                  │
                  └── Full-Text Search + pgvector(optional)
```

운영 콘솔, HTTP API, MCP는 별도 비즈니스 로직을 갖지 않고 같은 application use case를 호출한다. PostgreSQL은 transaction과 tenant constraint의 기준 저장소이며 pg-boss도 같은 Database를 사용한다. S3 호환 storage에는 문서 원본만 저장하고 권한·상태·chunk·provenance는 PostgreSQL에 둔다.

## 계층과 의존성

```text
src/app  ──▶ src/lib ──▶ src/application ──▶ src/domain
   │               └──▶ src/infrastructure ──▶ src/domain
   └───────────────────────────────────────▶ src/domain
```

- `src/domain`은 entity, 접근 정책, repository port를 소유한다. 다른 내부 계층과 third-party package에 의존하지 않는다.
- `src/application`은 use case를 조립하며 domain에만 의존한다.
- `src/infrastructure`는 PostgreSQL, S3, pg-boss, embedding, observability adapter를 구현한다. application과 app에 의존하지 않는다.
- `src/app`은 UI와 HTTP entry point를 제공하고 infrastructure를 직접 선택하지 않는다. 화면이 표시·검증에 쓰는 domain 정책과 type은 직접 import할 수 있다.
- `src/lib`은 인증·HTTP 변환과 composition root를 제공한다. infrastructure adapter를 application use case에 주입하고 app에 준비된 operation을 노출한다.

`dependency-cruiser.config.cjs`와 `eslint.config.mjs`가 이 방향을 검사한다. Dependency cruiser는 `import type`을 포함한 소스 의존성과 순환 의존성을 검사해 repository port와 외부 package의 타입 참조도 경계 규칙에 포함한다.

## 개발 시 책임과 port 계약

Memory 생성은 `src/app/api/memories/route.ts` → `src/lib/memory-service.ts` → `src/application/memory/create-memory.ts` → domain의 `MemoryRepository` port로 이어진다. `src/lib/container.ts`가 PostgreSQL adapter와 선택형 AI adapter를 만들고 service가 clock·ID 함수와 함께 주입한다. HTTP와 MCP는 이 조립된 operation을 공유한다.

- Domain은 프레임워크 타입을 받지 않고 entity와 순수 정책을 정의한다.
- Application은 인증된 actor와 port를 받아 권한과 workflow를 결정한다. 시간·ID·외부 호출은 주입한다.
- Repository adapter는 row 변환과 SQL을 소유한다. `saveRevision`, candidate `accept`, `mergeNodes`처럼 하나로 완료되어야 하는 작업을 transaction 안에서 실행한다. 마지막 owner 보존과 동일 scope merge 등 동시 변경에 민감한 불변 조건은 잠근 최신 상태에서 최종 검사한다.
- `lib`의 `*-schemas`와 `*-http`는 입력 검증·공개 응답·오류 변환을, `*-service`와 `container`는 조립을 담당한다. Better Auth 연결과 readiness 같은 운영 기능도 이 외부 경계에 둔다. Route는 준비된 operation을 호출한다.
- Unit test는 clock·ID·port 대역으로 정책을 검증한다. Transaction, tenant FK, SQL 권한 predicate는 실제 PostgreSQL integration test로 검증한다.

| 확인할 계약 | 구현 기준 |
| --- | --- |
| 시작 순서와 종료 hook | [instrumentation.ts](../src/instrumentation.ts) |
| 설치 초기화·가입 | [installation-repository.ts](../src/infrastructure/database/repositories/installation-repository.ts) |
| 조직·team·user scope 정책 | [organization-access.ts](../src/domain/identity/organization-access.ts), [memory-access.ts](../src/domain/memory/memory-access.ts) |
| SQL 읽기 권한 | [scope-predicates.ts](../src/infrastructure/database/repositories/scope-predicates.ts) |
| 문서 처리·후속 AI job | [process-document.ts](../src/application/document/process-document.ts), [ingest-document.ts](../src/application/document/ingest-document.ts) |
| 통합 검색·회상 재정렬 | [search-context.ts](../src/application/context/search-context.ts), [context-service.ts](../src/lib/context-service.ts) |
| MCP 도구 등록·공개 응답 | [mcp-server.ts](../src/lib/mcp-server.ts) |

Port를 수정할 때 반환 데이터의 권한 범위, 원자성, 재실행 의미, 충돌 결과를 함께 확인하라. 예를 들어 candidate 승인은 최초 승격과 재실행을 구분한다. 최초 승격은 ready source를 요구하지만, 이미 승인한 candidate의 재실행은 source가 이후 archive되었더라도 기존 승인 결과를 반환하며 새 graph resource를 생성하지 않는다.

## 설치 경계

### 시작 순서

Node.js runtime은 bootstrap 설정을 검증한 뒤 선택형 migration, DB 설정 override 적용·검증, 설치 조직 초기화, 운영 설정 확인, 종료 hook·telemetry 등록, 선택형 worker 시작 순서로 준비된다. `MIGRATE_ON_START=true`이면 migration 전에 기존 다중 조직 여부를 검사한다. DB와 암호화 root 설정은 override를 읽기 전에 필요하다.

### 단일 조직과 가입

한 설치는 하나의 조직을 사용한다. 서버 시작 시 조직이 없으면 기본 조직을 만들고, 하나면 기존 데이터를 사용하며, 둘 이상이면 시작을 거부한다. 조직 생성 시 PostgreSQL table lock으로 직렬화하고 기존 조직 조회에는 이 잠금을 사용하지 않는다. 요청 권한 검사는 조직을 읽기만 하며 조직을 생성하지 않는다. 일반 HTTP와 session MCP는 사용자 인증을 먼저 확인한다. 내부 organization ID와 tenant FK는 scope·provenance 검증을 위해 유지한다. 공개 API에는 조직 선택 경로가 없고 `/api/organization`은 조회·설정 변경만 제공한다. MCP 주소는 `/api/mcp`다.

인증 사용자의 첫 콘솔 진입 시 가입 요청을 등록한다. 같은 조직 advisory lock 아래에서 최초 owner를 결정하고 기본 팀 배정을 수행한다. active owner가 없는 경우에만 전역 admin을 owner로 준비한다. 그 외 신규 사용자는 pending 요청으로 등록하며 운영자가 승인해야 active 멤버가 된다. 기존 blocked·removed membership은 로그인으로 재활성화하지 않는다.

## 요청 경계

조직 resource 요청은 다음 책임을 분리한다. Path ID 검증을 인증보다 먼저 수행하는 route도 있고 body 검증을 인증 뒤에 수행하는 route도 있으므로 모든 endpoint의 검사 순서가 같지는 않다. Resource 접근은 인증·조직 권한 확인을 통과해야 한다.

| 경계 | 책임 |
| --- | --- |
| Route와 schema | path·query·body 형식과 크기를 검증 |
| 인증·설치 권한 | session/Bearer를 검증하고 설치 조직의 활성 멤버 또는 조직 서비스 principal을 결정 |
| Application | scope·action·현재 resource 상태와 version을 검증 |
| Repository | 조직 ID, SQL 권한 predicate, transaction·constraint로 저장소 경계를 유지 |
| 공개 변환 | 호출자에게 허용한 필드만 반환하고 embedding vector·storage 내부 정보 등을 제외 |

운영 콘솔은 `api-response-schemas`의 endpoint별 Zod schema로 성공 응답을 decode한 뒤 상태와 mutation target에 사용한다. JSON이더라도 계약과 다른 응답은 화면의 operation fallback 오류로 처리하며 caller가 지정한 generic type으로 단언하지 않는다.

브라우저의 unsafe method는 요청 origin이 실제 또는 설정된 application origin과 같아야 한다. Bearer 요청은 Agent 호출로 취급한다.

Next.js 전역 응답 header는 CSP `frame-ancestors 'none'`과 `X-Frame-Options: DENY`로 clickjacking을 차단하고 MIME sniffing, cross-origin referrer, 사용하지 않는 browser capability를 제한한다.

### MCP 서비스 인증과 사용자 위임

조직 Agent token은 organization별 하나만 존재하며 `admin` 또는 `owner`가 생성·재생성·reveal·폐기한다. 저장 시 SHA-256 hash와 AES-256-GCM 암호문을 함께 기록한다. 암호화 key는 `BETTER_AUTH_SECRET`에서 HKDF(`agent-memory/organization-agent-token/v1`)로 파생하고 organization UUID를 AAD로 결합한다. 검증은 복호화가 아니라 hash 비교를 사용하므로 key가 바뀌어 reveal할 수 없는 token도 인증 자체는 유지된다. 원문은 생성 또는 명시적 reveal POST에서만 반환한다. Token은 설치의 `/api/mcp`에서만 인증되며 일반 HTTP API에는 사용자 principal을 만들지 않는다. 검증할 때 발급자가 현재 active `admin` 또는 `owner`인지 다시 확인해 제거·차단·강등을 즉시 반영한다.

유효한 token 요청에 `X-User-Email`이 없으면 발급자에게 귀속되는 organization service principal로 실행하며 organization scope만 허용한다. 이 경우 user scope, team scope, 개별 access grant는 domain 정책과 SQL predicate 모두에서 제외한다.

Header가 있으면 정규화·형식 검증 후 token 조직의 활성 멤버를 `findByEmail`로 조회해 사용자의 role과 team을 포함한 기존 사용자 권한을 적용한다. 빈 값·잘못된 형식은 거부하고 활성 멤버가 없으면 접근을 거부하며 service principal로 fallback하지 않는다. Token 발급자의 role을 위임 사용자에게 물려주지 않는다. 조직 token은 조직 내 사용자 신원을 위임할 수 있으므로 인증된 사용자 email을 전달하는 신뢰된 server-side client만 보유해야 한다. Session 인증과 일반 HTTP route는 이 header로 사용자를 변경하지 않는다.

### 로그인 정책과 전역 설정

Better Auth의 user·session 생성 hook은 설정한 email domain을 인증 경계에서 검사한다. 허용 domain 목록이 없으면 모든 email domain을 허용한다. 인증 경계는 설정된 전역 admin email 여부를 actor에 담고, 설치 멤버십의 최초 owner bootstrap과 전역 설정 API가 이 권한을 확인한다. 이 권한은 조직 resource 접근을 우회하지 않으며 다른 사용자와 동일하게 organization membership과 role 정책을 따른다.

전역 애플리케이션 설정은 singleton `app_settings` row에 env 이름별 override로 저장한다. Application use case가 env보다 override를 우선해 유효 설정을 만들고, infrastructure adapter가 Secret 값을 `BETTER_AUTH_SECRET`에서 분리해 파생한 AES-256-GCM key와 env 이름 AAD로 암호화한다. 인증 domain과 admin 목록은 짧은 cache를 거쳐 요청 시 다시 읽으며, process 초기화형 설정은 instrumentation이 migration 이후 다른 adapter를 import하기 전에 `process.env`에 적용한다. Database 연결, 암호화 root, migration 실행 여부, Node runtime은 이 row를 읽기 전에 필요하므로 bootstrap env로 남긴다.

## Scope와 권한

검색·조회 SQL의 scope 필터는 `scope-predicates`(infrastructure repository 공용 builder)가 단일 소유하며, domain의 `canAccessScopedResource`와의 동치성을 integration test로 고정한다. user scope의 기본 접근 권한은 본인에게만 있고 `admin`·`owner` 역할만으로 다른 사용자의 개인 자료를 열람할 수 없다. Memory는 명시적 access grant가 있으면 해당 사용자·팀에도 접근을 허용한다.

### 멤버십과 관리 권한

조직 membership은 사용자에게 노출하는 `active`, `pending`, `blocked`와 접근 회수 tombstone인 내부 `removed` status를 가진다. 조직 접근 조회는 `active` membership만 반환하므로 나머지 사용자는 모든 조직 API에서 `403`을 받는다. 조직은 기본 팀(`defaultTeamId`)을 설정할 수 있으며, 멤버가 `active`가 되는 시점에 기본 팀에 `member`로 배정된다. 가입 요청은 항상 pending으로 저장한다. 기본 팀은 같은 organization의 team만 composite FK로 참조한다. 조직 설정 변경, 기본 팀 삭제, 가입·활성화는 같은 organization advisory lock을 사용하며 기본 팀 삭제 transaction은 참조를 먼저 해제한다. 조직 온톨로지(`ontology` 사전, `ontologyMode`)를 포함한 조직 설정 변경은 `admin`·`owner`만 수행한다. 마지막 active `owner`는 강등·차단·제거할 수 없고, 자기 자신의 membership 변경은 허용하지 않는다.

Membership 제거는 row를 삭제하지 않고 `removed`로 전환해 user scope의 Memory, Document, Knowledge resource 소유권을 보존한다. Team membership과 해당 사용자가 발급한 조직 Agent token은 즉시 삭제하고 모든 접근 조회에서 tombstone을 제외한다. 관리자가 다시 추가하면 기존 row를 활성화하므로 보존된 user scope에 다시 접근할 수 있다. `createdBy`, `changedBy`, `grantedBy`, `reviewedBy`, `mergedBy` 같은 audit actor도 stable global user를 참조하므로 감사 기록과 organization·team scope resource를 보존한다.

### Resource scope

모든 memory, document, knowledge node와 edge는 하나의 organization에 속하며 다음 scope 중 하나를 갖는다. 표는 별도 Memory access grant가 없는 기본 권한이다.

| Scope | 읽기 | 쓰기 | 관리 |
| --- | --- | --- | --- |
| organization | 조직 멤버 | `admin`, `owner` | `admin`, `owner` |
| team | 해당 팀 멤버, 조직 `admin`·`owner` | 해당 팀 멤버, 조직 `admin`·`owner` | team `manager`, 조직 `admin`·`owner` |
| user | 해당 사용자 | 해당 사용자 | 해당 사용자 |

Memory는 별도 access grant로 organization 안의 team 또는 user에게 `read`, `write`, `manage`를 부여할 수 있다. Tenant가 다른 grant나 resource는 허용하지 않는다.

## Memory 흐름

Memory 종류는 `rule`, `experience`, `decision`, `preference`, `fact`다. 생성할 때 scope, content, source, 유효기간과 선택형 access grant를 저장한다.

- HTTP 수정·archive는 `If-Match`, MCP `forget`은 `expectedVersion`으로 현재 version을 받아 충돌을 감지한다.
- 각 변경 전 상태는 revision으로 보존한다. Revision 조회는 `manage` 권한이 필요하다.
- 검색·라이브러리·회상은 접근 가능하고 `active`이며 현재 유효한 Memory만 반환한다. ID 조회는 읽을 수 있는 active Memory를 반환하므로 만료·미래 유효 Memory도 조회할 수 있다. Archive된 Memory는 일반 ID 조회에서도 제외한다.
- `EMBEDDING_MODEL`이 설정되면 같은 model의 vector score와 PostgreSQL Full-Text Search를 결합한다. 설정하지 않으면 lexical search만 사용한다.
- Embedding은 model 이름과 함께 저장한다. 검색 시 같은 model의 vector만 비교한다. 차원과 ANN index를 특정 model에 미리 고정하지 않는다.
- 제목·본문을 포함한 revision은 현재 embedding 설정으로 vector를 다시 만들며, embedding이 비활성화된 경우 기존 vector를 제거한다. 다른 필드만 바꾸면 기존 vector를 유지한다. 전체 Memory를 자동 재색인하는 작업은 제공하지 않는다.

## 문서 수집 흐름

```text
multipart upload → S3-compatible storage → document row(pending)
                                      └──▶ pg-boss job
                                           └──▶ extract → chunk → embed(optional) → ready
                                                                    └──▶ enrichment job(optional)
                                                                         └──▶ candidate → scope review → graph
```

### 원본 저장과 처리 claim

원본은 S3 호환 스토리지에 저장하고 metadata와 처리 상태는 PostgreSQL에 저장한다. Document row 생성은 organization advisory lock 아래에서 누적 storage, 처리 backlog, 사용자별 시간당 업로드 quota를 원자적으로 검사하며 모든 replica가 같은 한도를 공유한다. 한도를 넘으면 row를 만들지 않고 저장한 object를 제거한다. Worker는 처리 claim마다 lease ID를 발급하고 queue job expiration과 같은 15분 ownership timeout을 사용하므로, 만료된 job은 새 lease로 복구하고 stale worker의 chunk나 상태 갱신은 거부한다. `document-ingestion-v2` queue는 document ID별 exclusive job을 보장해 queued·active·retry job이 있을 때만 중복 enqueue를 병합한다.

### 추출·embedding과 실패

지원 MIME type의 text를 정규화하고 문서당 최대 512개 chunk를 생성하며 embedding은 최대 64개 chunk씩 provider에 전달한다. 최대 8개 batch를 순서대로 요청하며 각 embedding HTTP 요청의 timeout은 60초다. 이 값은 S3 조회·추출·DB 저장을 포함한 전체 처리 시간의 보장이 아니다. Lease가 재발급되면 이전 worker의 저장은 거부된다. 실패한 문서는 안전한 공개 오류와 `failed` 상태를 남겨 retry 요청으로 다시 queue에 넣는다. 최초 queue 등록이 실패해도 document ID를 반환해 복구 경로를 유지한다. 검색은 `ready` 상태이고 호출자가 읽을 수 있는 chunk만 반환한다. Document 삭제는 provenance를 보존하는 archive이며 원본과 chunk를 유지하되 검색, retry, AI 후보 조회·승인에서 제외한다.

### 후속 Knowledge enrichment

`buildIngestDocument` application operation은 문서 처리를 완료한 뒤 선택형 `DocumentKnowledgeEnrichmentQueue` port로 후속 작업을 등록한다. Worker는 job decode, operation 호출, queue retry와 로그를 담당한다. 후속 queue 등록 실패는 문서 처리 상태를 되돌리지 않으며 ingestion 재실행에서 chunk 등록을 다시 시도한다.

Knowledge extraction model을 설정하면 ready 문서의 각 chunk를 `document-knowledge-enrichment-v2` queue의 별도 job으로 enqueue해 entity와 relationship 후보를 생성한다. Chunk ID별 exclusive job이 독립적으로 retry되며 한 chunk의 실패는 문서의 ready 상태나 다른 chunk의 검색·후보 생성을 되돌리지 않는다. 후보는 source chunk, scope, model을 보존하며 chunk별로 중복 생성하지 않는다. AI 생성 결과는 graph에 직접 쓰지 않고 해당 scope의 `manage` 권한을 가진 사용자가 검토한 뒤 승격한다. 승인 transaction은 candidate를 잠그고 node·edge upsert, candidate→resource 관계, reviewer audit을 함께 저장한다. Node merge로 resource ID가 바뀌면 candidate 관계도 surviving resource로 옮겨 재승인 응답의 정합성을 유지한다.

## Knowledge Graph와 통합 검색

### Provenance와 현재 유효성

Graph 검색·이름 기반 중복 조회·관계 탐색은 각 작업 시작 시의 애플리케이션 시각으로 출처 Memory의 유효기간을 검사한다. 한 작업의 node·edge·source 조회에는 같은 시각을 사용하며, DB 서버의 시각을 별도 기준으로 사용하지 않는다.

Knowledge node와 edge는 scope와 여러 provenance를 가진다. 각 provenance 행은 DB constraint로 정확히 하나의 memory 또는 document chunk를 참조한다. Canonical resource가 여러 근거에서 발견되면 resource를 중복 생성하지 않고 provenance를 누적한다. 생성 시 호출자가 source를 읽을 수 있어야 하고 graph scope는 source scope보다 넓을 수 없다. 검색·Neighborhood·node 및 edge 생성은 source의 현재 권한과 active·유효·ready 상태를 다시 확인한다. Memory의 유효성은 domain의 `isMemoryActiveAt` 정책으로 정의하며 `validFrom <= now`이고 `expiresAt`이 없거나 `now < expiresAt`인 active Memory만 검색과 Graph 근거로 허용한다.

Graph의 검색·중복 후보 조회·Neighborhood repository port는 읽을 수 있고 현재 유효한 provenance만 반환한다. Resource 선택과 개별 source 필터는 같은 SQL predicate를 사용하며, source를 다시 조회하는 사이 유효한 근거가 사라진 resource는 결과에서 제외한다. 내부 mutation을 위한 `findNodeById`와 `findEdgeById`는 전체 provenance를 보존하므로 공개 검색 결과로 직접 사용하지 않는다.

### Identity·온톨로지·변경

Node identity는 NFKC·공백·대소문자를 정규화한 canonical name key와 ontology로 정규화한 kind를 사용한다. 동일 scope의 동일 identity 생성은 transaction advisory lock으로 직렬화해 하나의 node와 provenance로 수렴한다. 이름은 같지만 kind가 다른 node는 자동 병합하지 않고 검토 대상으로 남긴다.

조직은 통제 어휘 사전(`ontology`: node kind·edge predicate 목록)과 검증 모드(`ontologyMode`: `off`·`warn`·`strict`)를 가진다. 신규 조직은 추출 프롬프트의 기본 kind 목록과 범용 edge predicate 목록으로 구성된 domain의 `defaultKnowledgeOntology` + `warn` 모드로 생성된다. 사전 확장은 두 경로로 지원한다 — 조직의 graph·pending 후보에서 관찰된 용어의 결정적 빈도 집계(`KnowledgeTermUsageRepository`), 그리고 관찰 용어를 extraction 모델에 보내 정제·통합을 제안받는 AI 경로(`KnowledgeOntologySuggestionService`, 용어 문자열만 전송). 두 경로 모두 admin·owner 전용이며 저장은 항상 설정 PATCH를 거친다. 검증은 application 계층에서 node 생성, edge 생성, AI 후보 승인의 세 쓰기 경로에 일괄 적용된다 — `warn`은 응답에 경고를 싣고, `strict`는 embedding 호출과 영속화 전에 `422`로 거부한다. 검증 모드가 켜져 있고 사전이 비어 있지 않으면 AI 추출 프롬프트에 조직 사전을 힌트로 주입하고, `strict`에서는 entity kind를 structured output schema의 enum으로 제약한다. 사전 조회는 `KnowledgeOntologyReader` port를 통해 organizations 행에서 읽는다.

Graph resource 삭제는 해당 scope의 `manage` 권한을 요구한다. Edge 삭제는 edge와 provenance row만 제거하고, node 삭제는 연결 edge와 각 provenance row를 함께 제거한다. 어느 경우에도 source Memory나 document를 삭제하지 않는다.

Node merge는 같은 scope에서만 허용한다. 하나의 transaction에서 source provenance를 target에 누적하고 edge endpoint를 재작성하며 동일 edge를 병합하고 self-edge를 제거한다. Source node 삭제 전 reviewer, reason, 원래 kind와 canonical name을 merge audit에 저장한다.

AI candidate는 graph와 분리된 검토 queue다. 거절은 graph를 변경하지 않으며, 승인된 candidate는 다시 거절할 수 없다. 승인·거절에는 reviewer와 선택형 사유를 남긴다.

### 후보 수집과 재정렬

통합 Context 검색은 같은 인증·scope 조건으로 memory, document chunk, knowledge node 후보를 각각 검색한다. Semantic search가 활성화되어도 query embedding은 한 번만 생성해 세 저장소 검색에 공유한다. Reranker가 설정되면 종류별로 `min(100, max(12, limit × 4))`개까지 후보를 조회한 뒤 같은 총량 상한 안에서 source별로 균형 있게 구성하고, 권한 필터가 완료된 후보만 외부 reranker에 보낸다. Reranker 입력은 query 4,000자, 후보당 8,000자로 제한한다. 성공하면 relevance score로 최종 순위를 정하고, timeout·provider 오류·잘못된 응답이면 기존 hybrid score 순위로 복귀한다. 모든 AI call은 인증 access 또는 document creator에서 organization·user quota key를 만들고, instance-local limiter와 PostgreSQL minute bucket을 모두 통과해야 한다. 따라서 여러 replica와 worker가 같은 tenant·principal budget을 공유한다. API와 MCP는 동일한 application operation을 사용한다.

### Memory 전용 회상

서비스의 기억 lifecycle은 MCP `remember`·`recall`·`forget`으로 제공한다. `remember`는 Memory 생성 use case를, `forget`은 manage 권한과 현재 version을 검증하는 archive use case를 사용한다. Archive 후에는 회상·검색에서 제외하고 revision과 provenance는 보존한다. `recall`은 같은 검색·재정렬 흐름을 Memory만 대상으로 실행하며 문서·Graph를 조회하지 않는다. Reranker 설정·최소 점수·실패 시 hybrid 복귀를 통합 검색과 공유한다. 회상 응답은 결과 하나 최대 1,200자·전체 최대 4,000자의 `remembered` text와 구조화 Memory 검색 결과를 반환한다. 두 형식 모두 Memory ID·version을 포함해 text만 소비하는 서비스도 `forget`을 호출할 수 있다. RAG·Knowledge Graph를 함께 검색하려면 `context_search`를 사용한다.

Embedding, reranker, knowledge extraction, 온톨로지 AI 제안 adapter는 같은 instance-local request limiter를 공유한다. 동시 실행 수와 분당 합산 호출 수를 넘으면 provider를 호출하지 않는다. Embedding 기반 HTTP 요청은 `429`와 `Retry-After`를 반환하고, reranker는 hybrid 순위로 복귀하며, worker의 제한 초과는 pg-boss retry로 복구한다.

### 관계 지도

운영 콘솔의 관계 지도는 search hit의 node ID로 제한된 neighborhood를 요청한다. Client는 반환된 node와 방향성 edge를 SVG에 배치하고 node 선택 상태와 inspector를 관리한다. Inspector의 `이 node 중심으로 탐색`을 실행하면 해당 node를 새 중심으로 neighborhood를 재조회한다. Layout은 표현 계층의 책임이며 접근 가능한 node·edge 결정은 server의 application·repository 계층에 남긴다.

## 실패 격리와 복구 경계

- 문서 원본 저장 후 queue 등록이 실패해도 document row와 ID를 유지하고 `failed` 상태에서 retry할 수 있다.
- Document processing lease가 재발급되면 이전 worker의 complete·fail 갱신을 거부한다.
- Knowledge enrichment 실패는 ready 문서와 문서 검색 가능 상태를 되돌리지 않는다.
- AI candidate 승인은 node·edge와 reviewer audit을 하나의 transaction으로 저장한다.
- Memory mutation은 HTTP `If-Match` 또는 MCP `expectedVersion` 충돌을 감지하고 덮어쓰기를 거부한다.
- Source를 읽을 수 없게 되면 graph 검색과 neighborhood에서 해당 provenance를 다시 제외한다.
- 팀 삭제는 PostgreSQL의 team resource를 cascade 삭제하지만 S3 호환 storage의 문서 원본 object는 제거하지 않는다. 삭제 전 식별과 object lifecycle은 운영 경계에서 담당한다.

## 관측성과 민감정보

Pino는 작업명, organization ID, 결과 수, 처리 시간을 구조화해 기록한다. 일반 Error는 allowlist된 type·code만 직렬화하고 message를 기록하지 않는다. Provider·storage adapter가 만든 `SafeOperationalError`만 입력을 포함하지 않는 고정 message와 code를 기록하며, cause는 message 없이 type·code chain만 최대 3단계 보존한다. Reranker가 실패하면 본문 없이 fallback을 기록한다. 검색어와 본문은 retrieval log에 포함하지 않는다. Langfuse key가 모두 설정되면 OpenTelemetry trace를 내보내며 token과 secret을 마스킹하고 media upload를 비활성화한다. Retrieval 실패는 observation 안에서 고정된 실패 상태로 기록하고 원래 오류는 observation 밖에서 다시 던져 SDK가 오류 message를 span에 기록하지 못하게 한다. Embedding과 reranker 입력·출력은 telemetry 대상이 아니다.

## 수집 receipt

`ingestion_receipts`는 조직·사용자·operation·key를 primary key로 사용하고 payload hash와 resource ID를
보관한다. Memory·Document insert와 receipt insert는 같은 transaction이다. 동시 요청의 패자는
자신의 작업을 rollback한 뒤 현재 권한으로 기존 resource를 읽는다. 문서 quota 검사 전에 기존
receipt를 확인하므로 같은 요청의 replay가 최초 생성으로 소진한 quota 때문에 거절되지 않는다.

Payload fingerprint는 JSON key 순서·생성 시각·인증 role에 의존하지 않는다. 선택한 scope와 실제
요청 내용을 반영한다. Archive 뒤에도 receipt를 유지해 재생성을 막는다. 문서 queue 등록은 resource
transaction 뒤에 수행하며, pending upload replay가 동일 ID로 queue publication을 복구한다.

멱등 문서 retry는 receipt와 pending 상태를 함께 commit한 뒤 queue에 발행한다. Queue 메시지의
expectedAttempts와 현재 처리 횟수가 일치할 때만 새 처리를 claim한다. 만료된 processing lease는
같은 횟수로 회수하므로 worker 재시작과 새 retry 요청을 구분한다. 완료된 처리의 오래된 queue
메시지는 새 처리를 시작하지 않는다.
