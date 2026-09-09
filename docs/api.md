# HTTP API와 MCP

Agent Memory는 MCP로 Memory 저장·회상·잊기를 제공하며, HTTP API로 Memory·RAG 문서·Knowledge Graph와 조직 설정을 관리한다. 이 문서는 현재 route, 입력 schema, 공개 응답의 계약을 설명한다.

| 찾는 계약 | 위치 |
| --- | --- |
| 인증·가입·token·오류 | [인증과 요청 경계](#인증과-요청-경계) |
| HTTP 경로 전체 목록 | [Endpoint](#endpoint) |
| Memory·문서·Graph CRUD | [Memory](#memory), [문서](#문서), [Knowledge Graph](#knowledge-graph) |
| 통합 검색·reranker | [통합 Context 검색](#통합-context-검색) |
| 서비스의 기억 lifecycle | [MCP](#mcp) |
| 콘솔 목록·원문 페이지 조회 | [Workspace library reads](#workspace-library-reads) |

모든 예시는 local base URL을 사용한다. `<memoryId>`, `<nodeId>`와 token은 실제 값으로 바꿔라.

```bash
export AGENT_MEMORY_URL=http://localhost:3100
export AGENT_MEMORY_TOKEN='<better-auth-session-token>'
```

## 인증과 요청 경계

Better Auth의 `advanced.cookiePrefix`는 `agent-memory`다. 세션 쿠키는
`agent-memory.session_token`이며 HTTPS 설정에서는 `__Secure-`가 붙는다. Studio의
`agent-studio` 쿠키와 분리하며 이전 `better-auth` 쿠키를 인증에 사용하지 않는다.
접두어 변경 배포 후 브라우저 사용자는 다시 로그인해야 한다.

인증 방식과 사용할 수 있는 endpoint는 다음과 같다.

| 인증 | 사용 범위 | 권한 주체 |
| --- | --- | --- |
| Better Auth session cookie | 조직 HTTP API와 MCP | 로그인 사용자 |
| Better Auth session Bearer | 조직 HTTP API와 MCP | 로그인 사용자 |
| 조직 Agent Bearer(`amt_...`) | `/api/mcp`만 | Organization service principal 또는 위임 사용자 |
| `METRICS_BEARER_TOKEN` | `/api/metrics`만 | 지표 조회 전용 |

`/api/auth/*`는 Better Auth의 로그인·가입·provider 흐름을 처리한다. Agent가 일반 HTTP API를 호출하려면 Better Auth 로그인 응답의 `set-auth-token` 값을 전달한다.

```http
Authorization: Bearer <token>
```

### 브라우저 session

운영 콘솔의 로그인·가입 요청은 `/api/auth/*` Better Auth endpoint를 사용한다. 조직 HTTP API의 POST, PUT, PATCH, DELETE 요청은 session cookie뿐 아니라 trusted origin 조건을 만족해야 한다. `Origin`은 요청 URL의 origin 또는 `BETTER_AUTH_URL`의 origin과 일치해야 한다. Bearer 인증 요청은 cookie를 인증에 사용하지 않으며 이 origin 검사를 생략한다.

모든 응답은 `Content-Security-Policy: frame-ancestors 'none'`과 `X-Frame-Options: DENY`로 framing을 금지하며, MIME sniffing 방지, 제한된 referrer, camera·microphone·geolocation 비활성화 header를 함께 반환한다.

### Session Bearer 인증

Password provider가 활성화된 환경에서는 Better Auth email 로그인 응답 header에서 token을 얻을 수 있다.

```bash
curl -i \
  -X POST "$AGENT_MEMORY_URL/api/auth/sign-in/email" \
  -H 'Content-Type: application/json' \
  -H "Origin: $AGENT_MEMORY_URL" \
  --data '{
    "email": "agent@example.com",
    "password": "replace-with-password"
  }'
```

성공 응답의 `set-auth-token` header 값을 저장하고 이후 요청에 사용하라. Token을 source code, shell history, log 또는 MCP 설정 repository에 넣지 마라. 운영 환경에서는 secret manager를 사용하라.

### 가입 승인과 설치 조직

`ALLOWED_EMAIL_DOMAINS`가 미설정 또는 빈 값이면 모든 email domain으로 로그인할 수 있다. 목록을 설정하면 인증을 해당 email domain으로 제한한다. 서버가 설치 조직을 준비하며 active owner가 없을 때 `ADMIN_EMAILS` 사용자가 콘솔에 접속하면 최초 owner를 설정한다. 그 외 신규 사용자는 첫 콘솔 접속 시 가입 요청이 접수되며 운영자 승인 전까지 pending 상태다. 전역 admin 권한은 조직의 멤버십이나 role을 대체하지 않는다. 조직 생성·가입·삭제 API는 제공하지 않는다.

가입 요청 후 운영자 승인을 받은 사용자는 다음 요청으로 설치 조직을 확인한다. 최초 owner 준비는 [시작 가이드](getting-started.md#3-최초-운영자-준비와-가입-요청)를 따른다. 로그인 API만 호출하면 가입 요청이 접수되지 않으므로 먼저 브라우저에서 콘솔에 접속하라.

```bash
curl \
  -H "Authorization: Bearer $AGENT_MEMORY_TOKEN" \
  "$AGENT_MEMORY_URL/api/organization"
```

일반 활성 멤버의 응답 형식은 다음과 같다.

```json
{
  "id": "00000000-0000-0000-0000-000000000000",
  "slug": "default",
  "name": "Agent Memory",
  "createdAt": "2026-09-08T00:00:00.000Z"
}
```

`admin`·`owner`에게는 `defaultTeamId`, `ontologyMode`, `ontology` 설정도 반환한다. 조직 목록·멤버십 응답이 아니므로 `organizations`, `count`, `role`, `status`는 포함하지 않는다. `active` membership만 이 endpoint와 조직 resource에 접근할 수 있으며, 승인 대기·차단·제거된 사용자는 `403`을 받는다.

현재 role과 team membership은 `GET /api/me`로 확인한다. 응답은 `{ organizationId, role, teams, user }`다.

- `teams`: `{ teamId, role: "member" | "manager" }` 배열
- `user`: `{ id, email, name, image: string | null, isAdmin: boolean }`

`user.isAdmin`은 전역 애플리케이션 설정 권한이며 조직 `role`과 독립적이다.

모든 resource endpoint는 서버가 설치 조직을 결정하고 인증 사용자의 멤버십을 확인한다. URL·body·header의 tenant 식별자로 대상 조직을 선택할 수 없다. 브라우저 mutation은 trusted same-origin 요청만 허용하며 Bearer 요청에는 origin 검사를 적용하지 않는다. 조직 UUID는 내부 resource scope와 공개 응답에서 유지한다.

### 조직 Agent token

Organization `admin` 또는 `owner`는 `Agent 연결` 화면이나 `POST /api/agent-token`에서 MCP 전용 token을 생성할 수 있다. DB에는 검증용 SHA-256 hash와 reveal용 AES-256-GCM 암호문을 저장한다. 암호화 key는 `BETTER_AUTH_SECRET`에서 HKDF로 용도 분리해 파생한다. 같은 조직에서 다시 생성하면 기존 token은 즉시 무효화된다. 생성 성공은 `201`과 아래 JSON, `DELETE /api/agent-token` 폐기 성공은 `204`와 빈 본문이다.

```json
{
  "token": "amt_...",
  "masked": "amt_••••1234",
  "createdAt": "2026-08-31T00:00:00.000Z"
}
```

일상적인 `GET .../agent-token` 응답은 `configured` 여부와 함께 mask, 생성 시각, `revealable` 상태만 반환하며, token이 없으면 `{ "configured": false }`만 반환한다. 원문은 생성 응답과 명시적인 `POST .../agent-token/reveal`에서만 반환하며 두 응답 모두 `Cache-Control: no-store`다. 암호문 column이 없는 기존 hash-only token은 MCP 인증은 유지하지만 reveal할 수 없으므로 한 번 재생성해야 한다.

이 token은 설치의 `/api/mcp`에서만 인증되며 일반 HTTP API에서는 사용할 수 없다. Token 발급자가 현재 active `admin` 또는 `owner`인지 확인한 뒤 `X-User-Email`이 없으면 organization scope만 접근할 수 있는 service principal을 적용한다. 유효한 token과 함께 전달된 `X-User-Email`은 설치 조직의 활성 사용자 권한으로 위임한다. 상세 검증과 신뢰 경계는 MCP 절을 따른다. 발급자가 차단·제거·강등되면 다음 요청부터 인증이 거부된다. `BETTER_AUTH_SECRET`을 변경하면 기존 token은 hash 검증으로 계속 인증되지만 원문을 복호화할 수 없으므로 재생성해야 한다.

### Readiness와 지표

- `GET /api/health`: 인증 없이 DB readiness를 확인한다. 성공은 `200` `{ "status": "ok", "checks": { "database": "ok" } }`, DB 실패는 `503` `{ "status": "unavailable", "checks": { "database": "failed" } }`다. 두 응답 모두 `Cache-Control: no-store`다. Object storage·AI provider 상태는 검사하지 않는다.
- `GET /api/metrics`: `METRICS_BEARER_TOKEN`이 없거나 Bearer가 일치하지 않으면 `404`다. 성공하면 Prometheus text exposition format으로 build·process 지표를 반환한다.

### 전역 애플리케이션 설정

- `GET /api/settings/runtime`: 전역 admin에게 env, Database override, 기본값 중 유효한 설정과 source를 반환한다. Secret은 마스킹한다.
- `PUT /api/settings/runtime`: `values`의 항목을 Database override로 저장하고 `reset`의 항목은 env fallback으로 되돌린다. `ADMIN_EMAILS`에서 요청자 자신을 제거하거나 `ALLOWED_EMAIL_DOMAINS`에서 요청자의 domain을 제외하는 변경은 거부한다.

요청 예시는 다음과 같다.

```json
{
  "values": {
    "ALLOWED_EMAIL_DOMAINS": "",
    "ADMIN_EMAILS": "admin@example.com"
  },
  "reset": ["RERANKER_MODEL"]
}
```

`ALLOWED_EMAIL_DOMAINS`의 빈 문자열은 명시적인 무제한 override다. Override 삭제는 빈 문자열 대신 `reset`을 사용한다.

저장 시 서버 시작과 동일한 runtime 검증을 수행하며 모든 로그인 수단을 비활성화하는 변경은 거부한다. AI endpoint 변경에는 해당 API key의 명시적 입력·제거 또는 env 쌍으로의 reset이 필요하다. 마스킹된 key를 재전송하는 것은 새 endpoint에 대한 credential 입력으로 인정하지 않는다.

### HTTP 오류와 요청 크기

JSON body를 읽는 조직 API는 UTF-8 JSON을 요구하며 전체 body를 1 MiB로 제한한다. Multipart 문서 업로드의 별도 제한은 [문서](#문서)를 따른다. MCP transport의 오류와 도구 오류는 [MCP](#mcp)를 따른다.

오류 응답은 기본적으로 `{ "error": string }`이며 schema validation 오류는 `issues`를 추가할 수 있다.

| Status | 의미 |
| --- | --- |
| `400` | JSON, UUID, query 또는 입력 schema가 잘못됨 |
| `401` | Session 또는 Bearer 인증 실패 |
| `403` | 조직 멤버십·resource action 권한 부족 또는 브라우저 mutation의 origin 검증 실패 |
| `404` | Resource가 없거나 호출자에게 존재를 공개할 수 없음 |
| `409` | Memory version, 문서 retry·candidate review 상태, 중복 membership·팀 slug, owner·자기 관리 제약 또는 Agent token reveal 충돌 |
| `413` | JSON body가 1 MiB를 초과하거나 문서 upload request·파일이 제한을 초과함 |
| `422` | 조직 온톨로지 검증(strict)에서 미등록 kind·predicate를 거부함. 응답에 `violations` 배열 포함 |
| `428` | Memory mutation에 유효한 `If-Match`가 없음 |
| `429` | Instance 또는 PostgreSQL organization·user AI provider 호출 상한, document storage·processing backlog·사용자 upload rate quota를 초과함 |
| `503` | Health check에서 Database를 사용할 수 없거나, AI 모델 미구성 상태에서 온톨로지 AI 추천을 호출함 |

AI 호출 quota의 `429`는 초 단위 `Retry-After` header를 포함한다. 문서 storage·backlog·upload quota의 `429`에는 이 header가 없다. Reranker 호출 실패·quota 초과는 hybrid 순위로 복귀한다.

## Endpoint

| Method | Path | 역할 |
| --- | --- | --- |
| `GET` | `/api/health` | Database readiness 확인 |
| `GET` | `/api/metrics` | `METRICS_BEARER_TOKEN`으로 보호된 Prometheus process·build 지표 조회 |
| `GET`, `POST` | `/api/auth/*` | Better Auth 인증 endpoint |
| `GET`, `PATCH` | `/api/organization` | 설치 조직 조회, 설정 변경(admin·owner) |
| `GET`, `PUT` | `/api/settings/runtime` | 애플리케이션 설정 조회·override 변경(전역 admin) |
| `GET` | `/api/me` | 현재 멤버십과 팀 역할 조회 |
| `GET`, `POST`, `DELETE` | `/api/agent-token` | MCP 전용 Agent token 상태 조회·생성·폐기(admin·owner) |
| `POST` | `/api/agent-token/reveal` | 저장된 MCP Agent token 원문 조회(admin·owner) |
| `GET`, `POST` | `/api/members` | 조직 멤버 조회·추가 |
| `PATCH`, `DELETE` | `/api/members/:userId` | 멤버 role·status 변경, 멤버 제거 |
| `GET`, `POST` | `/api/teams` | 팀 조회·생성 |
| `PATCH` | `/api/teams/:teamId` | 팀 이름 변경(team manager·조직 admin·owner) |
| `DELETE` | `/api/teams/:teamId` | 팀 삭제(조직 admin·owner) |
| `GET`, `PUT` | `/api/teams/:teamId/members` | 팀 멤버 조회, 기존 조직 멤버를 팀에 추가·역할 변경 |
| `DELETE` | `/api/teams/:teamId/members/:userId` | 팀 멤버 제거 |
| `GET`, `POST` | `/api/memories` | Memory 검색·생성 |
| `GET` | `/api/memories/library` | 현재 유효하고 읽을 수 있는 Memory 목록 |
| `GET`, `PATCH`, `DELETE` | `/api/memories/:memoryId` | Memory 조회·수정·archive |
| `GET` | `/api/memories/:memoryId/versions` | Memory revision 조회 |
| `GET`, `POST` | `/api/documents` | 문서 chunk 검색·원본 업로드 |
| `GET` | `/api/documents/library` | 문서 목록과 처리 상태 |
| `GET`, `DELETE` | `/api/documents/:documentId` | 문서 상태 조회·archive |
| `POST` | `/api/documents/:documentId/retry` | 실패한 문서 처리 재시도 |
| `GET` | `/api/documents/:documentId/chunks` | 처리된 문서 본문을 순서대로 페이지 조회 |
| `GET` | `/api/document-chunks/:chunkId` | 현재 읽을 수 있는 원문 근거 조회 |
| `GET`, `POST` | `/api/knowledge/nodes` | Knowledge node 검색·생성 |
| `POST` | `/api/knowledge/edges` | Knowledge edge 생성 |
| `DELETE` | `/api/knowledge/nodes/:nodeId` | Knowledge node와 연결 edge 삭제 |
| `POST` | `/api/knowledge/nodes/:nodeId/merge` | 중복 Knowledge node 병합 |
| `DELETE` | `/api/knowledge/edges/:edgeId` | Knowledge edge 삭제 |
| `GET` | `/api/knowledge/nodes/:nodeId/neighborhood` | 제한된 graph neighborhood 조회 |
| `GET` | `/api/knowledge/candidates` | 검토 대기 중인 AI graph 후보 조회 |
| `GET` | `/api/knowledge/candidates/:candidateId/duplicates` | 후보 entity와 canonical name·scope가 같은 기존 node 일괄 조회 |
| `POST` | `/api/knowledge/candidates/:candidateId/accept` | AI 후보를 Knowledge Graph로 승격 |
| `GET` | `/api/knowledge/ontology/recommendations` | 관찰된 용어 기반 온톨로지 추천(admin·owner) |
| `POST` | `/api/knowledge/ontology/suggestions` | AI 모델 기반 온톨로지 정제 제안(admin·owner) |
| `POST` | `/api/knowledge/candidates/:candidateId/reject` | AI 후보 거절 |
| `GET` | `/api/context/search` | 통합 Context 검색 |
| `GET`, `POST`, `DELETE` | `/api/mcp` | Streamable HTTP MCP transport |

## 조직 관리 입력

### 조회와 성공 응답

| 요청 | 권한 | 성공 응답 |
| --- | --- | --- |
| `GET /api/members` | 조직 admin·owner | `200` `{ members, count }` |
| `GET /api/teams` | 활성 조직 멤버 | `200` `{ teams, count }` |
| `GET /api/teams/:teamId/members` | 해당 팀 멤버 또는 조직 admin·owner | `200` `{ members, count }` |
| `POST /api/members`, `POST /api/teams` | 조직 admin·owner | `201`, 생성한 member 또는 team |
| 조직·멤버·팀 `PATCH`, 팀 멤버 `PUT` | 아래 관리 정책 | `200`, 갱신한 resource |
| 멤버·팀·팀 멤버 `DELETE` | 아래 관리 정책 | `204`, 본문 없음 |

`count`는 반환 배열 길이다. Member는 `userId`, `email`, `name`, `role`, `status`, `createdAt`을 포함한다. Team은 `id`, `organizationId`, `slug`, `name`, `createdAt`, `updatedAt`을 포함한다. Team member는 `teamId`, `userId`, `email`, `name`, `role`, `createdAt`을 포함한다.

### 변경 입력

- 조직 설정 변경(`PATCH /api/organization`): `{ "name"?: string, "defaultTeamId"?: UUID | null, "ontologyMode"?: "off" | "warn" | "strict", "ontology"?: { "nodeKinds": string[], "edgePredicates": string[] } }` — 필드 하나 이상 필요. `ontology`는 두 목록 전체를 치환하며 목록당 최대 200개, 용어당 최대 100자다. 용어는 소문자로 정규화하고 중복을 제거해 저장한다.
- 조직 멤버 추가: `{ "email": string, "role": "member" | "admin" | "owner" }` — 이미 존재하는 계정만 운영자가 active 멤버로 추가할 수 있다. 계정이 없으면 `404`, pending·active·blocked 멤버가 이미 있으면 `409`다. Pending 요청 승인과 기존 멤버의 role 변경은 `PATCH /api/members/:userId`를 사용한다. Removed 멤버의 재추가는 허용한다.
- 멤버 변경(`PATCH .../members/:userId`): `{ "role"?: "member" | "admin" | "owner", "status"?: "active" | "pending" | "blocked" }` — 필드 하나 이상 필요
- 팀 생성: `{ "slug": string, "name": string }`
- 팀 이름 변경(`PATCH .../teams/:teamId`): `{ "name": string }`
- 팀 멤버 추가·변경: `{ "email": string, "role": "member" | "manager" }`

팀 `slug`는 63자 이하의 소문자 영숫자와 단일 hyphen 구분 형식을 사용한다. 조직과 팀의 `name`은 1–200자다. 멤버·팀 관리는 organization `admin` 또는 `owner`가 수행하고, team `manager`는 자신이 관리하는 팀에 기존 조직 멤버를 배정하거나 팀 이름을 변경할 수 있다. 팀 삭제와 조직 설정 변경은 `admin`·`owner`만 가능하다. 조직 설정 PATCH는 알 수 없는 필드를 `400`으로 거부한다.

### 멤버십 status와 가입 흐름

- 일반 사용자의 첫 콘솔 접속은 `pending` 가입 요청으로 저장한다. 운영자는 회원 목록에서 요청자를 확인하고 `PATCH /api/members/:userId`에 `{ "status": "active" }`를 보내 승인한다. 로그인 성공이나 허용 email domain만으로 멤버 권한이 부여되지 않는다.
- 조직에 `defaultTeamId`가 설정되어 있으면 멤버가 `active`가 되는 시점(최초 owner 준비, 운영자의 멤버 추가·승인)에 해당 팀의 `member`로 자동 배정한다.
- `owner` role 부여와 `owner` 멤버 변경·제거는 `owner`만 수행할 수 있고, 마지막 active `owner`는 강등·차단·제거할 수 없다(`409`).
- 멤버 제거는 active membership과 team membership을 해제하지만 user scope의 Memory, Document, Knowledge resource는 보존한다. 관리자가 제거된 사용자를 다시 추가하면 같은 membership을 활성화해 기존 user scope 소유권을 복원한다.
- 자기 자신의 role·status 변경과 제거는 허용하지 않는다(`409`).
- `DELETE .../teams/:teamId`는 팀 소속과 team scope의 memory, 문서 metadata, Knowledge Graph를 함께 삭제한다.

팀 삭제는 PostgreSQL resource만 제거하며 S3 호환 storage의 문서 원본 object는 삭제하지 않는다. 운영 환경은 삭제 전에 대상 object를 식별하거나 별도 lifecycle로 관리해야 한다.

## Memory

### 생성과 scope

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
- `source.uri`: 선택형 원본 URI, 1–2,048자
- `source.agentId`: 선택형 생성 Agent 식별자, 1–255자
- `source.metadata`: 선택형 JSON object, 직렬화 기준 최대 32 KiB
- `accessGrants`: 최대 100개의 고유 team 또는 user principal과 `read`, `write`, `manage` 권한
- `validFrom`, `expiresAt`: offset을 포함한 ISO 8601 datetime. `validFrom` 생략 시 서버의 현재 시각이며 `expiresAt`은 `validFrom`보다 뒤여야 한다.

Scope의 기본 쓰기 권한은 organization은 admin·owner, team은 해당 팀 멤버 또는 조직 관리자, user는 본인이다. `accessGrants`를 명시하면 생성도 scope의 `manage` 권한을 요구한다. Team `manage`는 해당 팀 manager 또는 조직 관리자에게 있다.

Grant는 다음 두 형식 중 하나이며 같은 principal을 중복 지정할 수 없다. `manage`는 `write`·`read`를, `write`는 `read`를 포함한다. 생성·수정에서 배열은 전체 grant 목록을 설정하며 `[]`는 명시적 grant를 비운다.

```json
[
  { "principalKind": "user", "userId": "00000000-0000-4000-8000-000000000001", "permission": "read" },
  { "principalKind": "team", "teamId": "00000000-0000-4000-8000-000000000002", "permission": "write" }
]
```

Organization scope Memory 생성 예시는 다음과 같다.

```bash
curl -i \
  -X POST \
  -H "Authorization: Bearer $AGENT_MEMORY_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{
    "kind": "decision",
    "scope": { "kind": "organization" },
    "title": "Checkout rollback policy",
    "content": "Rollback requires two approvers.",
    "source": {
      "type": "agent",
      "agentId": "release-agent",
      "metadata": { "runId": "run-123" }
    }
  }' \
  "$AGENT_MEMORY_URL/api/memories"
```

### 공개 응답

성공하면 `201`, resource URL을 담은 `Location`, 현재 version을 담은 `ETag`와 Memory JSON을 반환한다. 공개 Memory 형식은 다음 필드를 가진다.

```json
{
  "id": "00000000-0000-0000-0000-000000000000",
  "kind": "decision",
  "scope": { "kind": "organization", "organizationId": "..." },
  "title": "Checkout rollback policy",
  "content": "Rollback requires two approvers.",
  "source": { "type": "agent", "agentId": "release-agent" },
  "createdBy": "...",
  "validFrom": "...",
  "status": "active",
  "createdAt": "...",
  "updatedAt": "...",
  "version": 1,
  "capabilities": { "write": true, "manage": true },
  "accessGrants": []
}
```

`expiresAt`, `embeddingModel`은 값이 있을 때만 포함한다. `capabilities`는 호출자 기준으로 계산하고 `accessGrants`는 `manage` 권한이 있을 때만 포함한다.

### 조회와 검색

`GET /api/memories/:memoryId`는 읽을 수 있는 active Memory와 `ETag`를 반환한다. ID 조회는 만료·미래 유효 Memory도 반환할 수 있지만 검색·library·회상은 현재 유효한 Memory만 포함한다. 없는 Memory, archived Memory, 읽을 수 없는 Memory의 ID 조회는 `404`다.

검색은 `GET .../memories?q=<query>&limit=<1-100>`을 사용하며 query는 1–10,000자, 기본 limit은 10이다.

```bash
curl \
  -H "Authorization: Bearer $AGENT_MEMORY_TOKEN" \
  --get \
  --data-urlencode 'q=rollback policy' \
  --data 'limit=10' \
  "$AGENT_MEMORY_URL/api/memories"
```

검색 응답은 `{ hits, count }`이며 hit는 `{ memory, lexicalScore, vectorScore, score }`다. `count`는 반환 개수이며 이 endpoint는 reranker를 사용하지 않는다. 검색어 없는 탐색은 [Workspace library reads](#workspace-library-reads)를 사용한다.

### 수정과 archive

수정할 필드가 하나 이상인 JSON을 `PATCH`로 보내고 현재 응답의 `ETag` version을 `If-Match` header에 전달하라.

```bash
curl -i \
  -X PATCH \
  -H "Authorization: Bearer $AGENT_MEMORY_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "1"' \
  --data '{
    "content": "Rollback requires three approvers.",
    "changeReason": "Security review"
  }' \
  "$AGENT_MEMORY_URL/api/memories/<memoryId>"
```

Archive도 `DELETE`와 `If-Match`를 사용하며 선택형 `reason` query는 1,000자 이하다.

```bash
curl -i \
  -X DELETE \
  -H "Authorization: Bearer $AGENT_MEMORY_TOKEN" \
  -H 'If-Match: "2"' \
  "$AGENT_MEMORY_URL/api/memories/<memoryId>?reason=Superseded%20policy"
```

`If-Match`가 없거나 잘못되면 `428`, version이 충돌하면 `409`를 반환한다. `PATCH`로 변경할 수 있는 필드는 `title`, `content`, `source`, `accessGrants`, `expiresAt`이며 `changeReason` 자체는 변경 필드로 계산하지 않는다. 선택형 `changeReason`은 1–1,000자다. `expiresAt: null`은 만료를 해제한다. 만료일을 지정하면 `validFrom`보다 뒤여야 한다.

PATCH 성공은 `200`과 갱신된 Memory·`ETag`, DELETE 성공은 `204`와 빈 본문을 반환한다. 일반 필드 수정은 `write`, grant 변경과 archive는 `manage` 권한이 필요하다. `kind`, `scope`, `validFrom`은 PATCH로 변경할 수 없다.

### Revision 조회

Revision은 `GET .../versions?limit=<1-100>&before=<version>`으로 역순 조회한다. 기본 limit은 50이며 `manage` 권한이 필요하다. `before`는 2 이상의 정수다. 응답은 `{ versions, nextBefore? }`이며 `nextBefore`가 있으면 다음 요청의 `before`로 사용한다. 최초 version인 1에 도달하거나 페이지가 limit보다 짧으면 `nextBefore`를 생략한다. `before`는 해당 version을 제외한 더 오래된 revision을 선택한다.

Revision 항목은 `memoryId`, `version`, `title`, `content`, `source`, `accessGrants`, `validFrom`, `status`, `changedBy`, `createdAt`과 값이 있는 `embeddingModel`, `expiresAt`, `changeReason`을 포함한다. Archive된 Memory의 revision도 `manage` 권한으로 조회할 수 있다.

## 문서

### 업로드

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

지원 MIME type은 `text/plain`, `text/markdown`, `text/csv`, `application/json`, `application/xml`, `text/xml`이다. `teamId`는 team scope에서만, `userId`는 user scope에서만 허용한다.

| 제한 | 동작 |
| --- | --- |
| 파일 10 MiB, multipart 전체 10 MiB + 64 KiB | 초과 시 `413`. `Content-Length`와 실제 stream을 모두 검사한다. |
| 조직 누적 storage·processing backlog·사용자 최근 1시간 upload quota | 초과 시 저장한 원본을 정리하고 `429`를 반환한다. |
| 문서당 512개 chunk | 처리 중 초과 시 provider 호출 전에 `failed`로 전환한다. |

업로드 성공은 `202`, Document JSON과 상태 조회용 `Location`을 반환한다. Queue 등록에 실패해도 저장된 document ID와 `failed` 상태를 반환하므로 같은 ID로 retry할 수 있다.

User scope 문서 업로드 예시는 다음과 같다. `curl`이 파일 MIME type을 올바르게 전송하도록 `type`을 명시하라.

```bash
curl -i \
  -X POST \
  -H "Authorization: Bearer $AGENT_MEMORY_TOKEN" \
  -F 'scopeKind=user' \
  -F 'title=Operations handbook' \
  -F 'metadata={"source":"internal"}' \
  -F 'file=@./handbook.md;type=text/markdown' \
  "$AGENT_MEMORY_URL/api/documents"
```

### 상태와 공개 Document

공개 Document는 `id`, `scope`, `title`, `checksum`, `mimeType`, `sizeBytes`, `status`, `metadata`, `createdBy`, `processingAttempts`, `createdAt`, `updatedAt`을 포함한다. `sourceUri`, `processingStartedAt`, `processedAt`은 값이 있을 때만 포함하고 `processingError`는 실패 사유가 있는 `failed` 상태에만 포함한다. 원본 object key와 embedding은 반환하지 않는다.

`202` 응답의 `Location`을 polling하여 `status`가 `ready` 또는 `failed`가 될 때까지 확인한다.

```bash
curl \
  -H "Authorization: Bearer $AGENT_MEMORY_TOKEN" \
  "$AGENT_MEMORY_URL/api/documents/<documentId>"
```

### 재시도와 archive

`failed` 상태만 retry할 수 있다.

```bash
curl -i \
  -X POST \
  -H "Authorization: Bearer $AGENT_MEMORY_TOKEN" \
  "$AGENT_MEMORY_URL/api/documents/<documentId>/retry"
```

Retry는 원래 scope의 `write` 권한을 요구한다. 성공은 재시도 queue 등록을 수락했다는 `202`이며, 응답 Document는 등록 전 snapshot이므로 `status: "failed"`일 수 있다. 처리 완료 여부는 상태 조회 endpoint로 확인한다. `pending`, `processing`, `ready` 문서를 retry하면 `409`, archived 문서는 `404`다.

`DELETE .../documents/:documentId`는 문서를 영구 제거하지 않고 archive하며 `204`를 반환한다. 원본과 chunk는 provenance 보존을 위해 유지하지만 검색, 상태 조회, retry, AI 후보 조회·승인에서는 제외한다. 삭제에는 원래 document scope의 `manage` 권한이 필요하다.

### 문서 검색

`GET /api/documents?q=<query>&limit=<1-100>`은 `ready` 상태이며 읽을 수 있는 chunk를 hybrid 검색한다. Query는 1–10,000자, 기본 limit은 10이다. 응답은 `{ hits, count }`이며 hit는 `{ document, chunk: { id, ordinal, content, metadata }, lexicalScore, vectorScore, score }`다.

검색어 없는 문서 목록, chunk 원문과 순차 본문 조회는 [Workspace library reads](#workspace-library-reads)를 따른다.

## Knowledge Graph

### 근거와 생성 입력

검색·중복 후보 조회·Neighborhood 응답의 `sources`에는 호출자가 읽을 수 있는 현재 유효한 Memory 또는 ready 문서 chunk 참조만 포함한다. 유효한 근거가 하나도 없는 node·edge는 해당 조회 결과에서 제외한다.

Node 생성 입력은 `scope`, `kind`, `canonicalName`, `source`와 선택형 `summary`, `properties`다. Edge 생성 입력은 `scope`, `sourceNodeId`, `targetNodeId`, `predicate`, `source`와 선택형 `properties`다.

- Node의 `kind`는 1–100자, `canonicalName`은 1–500자, `summary`는 1–10,000자다.
- Edge의 `predicate`는 1–100자다.
- Node와 edge의 `properties`는 선택형 JSON object이며 직렬화 기준 최대 32 KiB다.

생성 요청의 `source`는 `{ "memoryId": UUID }` 또는 `{ "chunkId": UUID }` 중 정확히 하나만 포함한다. 호출자는 source를 읽을 수 있어야 하며 graph resource를 source보다 넓은 scope로 만들 수 없다. Canonical node·edge는 여러 근거를 누적하며 응답의 `sources` 배열로 반환한다. 각 배열 항목은 정확히 하나의 Memory 또는 document chunk를 참조한다.

Memory를 근거로 두 node와 edge를 만드는 흐름은 다음과 같다.

```bash
curl -X POST \
  -H "Authorization: Bearer $AGENT_MEMORY_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{
    "scope": { "kind": "organization" },
    "kind": "service",
    "canonicalName": "Checkout API",
    "summary": "Processes purchases",
    "source": { "memoryId": "<memoryId>" }
  }' \
  "$AGENT_MEMORY_URL/api/knowledge/nodes"
```

두 node의 `id`를 사용해 방향성 edge를 생성한다.

```bash
curl -X POST \
  -H "Authorization: Bearer $AGENT_MEMORY_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{
    "scope": { "kind": "organization" },
    "sourceNodeId": "<sourceNodeId>",
    "targetNodeId": "<targetNodeId>",
    "predicate": "depends_on",
    "source": { "memoryId": "<memoryId>" }
  }' \
  "$AGENT_MEMORY_URL/api/knowledge/edges"
```

Node 응답은 `id`, `scope`, `kind`, `canonicalName`, `properties`, `sources`, `createdAt`, `updatedAt`과 값이 있는 `summary`, `embeddingModel`을 포함한다. Edge 응답은 `id`, `sourceNodeId`, `targetNodeId`, `predicate`, `scope`, `properties`, `sources`, `createdAt`을 포함한다.

Node·edge 생성 성공은 `200`과 공개 resource를 반환한다. Node 응답의 `Location`은 해당 node의 neighborhood URL이다. 온톨로지 경고는 아래 검증 모드에 따라 추가된다.

### 삭제와 병합

`DELETE .../knowledge/nodes/:nodeId`와 `DELETE .../knowledge/edges/:edgeId`는 해당 graph resource scope의 `manage` 권한을 요구하며 성공 시 `204`를 반환한다. Node 삭제는 연결된 edge도 함께 삭제하지만 provenance source인 Memory나 document는 삭제하지 않는다.

`POST .../knowledge/nodes/:targetNodeId/merge`는 `{ "sourceNodeId": UUID, "reason": string }`을 받아 source node를 target node로 병합한다. `reason`은 1–2,000자다. 두 node는 같은 organization과 scope에 있어야 하며 호출자는 둘 다 `manage`할 수 있어야 한다. 병합 transaction은 provenance를 누적하고 incoming·outgoing edge를 target으로 재연결하며, 중복 edge를 합치고 self-edge를 제거한 뒤 source node를 삭제하고 audit을 저장한다.

병합 성공은 `200`과 갱신된 target node를 반환한다. 자기 자신과의 병합이나 서로 다른 scope 병합은 `400`이다.

Node identity는 NFKC, 연속 공백, 대소문자를 정규화한 canonical name과 정규화 kind를 사용한다. `award`, `honor`, `honour`, `achievement`, `designation`은 `recognition`으로 통합한다. 같은 scope에서 정규화 identity가 같으면 신규 생성과 AI 후보 승인 시 기존 node에 자동 병합한다. 이름만 같고 kind가 다른 node는 자동 병합하지 않는다.

### 조직 온톨로지 검증

조직은 허용 node kind·edge predicate 사전(`ontology`)과 검증 모드(`ontologyMode`)를 설정할 수 있다(`PATCH /api/organization`, admin·owner). 검증은 node 생성, edge 생성, AI 후보 승인에 적용되며 정규화(NFKC·소문자·kind alias)된 용어로 사전과 비교한다. 빈 목록은 해당 축을 검증하지 않는다.

신규 조직은 기본 사전과 `warn` 모드로 생성된다. 기본 node kind는 AI 추출 프롬프트의 기본 kind 목록과 동일한 13개(person, organization, product, service, project, technology, location, recognition, certification, role, event, document, concept)이고, 기본 edge predicate는 범용 10개(depends_on, uses, owns, part_of, member_of, works_for, located_in, integrates_with, produces, manages)다. 기존 조직의 설정은 변경되지 않는다.

- `off`: 검증하지 않는다.
- `warn`: 쓰기를 허용하고 성공 응답에 `ontologyWarnings: [{ "type": "unknown_kind" | "unknown_predicate", "term": string }]`를 포함한다(위반이 없으면 필드 생략).
- `strict`: 미등록 용어를 `422` `{ "error": "knowledge ontology violation", "violations": [...] }`로 거부한다. AI 후보 승인은 node·edge 생성과 embedding 호출 전에 거부된다.

`GET .../candidates/:candidateId/duplicates` 응답은 `duplicates`와 함께 `ontology: { "mode": string, "violations": [...] }`를 반환해 검토 화면이 미등록 용어를 표시할 수 있게 한다. 검증 모드가 `off`가 아니고 사전이 비어 있지 않으면 AI 추출 프롬프트에 조직 사전이 힌트로 주입되며, `strict`에서는 entity kind와 relationship predicate가 각각 비어 있지 않은 사전 값으로 제약된다. 승인 시점에도 사전을 다시 검증한다.

### 온톨로지 추천

두 endpoint 모두 organization scope `manage` 권한(admin·owner)이 필요하다.

- `GET .../knowledge/ontology/recommendations`: 조직의 graph node·edge와 pending 후보에서 관찰된 용어를 집계해, 사전에 없는 상위 용어를 반환한다. 응답은 `{ "nodeKinds": [{ "term": string, "count": number }], "edgePredicates": [...] }`이며 목록당 최대 20개다. AI 호출 없이 결정적으로 동작한다.
- `POST .../knowledge/ontology/suggestions`: 관찰 용어와 현재 사전을 knowledge extraction 모델에 보내 정제된 용어(동의어 통합·정규화)를 제안받는다. 응답은 `{ "nodeKinds": string[], "edgePredicates": string[] }`이며 사전에 이미 있는 용어는 제외된다. `KNOWLEDGE_EXTRACTION_MODEL`이 설정되지 않았으면 `503`, provider 상한 초과 시 `429`를 반환한다. 요청에는 용어 문자열과 개수만 전달되며 문서 본문은 전송하지 않는다.

추천·제안은 사전에 자동 반영되지 않는다 — admin이 콘솔 설정 화면에서 선택해 `PATCH /api/organization`로 저장한다.

### 검색과 neighborhood

검색은 `GET .../knowledge/nodes?q=<query>&limit=<1-100>`을 사용하며 query는 1–10,000자, 기본 검색 limit은 10이다. Neighborhood는 `depth=1-5`, `limit=1-200`을 받으며 기본값은 각각 1과 100이다. 두 조회는 호출자가 현재 읽을 수 있고 active·유효한 Memory 또는 ready document chunk 근거가 하나 이상 있는 graph resource만 반환한다.

```bash
curl \
  -H "Authorization: Bearer $AGENT_MEMORY_TOKEN" \
  "$AGENT_MEMORY_URL/api/knowledge/nodes/<nodeId>/neighborhood?depth=2&limit=100"
```

검색 응답은 `{ hits, count }`이며 hit는 `{ node, lexicalScore, vectorScore, score }`다. Neighborhood 응답은 `{ "nodes": [...], "edges": [...] }` 형식이다. 서버는 조회 시점마다 graph scope뿐 아니라 각 provenance source의 현재 권한과 상태를 다시 확인한다.

### AI 후보 조회와 검토

`GET /api/knowledge/review-groups?offset=0&limit=25&query=유비`는 검토 가능한 전체 pending 후보에서 동일 scope·kind·정규화 이름의 개체와 동일 양 끝 개체·predicate의 관계를 통합한 후 페이지를 반환한다. 응답은 `{ groups, total, sourceCount, offset, limit }`이다. Limit은 1–100, offset은 0 이상의 정수이며 query는 최대 500자다. 그룹의 `occurrences`는 후보 ID, 문서 제목·ID, chunk ID·ordinal, 근거, 별칭·설명과 해당 항목을 검토할 `selection`을 제공한다. 빈 결과와 이미 검토한 항목은 제외한다. 각 그룹의 `ontology`는 검증 모드와 해당 항목의 위반 목록을 제공한다. 구체적인 관계와 인용 근거가 있는 항목을 우선하며 정렬은 진실성 점수가 아니다. 대칭 관계만 역방향을 통합한다. 원본 인용이 다른 사건·시점을 나타내는지는 검토자가 확인한다.

승인·거절 body의 선택적 `selection: { entityKeys: string[], relationshipIndexes: number[] }`은 원본 graph의 키와 0 기반 관계 index를 참조한다. 생략하면 남은 항목 전체를 처리한다. 관계 승인은 양 끝 개체도 승격하고, 개체 거절은 아직 검토하지 않은 연결 관계도 거절한다. 다른 항목은 pending으로 남는다. `itemReviews`는 항목별 decision·reviewedBy·reviewedAt·reason을 보존하며 원본 graph는 변경하지 않는다. 모든 항목을 검토하면 승인된 항목이 하나라도 있는 후보는 accepted, 전부 거절한 후보는 rejected가 된다. 동일 항목의 같은 결정은 멱등하며 반대 결정은 거부한다. 빈 추출은 조회 이력으로 보존하되 승인할 수 없다.

Knowledge extraction을 활성화하면 ready 문서의 각 chunk에서 entity와 relationship candidate를 만든다. Candidate는 source document·chunk, 원래 scope, extraction model을 포함하며 chunk 원문 전체를 응답하지 않는다. 새 추출의 entity는 `aliases`와 `evidence` 배열을, relationship은 `evidence` 배열을 포함한다. Evidence는 청크에서 인용한 최대 2,000자의 문구이며 각 배열은 최대 20개다. 근거 필드가 없는 기존 추출 기록도 조회할 수 있다. 서버는 NFKC·공백 정규화 후 원문에 존재하는 인용만 보존하고, 근거가 없는 개체·관계와 막연한 동시 등장 관계를 제외한다. 인용 일치는 의미적 사실 검증을 대체하지 않는다.

- `GET .../knowledge/candidates?limit=<1-100>`은 빈 추출 결과를 제외한 pending candidate를 오래된 순으로 반환하며 기본 limit은 50이다. 응답은 `{ candidates, count }`다. 각 candidate는 `id`, `scope`, `documentId`, `chunkId`, `model`, 추출된 `graph`, `status`, `createdAt`, `updatedAt`과 값이 있는 `reviewedBy`, `reviewReason`, `reviewedAt`을 포함한다.
- `GET .../knowledge/candidates/<candidateId>/duplicates`는 후보의 모든 entity를 한 번에 조회하고 entity key별로 같은 canonical name·scope의 읽기 가능한 기존 node를 반환한다. Semantic embedding을 생성하지 않는다.
- 후보 조회와 승인은 source scope의 `manage` 권한을 따른다. Organization scope는 `admin`·`owner`, team scope는 해당 팀 `manager` 또는 조직 `admin`·`owner`, user scope는 본인만 검토한다.
- `POST .../accept`와 `POST .../reject` JSON object body는 필수이며 `reason`만 선택 항목이다. 사유가 없으면 `{}`를 보내고, 있으면 `{ "reason": string }`을 보낸다. reason은 앞뒤 공백 제거 후 1–2,000자다.
- 승인은 node·edge, candidate→resource 관계, reviewer audit을 하나의 transaction으로 저장한다. 이미 거절된 후보를 승인하거나 승인된 후보를 거절하면 `409`를 반환한다. 최초 승인 시 source 문서가 archive 등으로 `ready`가 아니면 `409` `{ "error": "knowledge candidate source document is not ready" }`를 반환한다. 이미 승인된 후보의 재승인은 멱등하며 현재 surviving resource로 해석한 기존 승인 결과를 반환한다.

Pending 후보를 조회하고 승인하는 예시는 다음과 같다.

```bash
curl \
  -H "Authorization: Bearer $AGENT_MEMORY_TOKEN" \
  "$AGENT_MEMORY_URL/api/knowledge/candidates?limit=50"

curl -X POST \
  -H "Authorization: Bearer $AGENT_MEMORY_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{ "reason": "Source와 관계를 확인함" }' \
  "$AGENT_MEMORY_URL/api/knowledge/candidates/<candidateId>/accept"
```

승인 성공은 `200` `{ candidate, nodes, edges, ontologyWarnings? }`다. 거절 성공은 `200`과 갱신된 candidate 자체를 반환하며 Graph resource를 만들지 않는다.

## 통합 Context 검색

### 요청과 순위

`GET .../context/search?q=<query>&limit=<1-100>`은 접근 가능한 memory, document chunk, knowledge node를 검색해 하나의 순위 결과로 반환한다. query는 1–10,000자이며 기본 limit은 10이다.

```bash
curl \
  -H "Authorization: Bearer $AGENT_MEMORY_TOKEN" \
  --get \
  --data-urlencode 'q=checkout rollback' \
  --data 'limit=10' \
  "$AGENT_MEMORY_URL/api/context/search"
```

응답은 통합 순위의 `hits`, 반환 개수인 `count`, source별 후보 개수인 `counts`, 최종 순위 방식인 `ranking`을 포함한다. `ranking`은 reranker가 성공하면 `rerank`, 미설정·후보 없음·provider fallback에서는 `hybrid`다.

| 항목 | 계약 |
| --- | --- |
| 후보 수집 | Reranker 활성 시 종류별 최대 `min(100, max(12, limit × 4))`개를 조회한다. |
| 재정렬 입력 | 조회 후보에서 source별 순위를 유지하며 번갈아 선택하고, 전체를 같은 후보 예산 이내로 제한한다. 한 종류만 있으면 해당 종류에서 예산을 채운다. |
| `counts` | 종류별 조회 후보 수. 선택된 재정렬 입력 수 또는 최종 반환 수와 다를 수 있다. |
| 최소 점수 | `RERANKER_MIN_SCORE`는 재정렬 성공 시에만 적용한다. 후보가 있어도 `hits`가 비어 있을 수 있다. |
| Fallback | Reranker 장애·timeout·quota 초과 시 선택된 후보의 hybrid 순위로 복귀하며 최소 점수 하한은 적용하지 않는다. |

HTTP 개별 Memory·문서·Knowledge 검색은 reranker를 사용하지 않는다. Embedding provider가 설정되어 있으면 검색 전에 query embedding을 생성하며, 이 단계의 실패는 reranker fallback 대상이 아니다.

### 응답

다음은 필드를 줄인 응답 예시다. 실제 Memory payload는 [공개 응답](#공개-응답)을 따른다.

```json
{
  "hits": [
    {
      "sourceType": "memory",
      "memory": { "id": "...", "title": "Checkout rollback policy" },
      "lexicalScore": 0.09,
      "vectorScore": 0.78,
      "candidateScore": 0.44,
      "rerankScore": 0.91,
      "score": 0.91
    }
  ],
  "count": 1,
  "counts": {
    "memories": 1,
    "documents": 0,
    "knowledge": 0
  },
  "ranking": "rerank"
}
```

각 hit의 구체적인 payload는 `sourceType`에 따라 `memory`, `document`와 `chunk`, `node` 중 하나를 포함한다. `candidateScore`는 1차 hybrid 점수다. Reranker가 성공하면 `rerankScore`와 최종 `score`가 같고, hybrid fallback에서는 `rerankScore`를 생략하고 `score`가 `candidateScore`와 같다. `vectorScore`는 embedding을 사용하지 않을 때 `0`이다.

## MCP

### Transport와 인증

Streamable HTTP endpoint는 `/api/mcp`다. MCP client의 초기화·`tools/list`·`tools/call` 흐름을 사용한다. 아래 도구 호출 예시는 `tools/call`의 params이며 일반 REST JSON 요청이 아니다.

| 인증과 header | 적용 권한 |
| --- | --- |
| Better Auth session | Session 사용자의 조직 role·team·user scope·개별 grant. `X-User-Email`은 무시한다. |
| 조직 Agent Bearer, `X-User-Email` 없음 | Organization scope만 접근하는 service principal |
| 조직 Agent Bearer + `X-User-Email` | 설치 조직에서 email로 찾은 활성 사용자의 권한 |

조직 Agent token의 발급자는 현재 active admin·owner여야 한다. 위임 email은 앞뒤 공백 제거·소문자 정규화 후 검증한다. 잘못된 형식이나 빈 header는 HTTP `400`, 활성 멤버가 아닌 email은 `403`이며 발급자 권한으로 대체하지 않는다. Token 인증 실패는 `401`이다.

### 도구와 결과 형식

| Tool | 역할 | 입력 | Structured content |
| --- | --- | --- | --- |
| `remember` | Scoped Memory 저장 | [Memory 생성 입력](#생성과-scope) | `{ memory }` |
| `recall` | 현재 유효한 Memory 회상 | `query`, `limit?` | `{ remembered, hits, count, counts, ranking }` |
| `forget` | Memory archive | `memoryId`, `expectedVersion`, `changeReason?` | `{ memoryId, forgotten: true }` |
| `context_search` | Memory·RAG·Graph 통합 검색 | `query`, `limit?` | `{ hits, count, counts, ranking }` |
| `document_search` | 처리된 문서 chunk 검색 | `query`, `limit?` | `{ hits }` |
| `knowledge_search` | Knowledge node 검색 | `query`, `limit?` | `{ hits }` |
| `knowledge_neighborhood` | Graph neighborhood 조회 | `nodeId`, `depth?`, `limit?` | `{ nodes, edges }` |

검색 `query`는 1–10,000자, `limit`은 정수 1–100이며 기본값은 10이다. `knowledge_neighborhood`는 UUID `nodeId`와 `depth` 1–5(기본 1), `limit` 1–200(기본 100)을 사용한다. 개별 문서·Knowledge hit와 neighborhood payload는 해당 HTTP API의 공개 형식과 같다.

도구 성공 응답은 `structuredContent`와 text `content`를 함께 반환한다. `recall`의 text는 아래 compact 기억 본문이며 나머지는 structured payload의 JSON 문자열이다. MCP의 Memory에는 HTTP의 `capabilities`와 `accessGrants`가 포함되지 않는다.

### 기억 저장·회상·잊기

`remember`는 HTTP Memory 생성과 같은 입력·scope 정책을 사용한다. 사용자 위임 없는 조직 Agent token은 organization scope만 사용하며 `accessGrants`를 생략해야 한다. 빈 배열도 허용하지 않는다. 사용자 요청에서 `accessGrants`를 명시하면 해당 scope의 `manage` 권한이 필요하다.

`recall`은 권한이 있고 현재 유효한 Memory만 검색한다. `remembered`의 각 항목은 `[memory id=<UUID> version=<현재 version>]`으로 시작해 text만 읽는 client도 잊을 대상을 지정할 수 있다. Text는 항목당 최대 1,200자, 전체 최대 4,000자로 잘린다. Structured `hits`에는 반환된 Memory 본문이 그대로 있으므로 `count`와 compact text에 보이는 항목 수는 다를 수 있다. 검색 결과가 없으면 `remembered`는 빈 문자열이고 `hits`는 빈 배열이다.

`forget`은 해당 Memory의 `manage` 권한과 현재 version을 요구한다.

| 입력 | 계약 |
| --- | --- |
| `memoryId` | 기억 UUID |
| `expectedVersion` | 1 이상의 정수. HTTP `If-Match`와 같은 낙관적 동시성 계약 |
| `changeReason` | 선택형 1–1,000자 문자열 |

성공하면 회상·검색에서 제외한다. 원본과 revision은 보존하며 영구 삭제하지 않는다. 없는 기억·이미 archive된 기억, 권한 부족, version 충돌은 도구 오류다.

서비스는 다음 순서로 도구를 호출한다. `forget`의 ID와 version은 실제 `remember` 또는 `recall` 응답에서 가져온다.

```jsonl
{"name":"remember","arguments":{"kind":"fact","scope":{"kind":"organization"},"title":"Release policy","content":"Deploy after verification.","source":{"type":"agent","agentId":"release-service"}}}
{"name":"recall","arguments":{"query":"Release policy","limit":5}}
{"name":"forget","arguments":{"memoryId":"<returned memory.id>","expectedVersion":1,"changeReason":"Superseded"}}
```

### 검색 순위와 오류

`context_search`와 `recall`은 [통합 Context 검색](#통합-context-검색)의 점수·reranker·fallback 계약을 사용한다. `recall`의 hit는 `sourceType: "memory"`이며 `counts.documents`, `counts.knowledge`는 0이다. RAG·Graph를 함께 조회하려면 `context_search`를 사용한다. `document_search`·`knowledge_search`는 hybrid 검색이며 reranker를 사용하지 않는다.

도구 실행 실패는 `isError: true`와 text 메시지로 반환한다. 알려진 application 오류는 입력·권한·요청 제한을 설명하고, DB·provider 등 예상하지 못한 오류는 내부 상세 없이 `Tool execution failed`로 반환한다. HTTP 인증 상태와 도구 실행 결과를 구분하고 HTTP 성공만으로 도구 성공을 판단하지 마라.

### Client 연결

MCP client에는 endpoint와 Agent token Bearer header를 함께 설정하라. 실제 설정 형식은 사용하는 client가 지원하는 Streamable HTTP server 형식을 따른다.

```json
{
  "mcpServers": {
    "agent-memory": {
      "type": "http",
      "url": "http://localhost:3100/api/mcp",
      "headers": {
        "Authorization": "Bearer <amt_token>"
      }
    }
  }
}
```

Token은 client의 secret 또는 environment variable 기능으로 주입하고 설정 파일에 commit하지 마라. Agent Studio에서는 MCP registry entry의 `Authorization` header에 `Bearer amt_...` 값을 저장한다. Agent Studio는 로그인 사용자의 `X-User-Email`을 자동으로 전달하므로 해당 사용자가 웹에서 볼 수 있는 개인·팀 문서도 MCP에서 검색할 수 있다. 다른 client는 검증한 사용자 email을 `X-User-Email`로 전달하거나 실제 사용자의 Better Auth Bearer token을 사용한다.

조직 Agent token은 조직 내 활성 사용자를 대신할 수 있는 위임 credential이다. 사용자 신원을 검증하고 header를 생성하는 신뢰된 server-side client에만 제공한다. 브라우저·모델 인자·외부 요청의 header를 그대로 전달하지 마라. Email만으로는 인증할 수 없다.

## Workspace library reads

검색어 없이 접근 가능한 자료를 탐색할 때 다음 읽기 endpoint를 사용한다. 검색 endpoint는 `q`를 요구한다.

- `GET /api/memories/library?limit=25&offset=0`: 현재 active이고 유효하며 읽을 수 있는 Memory를 반환한다. 응답은 `{ memories: [...], count, nextOffset }`이고 각 항목은 기존 공개 Memory 형식과 capability를 사용한다.
- `GET /api/documents/library?limit=25&offset=0`: 읽을 수 있는 pending·processing·failed·ready 문서를 반환하며 archived 문서는 제외한다. 응답은 `{ documents: [...], count, nextOffset }`이고 각 항목은 기존 공개 Document 형식이다.

### 목록 페이지

두 목록은 생성 시각 내림차순, 같은 시각이면 ID 내림차순으로 정렬한다. `limit`은 1–100(기본 25), `offset`은 0 이상의 안전한 정수(기본 0)이며 다음 page 계산을 위해 `Number.MAX_SAFE_INTEGER - 101` 이하로 제한한다. `count`는 현재 page의 항목 수이며 총 자료 수가 아니다. 다음 page가 있으면 `nextOffset`으로 요청하고 없으면 `null`을 반환한다. 동시 생성·archive 중에는 offset 기반 page 사이에 항목이 이동할 수 있으므로 새로 고침은 첫 page에서 시작한다.

### Chunk 원문

`GET /api/document-chunks/{chunkId}`는 후보 검토와 Graph 출처 확인을 위한 원문을 반환한다. 응답은 `{ document, chunk: { id, ordinal, content, metadata } }`이다. Document는 기존 공개 응답을 사용하고 object key나 embedding은 노출하지 않는다. 같은 조직의 ready 문서이며 현재 사용자가 source를 읽을 수 있을 때만 반환한다. 없는 chunk, 권한 없는 source, ready가 아닌 source는 모두 `404`로 처리한다. 원본 파일 download endpoint가 아니라 처리된 chunk 원문 조회다.

### 문서 본문 페이지

`GET /api/documents/{documentId}/chunks?limit=25&offset=0`는 ready 문서의 처리된 본문을 순서대로 읽는다. 응답은 `{ document, chunks: [{ id, ordinal, content, metadata }], count, nextOffset }`이며 Document는 기존 공개 응답 형식이다. `ordinal` 오름차순(ID로 동률 정렬)으로 조회하며 `limit`·`offset` 범위와 `count`·`nextOffset` 의미는 위 library endpoint와 같다. 마지막 page 이후에는 `chunks: []`, `nextOffset: null`을 반환한다. 문서 조회와 본문 page는 같은 읽기 transaction snapshot을 사용한다. 다른 조직, 읽기 권한 없음, archived·pending·processing·failed source는 모두 `404`로 처리한다. 원본 파일 bytes나 object key, embedding은 반환하지 않는다.

## 멱등 수집

Memory 생성 HTTP API와 MCP `remember`는 선택적 `idempotencyKey`(trim 후 1–256자)를 받는다.
같은 설치 조직·인증 사용자·operation·key에 같은 payload를 다시 보내면 기존 Memory를 반환한다.
다른 payload는 HTTP 409 또는 MCP tool error다. 현재 scope 권한을 다시 확인하며 archived resource를
새로 만들지 않는다. 인증 방식은 기존 session 또는 조직 Agent Bearer + 검증된 email 위임을 유지한다.

문서 수집 MCP는 같은 receipt 계약을 제공한다. 저장된 pending 문서의 업로드를 재호출하면 같은
문서 ID로 queue 등록을 복구한다. 새 원본·문서를 만들지 않는다.

| Tool | 입력 | 응답 |
| --- | --- | --- |
| `document_ingest` | `idempotencyKey`, `scope`, `title`, `mimeType`, UTF-8 `content`, 선택적 `sourceUri`·`metadata` | `{ document }` |
| `document_ingest_status` | `documentId` | `{ document }`, 처리 상태·processingAttempts 포함 |
| `document_ingest_retry` | `documentId`, `idempotencyKey`, 관측한 `expectedAttempts` | `{ document }` |

Content는 기존 문서 MIME과 10 MiB 제한을 적용한다. metadata는 32 KiB다. MCP HTTP JSON 본문은
문자 escape와 envelope를 포함해 `6 × maxDocumentBytes + 512 KiB`로 제한한다. 일반 HTTP JSON
본문의 1 MiB 제한은 유지한다.

Retry는 현재 문서 write 권한을 요구한다. 같은 키·같은 expectedAttempts는 같은 요청이며, 처리
횟수가 바뀌면 새 키와 관측한 횟수로 요청한다. 이미 처리한 요청을 replay해도 재처리를 시작하지
않는다. Queue 메시지도 expectedAttempts를 보관해 늦게 도착한 메시지를 거절한다. 처리 중 worker가
중단된 경우 같은 횟수에서 만료 lease만 회수한다.
