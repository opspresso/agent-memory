# 사용자 가이드

운영 콘솔은 조직의 Memory, RAG 문서, Knowledge Graph를 검색하고 관리하는 화면이다. 좌측 메뉴에서 `통합 검색`, `Memory`, `문서 수집`, `Knowledge Graph`, `AI 후보 검토`, `Agent 연결`으로 이동하고, 조직 `admin`·`owner`에게는 `회원`, `팀`, `설정` 관리 메뉴가, team `manager`에게는 `팀` 메뉴가 추가로 표시된다. 모든 화면은 로그인 사용자와 활성 조직의 멤버십·scope 권한을 적용한다. 같은 내용을 사이트에서 읽으려면 로그인 전후에 `/guide`를 열거나 좌측 메뉴 하단의 `가이드`를 선택하라.

## 최초 로그인과 가입 요청

설치마다 하나의 조직이 자동으로 준비된다. Active owner가 없을 때 전역 admin(`ADMIN_EMAILS`)이 콘솔에 접속하면 최초 owner가 설정된다. 그 외 신규 사용자는 첫 콘솔 접속 시 가입 요청이 접수되며 승인 대기 상태가 된다. 승인 대기 중에는 조직의 지식 API를 사용할 수 없으며, 관리자가 `회원`에서 승인하면 활성화된다. 승인 후 콘솔을 새로고침해 이용하라. 차단·제거된 사용자는 로그인으로 접근 권한이 복구되지 않는다.

## 설치 조직과 권한

상단에는 설치의 조직 이름이 표시된다. 조직 선택·생성·삭제 기능은 제공하지 않는다. 팀·개인 공유 범위와 역할에 따른 권한은 그대로 적용한다.

Resource scope의 기본 권한은 다음과 같다. 모든 접근에는 활성 멤버십이 필요하다.

| Scope | 읽기 | 쓰기 | 관리 |
| --- | --- | --- | --- |
| organization | 조직 멤버 | `admin`, `owner` | `admin`, `owner` |
| team | 팀 멤버, 조직 관리자 | 팀 멤버, 조직 관리자 | team `manager`, 조직 관리자 |
| user | 본인 | 본인 | 본인 |

Memory는 HTTP API의 `accessGrants`로 같은 조직의 사용자·팀에 추가 읽기·쓰기·관리 권한을 부여할 수 있다. 명시적 grant가 없다면 관리자가 다른 사용자의 개인 자료를 볼 수 없다. 읽을 수 없는 resource는 검색과 관계 지도에 나타나지 않는다. 권한을 잃거나 source가 archive·만료되면 이전에 보이던 Knowledge Graph 관계도 더 이상 반환되지 않을 수 있다.

## 통합 검색

`통합 검색`에서 검색 대상을 선택한다.

- `모든 지식` / `All knowledge`: Memory, document chunk, Knowledge node를 하나의 순위로 결합한다.
- `Memory`: 활성 상태이고 현재 유효한 Memory만 검색한다.
- `Documents`: 처리가 완료된 `ready` document chunk만 검색한다.
- `Graph`: 읽을 수 있는 provenance를 가진 Knowledge node만 검색한다.

검색 결과는 목록과 상세 패널로 구성된다. 목록에서 제목·요약·종류·공유 범위를 확인하고 항목을 선택하면 전체 내용과 원문 근거를 읽는다. Memory 상세는 읽기 권한이 있는 모든 사용자에게 열리며 수정과 이력 조회 권한은 별도로 적용한다. 문서 결과는 원문 본문과 문서 상세로, Knowledge 결과는 근거와 관계 지도로 이어진다. 관계 지도를 닫으면 기존 검색 목록으로 돌아온다.

검색어와 종류는 URL에 보존되어 링크 공유와 뒤로·앞으로 이동에 사용할 수 있다. 처음 방문한 상태와 검색 결과가 없는 상태는 서로 다른 안내를 제공한다. 모바일에서는 목록과 선택한 상세를 전환하고 `목록으로 돌아가기`로 탐색을 이어간다.

Knowledge·문서 상세의 `검색 진단 정보`를 펼치면 상대 관련도와 lexical·vector score를 확인한다. 상대 관련도는 현재 결과 집합에서 가장 높은 최종 score를 100%로 정규화한 표시이며 정확도나 신뢰 확률이 아니다. Reranker가 설정되면 reranker relevance, 그렇지 않거나 provider fallback이 발생하면 hybrid score를 사용한다.

## Memory lifecycle

`Memory`에서 현재 유효하고 읽을 수 있는 Memory를 최신순으로 둘러보거나 검색한다. `새 Memory`에서 종류·제목·내용·공유 범위를 입력하면 사용자 출처의 Memory가 생성된다. 기본 범위는 개인이며 조직과 팀 범위는 현재 쓰기 권한에 따라 선택한다.

목록에서 항목을 선택하면 상세 패널의 `내용과 출처`, `수정`, `Version 이력` 탭을 사용한다. 읽기 권한만 있으면 내용과 출처만 표시된다. 상세 URL의 `memory` 값으로 직접 진입할 수 있다.

### Revision 생성

1. 상세의 `수정` 탭에서 title 또는 content를 수정한다.
2. 다음 사용자가 변경 이유를 이해할 수 있도록 `변경 사유`를 입력한다.
3. `Revision 저장`을 선택한다.

저장 요청은 화면을 열 때 받은 현재 version을 `If-Match`로 전송한다. 다른 사용자가 먼저 수정했다면 `409` 충돌을 표시하며 최신 상태를 다시 불러와야 한다.

### Version 이력

`Version 이력`은 최신 version부터 과거 revision을 보여준다. Revision에는 당시의 content, source, 유효기간, access grant, 변경 사용자와 변경 사유가 보존된다. 이력 조회에는 `manage` 권한이 필요하다.

### Archive

`Archive`는 Memory를 삭제하지 않고 새 archived version을 만든다. Archived Memory는 일반 검색과 해당 provenance에 의존하는 Knowledge Graph 결과에서 제외된다.

## 문서 수집

`문서 수집`에서 문서 목록과 상태를 확인한다. `문서 업로드`를 선택하고 공유 범위와 파일을 입력한다. 업로드가 완료되면 해당 문서를 상세 패널에서 선택한다.

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

문서 상세에서 상태와 처리 시도 횟수, 실패 사유를 확인한다. 쓰기 권한이 있으면 `failed` 문서의 재처리를 요청할 수 있다. 재처리 요청 성공은 처리 완료를 뜻하지 않는다. 화면은 실제 상태를 최대 2분 동안 확인하며 비활성 탭에서는 조회를 쉬고, 이후에는 새로고침으로 다시 확인한다. 문서가 `pending`에 머물면 document worker가 실행 중인지 확인한다. 원본은 S3 호환 storage에 있고 검색용 chunk와 상태는 PostgreSQL에 저장된다.

`사용 가능` 문서를 선택하면 상세의 `문서 내용`에서 처리된 원문을 본문 순서대로 읽는다. 한 번에 25개 본문을 불러오며 `본문 더 보기`로 이어서 읽는다. 원본 파일 다운로드가 아니라 검색·Graph에서 사용하는 처리된 원문의 조회다. 다른 문서를 선택하면 이전 본문을 지우고 접근 권한을 다시 확인한다.

문서 삭제는 원본과 provenance를 보존하는 archive다. Archive된 문서는 검색, 상태 조회, retry, AI 후보 검토에서 제외되며 해당 scope의 `manage` 권한이 필요하다.

## Knowledge Graph 탐색

1. `Knowledge Graph`를 열거나 통합 검색에서 `Graph`를 선택한다.
2. entity 이름이나 요약을 검색한다.
3. 검색 결과를 선택하고 상세의 `관계 보기`를 선택한다.
4. 관계 지도에서 node와 방향성 edge를 탐색한다.

관계 지도는 다음 요소를 사용한다.

- 종류별 색상과 연결 수에 따른 크기로 구분한 node
- 관계 방향을 표시하는 화살표
- edge의 predicate label
- node 이름·kind 검색과 종류별 표시 필터, 키보드로 선택할 수 있는 노드 목록
- 확대·축소와 화면 맞춤 제어
- 선택 node의 kind, 이름, summary, 연결 관계와 node·edge별 원문 근거를 보여주는 inspector

Node를 선택하면 해당 node와 직접 연결된 관계가 강조되고 inspector가 바뀐다. inspector의 `이 node 중심으로 탐색`을 선택하면 해당 node를 중심으로 neighborhood를 다시 조회한다. 키보드에서는 node에 focus한 뒤 `Enter` 또는 `Space`로 선택할 수 있다.

Neighborhood가 바뀌면서 node 수가 늘거나 줄 수 있다. 서버는 새 중심에서 접근 가능한 source를 다시 검사하고 제한된 depth·limit 안에서 관계를 반환한다.

Graph node와 edge 삭제에는 해당 scope의 `manage` 권한이 필요하다. Edge를 삭제해도 연결 node와 source는 유지된다. Node를 삭제하면 연결 edge도 함께 삭제되지만 근거인 Memory나 document는 유지된다.

검색 결과에서 같은 scope와 이름을 가진 node가 여러 개 발견되면 kind를 비교한다. 정규화 identity가 같은 신규 node는 자동으로 기존 node에 합쳐진다. Kind가 달라 자동 병합되지 않은 기존 node는 `중복 병합`에서 target을 확인하고 병합 사유를 입력한다. 병합은 provenance와 관계를 보존하며 되돌릴 수 없으므로 같은 실제 entity인지 확인하라.

## AI 후보 검토

Knowledge extraction이 활성화되면 ready document chunk에서 entity와 relationship 후보가 생성된다. 후보는 자동으로 공유 Graph에 들어가지 않는다.

`AI 후보 검토`에서 다음 내용을 확인한다.

- 사용한 extraction model
- source 문서 제목과 실제 chunk 원문
- 제안된 entity의 kind, canonical name, summary
- entity 이름으로 표시된 source–predicate–target 관계와 기존 지식 중복 후보
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

`회원`에서 이름·email과 상태로 조직 회원 목록을 좁혀 확인하고 관리한다.

- 조직 `admin`, `owner`: 멤버 추가, 조직 role 변경, 승인 대기 멤버 승인, 차단·차단 해제, 조직에서 제거, 팀 배정·해제
- `owner` role 부여와 `owner` 멤버 변경·제거는 `owner`만 가능하다. 마지막 owner와 자기 자신은 변경할 수 없다.
- 조직에서 제거하면 팀 소속과 접근 권한은 즉시 해제되지만 user scope의 Memory, Document, Knowledge resource는 보존된다. 관리자가 같은 사용자를 다시 추가하면 기존 user scope를 다시 사용할 수 있다.

`팀`에서 팀을 관리한다.

- 조직 `admin`, `owner`: 팀 생성·이름 변경·삭제, 팀 멤버 관리. 팀 삭제는 team scope의 Memory·문서 record·chunk·Knowledge Graph를 PostgreSQL에서 함께 삭제한다.
- Team `manager`: 자신이 관리하는 팀의 이름 변경, 기존 조직 멤버 배정과 team role 변경, 팀 멤버 제거
- Team `member`: team scope resource 읽기·쓰기

`설정`에서 조직 이름, 기본 팀, Knowledge Graph 온톨로지(검증 모드와 node kind·edge predicate 사전, 빈도 추천·AI 제안 반영)를 관리한다. 전역 admin에게는 env보다 우선하는 애플리케이션 설정도 표시된다. `ALLOWED_EMAIL_DOMAINS`를 비우면 모든 email domain을 허용하고, 각 override의 reset button을 누르면 env fallback으로 되돌린다. 재시작 필요 표시가 있는 설정은 저장 후 모든 instance를 재시작하라. 기본 팀이 설정되면 신규 회원이 활성화될 때 자동으로 해당 팀에 배정된다.

팀을 삭제해도 S3 호환 storage의 문서 원본 object는 자동으로 제거되지 않는다. 원본 삭제가 필요하면 PostgreSQL metadata가 사라지기 전에 대상 object를 식별하거나 운영 환경의 object lifecycle을 따른다.

`ADMIN_EMAILS`의 전역 권한은 최초 owner 준비와 애플리케이션 설정 관리를 허용한다. 기존 조직 안에서는 항상 실제 organization membership과 role을 사용한다.

## Agent 연결

`Agent 연결`에는 현재 사이트 주소에 `/api/mcp`를 붙인 전체 Streamable HTTP MCP endpoint가 표시된다. 조직 slug나 조직 선택 parameter는 사용하지 않는다. `복사`를 선택해 client 설정에 붙여 넣어라.

```text
http://localhost:3100/api/mcp
```

Organization `admin` 또는 `owner`는 같은 화면에서 MCP 전용 Agent token을 생성한다. 생성된 원문을 복사해 Agent Studio MCP registry entry의 `Authorization` header에 저장하라. 이후 `Token 보기`로 원문을 다시 확인하고 `Token 숨기기`로 화면에서 제거할 수 있다.

```http
Authorization: Bearer <amt_token>
```

같은 화면의 `Agent Studio 등록 템플릿`은 Name, URL, Description, Headers의 Key·Value, 선택 입력인 Content 예시를 만든다. 각 항목의 복사 버튼으로 Agent Studio의 `Tools → Register MCP server`에 붙여 넣어라. Name 기본값은 내부 조직 slug를 사용한 `<organizationSlug>-memory`(새 설치는 `default-memory`)이며 필요하면 변경한다. URL은 사이트의 `/api/mcp`로 고정되며 Name을 바꿔도 영향을 받지 않는다. Headers 예시의 `<amt_token>`은 위에서 생성하거나 확인한 실제 token으로 교체한다. 템플릿 자체에는 실제 token을 포함하지 않는다.

Name은 version이 참조하는 registry 식별자다. Description은 모델의 `Connected MCP Servers` 표와 capability 검색에 사용되므로 서버를 사용할 상황과 기능을 설명한다. Content는 콘솔에만 표시되는 운영자 메모이며 모델에 전달되지 않는다. 모델의 정보 저장 조건·응답 규칙은 version의 system prompt 또는 연결한 Skill에 작성하라. 개별 tool의 설명과 입력 schema는 MCP 서버에서 자동으로 읽으므로 Content에 적어도 tool 계약이 바뀌지 않는다.

등록 후 `Test connection`으로 도구 목록 조회를 확인하고 사용할 project의 version에 해당 MCP server를 bind한 뒤 실제 실행을 확인하라. Version의 header override는 registry header보다 우선하므로 token 재생성 시 override도 확인하라.

Agent token만 전달하면 발급자에게 귀속되는 organization service principal로 동작하며 organization scope만 검색·변경할 수 있다. Agent Studio는 로그인 사용자의 `X-User-Email`을 함께 전달하므로 해당 조직의 활성 멤버 권한으로 개인·팀 문서와 허용된 Memory도 검색한다. 다른 client는 실제 사용자의 email을 이 header로 전달하거나 해당 사용자의 Better Auth Bearer token을 사용하라. 조직 Agent token은 조직 내 사용자를 대신할 수 있으므로 사용자 신원을 검증하는 신뢰된 server-side client에만 제공하라. 잘못된 email은 `400`, 활성 멤버가 아닌 email은 `403`으로 거부한다.

MCP에서 제공하는 tool은 다음과 같다.

- `context_search`
- `recall`
- `remember`
- `forget`
- `document_search`
- `knowledge_search`
- `knowledge_neighborhood`

Agent Studio에서 version에 서버를 직접 bind하고 `memoryRecall`을 켜면 실행 전 `recall`을 호출해 관련 Memory를 system prompt에 넣는다. Binding의 도구 선택에서 `recall`을 허용해야 하며 dynamic discovery만으로 추가된 서버는 자동 회상 대상이 아니다. `remembered` text는 전체 4,000자로 제한된다. 서비스는 `remember`로 기억을 저장하고, `recall` 결과의 Memory ID·version을 `forget`에 전달해 기억을 archive한다. 잊기에는 해당 Memory의 manage 권한이 필요하다. Memory 회상에도 설정된 reranker를 적용하며 실패하면 hybrid 순위로 복귀한다. RAG·Graph를 포함한 통합 검색은 `context_search`를 사용한다.

재생성은 이전 token을 즉시 무효화하며 폐기하면 연결된 Agent가 더 이상 인증되지 않는다. Hash만 저장된 기존 token은 한 번 재생성해야 `Token 보기`를 사용할 수 있다. Token lifecycle과 MCP client 설정 예시는 [HTTP API와 MCP](api.md#조직-agent-token)를 따른다.
