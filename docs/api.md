# HTTP API와 MCP

## 인증과 요청 경계

`/api/health`를 제외한 API는 Better Auth 인증이 필요하다. 브라우저는 session cookie를 사용하고 Agent는 Better Auth 로그인 응답의 `set-auth-token` header 값을 다음과 같이 전달한다.

```http
Authorization: Bearer <token>
```

조직 endpoint는 URL의 `organizationId`에 대한 멤버십을 추가로 확인한다. 브라우저 mutation은 trusted same-origin 요청만 허용하며 Bearer 요청에는 origin 검사를 적용하지 않는다.

인증은 `ALLOWED_EMAIL_DOMAINS`에 설정한 email domain으로 제한한다. `POST /api/organizations`는 `ADMIN_EMAILS`에 설정한 사용자만 호출할 수 있으며, 생성자는 새 조직의 owner가 된다. 이 전역 bootstrap 권한은 기존 조직의 멤버십이나 role을 대체하지 않는다.

모든 JSON validation error는 `400`, 인증 실패는 `401`, 권한 부족은 `403`을 반환한다. 존재하지 않거나 읽을 수 없는 resource는 정보 노출을 막기 위해 `404`가 될 수 있다.

## Endpoint

| Method | Path | 역할 |
| --- | --- | --- |
| `GET` | `/api/health` | Database readiness 확인 |
| `GET`, `POST` | `/api/auth/*` | Better Auth 인증 endpoint |
| `GET`, `POST` | `/api/organizations` | 접근 가능한 조직 조회, 전역 admin의 조직 생성 |
| `GET` | `/api/organizations/:organizationId/me` | 현재 멤버십과 팀 역할 조회 |
| `GET`, `PUT` | `/api/organizations/:organizationId/members` | 조직 멤버 조회·추가·역할 변경 |
| `GET`, `POST` | `/api/organizations/:organizationId/teams` | 팀 조회·생성 |
| `PUT` | `/api/organizations/:organizationId/teams/:teamId/members` | 기존 조직 멤버를 팀에 추가·역할 변경 |
| `GET`, `POST` | `/api/organizations/:organizationId/memories` | Memory 검색·생성 |
| `GET`, `PATCH`, `DELETE` | `/api/organizations/:organizationId/memories/:memoryId` | Memory 조회·수정·archive |
| `GET` | `/api/organizations/:organizationId/memories/:memoryId/versions` | Memory revision 조회 |
| `GET`, `POST` | `/api/organizations/:organizationId/documents` | 문서 chunk 검색·원본 업로드 |
| `GET` | `/api/organizations/:organizationId/documents/:documentId` | 문서 상태 조회 |
| `POST` | `/api/organizations/:organizationId/documents/:documentId/retry` | 실패한 문서 처리 재시도 |
| `GET`, `POST` | `/api/organizations/:organizationId/knowledge/nodes` | Knowledge node 검색·생성 |
| `POST` | `/api/organizations/:organizationId/knowledge/edges` | Knowledge edge 생성 |
| `GET` | `/api/organizations/:organizationId/knowledge/nodes/:nodeId/neighborhood` | 제한된 graph neighborhood 조회 |
| `GET` | `/api/organizations/:organizationId/knowledge/candidates` | 검토 대기 중인 AI graph 후보 조회 |
| `POST` | `/api/organizations/:organizationId/knowledge/candidates/:candidateId/accept` | AI 후보를 Knowledge Graph로 승격 |
| `POST` | `/api/organizations/:organizationId/knowledge/candidates/:candidateId/reject` | AI 후보 거절 |
| `GET` | `/api/organizations/:organizationId/context/search` | 통합 Context 검색 |
| `GET`, `POST`, `DELETE` | `/api/organizations/:organizationId/mcp` | Streamable HTTP MCP transport |

## 조직 관리 입력

- 조직 생성: `{ "slug": string, "name": string }`
- 조직 멤버 추가·변경: `{ "email": string, "role": "member" | "admin" | "owner" }`
- 팀 생성: `{ "slug": string, "name": string }`
- 팀 멤버 추가·변경: `{ "email": string, "role": "member" | "manager" }`

`slug`는 63자 이하의 소문자 영숫자와 단일 hyphen 구분 형식을 사용한다. 멤버·팀 관리는 organization `admin` 또는 `owner`가 수행하고, team `manager`는 자신이 관리하는 팀에 기존 조직 멤버를 배정할 수 있다.

## Memory

`POST .../memories`는 다음 JSON을 받는다.

```json
{
  "kind": "rule",
  "scope": { "kind": "team", "teamId": "00000000-0000-0000-0000-000000000000" },
  "title": "배포 규칙",
  "content": "운영 배포 전에 smoke test를 실행한다.",
  "source": { "type": "user" },
  "accessGrants": [],
  "validFrom": "2026-08-26T00:00:00+09:00"
}
```

- `kind`: `rule`, `experience`, `decision`, `preference`, `fact`
- `scope`: `organization`, `team`, `user`. user scope에서 `userId`를 생략하면 인증 사용자를 사용한다.
- `title`: 1–500자, `content`: 1–100,000자
- `source.type`: `agent`, `user`, `document`, `system`
- `accessGrants`: 최대 100개의 고유 team 또는 user principal과 `read`, `write`, `manage` 권한
- `validFrom`, `expiresAt`: offset을 포함한 ISO 8601 datetime

검색은 `GET .../memories?q=<query>&limit=<1-100>`을 사용하며 기본 limit은 10이다. 수정할 필드가 하나 이상인 JSON을 `PATCH`로 보내고 현재 응답의 `ETag` version을 `If-Match` header에 전달하라. Archive도 `DELETE`와 `If-Match`를 사용하며 선택형 `reason` query는 1,000자 이하다. Header가 없거나 잘못되면 `428`, version이 충돌하면 `409`를 반환한다.

HTTP의 Memory 조회·검색 응답은 호출자 기준 `capabilities.write`와 `capabilities.manage`를 포함한다. `accessGrants`는 `manage` 권한이 있는 호출자에게만 노출한다.

Revision은 `GET .../versions?limit=<1-100>&before=<version>`으로 역순 조회한다. 기본 limit은 50이며 `manage` 권한이 필요하다.

## 문서

`POST .../documents`는 `multipart/form-data`를 받는다.

| Field | 필수 | 설명 |
| --- | --- | --- |
| `file` | 예 | 10 MiB 이하의 비어 있지 않은 원본 |
| `scopeKind` | 예 | `organization`, `team`, `user` |
| `title` | 아니요 | 생략하면 파일 이름 사용, 최대 500자 |
| `teamId` | team scope | Team UUID |
| `userId` | 아니요 | user scope에서 생략하면 인증 사용자 사용 |
| `sourceUri` | 아니요 | 원본 URI, 최대 2,048자 |
| `metadata` | 아니요 | JSON object 문자열, 최대 32 KiB |

지원 MIME type은 `text/plain`, `text/markdown`, `text/csv`, `application/json`, `application/xml`, `text/xml`이다. 서버는 `Content-Length`와 실제 request stream을 모두 제한한다. 업로드는 `202`와 상태 조회용 `Location`을 반환한다. Queue 등록에 실패해도 저장된 document ID와 `failed` 상태를 반환하므로 같은 ID로 retry할 수 있다. 검색은 `GET .../documents?q=<query>&limit=<1-100>`을 사용하고 `ready` 상태의 접근 가능한 chunk만 반환한다. `failed` 문서만 retry할 수 있다.

## Knowledge Graph

Node 생성 입력은 `scope`, `kind`, `canonicalName`, `source`와 선택형 `summary`, `properties`다. Edge 생성 입력은 `scope`, `sourceNodeId`, `targetNodeId`, `predicate`, `source`와 선택형 `properties`다.

생성 요청의 `source`는 `{ "memoryId": UUID }` 또는 `{ "chunkId": UUID }` 중 정확히 하나만 포함한다. 호출자는 source를 읽을 수 있어야 하며 graph resource를 source보다 넓은 scope로 만들 수 없다. Canonical node·edge는 여러 근거를 누적하며 응답의 `sources` 배열로 반환한다. 각 배열 항목은 정확히 하나의 Memory 또는 document chunk를 참조한다.

검색은 `GET .../knowledge/nodes?q=<query>&limit=<1-100>`을 사용한다. Neighborhood는 `depth=1-5`, `limit=1-200`을 받으며 기본값은 각각 1과 100이다. 두 조회는 호출자가 현재 읽을 수 있고 active·유효한 Memory 또는 ready document chunk 근거가 하나 이상 있는 graph resource만 반환한다.

Knowledge extraction을 활성화하면 ready 문서의 각 chunk에서 entity와 relationship candidate를 만든다. Candidate는 source document·chunk, 원래 scope, extraction model을 포함하며 원문 content를 응답하지 않는다.

- `GET .../knowledge/candidates?limit=<1-100>`은 pending candidate를 오래된 순으로 반환하며 기본 limit은 50이다.
- 후보 조회와 승인은 source scope의 `manage` 권한을 따른다. Organization scope는 `admin`·`owner`, team scope는 team `manager` 이상, user scope는 본인만 검토한다.
- `POST .../accept`와 `POST .../reject` body는 선택형 `{ "reason": string }`을 받으며 reason은 2,000자 이하다.
- 승인은 node·edge와 reviewer audit을 하나의 transaction으로 저장한다. 이미 거절된 후보를 승인하거나 승인된 후보를 거절하면 `409`를 반환한다.

## 통합 Context 검색

`GET .../context/search?q=<query>&limit=<1-100>`은 접근 가능한 memory, document chunk, knowledge node를 검색해 하나의 순위 결과로 반환한다. 기본 limit은 10이다.

## MCP

Streamable HTTP endpoint는 `/api/organizations/:organizationId/mcp`다. HTTP API와 같은 Bearer 인증과 조직 권한을 사용한다.

| Tool | 역할 | 주요 입력 |
| --- | --- | --- |
| `context_search` | 전체 Context 통합 검색 | `query`, `limit?` |
| `memory_search` | Memory 검색 | `query`, `limit?` |
| `memory_create` | Scoped memory 생성 | Memory 생성 입력 |
| `document_search` | 처리된 문서 chunk 검색 | `query`, `limit?` |
| `knowledge_search` | Knowledge node 검색 | `query`, `limit?` |
| `knowledge_neighborhood` | Graph neighborhood 조회 | `nodeId`, `depth?`, `limit?` |

검색 query는 1–10,000자, limit은 1–100이며 기본값은 10이다. `knowledge_neighborhood`의 depth와 limit은 HTTP API와 같은 제한을 사용한다.
