# Architecture

이 문서는 계층·권한·저장 동작을 변경하는 개발자를 위한 설계 참조다. API 형식은 [API 문서](api.md), 실행 절차는 [운영 가이드](operations.md)를 따른다. 아래 제약은 구현을 바꿀 때도 유지한다.

| 확인할 내용 | 위치 |
| --- | --- |
| 구성 요소와 의존 방향 | [System context](#system-context), [계층과 의존성](#계층과-의존성) |
| 인증·조직·공유 범위 | [설치 경계](#설치-경계), [요청 경계](#요청-경계), [Scope와 권한](#scope와-권한) |
| 기억 저장·수정·보관 | [Memory 흐름](#memory-흐름) |
| 문서 처리·지식 추출·검토 | [문서 수집 흐름](#문서-수집-흐름) |
| 출처별 정보·검색·관계 탐색 | [Knowledge Graph와 통합 검색](#knowledge-graph와-통합-검색) |
| 실패·재시도·민감정보 | [실패 격리](#실패-격리와-복구-경계), [관측성](#관측성과-민감정보), [수집 receipt](#수집-receipt) |

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
                  │
                  └── Approved topology ──▶ Neo4j ──▶ Neighborhood traversal
```

운영 콘솔, HTTP API, MCP는 별도 비즈니스 로직을 갖지 않고 같은 application use case를 호출한다. PostgreSQL은 transaction과 tenant constraint의 기준 저장소이며 pg-boss도 같은 Database를 사용한다. S3 호환 storage에는 문서 원본만 저장하고 권한·상태·chunk·provenance는 PostgreSQL에 둔다. Neo4j는 승인된 Graph topology를 저장·탐색하고 PostgreSQL이 반환 자료의 현재 출처·권한을 검증한다.

## 계층과 의존성

Clean Architecture를 적용해 정책과 use case를 외부 기술에서 분리하고, domain port를 통해 저장소와 서비스를 주입한다.

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

Knowledge 쓰기 port는 단일 출처의 `KnowledgeNodeContribution` 또는 `KnowledgeEdgeContribution`을 받는다. Properties와 node 설명·embedding은 해당 provenance에 저장하고, 조회용 node·edge는 현재 읽을 수 있는 출처에서 값을 구성한다. 조회 객체에는 공유 embedding을 두지 않는다.

## 설치 경계

### 시작 순서

Node.js runtime은 bootstrap 설정을 검증한 뒤 빈 DB 초기화·schema fingerprint 검사, DB 설정 override 적용·검증, 설치 조직 초기화, 운영 설정 확인, Neo4j 연결·constraint 준비, 종료 hook·telemetry 등록, 선택형 worker 시작 순서로 준비된다. DB와 암호화 root 설정은 override를 읽기 전에 필요하다.

Production 초기화가 실패하면 안전한 오류 로그를 남기고 process를 exit code `1`로 종료한다. Next.js가 초기화 실패 promise를 보존한 채 TCP listener를 유지하므로, supervisor가 process를 다시 시작해야 의존성 복구 후 초기화를 재실행할 수 있다. 초기화 완료 이후의 의존성 장애는 readiness 실패로 처리한다.

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

Better Auth 계정은 `auth_accounts.provider_id`와 `account_id`의 조합으로 식별하며 DB unique index로 중복을 막는다. 서로 다른 provider는 같은 account ID를 사용할 수 있다. 계정 테이블은 설치된 Better Auth의 계약을 따르며 `issuer` column을 저장하지 않는다. OIDC issuer는 provider 설정과 token 검증에서 사용한다.

Better Auth의 user·session 생성 hook은 설정한 email domain을 인증 경계에서 검사한다. 허용 domain 목록이 없으면 모든 email domain을 허용한다. 인증 경계는 설정된 전역 admin email 여부를 actor에 담고, 설치 멤버십의 최초 owner bootstrap과 전역 설정 API가 이 권한을 확인한다. 이 권한은 조직 resource 접근을 우회하지 않으며 다른 사용자와 동일하게 organization membership과 role 정책을 따른다.

전역 애플리케이션 설정은 singleton `app_settings` row에 env 이름별 override로 저장한다. Application use case가 env보다 override를 우선해 유효 설정을 만들고, infrastructure adapter가 Secret 값을 `BETTER_AUTH_SECRET`에서 분리해 파생한 AES-256-GCM key와 env 이름 AAD로 암호화한다. 인증 domain과 admin 목록은 짧은 cache를 거쳐 요청 시 다시 읽으며, process 초기화형 설정은 instrumentation이 schema 준비 이후 다른 adapter를 import하기 전에 `process.env`에 적용한다. Database 연결, 암호화 root, Node runtime은 이 row를 읽기 전에 필요하므로 bootstrap env로 남긴다.

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
- Embedding은 model 이름과 함께 저장한다. `EMBEDDING_DIM`은 provider에 요청할 차원을 지정하며 기본 `native`는 파라미터를 생략한다. 검색 시 같은 model·같은 차원의 vector만 비교하고 다른 차원은 키워드 검색에 남긴다. 차원과 ANN index를 특정 model에 미리 고정하지 않는다.
- Memory·문서·Knowledge 검색은 같은 hybrid SQL 정책을 사용한다. Vector score는 코사인 유사도(`1 - cosine distance`)를 `0–1`로 제한하며 영벡터는 비교에서 제외한다. Provider 응답은 16,000차원 이하의 유한한 float32 값과 nonzero norm을 요구한다. `EMBEDDING_MIN_SCORE` 하한은 권한·상태 조건과 함께 SQL에서 `LIMIT` 전에 적용하며 키워드 일치를 제외하지 않는다. 설정 override는 다음 검색에서 읽으며 재시작·재색인이 필요 없다.
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

원본은 S3 호환 스토리지에 저장하고 metadata와 처리 상태는 PostgreSQL에 저장한다. Document row 생성은 organization advisory lock 아래에서 누적 storage, 처리 backlog, 사용자별 시간당 업로드 quota를 원자적으로 검사하며 모든 replica가 같은 한도를 공유한다. 한도를 넘으면 row를 만들지 않고 저장한 object를 제거한다. Worker는 처리 claim마다 lease ID를 발급하고 queue job expiration과 같은 15분 ownership timeout을 사용하므로, 만료된 job은 새 lease로 복구하고 stale worker의 chunk나 상태 갱신은 거부한다. `document-ingestion-v2` queue는 document ID와 선택형 처리 세대(`expectedAttempts`)별 exclusive job을 보장해 같은 세대의 queued·active·retry job이 있을 때만 중복 enqueue를 병합한다.

### 추출·embedding과 실패

`DocumentTextExtractor` port는 추출 본문과 본문의 MIME을 함께 반환한다. 원본 MIME과 checksum은 Document에 보존하고, chunk의 `metadata.textMimeType`은 실제 추출 형식을 기록한다. 분할과 후속 AI 추출은 이 본문 형식을 사용한다.

텍스트·Markdown·CSV·JSON·XML은 Node.js에서 UTF-8로 읽는다. PDF·DOCX·PPTX·XLSX·XLS·HTML·EPUB는 infrastructure adapter가 별도 Python process의 [MarkItDown](https://github.com/microsoft/markitdown) converter로 Markdown으로 변환한다. 파일 bytes만 stdin으로 전달하며 URL 수집, plugin 탐색, OCR, LLM 호출은 사용하지 않는다. 허용된 converter만 직접 호출하며 Python 네트워크 접근을 차단한다. MarkItDown의 간접 의존성인 ONNX Runtime도 import 전에 [telemetry를 비활성화](https://github.com/microsoft/onnxruntime/blob/main/docs/Privacy.md#disabling-telemetry)해 네트워크 전송과 식별자 파일 생성을 막는다. Application credential은 child process에 전달하지 않는다. 변환은 60초, 출력은 8 MiB로 제한하고 ZIP 기반 형식은 압축 해제 전 64 MiB·4,096개 항목 한도를 검사한다. Linux에서는 process 주소 공간을 2 GiB로 제한한다.

문서당 최대 512개 chunk를 생성하며 embedding은 최대 64개 chunk씩 provider에 전달한다. 최대 8개 batch를 순서대로 요청하며 각 embedding HTTP 요청의 timeout은 60초다. 이 값은 S3 조회·추출·DB 저장을 포함한 전체 처리 시간의 보장이 아니다. Lease가 재발급되면 이전 worker의 저장은 거부된다. 실패한 문서는 안전한 공개 오류와 `failed` 상태를 남겨 retry 요청으로 다시 queue에 넣는다. 최초 queue 등록이 실패해도 document ID를 반환해 복구 경로를 유지한다. 검색은 `ready` 상태이고 호출자가 읽을 수 있는 chunk만 반환한다. Document 삭제는 provenance를 보존하는 archive이며 원본과 chunk를 유지하되 검색, retry, AI 후보 조회·승인에서 제외한다.

Markdown chunk는 2,000자 문맥 예산에 들어가는 상위 제목 경로를 원문 그대로 함께 보존한다. 제목 경로 자체가 예산을 초과하면 일반 텍스트 분할로 처리한다. 같은 단계의 제목이나 새 최상위 제목을 만나면 이전 경로를 제거하며 fenced code 안의 제목은 문서 구조로 해석하지 않는다. 본문 없는 상위 제목은 자식 chunk의 문맥으로 사용한다. 같은 부모와 단계 아래에 연속된 본문·자식 없는 제목은 예산 안에서 함께 묶고 공통 상위 제목만 반복한다. 본문이 있는 섹션과 새 최상위 제목의 경계는 유지한다. `metadata.start/end`는 줄바꿈과 앞뒤 공백을 정규화한 추출 본문의 문자 범위이고, 반복한 제목의 원본 범위는 `metadata.contextSpans`에 기록한다. 이력서의 주인·경력·기술·프로젝트 구분도 같은 chunk의 근거로 조회할 수 있다. 변환 파일의 범위는 원본 bytes나 PDF page 좌표가 아니다. JSON의 범위는 경로·값으로 펼친 본문을 기준으로 한다.

Markdown 표와 CSV는 열 제목을 반복하면서 들어갈 수 있는 행을 함께 묶는다. Markdown 표는 상위 제목도 함께 보존하며, 반복한 열 제목의 범위는 `metadata.contextSpans`에 기록한다. 하나의 긴 행은 열 제목을 제외한 본문 예산으로 나누고, 표의 열 제목 자체가 너무 길어 유효한 본문 공간을 확보할 수 없으면 일반 텍스트 분할을 적용한다. Fenced code 안의 표 예시는 문서 표로 해석하지 않는다.

### 문서 공유 범위 변경

Ready 문서의 scope 변경은 현재 문서와 대상 scope의 `manage` 권한을 요구한다. Chunk와 AI 후보의 scope는 문서에서 조회하며 별도 scope column을 두지 않는다. `document_scope_changes`는 이전·새 scope, 변경자, 시각, Knowledge 적용·제외 건수를 기록한다. HTTP `If-Match`는 문서 `updatedAt` 기반 ETag를 검사하며, scope 변경은 timestamp를 최소 1ms 증가시킨다.

Application의 scope 변경 use case가 repository의 원자적 변경 port를 호출한다. Repository는 조직 관리 advisory lock으로 최신 membership·대상 팀을 검증하고, 조직별 Knowledge scope 배타 잠금 아래 문서와 직접 provenance로 연결된 node·edge를 검증한다. 모든 출처의 현재 유효성·대상 scope 포함 여부, graph 관리 권한, 대상 identity 충돌을 검사한다. 관계 양 끝의 최종 scope와 유효 출처를 검사하며, node scope 축소로 기존 edge를 읽을 수 없게 만드는 변경은 제외한다. 통과한 항목만 변경하고 문서·지식·audit을 함께 commit한다. 제외된 지식은 기존 scope를 유지하며 일반 검색의 현재 provenance 권한 필터를 계속 적용한다.

Graph 쓰기는 같은 조직별 Knowledge scope 잠금을 사용한다. 공개 node 생성, 후보 승인과 node 병합은 이름 해석·병합·승격을 원자적으로 수행하기 위해 배타 모드를 사용하며, 나머지 Graph 저장·삭제는 공유 모드를 사용한다. Scope 변경 중에는 이 쓰기들을 대기시키며 일반 조회는 계속 허용한다. 검증한 출처 row는 공유 잠금으로 commit까지 보존한다. 지식 생성은 저장 transaction에서 source scope를 다시 확인하고, 관계 생성은 끝점 scope도 확인한다. 후보 검토는 현재 문서 scope와 검토자의 활성 멤버십·관리 권한을 다시 확인한다. 삭제는 application이 확인한 scope를 repository에서 재검사한다. Scope 변경과 겹친 오래된 mutation으로 이전 권한을 적용하지 않는다.

문서 범위 축소·이동에서 제외된 지식은 기존 scope를 유지한다. Properties·설명·별칭·embedding은 현재 읽을 수 있는 출처만 사용하므로 숨겨진 출처의 값이 남은 지식에 섞이지 않는다. 충돌 검사는 출처·권한 검증을 통과해 실제 이동할 수 있는 후보와 대상 범위의 기존 지식 사이에 수행한다. 보관 요청도 권한 검사 시 읽은 document scope를 저장 조건으로 사용해 동시 scope 변경에 이전 권한을 적용하지 않는다.

### 후속 Knowledge enrichment

이 단계는 처리된 문서에서 지식 후보를 만들고 검토해 Graph에 반영한다. 문서의 검색 준비 상태인 `ready`와 별도로 진행한다.

#### 작업 등록과 실패 경계

`buildIngestDocument`는 문서 처리를 마친 뒤 선택형 `DocumentKnowledgeEnrichmentQueue` port로 후속 작업을 등록한다. 추출 모델이 설정돼 있으면 각 chunk를 `document-knowledge-enrichment-v2` queue의 별도 job으로 보낸다. Worker는 job 해석, operation 호출, 재시도와 로그를 담당한다.

- Chunk ID별 exclusive job을 사용하며 각 job은 독립적으로 재시도한다.
- 한 chunk의 실패는 문서의 `ready` 상태나 다른 chunk의 검색·후보 생성을 되돌리지 않는다.
- 후속 queue 등록에 실패하면 ingestion 재실행에서 등록을 다시 시도한다.
- 후보는 출처 chunk·현재 문서 scope·모델을 보존한다. 청크별 후보는 하나이며 재시도는 저장된 추출을 재사용한다.

#### 개체 식별과 관계 추출

Runtime은 두 단계의 structured-output 요청을 사용한다. 단일 호출 추출기는 평가 비교용이다. 각 요청은 AI limiter를 개별적으로 통과한다.

1. 원문에서 이름과 인용이 있는 개체를 식별한다. 이름·종류를 정규화하고 부적격 개체를 제거한다.
2. 살아남은 개체 key만 관계 끝점의 enum으로 전달해 관계를 추출한다. 개체가 0–1개면 이 요청을 생략한다.
3. 인용과 연결 구조를 검사해 후보를 만든다. 관계가 없는 결과도 정상으로 보존한다. 관계 요청이 실패하면 부분 Graph를 승인 후보로 반환하지 않는다.

추출과 검증은 같은 종류·관계 정의와 문서 구조 해석 규칙을 사용한다. 종류를 설명보다 먼저 판단하며, 새 entity key는 서버가 부여한다. 제목은 문맥으로 다루고 항상 행위자로 해석하지 않는다. 이력서의 경력·기술·프로젝트와 짧은 목록도 이름이 확인된 주체와 원문의 구조를 기준으로 평가한다.

원문의 구절에는 중립적인 ID를 부여한다. 모델은 추출의 `evidenceIds`와 검증의 `evidenceId`에서 제공된 ID만 선택한다. 서버가 ID를 실제 인용으로 변환하므로 모델이 인용을 다시 쓰거나 생략 기호로 조합하지 않는다. 존재하지 않는 ID는 거부한다.

후보를 만들 때 다음 규칙을 적용한다.

- 별칭은 entity 속성으로 표현한다. 각 개체·관계에는 원문 인용이 필요하다.
- 원문에 없는 인용, 근거 없는 항목, 범용 동시 등장 관계는 제거한다.
- 같은 kind·정규화 이름의 개체는 청크 안에서 통합한다. 대칭 관계의 역방향 반복도 합치고 근거를 모은다.
- 하나의 키가 서로 다른 개체를 가리키면 해당 개체와 그 키를 참조한 관계를 제외한다.
- 없는 개체를 참조한 관계와 자기 관계는 제외한다. 같은 청크의 정상 지식은 보존한다.

키 고유성과 관계 끝점의 불변 조건은 정규화한 Graph에 적용한다. 인용 존재 검사는 사실의 의미나 진실성을 보장하지 않는다.

#### 독립 검증과 자동 판단

검증 adapter는 원문과 현재 읽을 수 있는 기존 지식을 대조한다. 기존 지식은 출처의 대표 이름·별칭으로 찾는다. 추출과 다른 검증 모델·endpoint를 설정할 수 있다. 별도 검증 endpoint는 추출용 API key를 상속하지 않는다.

`evidence-v5`는 다음 기준으로 자동 승인·수동 검토·자동 제외를 결정한다. 모델이 제시한 숫자 점수는 승인 임계값으로 쓰지 않는다.

| 기준 | 처리 규칙 |
| --- | --- |
| 항목의 표현(`representation`) | Entity·relationship·attribute·generic_reference·uncertain을 구분한다. 관계·속성·호칭을 개체로 승인하지 않는다. |
| 개체 종류 | 제안된 kind와 원래 추출 key를 숨기고 중립적인 ID로 검증한다. 모델은 원문에서 `entityKind`를 독립적으로 판단한다. 서버는 결과를 원래 key에 연결한다. Kind가 다르거나 독립 개체인지 불분명하면 개체와 연결 관계를 수동 검토로 남긴다. |
| 원문 근거와 충돌 | 명시성·인용 일치·충돌 여부·온톨로지·관계 끝점을 확인한다. `support`, `usefulness`, `conflict`를 보존해 모델의 판단과 최종 verdict를 구분한다. |
| 유용성 | 핵심 관계가 나머지 검증을 모두 통과했다면 `incidental` 표기만으로 제외하지 않는다. 단독 이름과 그 밖의 관계에는 유용성 판정을 적용한다. 불필요한 이동·응답·모호한 연관은 제외한다. |
| 표시용 설명 | 최대 1,000자에 맞춰 말줄임표로 줄인다. 설명 길이만으로 전체 판정을 실패시키지 않으며, 인용·판단 필드의 검사는 유지한다. |

별칭 검증은 개체·관계 주장 검증과 구분한다. `same_entity`, `generic_reference`, `different_entity`, `uncertain` 중에서 원문 인용이 확인된 `same_entity`만 자동 승인한다. 별칭 자체가 원문에 없거나 설명형 확장·공통 직함·호칭이면 제외하되 유효한 개체 사실은 보존한다. 불확실한 별칭은 해당 개체와 연결 관계를 수동 검토로 남긴다.

#### 승인 저장과 재검증

자동 검토에도 활성 멤버십과 출처 scope의 `manage` 권한이 필요하다. 긴 AI 호출 뒤에는 권한 주체를 다시 확인한다.

1. Assessment를 먼저 저장한다.
2. 항목별 결정을 멱등하게 적용한다. 재시도가 같은 검증 요청이나 Graph를 반복 생성하지 않도록 한다. 자동 처리에는 `method: automatic`을 기록한다.
3. 승인 transaction에서 candidate를 잠그고 node·edge, candidate와 resource의 연결, 검토자 기록을 함께 저장한다.
4. 부분 검토는 원래 Graph를 보존하고 `itemReviews`에 결정을 누적한다. 미검토 항목은 `pending`으로 유지한다.

빈 추출은 이력으로 보존하되 기본 검토 큐에서 제외한다. 통합 큐는 권한 검사를 통과한 수동 검토 대상의 `pending` 항목을 개체·관계별로 묶어 페이지를 만든다. 현재 strict 사전이 자동 승인 묶음을 거부하면 수동 검토에 표시한다. 원래 assessment는 바꾸지 않으며 사전이 허용하는 개별 항목은 선택 승인할 수 있다.

미완료 후보의 검토 정책 버전이 바뀌면 새 검증을 실행하고 이전 결과를 `assessmentHistory`에 보존한다. 같은 정책의 결과와 이미 처리한 항목은 재사용한다. 재검증은 원본 추출·기존 승인·거절 결정을 바꾸거나 승인된 Graph를 자동 삭제하지 않는다. 완료된 과거 Graph의 재추출·정리는 별도 데이터 운영 작업이다.

Node 병합 시 candidate의 연결도 남는 resource로 옮겨 재승인 결과를 일치시킨다. 대칭 관계의 끝점 순서를 정규화하고 중복 관계의 출처를 합친다. 개체 설명은 현재 보이는 출처의 description으로만 구성한다.

## Knowledge Graph와 통합 검색

### Neo4j topology와 승인 원장

Neo4j는 `MemoryEntity` node와 `MEMORY_RELATION` edge를 영속 저장하며, 관계 지도와 HTTP/MCP neighborhood의 인접 관계를 조회한다. 조직 ID와 resource ID로 개체를 구분하고 관계 유형은 `predicate` 속성으로 보존한다. 사용자 입력을 Cypher 식별자로 조립하지 않는다. PostgreSQL은 Graph의 승인 원장, identity·scope·provenance, 후보 검토·병합 이력과 다른 resource의 transaction 경계를 소유한다. Graph node·edge의 공개 정보와 lexical/vector 검색은 이 원장을 사용한다.

Graph 변경 transaction은 조직별 `knowledge_graph_versions.revision`을 함께 변경한다. Neo4j의 `MemoryGraph.revision`과 다르면 첫 neighborhood 조회가 조직 Graph 쓰기 잠금 아래 승인된 node·edge snapshot을 읽고 하나의 Neo4j transaction으로 교체한다. 같은 revision은 재전송하지 않는다. 원장에는 graph 변경과 revision이 함께 commit되므로 Neo4j 장애로 동기화가 실패해도 다음 조회가 재구성할 수 있다. Node 삭제·병합·scope 변경도 같은 규칙을 사용한다. 시작 시 Neo4j uniqueness constraint를 멱등하게 준비한다.

Neo4j에는 검색어·문서 본문·출처별 설명·embedding·credential을 복제하지 않는다. 탐색은 Neo4j가 반환한 인접 edge ID를 PostgreSQL에서 현재 scope와 유효 출처로 검증하고, 읽을 수 있는 끝점만 다음 탐색 단계로 전달한다. 만료·보관·권한 변경은 projection revision 변경을 기다리지 않고 조회에서 적용된다. 오래되었거나 권한 없는 edge가 앞 페이지에 있어도 다음 페이지를 조회한다. Neo4j 오류는 `503`으로 드러내며 PostgreSQL 탐색으로 자동 우회하지 않는다. Repository의 SQL topology 구현은 Neo4j 없이 권한 정책을 격리 검증하는 테스트에 사용하고 runtime composition은 Neo4j를 주입한다.

Revision이 바뀐 조직은 전체 topology를 재구성하므로 변경 직후 첫 탐색에는 Graph 크기에 비례하는 비용과 쓰기 잠금이 발생한다. 현재 구현은 이를 명시적인 일관성 경계로 사용하며, 지속적인 대규모 변경이 발생하는 설치에서는 증분 projection으로 전환하기 전에 실제 동기화 시간과 Graph 크기를 측정한다. 한 조회 도중 더 최근의 변경이 commit되면 다음 조회에서 해당 revision을 반영하며, 반환 데이터의 출처 권한 검사는 계속 적용한다.

### Provenance와 현재 유효성

Graph 검색·이름 기반 중복 조회·관계 탐색은 각 작업 시작 시의 애플리케이션 시각으로 출처 Memory의 유효기간을 검사한다. 한 작업의 node·edge·source 조회에는 같은 시각을 사용하며, DB 서버의 시각을 별도 기준으로 사용하지 않는다.

Knowledge node와 edge는 scope와 여러 provenance를 가진다. 각 provenance 행은 DB constraint로 정확히 하나의 memory 또는 document chunk를 참조한다. Canonical resource가 여러 근거에서 발견되면 resource를 중복 생성하지 않고 provenance를 누적한다. 생성 시 호출자가 source를 읽을 수 있어야 하고 graph scope는 source scope보다 넓을 수 없다. 검색·Neighborhood·node 및 edge 생성은 source의 현재 권한과 active·유효·ready 상태를 다시 확인한다. Memory의 유효성은 domain의 `isMemoryActiveAt` 정책으로 정의하며 `validFrom <= now`이고 `expiresAt`이 없거나 `now < expiresAt`인 active Memory만 검색과 Graph 근거로 허용한다.

Graph의 검색·중복 후보 조회·Neighborhood repository port는 읽을 수 있고 현재 유효한 provenance만 반환한다. Resource 선택과 개별 source 필터는 같은 SQL predicate를 사용하며, source를 다시 조회하는 사이 유효한 근거가 사라진 resource는 결과에서 제외한다. 내부 mutation을 위한 `findNodeById`와 `findEdgeById`는 전체 provenance를 보존하므로 공개 검색 결과로 직접 사용하지 않는다.

Node·edge properties와 속성 갱신 시각은 각 source row가 소유한다. 수동 생성의 같은 출처 재기여는 속성 snapshot을 교체하며, AI 후보 승인은 기존 속성과 그 시각을 유지한다. 이미 승인된 entity의 관계를 추가 승인할 때는 현재 candidate binding을 재사용해 endpoint의 설명·vector도 덮어쓰지 않는다. 조회는 유효한 출처를 속성 갱신 시각·출처 종류·ID 순으로 합쳐 최근 값이 같은 key를 덮도록 한다. 병합은 고유 출처의 속성과 시각을 유지하며, 중복 출처는 target 속성을 우선해 합치고 병합 시각을 기록한다. 쓰기 응답에도 호출자의 현재 출처 권한을 적용한다.

### 개체와 관계의 표현

개체의 정체성과 그 개체에 대한 주장을 구분한다. `relationship`, `relation`, `employment`, `statement`, `claim`, `fact`, `attribute`는 node 종류와 온톨로지 node kind로 등록할 수 없다. 이 불변 조건은 사전 검증 모드와 무관하며 HTTP·후보 승인·domain 생성에서 적용한다. 추출 프롬프트와 사전 추천도 이 종류를 제외한다.

AI가 제안한 대표 이름은 NFKC·공백 정규화 후 원문에 있어야 한다. 인용문이 존재하더라도 원문에 없는 문장 요약형 이름은 개체가 될 수 없다. 자동 검증에서 부적격 개체와 그 끝점을 참조하는 관계를 함께 제외하고, 관계 승인 단계가 해당 개체를 재승격하지 않게 한다. 원문에 이름이 있는 개념과 사건은 보존한다. 인용 존재·이름 존재 검사는 사실의 함의나 개체의 의미적 적절성까지 보장하지 않으므로 별도의 AI 검증을 유지한다.

### Identity·온톨로지·변경

Node identity는 ID로 유지하며 저장된 대표 이름은 내부 label이다. 공개 `canonicalName`은 읽을 수 있는 출처 이름 중 내부 label과 정규화 key가 같은 값을 사용하고, 없으면 정규화 key 순서로 첫 이름을 선택한다. 같은 key의 표기가 여러 개면 문자열 정렬상 마지막 표기를 사용해 조회 순서에 의존하지 않는다. `aliases`에는 나머지 읽을 수 있는 이름만 포함한다. 정확한 이름 조회와 lexical 검색에도 숨겨진 내부 label을 넣지 않는다. Node source는 비어 있지 않은 이름 map을 필수로 저장한다.

Node 생성과 후보 승인은 조직별 배타 잠금 안에서 호출자가 읽을 수 있는 출처 이름으로 신규·기존 ID를 결정한다. Persistence에는 이 결정과 원래 기여 이름을 따로 전달하며 저장 label로 다시 연결하지 않는다. 저장 label에는 전역 이름 unique 제약을 두지 않고, scope 조회에는 별도의 nonunique index를 사용한다. 같은 호출자의 동시 재기여는 같은 ID로 수렴한다. Node 생성·후보 승인·병합은 각 출처가 제공한 이름만 보존하며 대상이나 이전 node의 저장 대표 이름을 다른 출처에 복사하지 않는다.

출처의 `primary_name_keys`는 원래 대표 이름의 역할을 `names`의 별칭과 구분하며, 비어 있지 않고 모두 해당 이름 map에 존재해야 한다. 병합은 이 역할도 출처별로 합친다. Identity resolver와 scope 충돌 검사는 현재 읽을 수 있는 원래 대표 이름을 사용하고 표시명을 대표 이름의 근거로 재해석하지 않는다. 따라서 같은 별칭이 표시명으로 선택된 서로 다른 개체도 별칭 공유만으로 병합하지 않는다.

Node kind와 출처 이름 key는 NFKC·공백·대소문자 및 온톨로지 규칙으로 정규화한다. `names`는 정규화 key→표기 map이다. 별칭은 개체와 별칭 identity가 AI 검증을 통과하거나 사람이 승인한 경우에만 승격한다.

- 후보의 대표 이름은 기존 대표 이름·별칭과 비교하고, 후보의 검증된 별칭은 기존 대표 이름과 비교한다. 서로 다른 개체가 별칭만 공유하면 동일인으로 판단하지 않는다.
- 여러 node와 일치하면 각 node의 원래 대표 이름 사이의 동일성이 명시적으로 확인돼야 통합한다. 해소되지 않은 모호성은 해당 개체와 연결 관계를 수동 검토로 보내고 독립 항목은 계속 처리한다.
- 검증된 이름이 여러 node를 연결하면 후보 대표 이름과 일치하는 node를 우선하고, 없으면 생성 시각·ID 순으로 target을 정한다. 이름이 같아도 kind가 다르면 자동 병합하지 않는다.
- 병합은 출처·관계·과거 candidate binding과 audit을 함께 보존한다. 출처 이름과 원래 대표 이름의 역할을 다른 출처로 복사하지 않는다.

조직은 통제 어휘 사전(`ontology`: node kind·edge predicate 목록)과 검증 모드(`ontologyMode`: `off`·`warn`·`strict`)를 가진다. 신규 조직은 추출 프롬프트의 기본 kind 목록과 범용 edge predicate 목록으로 구성된 domain의 `defaultKnowledgeOntology` + `warn` 모드로 생성된다. 사전 확장은 두 경로로 지원한다 — 조직의 graph·pending 후보에서 관찰된 용어의 결정적 빈도 집계(`KnowledgeTermUsageRepository`), 그리고 관찰 용어를 extraction 모델에 보내 정제·통합을 제안받는 AI 경로(`KnowledgeOntologySuggestionService`, 용어 문자열만 전송). 두 경로 모두 admin·owner 전용이며 저장은 항상 설정 PATCH를 거친다. 검증은 application 계층에서 node 생성, edge 생성, AI 후보 승인의 세 쓰기 경로에 일괄 적용된다 — `warn`은 응답에 경고를 싣고, `strict`는 embedding 호출과 영속화 전에 `422`로 거부한다. 검증 모드가 켜져 있고 사전이 비어 있지 않으면 AI 추출 프롬프트에 조직 사전을 힌트로 주입하고, `strict`에서는 entity kind를 structured output schema의 enum으로 제약한다. 사전 조회는 `KnowledgeOntologyReader` port를 통해 organizations 행에서 읽는다.

Graph resource 삭제는 해당 scope의 `manage` 권한을 요구한다. Edge 삭제는 edge와 provenance row만 제거하고, node 삭제는 연결 edge와 각 provenance row를 함께 제거한다. 어느 경우에도 source Memory나 document를 삭제하지 않는다.

Node merge는 같은 scope에서만 허용한다. 하나의 transaction에서 source provenance를 target에 누적하고 edge endpoint를 재작성하며 동일 edge를 병합하고 self-edge를 제거한다. Source node 삭제 전 reviewer, reason, 원래 kind와 canonical name을 merge audit에 저장한다.

AI candidate는 원본 추출과 검증·처리 이력을 graph와 분리해 보존한다. 항목별 승인은 graph에 근거를 반영하고 거절은 이미 승인한 graph를 변경하지 않는다. 자동·수동 처리 구분, 실행 principal, 시각과 사유를 기록한다.

### 후보 수집과 재정렬

Knowledge embedding은 `knowledge_node_sources`가 model과 함께 소유한다. 같은 출처 재기여나 AI 후보 승인에서 새 embedding을 제공하면 vector·model 쌍을 교체하고, 제공하지 않으면 기존 쌍을 유지하며, embedding 없는 새 출처는 두 값을 모두 NULL로 저장한다. 검색은 현재 읽을 수 있고 유효한 출처 중 query와 model·차원이 맞는 vector의 최대 점수를 사용한다. Node 병합은 고유 출처의 vector를 그대로 옮기며, 같은 출처가 양쪽에 있으면 target vector를 유지하고 target에 없을 때만 source vector를 채운다. 공유 node 설명·vector·검색 index는 저장하지 않는다.

통합 Context 검색은 같은 인증·scope 조건으로 memory, document chunk, knowledge node 후보를 각각 검색한다. Semantic search가 활성화되어도 query embedding은 한 번만 생성해 세 저장소 검색에 공유한다. Reranker가 설정되면 종류별로 `min(100, max(12, limit × 4))`개까지 후보를 조회한 뒤 같은 총량 상한 안에서 source별로 균형 있게 구성하고, 권한 필터가 완료된 후보만 외부 reranker에 보낸다. Reranker 입력은 query 4,000자, 후보당 8,000자로 제한한다. 성공하면 relevance score로 최종 순위를 정하고, timeout·provider 오류·잘못된 응답이면 기존 hybrid score 순위로 복귀한다. 모든 AI call은 인증 access 또는 document creator에서 organization·user quota key를 만들고, instance-local limiter와 PostgreSQL minute bucket을 모두 통과해야 한다. 따라서 여러 replica와 worker가 같은 tenant·principal budget을 공유한다. API와 MCP는 동일한 application operation을 사용한다.

### Memory 전용 회상

서비스의 기억 lifecycle은 MCP `remember`·`recall`·`forget`으로 제공한다. `remember`는 Memory 생성 use case를, `forget`은 manage 권한과 현재 version을 검증하는 archive use case를 사용한다. Archive 후에는 회상·검색에서 제외하고 revision과 provenance는 보존한다. `recall`은 같은 검색·재정렬 흐름을 Memory만 대상으로 실행하며 문서·Graph를 조회하지 않는다. Reranker 설정·최소 점수·실패 시 hybrid 복귀를 통합 검색과 공유한다. 회상 응답은 결과 하나 최대 1,200자·전체 최대 4,000자의 `remembered` text와 구조화 Memory 검색 결과를 반환한다. 두 형식 모두 Memory ID·version을 포함해 text만 소비하는 서비스도 `forget`을 호출할 수 있다. RAG·Knowledge Graph를 함께 검색하려면 `context_search`를 사용한다.

Embedding, reranker, knowledge extraction, 온톨로지 AI 제안 adapter는 같은 instance-local request limiter를 공유한다. 동시 실행 수와 분당 합산 호출 수를 넘으면 provider를 호출하지 않는다. Embedding 기반 HTTP 요청은 `429`와 `Retry-After`를 반환하고, reranker는 hybrid 순위로 복귀하며, worker의 제한 초과는 pg-boss retry로 복구한다.

### 관계 지도

운영 콘솔의 관계 지도는 search hit의 node ID로 제한된 neighborhood를 요청한다. Client는 반환된 node와 방향성 edge를 D3 force simulation으로 배치하고 SVG에 표시한다. D3는 복사한 좌표 데이터만 변경하며 React는 선택 상태와 inspector를 관리한다. Drag·zoom 이벤트와 simulation은 unmount 시 해제한다. 전체 화면 전환에서도 고정한 노드 위치를 유지한다. 노드 메뉴의 `탐색`을 실행하면 해당 node를 새 중심으로 neighborhood를 재조회한다. Inspector의 노드 이름 옆과 노드 우클릭 메뉴의 `확장`은 선택한 node의 depth 2 neighborhood(최대 100개)를 조회해 기존 지도에 ID 기준으로 병합한다. 기존 중심·위치·속도·고정 상태를 이어받고 새 노드를 연결된 노드 근처에 겹치지 않게 배치한 뒤 force simulation으로 부드럽게 정착시킨다. 확장 시 확대율과 화면 위치는 유지하며, 데이터 갱신에 따른 첫 크기 감시 알림으로 화면 맞춤을 실행하지 않는다. 중복 resource는 최신 응답으로 갱신하되 그래프 구조가 같으면 simulation을 다시 가열하지 않는다. 클릭은 선택만 하고 실제로 드래그한 노드만 고정한다. 모션 감소 설정에서는 애니메이션 없이 배치를 계산한다. 확장 실패 시 기존 지도를 유지한다. 우클릭 메뉴는 상세 보기·중심 탐색·확장, 고정된 node의 고정 해제와 관리 권한이 있는 node의 삭제를 제공하며 Shift+F10으로도 열 수 있다. 고정 해제는 해당 node의 좌표 제약을 제거하고 자동 배치를 재개한다. 중심 node도 해제할 수 있으며, 해제 상태는 종류 필터와 전체 화면 전환 후에도 유지한다. 배치 초기화는 중심 node를 원점에 다시 고정한다. Ctrl 또는 Cmd를 누른 채 node를 클릭하면 선택 집합에 추가하거나 제거한다. 다중 선택 모드에서는 양 끝이 모두 선택된 관계만 지도와 inspector에 표시하며, 선택하지 않은 node는 추가 선택할 수 있도록 흐리게 표시한다. 마지막 선택을 해제하거나 일반 클릭을 하면 다중 선택 모드를 종료한다. 선택과 관계 표시는 simulation의 입력을 바꾸지 않는다. 메뉴 바깥의 pointer 입력은 D3 이벤트 처리 전에 메뉴를 닫으며, 해당 클릭은 선택과 필터를 변경하거나 다른 동작을 실행하지 않는다. 메뉴가 없는 상태의 지도 빈 공간 클릭은 선택과 검색·종류 필터를 해제해 현재 불러온 모든 노드와 관계를 표시하며, 배경 드래그는 선택을 유지한다. Layout은 표현 계층의 책임이며 접근 가능한 node·edge 결정은 server의 application·repository 계층에 남긴다.

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
메시지는 새 처리를 시작하지 않는다. 멱등 수집 queue의 중복 제거 키는 document ID와
expectedAttempts를 함께 사용하므로 이전 세대의 queued·active·retry job이 새 세대를 막지 않는다.
