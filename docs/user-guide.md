# 사용자 가이드

운영 콘솔은 조직의 Memory, RAG 문서, Knowledge Graph를 검색하고 관리하는 화면이다. 모든 화면은 로그인 사용자와 활성 조직의 멤버십·scope 권한을 적용한다. 같은 내용을 사이트에서 읽으려면 로그인 전후에 `/guide`를 열거나 상단의 `Guide`를 선택하라.

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

상대 관련도는 현재 결과 집합에서 가장 높은 score를 100%로 정규화한 표시다. 서로 다른 검색 요청의 절대 품질을 비교하는 값으로 사용하지 마라.

## Memory lifecycle

Memory 검색 결과에서 `Lifecycle`을 선택하면 전체 화면 관리 창이 열린다.

### Revision 생성

1. title 또는 content를 수정한다.
2. 다음 사용자가 변경 이유를 이해할 수 있도록 `변경 사유`를 입력한다.
3. `Revision 저장`을 선택한다.

저장 요청은 화면을 열 때 받은 현재 version을 `If-Match`로 전송한다. 다른 사용자가 먼저 수정했다면 `409` 충돌을 표시하며 최신 상태를 다시 불러와야 한다.

### Version 이력

`Version spine`은 최신 version부터 과거 revision을 보여준다. Revision에는 당시의 content, source, 유효기간, access grant, 변경 사용자와 변경 사유가 보존된다. 이력 조회에는 `manage` 권한이 필요하다.

### Archive

`Archive`는 Memory를 삭제하지 않고 새 archived version을 만든다. Archived Memory는 일반 검색과 해당 provenance에 의존하는 Knowledge Graph 결과에서 제외된다.

## 문서 수집

`문서 수집`에서 공유 범위를 선택하고 문서를 업로드한다.

- user scope: 본인만 선택할 수 있다.
- team scope: 해당 팀 멤버와 조직 `admin`·`owner`가 선택할 수 있다. 먼저 공유할 팀을 선택하라.
- organization scope: 조직 `admin`·`owner`만 선택할 수 있다.

- 지원 형식: UTF-8 text, Markdown, CSV, JSON, XML
- 최대 원본 크기: 10 MiB
- title을 생략하면 파일 이름을 사용한다.

처리 흐름은 다음과 같다.

```text
upload → pending → processing → ready
                         └──→ failed → retry
```

문서가 `pending`에 머물면 document worker가 실행 중인지 확인한다. `failed`이면 공개 처리 오류를 확인하고 `다시 처리`를 실행한다. 원본은 S3 호환 storage에 있고 검색용 chunk와 상태는 PostgreSQL에 저장된다.

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

`조직 관리`에서 조직 멤버와 팀을 관리한다.

- 조직 `admin`, `owner`: 멤버 추가와 조직 role 변경, 팀 생성
- Team `manager`: 기존 조직 멤버를 자신이 관리하는 팀에 배정하고 team role 변경
- Team `member`: team scope resource 읽기·쓰기

`ADMIN_EMAILS`의 전역 bootstrap 권한은 새 조직 생성만 허용한다. 기존 조직 안에서는 항상 실제 organization membership과 role을 사용한다.

## Agent 연결

`Agent 연결`에는 현재 사이트 주소와 활성 조직 ID가 포함된 전체 Streamable HTTP MCP endpoint가 표시된다. `복사`를 선택해 client 설정에 붙여 넣어라.

```text
http://localhost:3100/api/organizations/<organizationId>/mcp
```

Agent는 Better Auth 로그인 응답의 `set-auth-token` 값을 Bearer token으로 전달해야 한다.

```http
Authorization: Bearer <token>
```

MCP에서 제공하는 tool은 다음과 같다.

- `context_search`
- `memory_search`
- `memory_create`
- `document_search`
- `knowledge_search`
- `knowledge_neighborhood`

Token 획득과 MCP client 설정 예시는 [HTTP API와 MCP](api.md#agent-bearer-인증)를 따른다.
