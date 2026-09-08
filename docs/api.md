# HTTP API와 MCP

모든 예시는 local base URL을 사용한다. `<memoryId>`, `<nodeId>`와 token은 실제 값으로 바꿔라.

```bash
export AGENT_MEMORY_URL=http://localhost:3100
export AGENT_MEMORY_TOKEN='<better-auth-session-token>'
```

## 인증과 요청 경계

조직 API는 인증이 필요하다. `/api/health`는 인증 없이 readiness를 제공하고, `/api/auth/*`는 Better Auth의 로그인·가입·provider 흐름을 처리한다. `/api/metrics`는 Better Auth 대신 `METRICS_BEARER_TOKEN`을 사용하며 token이 설정되지 않았거나 Bearer 값이 일치하지 않으면 `404`를 반환한다. 인증되면 Prometheus text exposition format으로 build와 process 수준 지표만 반환한다. 브라우저는 session cookie를 사용하고 Agent는 Better Auth 로그인 응답의 `set-auth-token` header 값을 다음과 같이 전달한다.

```http
Authorization: Bearer <token>
```

### 브라우저 session

운영 콘솔의 로그인·가입 요청은 `/api/auth/*` Better Auth endpoint를 사용한다. 브라우저의 POST, PATCH, DELETE 요청은 session cookie뿐 아니라 `BETTER_AUTH_URL`에서 파생한 trusted same-origin 조건을 만족해야 한다.

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

현재 role과 team membership은 `GET /api/me`로 확인한다.

모든 resource endpoint는 서버가 설치 조직을 결정하고 인증 사용자의 멤버십을 확인한다. URL·body·header의 tenant 식별자로 대상 조직을 선택할 수 없다. 브라우저 mutation은 trusted same-origin 요청만 허용하며 Bearer 요청에는 origin 검사를 적용하지 않는다. 조직 UUID는 내부 resource scope와 공개 응답에서 유지한다.

### 조직 Agent token

Organization `admin` 또는 `owner`는 `Agent 연결` 화면이나 `POST /api/agent-token`에서 MCP 전용 token을 생성할 수 있다. DB에는 검증용 SHA-256 hash와 reveal용 AES-256-GCM 암호문을 저장한다. 암호화 key는 `BETTER_AUTH_SECRET`에서 HKDF로 용도 분리해 파생한다. 같은 조직에서 다시 생성하면 기존 token은 즉시 무효화되고 `DELETE`로 폐기할 수 있다.

```json
{
  "token": "amt_...",
  "masked": "amt_••••1234",
  "createdAt": "2026-08-31T00:00:00.000Z"
}
```

일상적인 `GET .../agent-token` 응답은 `configured` 여부와 함께 mask, 생성 시각, `revealable` 상태만 반환하며, token이 없으면 `{ "configured": false }`만 반환한다. 원문은 생성 응답과 명시적인 `POST .../agent-token/reveal`에서만 반환하며 두 응답 모두 `Cache-Control: no-store`다. 암호문 column이 없는 기존 hash-only token은 MCP 인증은 유지하지만 reveal할 수 없으므로 한 번 재생성해야 한다.

이 token은 설치의 `/api/mcp`에서만 인증되며 일반 HTTP API에서는 사용할 수 없다. Token 발급자가 현재 active `admin` 또는 `owner`인지 확인한 뒤 `X-User-Email`이 없으면 organization scope만 접근할 수 있는 service principal을 적용한다. 유효한 token과 함께 전달된 `X-User-Email`은 설치 조직의 활성 사용자 권한으로 위임한다. 상세 검증과 신뢰 경계는 MCP 절을 따른다. 발급자가 차단·제거·강등되면 다음 요청부터 인증이 거부된다. `BETTER_AUTH_SECRET`을 변경하면 기존 token은 hash 검증으로 계속 인증되지만 원문을 복호화할 수 없으므로 재생성해야 한다.

`ALLOWED_EMAIL_DOMAINS`가 미설정 또는 빈 값이면 모든 email domain으로 로그인할 수 있다. 목록을 설정하면 인증을 해당 email domain으로 제한한다. 서버가 설치 조직을 준비하며 active owner가 없을 때 `ADMIN_EMAILS` 사용자가 콘솔에 접속하면 최초 owner를 설정한다. 그 외 신규 사용자는 첫 콘솔 접속 시 가입 요청이 접수되며 운영자 승인 전까지 pending 상태다. 전역 admin 권한은 조직의 멤버십이나 role을 대체하지 않는다. 조직 생성·가입·삭제 API는 제공하지 않는다.

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

오류 응답은 기본적으로 `{ "error": string }`이며 schema validation 오류는 `issues`를 추가할 수 있다.

| Status | 의미 |
| --- | --- |
| `400` | JSON, UUID, query 또는 입력 schema가 잘못됨 |
| `401` | Session 또는 Bearer 인증 실패 |
| `403` | 조직 멤버십·resource action 권한 부족 또는 브라우저 mutation의 origin 검증 실패 |
| `404` | Resource가 없거나 호출자에게 존재를 공개할 수 없음 |
| `409` | Memory version, candidate review 상태 충돌 또는 Agent token reveal 불가 |
| `413` | JSON body가 1 MiB를 초과하거나 문서 upload request·파일이 제한을 초과함 |
| `422` | 조직 온톨로지 검증(strict)에서 미등록 kind·predicate를 거부함. 응답에 `violations` 배열 포함 |
| `428` | Memory mutation에 유효한 `If-Match`가 없음 |
| `429` | Instance 또는 PostgreSQL organization·user AI provider 호출 상한, document storage·processing backlog·사용자 upload rate quota를 초과함 |
| `503` | Health check에서 Database를 사용할 수 없거나, AI 모델 미구성 상태에서 온톨로지 AI 추천을 호출함 |

## Endpoint

| Method | Path | 역할 |
| --- | --- | --- |
| `GET` | `/api/health` | Database readiness 확인 |
| `GET` | `/api/metrics` | `METRICS_BEARER_TOKEN`으로 보호된 Prometheus process·build 지표 조회 |
| `GET`, `POST` | `/api/auth/*` | Better Auth 인증 endpoint |
| `GET`, `PATCH` | `/api/organization` | 설치 조직 조회, 설정 변경(admin·owner) |
| `GET` | `/api/me` | 현재 멤버십과 팀 역할 조회 |
| `GET`, `POST`, `DELETE` | `/api/agent-token` | MCP 전용 Agent token 상태 조회·생성·폐기(admin·owner) |
| `POST` | `/api/agent-token/reveal` | 저장된 MCP Agent token 원문 조회(admin·owner) |
| `GET`, `POST` | `/api/members` | 조직 멤버 조회·추가 |
| `PATCH`, `DELETE` | `/api/members/:userId` | 멤버 role·status 변경, 멤버 제거 |
| `GET`, `POST` | `/api/teams` | 팀 조회·생성 |
| `PATCH`, `DELETE` | `/api/teams/:teamId` | 팀 이름 변경, 팀 삭제(admin·owner) |
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
- `validFrom`, `expiresAt`: offset을 포함한 ISO 8601 datetime

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

`expiresAt`, `embeddingModel`, `accessGrants`는 해당 값과 호출자 권한에 따라 생략될 수 있다.

검색은 `GET .../memories?q=<query>&limit=<1-100>`을 사용하며 query는 1–10,000자, 기본 limit은 10이다.

```bash
curl \
  -H "Authorization: Bearer $AGENT_MEMORY_TOKEN" \
  --get \
  --data-urlencode 'q=rollback policy' \
  --data 'limit=10' \
  "$AGENT_MEMORY_URL/api/memories"
```

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

`If-Match`가 없거나 잘못되면 `428`, version이 충돌하면 `409`를 반환한다. `PATCH`로 변경할 수 있는 필드는 `title`, `content`, `source`, `accessGrants`, `expiresAt`이며 `changeReason` 자체는 변경 필드로 계산하지 않는다. 선택형 `changeReason`은 1–1,000자다.

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

지원 MIME type은 `text/plain`, `text/markdown`, `text/csv`, `application/json`, `application/xml`, `text/xml`이다. 서버는 `Content-Length`와 실제 request stream을 모두 10 MiB로 제한하고, 추출 결과는 문서당 최대 512개 chunk로 제한한다. Chunk 제한을 넘으면 provider를 호출하지 않고 문서를 `failed`로 전환한다. 업로드는 organization 누적 storage, `pending`·`processing` backlog, 사용자별 최근 1시간 업로드 quota를 PostgreSQL transaction에서 검사한다. 한도를 넘으면 저장한 원본을 정리하고 `429`를 반환한다. 정상 업로드는 `202`와 상태 조회용 `Location`을 반환한다. Queue 등록에 실패해도 저장된 document ID와 `failed` 상태를 반환하므로 같은 ID로 retry할 수 있다. 검색은 `GET .../documents?q=<query>&limit=<1-100>`을 사용하고 `ready` 상태의 접근 가능한 chunk만 반환한다. query는 1–10,000자이며 `failed` 문서만 retry할 수 있다.

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

`202` 응답의 `Location`을 polling하여 `status`가 `ready` 또는 `failed`가 될 때까지 확인한다.

```bash
curl \
  -H "Authorization: Bearer $AGENT_MEMORY_TOKEN" \
  "$AGENT_MEMORY_URL/api/documents/<documentId>"
```

`failed` 상태만 retry할 수 있다.

```bash
curl -i \
  -X POST \
  -H "Authorization: Bearer $AGENT_MEMORY_TOKEN" \
  "$AGENT_MEMORY_URL/api/documents/<documentId>/retry"
```

Retry 성공은 `202`와 갱신된 document를 반환한다. `pending`, `processing`, `ready` 문서를 retry하면 `409`를 반환한다.

`DELETE .../documents/:documentId`는 문서를 영구 제거하지 않고 archive하며 `204`를 반환한다. 원본과 chunk는 provenance 보존을 위해 유지하지만 검색, 상태 조회, retry, AI 후보 조회·승인에서는 제외한다. 삭제에는 원래 document scope의 `manage` 권한이 필요하다.

## Knowledge Graph

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

Node 응답은 `id`, `scope`, `kind`, `canonicalName`, 선택형 `summary`, `properties`, `sources`, timestamp와 선택형 `embeddingModel`을 포함한다. Edge 응답은 node ID, `predicate`, `scope`, `properties`, `sources`, `createdAt`을 포함한다.

`DELETE .../knowledge/nodes/:nodeId`와 `DELETE .../knowledge/edges/:edgeId`는 해당 graph resource scope의 `manage` 권한을 요구하며 성공 시 `204`를 반환한다. Node 삭제는 연결된 edge도 함께 삭제하지만 provenance source인 Memory나 document는 삭제하지 않는다.

`POST .../knowledge/nodes/:targetNodeId/merge`는 `{ "sourceNodeId": UUID, "reason": string }`을 받아 source node를 target node로 병합한다. `reason`은 1–2,000자다. 두 node는 같은 organization과 scope에 있어야 하며 호출자는 둘 다 `manage`할 수 있어야 한다. 병합 transaction은 provenance를 누적하고 incoming·outgoing edge를 target으로 재연결하며, 중복 edge를 합치고 self-edge를 제거한 뒤 source node를 삭제하고 audit을 저장한다.

Node identity는 NFKC, 연속 공백, 대소문자를 정규화한 canonical name과 정규화 kind를 사용한다. `award`, `honor`, `honour`, `achievement`, `designation`은 `recognition`으로 통합한다. 같은 scope에서 정규화 identity가 같으면 신규 생성과 AI 후보 승인 시 기존 node에 자동 병합한다. 이름만 같고 kind가 다른 node는 자동 병합하지 않는다.

### 조직 온톨로지 검증

조직은 허용 node kind·edge predicate 사전(`ontology`)과 검증 모드(`ontologyMode`)를 설정할 수 있다(`PATCH /api/organization`, admin·owner). 검증은 node 생성, edge 생성, AI 후보 승인에 적용되며 정규화(NFKC·소문자·kind alias)된 용어로 사전과 비교한다. 빈 목록은 해당 축을 검증하지 않는다.

신규 조직은 기본 사전과 `warn` 모드로 생성된다. 기본 node kind는 AI 추출 프롬프트의 기본 kind 목록과 동일한 13개(person, organization, product, service, project, technology, location, recognition, certification, role, event, document, concept)이고, 기본 edge predicate는 범용 10개(depends_on, uses, owns, part_of, member_of, works_for, located_in, integrates_with, produces, manages)다. 기존 조직의 설정은 변경되지 않는다.

- `off`: 검증하지 않는다.
- `warn`: 쓰기를 허용하고 성공 응답에 `ontologyWarnings: [{ "type": "unknown_kind" | "unknown_predicate", "term": string }]`를 포함한다(위반이 없으면 필드 생략).
- `strict`: 미등록 용어를 `422` `{ "error": "knowledge ontology violation", "violations": [...] }`로 거부한다. AI 후보 승인은 node·edge 생성과 embedding 호출 전에 거부된다.

`GET .../candidates/:candidateId/duplicates` 응답은 `duplicates`와 함께 `ontology: { "mode": string, "violations": [...] }`를 반환해 검토 화면이 미등록 용어를 표시할 수 있게 한다. 검증 모드가 `off`가 아니고 사전이 비어 있지 않으면 AI 추출 프롬프트에 조직 사전이 힌트로 주입되며, `strict`에서는 entity kind가 사전 값으로 제약된다(predicate는 제약하지 않고 승인 시점에 검증한다).

### 온톨로지 추천

두 endpoint 모두 organization scope `manage` 권한(admin·owner)이 필요하다.

- `GET .../knowledge/ontology/recommendations`: 조직의 graph node·edge와 pending 후보에서 관찰된 용어를 집계해, 사전에 없는 상위 용어를 반환한다. 응답은 `{ "nodeKinds": [{ "term": string, "count": number }], "edgePredicates": [...] }`이며 목록당 최대 20개다. AI 호출 없이 결정적으로 동작한다.
- `POST .../knowledge/ontology/suggestions`: 관찰 용어와 현재 사전을 knowledge extraction 모델에 보내 정제된 용어(동의어 통합·정규화)를 제안받는다. 응답은 `{ "nodeKinds": string[], "edgePredicates": string[] }`이며 사전에 이미 있는 용어는 제외된다. `KNOWLEDGE_EXTRACTION_MODEL`이 설정되지 않았으면 `503`, provider 상한 초과 시 `429`를 반환한다. 요청에는 용어 문자열과 개수만 전달되며 문서 본문은 전송하지 않는다.

추천·제안은 사전에 자동 반영되지 않는다 — admin이 콘솔 설정 화면에서 선택해 `PATCH /api/organization`로 저장한다.

검색은 `GET .../knowledge/nodes?q=<query>&limit=<1-100>`을 사용하며 query는 1–10,000자다. Neighborhood는 `depth=1-5`, `limit=1-200`을 받으며 기본값은 각각 1과 100이다. 두 조회는 호출자가 현재 읽을 수 있고 active·유효한 Memory 또는 ready document chunk 근거가 하나 이상 있는 graph resource만 반환한다.

```bash
curl \
  -H "Authorization: Bearer $AGENT_MEMORY_TOKEN" \
  "$AGENT_MEMORY_URL/api/knowledge/nodes/<nodeId>/neighborhood?depth=2&limit=100"
```

Neighborhood 응답은 `{ "nodes": [...], "edges": [...] }` 형식이다. 서버는 조회 시점마다 graph scope뿐 아니라 각 provenance source의 현재 권한과 상태를 다시 확인한다.

Knowledge extraction을 활성화하면 ready 문서의 각 chunk에서 entity와 relationship candidate를 만든다. Candidate는 source document·chunk, 원래 scope, extraction model을 포함하며 원문 content를 응답하지 않는다.

- `GET .../knowledge/candidates?limit=<1-100>`은 pending candidate를 오래된 순으로 반환하며 기본 limit은 50이다.
- `GET .../knowledge/candidates/<candidateId>/duplicates`는 후보의 모든 entity를 한 번에 조회하고 entity key별로 같은 canonical name·scope의 읽기 가능한 기존 node를 반환한다. Semantic embedding을 생성하지 않는다.
- 후보 조회와 승인은 source scope의 `manage` 권한을 따른다. Organization scope는 `admin`·`owner`, team scope는 team `manager` 이상, user scope는 본인만 검토한다.
- `POST .../accept`와 `POST .../reject` body는 선택형 `{ "reason": string }`을 받으며 reason은 2,000자 이하다.
- 승인은 node·edge, candidate→resource 관계, reviewer audit을 하나의 transaction으로 저장한다. 이미 거절된 후보를 승인하거나 승인된 후보를 거절하면 `409`를 반환한다. Source 문서가 archive 등으로 `ready`가 아니면 `409` `{ "error": "knowledge candidate source document is not ready" }`를 반환한다. 이미 승인된 후보의 재승인은 멱등하며 현재 surviving resource로 해석한 기존 승인 결과를 반환한다.

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

승인 응답은 갱신된 `candidate`와 승격·병합된 `nodes`, `edges`를 반환한다. 거절 endpoint는 같은 body를 받고 갱신된 candidate를 반환하며 Graph resource를 만들지 않는다.

## 통합 Context 검색

`GET .../context/search?q=<query>&limit=<1-100>`은 접근 가능한 memory, document chunk, knowledge node를 검색해 하나의 순위 결과로 반환한다. query는 1–10,000자이며 기본 limit은 10이다.

```bash
curl \
  -H "Authorization: Bearer $AGENT_MEMORY_TOKEN" \
  --get \
  --data-urlencode 'q=checkout rollback' \
  --data 'limit=10' \
  "$AGENT_MEMORY_URL/api/context/search"
```

응답은 통합 순위의 `hits`, 반환 개수인 `count`, source별 후보 개수인 `counts`, 최종 순위 방식인 `ranking`을 포함한다. `ranking`은 reranker가 성공하면 `rerank`, 미설정이거나 provider fallback이 발생하면 `hybrid`다.

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

도구 실행 실패는 `isError: true`와 text 메시지로 반환한다. 알려진 application 오류는 입력·권한·요청 제한을 설명하고, DB·provider 등 예상하지 못한 오류는 내부 상세 없이 `Tool execution failed`로 반환한다.

Streamable HTTP endpoint는 `/api/mcp`다. Better Auth session Bearer token은 session 사용자의 조직 권한을 적용한다. 조직 Agent token은 `X-User-Email`이 없으면 organization scope만 접근하는 service principal 권한을 적용한다. 유효한 조직 Agent token과 `X-User-Email`을 함께 보내면 해당 조직의 활성 멤버를 email로 조회해 그 사용자의 role·team·user scope·개별 access grant를 적용한다. Email은 앞뒤 공백을 제거하고 소문자로 정규화한다. 잘못된 형식이나 빈 header는 `400`, 활성 멤버가 아닌 email은 `403`이며 발급자 권한으로 대체하지 않는다. Session 인증에서는 이 header를 무시하고 session 사용자 권한만 적용한다.

| Tool | 역할 | 주요 입력 |
| --- | --- | --- |
| `context_search` | 전체 Context 통합 검색 | `query`, `limit?` |
| `remember` | Scoped Memory 저장 | Memory 생성 입력 |
| `recall` | Memory 회상: compact text와 구조화 검색 결과 | `query`, `limit?` |
| `forget` | Memory archive로 회상·검색에서 제외 | `memoryId`, `expectedVersion`, `changeReason?` |
| `document_search` | 처리된 문서 chunk 검색 | `query`, `limit?` |
| `knowledge_search` | Knowledge node 검색 | `query`, `limit?` |
| `knowledge_neighborhood` | Graph neighborhood 조회 | `nodeId`, `depth?`, `limit?` |

검색 query는 1–10,000자, limit은 1–100이며 기본값은 10이다. `recall`은 권한이 있고 현재 유효한 Memory만 검색한다. `remembered` text는 결과 하나를 최대 1,200자, 전체를 최대 4,000자로 제한한다. Structured content는 `{ remembered, count, ranking: "hybrid", hits }`이며 각 hit는 공개 `memory`와 `lexicalScore`, `vectorScore`, `score`를 포함한다. `memory.id`와 `memory.version`으로 잊을 대상을 식별한다. RAG·Graph를 함께 조회하려면 `context_search`를 사용하며 reranker는 통합 검색에 적용된다. `knowledge_neighborhood`의 depth와 limit은 HTTP API와 같은 제한을 사용한다.

`remember`는 HTTP Memory 생성과 같은 입력·scope·권한 검증을 사용하고 `{ memory }`를 반환한다. `forget`은 해당 Memory의 `manage` 권한과 현재 version을 요구한다. `expectedVersion`은 1 이상의 정수이며 HTTP `If-Match`와 같은 낙관적 동시성 계약이다. `changeReason`은 선택형 1–1,000자 문자열이다. 성공하면 `{ memoryId, forgotten: true }`를 반환한다. 없는 기억·이미 archive된 기억, 권한 부족, version 충돌은 `isError: true`로 반환한다. Archive는 원본과 revision을 보존하며 영구 삭제를 수행하지 않는다.

서비스는 다음 순서로 도구를 호출한다.

```jsonl
{"name":"remember","arguments":{"kind":"fact","scope":{"kind":"organization"},"title":"Release policy","content":"Deploy after verification.","source":{"type":"agent","agentId":"release-service"}}}
{"name":"recall","arguments":{"query":"Release policy","limit":5}}
{"name":"forget","arguments":{"memoryId":"<returned memory.id>","expectedVersion":1,"changeReason":"Superseded"}}
```

`forget`의 ID와 version은 실제 `remember` 또는 `recall` 응답에서 가져온다. 서비스 principal은 organization scope만 사용하며 사용자 위임은 아래 인증 계약을 따른다.

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

Token은 설정 파일에 직접 commit하지 말고 client의 secret 또는 environment variable 기능으로 주입하라. Agent Studio에서는 MCP registry entry의 `Authorization` header에 `Bearer amt_...` 값을 저장하라. Agent Studio는 로그인 사용자의 `X-User-Email`을 자동으로 전달하므로 해당 사용자가 웹에서 볼 수 있는 개인·팀 문서도 MCP에서 검색할 수 있다. 다른 client는 실제 사용자 email을 `X-User-Email`로 전달하거나 실제 사용자의 Better Auth Bearer token을 사용하라. 조직 Agent token은 조직 내 활성 사용자를 대신할 수 있는 위임 credential이다. 사용자 신원을 검증하고 header를 생성하는 신뢰된 server-side client에만 제공하고 브라우저·모델 인자·외부 요청 header를 그대로 전달하지 마라. Email만으로는 인증할 수 없다. MCP가 `400`을 반환하면 요청 형식과 `X-User-Email` 형식을, `401`이면 token과 발급자의 active admin·owner membership을, `403`이면 위임 사용자의 승인·차단 상태를 확인하라.

## Workspace library reads

검색어 없이 접근 가능한 자료를 탐색할 때 다음 읽기 endpoint를 사용한다. 기존 Memory·Document 검색 endpoint의 `q` 계약은 유지한다.

- `GET /api/memories/library?limit=25&offset=0`: 현재 active이고 유효하며 읽을 수 있는 Memory를 반환한다. 응답은 `{ memories: [...], count, nextOffset }`이고 각 항목은 기존 공개 Memory 형식과 capability를 사용한다.
- `GET /api/documents/library?limit=25&offset=0`: 읽을 수 있는 pending·processing·failed·ready 문서를 반환하며 archived 문서는 제외한다. 응답은 `{ documents: [...], count, nextOffset }`이고 각 항목은 기존 공개 Document 형식이다.

두 목록은 생성 시각 내림차순, 같은 시각이면 ID 내림차순으로 정렬한다. `limit`은 1–100(기본 25), `offset`은 0 이상의 안전한 정수(기본 0)이며 다음 page 계산을 위해 `Number.MAX_SAFE_INTEGER - 101` 이하로 제한한다. `count`는 현재 page의 항목 수이며 총 자료 수가 아니다. 다음 page가 있으면 `nextOffset`으로 요청하고 없으면 `null`을 반환한다. 동시 생성·archive 중에는 offset 기반 page 사이에 항목이 이동할 수 있으므로 새로 고침은 첫 page에서 시작한다.

`GET /api/document-chunks/{chunkId}`는 후보 검토와 Graph 출처 확인을 위한 원문을 반환한다. 응답은 `{ document, chunk: { id, ordinal, content, metadata } }`이다. Document는 기존 공개 응답을 사용하고 object key나 embedding은 노출하지 않는다. 같은 조직의 ready 문서이며 현재 사용자가 source를 읽을 수 있을 때만 반환한다. 없는 chunk, 권한 없는 source, ready가 아닌 source는 모두 `404`로 처리한다. 원본 파일 download endpoint가 아니라 처리된 chunk 원문 조회다.

`GET /api/documents/{documentId}/chunks?limit=25&offset=0`는 ready 문서의 처리된 본문을 순서대로 읽는다. 응답은 `{ document, chunks: [{ id, ordinal, content, metadata }], count, nextOffset }`이며 Document는 기존 공개 응답 형식이다. `ordinal` 오름차순(ID로 동률 정렬)으로 조회하며 `limit`·`offset` 범위와 `count`·`nextOffset` 의미는 위 library endpoint와 같다. 마지막 page 이후에는 `chunks: []`, `nextOffset: null`을 반환한다. 문서 조회와 본문 page는 같은 읽기 transaction snapshot을 사용한다. 다른 조직, 읽기 권한 없음, archived·pending·processing·failed source는 모두 `404`로 처리한다. 원본 파일 bytes나 object key, embedding은 반환하지 않으며 기존 worker의 전체 chunk 조회 계약은 변경하지 않는다.
