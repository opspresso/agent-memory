# 사용자 가이드

운영 콘솔은 조직의 Memory, RAG 문서, Knowledge Graph를 검색하고 관리하는 화면이다. 좌측 메뉴에서 `통합 검색`, `문서 수집`, `AI 후보 검토`, `Agent 연결`으로 이동하고, 조직 `admin`·`owner`에게는 `회원`, `팀`, `설정` 관리 메뉴가, team `manager`에게는 `팀` 메뉴가 추가로 표시된다. 모든 화면은 로그인 사용자와 활성 조직의 멤버십·scope 권한을 적용한다. 같은 내용을 사이트에서 읽으려면 로그인 전후에 `/guide`를 열거나 좌측 메뉴 하단의 `가이드`를 선택하라.

## 최초 로그인과 조직 가입

active 상태의 조직 membership이 없는 사용자는 로그인하면 조직 선택 화면으로 이동한다. 가입 가능한 조직을 선택하면 조직의 신규 회원 정책에 따라 즉시 활성화되거나 승인 대기 상태가 된다. 승인 대기 중에는 조직 화면과 API를 사용할 수 없으며, 조직 관리자가 `회원`에서 승인하면 활성화된다. 전역 admin(`ADMIN_EMAILS`)은 이 화면과 `설정` 화면에서 새 조직을 만들 수 있다.

## 활성 조직과 권한

상단의 `활성 조직`에서 작업할 조직을 선택한다. 조직을 바꾸면 검색 결과, 팀, 후보 검토 권한과 MCP endpoint가 모두 선택한 조직 기준으로 바뀐다.

Resource scope는 다음과 같이 동작한다.

| Scope | 읽기 | 쓰기 | 관리 |
| --- | --- | --- | --- |
| organization | 조직 멤버 | `admin`, `owner` | `admin`, `owner` |
| team | 팀 멤버, 조직 관리자 | 팀 멤버, 조직 관리자 | team `manager`, 조직 관리자 |
| user | 본인 | 본인 | 본인 |

읽을 수 없는 resource는 검색과 관계 지도에 나타나지 않는다. 권한을 잃거나 source가 archive·만료되면 이전에 보이던 Knowledge Graph 관계도 더 이상 반환되지 않을 수 있다.

## 통합 검색

`통합 검색`에서 검색 대상을 선택한다.

- `All Context`: Memory, document chunk, Knowledge node를 하나의 순위로 결합한다.
- `Memory`: 활성 상태이고 현재 유효한 Memory만 검색한다.
- `Documents`: 처리가 완료된 `ready` document chunk만 검색한다.
- `Graph`: 읽을 수 있는 provenance를 가진 Knowledge node만 검색한다.

검색 결과에는 다음 정보가 표시된다.

- 결과 종류와 scope
- title 또는 canonical name
- 본문 요약이나 chunk 내용
- provenance 설명
- 상대 관련도
- lexical score
- embedding이 활성화된 경우 vector score

상대 관련도는 현재 결과 집합에서 가장 높은 최종 score를 100%로 정규화한 표시다. Reranker가 설정되면 reranker relevance, 그렇지 않거나 provider fallback이 발생하면 hybrid score를 사용한다. 서로 다른 검색 요청이나 model 사이의 절대 품질을 비교하는 값으로 사용하지 마라.

## Memory lifecycle

Memory 검색 결과에서 `Lifecycle`을 선택하면 전체 화면 관리 창이 열린다.

### Revision 생성

1. title 또는 content를 수정한다.
2. 다음 사용자가 변경 이유를 이해할 수 있도록 `변경 사유`를 입력한다.
3. `Revision 저장`을 선택한다.

저장 요청은 화면을 열 때 받은 현재 version을 `If-Match`로 전송한다. 다른 사용자가 먼저 수정했다면 `409` 충돌을 표시하며 최신 상태를 다시 불러와야 한다.

### Version 이력

`Version 이력`은 최신 version부터 과거 revision을 보여준다. Revision에는 당시의 content, source, 유효기간, access grant, 변경 사용자와 변경 사유가 보존된다. 이력 조회에는 `manage` 권한이 필요하다.

### Archive

`Archive`는 Memory를 삭제하지 않고 새 archived version을 만든다. Archived Memory는 일반 검색과 해당 provenance에 의존하는 Knowledge Graph 결과에서 제외된다.

## 문서 수집

`문서 수집`에서 공유 범위를 선택하고 문서를 업로드한다.

- user scope: 본인만 선택할 수 있다.
- team scope: 해당 팀 멤버와 조직 `admin`·`owner`가 선택할 수 있다. 먼저 공유할 팀을 선택하라.
- organization scope: 조직 `admin`·`owner`만 선택할 수 있다.

- 지원 형식: UTF-8 text, Markdown, CSV, JSON, XML
- 최대 원본 크기: 10 MiB, 추출 결과 최대 512 chunks
- 기본 quota: organization 누적 원본 1 GiB, 처리 대기·진행 100건, 사용자별 시간당 업로드 100건(운영 환경변수로 조정)
- title을 생략하면 파일 이름을 사용한다.

처리 흐름은 다음과 같다.

```text
upload → pending → processing → ready
                         └──→ failed → retry
```

문서 상태 확인과 `failed` 문서의 재처리는 API로 수행한다([HTTP API와 MCP](api.md#문서) 참조). 문서가 `pending`에 머물면 document worker가 실행 중인지 확인한다. 원본은 S3 호환 storage에 있고 검색용 chunk와 상태는 PostgreSQL에 저장된다.

문서 삭제는 원본과 provenance를 보존하는 archive다. Archive된 문서는 검색, 상태 조회, retry, AI 후보 검토에서 제외되며 해당 scope의 `manage` 권한이 필요하다.

## Knowledge Graph 탐색

1. 통합 검색에서 `Graph`를 선택한다.
2. entity 이름이나 요약을 검색한다.
3. 검색 결과의 `관계 보기`를 선택한다.
4. 관계 지도에서 node와 방향성 edge를 탐색한다.

관계 지도는 다음 요소를 사용한다.

- 종류별 색상과 연결 수에 따른 크기로 구분한 node
- 관계 방향을 표시하는 화살표
- edge의 predicate label
- node 이름·kind 검색과 종류별 표시 필터
- 확대·축소와 화면 맞춤 제어
- 선택 node의 kind, 이름, summary, 연결 관계를 보여주는 inspector

Node를 선택하면 해당 node와 직접 연결된 관계가 강조되고 inspector가 바뀐다. inspector의 `이 node 중심으로 탐색`을 선택하면 해당 node를 중심으로 neighborhood를 다시 조회한다. 키보드에서는 node에 focus한 뒤 `Enter` 또는 `Space`로 선택할 수 있다.

Neighborhood가 바뀌면서 node 수가 늘거나 줄 수 있다. 서버는 새 중심에서 접근 가능한 source를 다시 검사하고 제한된 depth·limit 안에서 관계를 반환한다.

Graph node와 edge 삭제에는 해당 scope의 `manage` 권한이 필요하다. Edge를 삭제해도 연결 node와 source는 유지된다. Node를 삭제하면 연결 edge도 함께 삭제되지만 근거인 Memory나 document는 유지된다.

검색 결과에서 같은 scope와 이름을 가진 node가 여러 개 발견되면 kind를 비교한다. 정규화 identity가 같은 신규 node는 자동으로 기존 node에 합쳐진다. Kind가 달라 자동 병합되지 않은 기존 node는 `중복 병합`에서 target을 확인하고 병합 사유를 입력한다. 병합은 provenance와 관계를 보존하며 되돌릴 수 없으므로 같은 실제 entity인지 확인하라.

## AI 후보 검토

Knowledge extraction이 활성화되면 ready document chunk에서 entity와 relationship 후보가 생성된다. 후보는 자동으로 공유 Graph에 들어가지 않는다.

`AI 후보 검토`에서 다음 내용을 확인한다.

- 사용한 extraction model
- source document chunk ID
- 제안된 entity의 kind, canonical name, summary
- 제안된 source–predicate–target 관계
- 선택형 검토 사유

### 승인

`Graph에 승인`을 선택하면 하나의 transaction에서 canonical node와 edge를 upsert하고 source chunk provenance와 reviewer audit을 저장한다. 같은 entity가 이미 있으면 중복 node 대신 provenance가 누적된다.

### 거절

`거절`은 candidate에 reviewer와 사유를 기록하지만 Graph를 변경하지 않는다. 거절된 후보는 나중에 승인할 수 없고 승인된 후보도 거절 상태로 바꿀 수 없다.

검토 권한은 candidate의 원래 scope를 따른다.

- organization: `admin`, `owner`
- team: team `manager` 또는 조직 관리자
- user: 해당 사용자

## 조직과 팀 관리

`회원`에서 조직 회원 목록을 확인하고 관리한다.

- 조직 `admin`, `owner`: 멤버 추가, 조직 role 변경, 승인 대기 멤버 승인, 차단·차단 해제, 조직에서 제거, 팀 배정·해제
- `owner` role 부여와 `owner` 멤버 변경·제거는 `owner`만 가능하다. 마지막 owner와 자기 자신은 변경할 수 없다.
- 조직에서 제거하면 팀 소속과 접근 권한은 즉시 해제되지만 user scope의 Memory, Document, Knowledge resource는 보존된다. 같은 사용자가 다시 가입하면 기존 user scope를 다시 사용할 수 있다.

`팀`에서 팀을 관리한다.

- 조직 `admin`, `owner`: 팀 생성·이름 변경·삭제, 팀 멤버 관리. 팀 삭제는 team scope의 Memory·문서 record·chunk·Knowledge Graph를 PostgreSQL에서 함께 삭제한다.
- Team `manager`: 자신이 관리하는 팀의 이름 변경, 기존 조직 멤버 배정과 team role 변경, 팀 멤버 제거
- Team `member`: team scope resource 읽기·쓰기

`설정`에서 조직 이름, 신규 회원 정책(즉시 활성화 또는 승인 대기, 기본은 승인 대기), 기본 팀, Knowledge Graph 온톨로지(검증 모드와 node kind·edge predicate 사전, 빈도 추천·AI 제안 반영)를 관리한다. 기본 팀이 설정되면 신규 회원이 활성화될 때 자동으로 해당 팀에 배정된다. 조직 삭제는 `owner`만 가능하며 조직의 멤버십, 팀, Memory, 문서 record·chunk, Knowledge Graph를 PostgreSQL에서 함께 제거한다.

팀과 조직을 삭제해도 S3 호환 storage의 문서 원본 object는 자동으로 제거되지 않는다. 원본 삭제가 필요하면 PostgreSQL metadata가 사라지기 전에 대상 object를 식별하거나 운영 환경의 object lifecycle을 따른다.

`ADMIN_EMAILS`의 전역 bootstrap 권한은 새 조직 생성만 허용한다. 기존 조직 안에서는 항상 실제 organization membership과 role을 사용한다.

## Agent 연결

`Agent 연결`에는 현재 사이트 주소와 활성 organization slug가 포함된 전체 Streamable HTTP MCP endpoint가 표시된다. `복사`를 선택해 client 설정에 붙여 넣어라.

```text
http://localhost:3100/api/organizations/<organizationSlug>/mcp
```

Organization `admin` 또는 `owner`는 같은 화면에서 MCP 전용 Agent token을 생성한다. 생성된 원문을 복사해 Agent Studio MCP registry entry의 `Authorization` header에 저장하라. 이후 `Token 보기`로 원문을 다시 확인하고 `Token 숨기기`로 화면에서 제거할 수 있다.

```http
Authorization: Bearer <amt_token>
```

Agent token은 발급자에게 귀속되는 organization service principal로 동작한다. Organization scope만 검색·변경할 수 있으며 user scope, team scope, 개별 access grant에는 접근하지 못한다. 사용자·팀 범위가 필요한 MCP client는 해당 사용자의 Better Auth Bearer token을 사용하라.

MCP에서 제공하는 tool은 다음과 같다.

- `context_search`
- `recall`
- `memory_search`
- `memory_create`
- `document_search`
- `knowledge_search`
- `knowledge_neighborhood`

Agent Studio에서 version의 `memoryRecall`을 켜면 실행 전 `recall`을 호출해 관련 Context를 system prompt에 넣는다. 이 응답은 전체 4,000자로 제한되며 reranker가 활성화된 배포에서는 통합 순위를 사용한다. Reranker가 실패해도 권한이 적용된 hybrid 결과로 복귀한다.

재생성은 이전 token을 즉시 무효화하며 폐기하면 연결된 Agent가 더 이상 인증되지 않는다. Hash만 저장된 기존 token은 한 번 재생성해야 `Token 보기`를 사용할 수 있다. Token lifecycle과 MCP client 설정 예시는 [HTTP API와 MCP](api.md#조직-agent-token)를 따른다.
