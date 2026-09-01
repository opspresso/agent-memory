# Architecture

Agent Memory는 여러 Agent가 공유하는 장기 memory와 검색 Context를 조직 경계 안에서 제공하는 독립 플랫폼이다. 필요하면 Agent Studio를 비롯한 Agent 실행 환경과 연동할 수 있다.

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

`dependency-cruiser.config.cjs`와 `eslint.config.mjs`가 이 방향과 순환 의존성 금지를 검사한다.

## 요청 경계

조직 API 요청은 다음 경계를 통과한다.

1. Route가 path와 query 또는 body를 검증한다.
2. Better Auth session 또는 session Bearer token으로 사용자를 인증한다. MCP route는 조직 Agent token을 service credential로 별도 인정하고 `X-User-Email`을 위임 사용자로 검증한다.
3. URL의 `organizationSlug`를 UUID로 해석하고 session 사용자 또는 위임 사용자의 현재 조직 멤버십과 팀 역할을 조회한다.
4. Application use case가 scope와 action에 대한 domain 정책을 적용한다.
5. Repository가 모든 조회와 변경을 `organizationId`로 제한한다.
6. 공개 응답 변환기가 권한에 따라 ACL과 내부 필드를 제거한다.

브라우저의 unsafe method는 요청 origin이 실제 또는 설정된 application origin과 같아야 한다. Bearer 요청은 Agent 호출로 취급한다.

조직 Agent token은 organization별 하나만 존재하며 `admin` 또는 `owner`가 생성·재생성·reveal·폐기한다. 저장 시 SHA-256 hash와 AES-256-GCM 암호문을 함께 기록한다. 암호화 key는 `BETTER_AUTH_SECRET`에서 HKDF(`agent-memory/organization-agent-token/v1`)로 파생하고 organization UUID를 AAD로 결합한다. 검증은 복호화가 아니라 hash 비교를 사용하므로 key가 바뀌어 reveal할 수 없는 token도 인증 자체는 유지된다. 원문은 생성 또는 명시적 reveal POST에서만 반환한다. Token은 같은 slug의 MCP route에서만 인증되며 일반 HTTP API에는 사용자 principal을 만들지 않는다. 검증할 때 발급자가 현재 active `admin` 또는 `owner`인지 다시 확인해 제거·차단·강등을 즉시 반영한다. 유효한 token 요청은 `X-User-Email`을 정규화한 뒤 같은 organization의 active membership을 조회하고, 그 사용자의 role과 team membership으로 MCP operation을 실행한다. 따라서 token은 Agent Studio를 신뢰해 organization 멤버 가운데 실행 주체를 위임하는 service credential이며, 이메일 header만으로는 인증되지 않는다.

Better Auth의 user·session 생성 hook은 설정한 email domain을 인증 경계에서 검사한다. 전역 admin email은 조직 bootstrap만 허용하며, 생성된 조직 안에서는 다른 사용자와 동일하게 organization membership과 role 정책을 따른다.

## Scope와 권한

검색·조회 SQL의 scope 필터는 `scope-predicates`(infrastructure repository 공용 builder)가 단일 소유하며, domain의 `canAccessScopedResource`와의 동치성을 integration test로 고정한다. user scope 자원은 검색 결과에서도 본인에게만 보인다 — `admin`·`owner`도 다른 사용자의 user scope 자원을 검색으로 열람할 수 없다.

조직 membership은 `active`, `pending`, `blocked` status를 가진다. 조직 접근 조회는 `active` membership만 반환하므로 `pending`·`blocked` 사용자는 모든 조직 API에서 `403`을 받는다. 조직은 신규 가입자의 기본 status(`newMemberStatus`, 기본값 `pending`)와 기본 팀(`defaultTeamId`)을 설정할 수 있으며, 멤버가 `active`가 되는 시점에 기본 팀에 `member`로 배정된다. 조직 온톨로지(`ontology` 사전, `ontologyMode`)를 포함한 조직 설정 변경은 `admin`·`owner`만 수행한다. 마지막 active `owner`는 강등·차단·제거할 수 없고, 자기 자신의 membership 변경은 허용하지 않는다.

모든 memory, document, knowledge node와 edge는 하나의 organization에 속하며 다음 scope 중 하나를 갖는다.

| Scope | 읽기 | 쓰기 | 관리 |
| --- | --- | --- | --- |
| organization | 조직 멤버 | `admin`, `owner` | `admin`, `owner` |
| team | 해당 팀 멤버, 조직 `admin`·`owner` | 해당 팀 멤버, 조직 `admin`·`owner` | team `manager`, 조직 `admin`·`owner` |
| user | 해당 사용자 | 해당 사용자 | 해당 사용자 |

Memory는 별도 access grant로 organization 안의 team 또는 user에게 `read`, `write`, `manage`를 부여할 수 있다. Tenant가 다른 grant나 resource는 허용하지 않는다.

## Memory 흐름

Memory 종류는 `rule`, `experience`, `decision`, `preference`, `fact`다. 생성할 때 scope, content, source, 유효기간과 선택형 access grant를 저장한다.

- 수정과 archive는 현재 version을 `If-Match`로 받아 충돌을 감지한다.
- 각 변경 전 상태는 revision으로 보존한다. Revision 조회는 `manage` 권한이 필요하다.
- 검색은 접근 가능하고 `active`이며 현재 유효한 memory만 반환한다.
- `EMBEDDING_MODEL`이 설정되면 같은 model의 vector score와 PostgreSQL Full-Text Search를 결합한다. 설정하지 않으면 lexical search만 사용한다.
- Embedding은 model 이름과 함께 저장한다. 차원과 ANN index를 특정 model에 미리 고정하지 않는다.

## 문서 수집 흐름

```text
multipart upload → S3-compatible storage → document row(pending)
                                      └──▶ pg-boss job
                                           └──▶ extract → chunk → embed(optional) → ready
                                                                    └──▶ enrichment job(optional)
                                                                         └──▶ candidate → scope review → graph
```

원본은 S3 호환 스토리지에 저장하고 metadata와 처리 상태는 PostgreSQL에 저장한다. Worker는 처리 claim마다 lease ID를 발급하므로 stale worker가 재claim 이후의 chunk나 상태를 덮어쓸 수 없다. 지원 MIME type의 text를 정규화하고 chunk를 생성하며, 실패한 문서는 안전한 공개 오류와 `failed` 상태를 남겨 retry 요청으로 다시 queue에 넣는다. 최초 queue 등록이 실패해도 document ID를 반환해 복구 경로를 유지한다. 검색은 `ready` 상태이고 호출자가 읽을 수 있는 chunk만 반환한다. Document 삭제는 provenance를 보존하는 archive이며 원본과 chunk를 유지하되 검색, retry, AI 후보 조회·승인에서 제외한다.

Knowledge extraction model을 설정하면 별도 pg-boss queue가 ready 문서의 chunk에서 entity와 relationship 후보를 생성한다. 이 실패는 문서의 ready 상태나 검색 가능성을 되돌리지 않는다. 후보는 source chunk, scope, model을 보존하며 chunk별로 중복 생성하지 않는다. AI 생성 결과는 graph에 직접 쓰지 않고 해당 scope의 `manage` 권한을 가진 사용자가 검토한 뒤 승격한다. 승인 transaction은 candidate를 잠그고 node·edge upsert와 reviewer audit을 함께 저장한다.

## Knowledge Graph와 통합 검색

Knowledge node와 edge는 scope와 여러 provenance를 가진다. 각 provenance 행은 DB constraint로 정확히 하나의 memory 또는 document chunk를 참조한다. Canonical resource가 여러 근거에서 발견되면 resource를 중복 생성하지 않고 provenance를 누적한다. 생성 시 호출자가 source를 읽을 수 있어야 하고 graph scope는 source scope보다 넓을 수 없다. 검색·Neighborhood·edge 생성은 source의 현재 권한과 active·유효·ready 상태를 다시 확인한다.

Node identity는 NFKC·공백·대소문자를 정규화한 canonical name key와 ontology로 정규화한 kind를 사용한다. 동일 scope의 동일 identity 생성은 transaction advisory lock으로 직렬화해 하나의 node와 provenance로 수렴한다. 이름은 같지만 kind가 다른 node는 자동 병합하지 않고 검토 대상으로 남긴다.

조직은 통제 어휘 사전(`ontology`: node kind·edge predicate 목록)과 검증 모드(`ontologyMode`: `off`·`warn`·`strict`)를 가진다. 신규 조직은 domain의 `defaultKnowledgeOntology`(추출 프롬프트 기본 kind 목록과 단일 source) + `warn` 모드로 생성된다. 사전 확장은 두 경로로 지원한다 — 조직의 graph·pending 후보에서 관찰된 용어의 결정적 빈도 집계(`KnowledgeTermUsageRepository`), 그리고 관찰 용어를 extraction 모델에 보내 정제·통합을 제안받는 AI 경로(`KnowledgeOntologySuggestionService`, 용어 문자열만 전송). 두 경로 모두 admin·owner 전용이며 저장은 항상 설정 PATCH를 거친다. 검증은 application 계층에서 node 생성, edge 생성, AI 후보 승인의 세 쓰기 경로에 일괄 적용된다 — `warn`은 응답에 경고를 싣고, `strict`는 embedding 호출과 영속화 전에 `422`로 거부한다. 검증 모드가 켜져 있고 사전이 비어 있지 않으면 AI 추출 프롬프트에 조직 사전을 힌트로 주입하고, `strict`에서는 entity kind를 structured output schema의 enum으로 제약한다. 사전 조회는 `KnowledgeOntologyReader` port를 통해 organizations 행에서 읽는다.

Graph resource 삭제는 해당 scope의 `manage` 권한을 요구한다. Edge 삭제는 edge와 provenance row만 제거하고, node 삭제는 연결 edge와 각 provenance row를 함께 제거한다. 어느 경우에도 source Memory나 document를 삭제하지 않는다.

Node merge는 같은 scope에서만 허용한다. 하나의 transaction에서 source provenance를 target에 누적하고 edge endpoint를 재작성하며 동일 edge를 병합하고 self-edge를 제거한다. Source node 삭제 전 reviewer, reason, 원래 kind와 canonical name을 merge audit에 저장한다.

AI candidate는 graph와 분리된 검토 queue다. 거절은 graph를 변경하지 않으며, 승인된 candidate는 다시 거절할 수 없다. 승인·거절에는 reviewer와 선택형 사유를 남긴다.

통합 Context 검색은 같은 인증·scope 조건으로 memory, document chunk, knowledge node를 각각 검색하고 score 순으로 하나의 결과를 만든다. Semantic search가 활성화되어도 query embedding은 한 번만 생성해 세 저장소 검색에 공유한다. API와 MCP는 동일한 application operation을 사용한다.

Embedding, knowledge extraction, 온톨로지 AI 제안 adapter는 같은 instance-local request limiter를 공유한다. 동시 실행 수와 분당 합산 호출 수를 넘으면 provider를 호출하지 않으며 HTTP 경계는 `429`와 `Retry-After`를 반환한다. Worker의 제한 초과는 pg-boss retry로 복구한다.

운영 콘솔의 관계 지도는 search hit의 node ID로 제한된 neighborhood를 요청한다. Client는 반환된 node와 방향성 edge를 SVG에 배치하고 node 선택 상태와 inspector를 관리한다. Inspector의 `이 node 중심으로 탐색`을 실행하면 해당 node를 새 중심으로 neighborhood를 재조회한다. Layout은 표현 계층의 책임이며 접근 가능한 node·edge 결정은 server의 application·repository 계층에 남긴다.

## 실패 격리와 복구 경계

- 문서 원본 저장 후 queue 등록이 실패해도 document row와 ID를 유지하고 `failed` 상태에서 retry할 수 있다.
- Document processing lease가 재발급되면 이전 worker의 complete·fail 갱신을 거부한다.
- Knowledge enrichment 실패는 ready 문서와 문서 검색 가능 상태를 되돌리지 않는다.
- AI candidate 승인만 node·edge와 reviewer audit을 하나의 transaction으로 저장한다.
- Memory mutation은 `If-Match` version 충돌을 감지하고 덮어쓰기를 거부한다.
- Source를 읽을 수 없게 되면 graph 검색과 neighborhood에서 해당 provenance를 다시 제외한다.

## 관측성과 민감정보

Pino는 작업명, organization ID, 결과 수, 처리 시간을 구조화해 기록한다. 검색어와 본문은 retrieval log에 포함하지 않는다. Langfuse key가 모두 설정되면 OpenTelemetry trace를 내보내며 token과 secret을 마스킹하고 media upload를 비활성화한다. Embedding 입력과 출력은 telemetry 대상이 아니다.
