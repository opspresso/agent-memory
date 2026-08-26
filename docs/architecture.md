# Architecture

Agent Memory는 여러 Agent가 공유하는 장기 memory와 검색 Context를 조직 경계 안에서 제공하는 독립 플랫폼이다. 필요하면 Agent Studio를 비롯한 Agent 실행 환경과 연동할 수 있다.

## 계층과 의존성

```text
src/app  ──▶ src/lib ──▶ src/application ──▶ src/domain
                   └──▶ src/infrastructure ──▶ src/domain
```

- `src/domain`은 entity, 접근 정책, repository port를 소유한다. 다른 내부 계층과 third-party package에 의존하지 않는다.
- `src/application`은 use case를 조립하며 domain에만 의존한다.
- `src/infrastructure`는 PostgreSQL, S3, pg-boss, embedding, observability adapter를 구현한다. application과 app에 의존하지 않는다.
- `src/app`은 UI와 HTTP entry point를 제공하고 infrastructure를 직접 선택하지 않는다.
- `src/lib`은 인증·HTTP 변환과 composition root를 제공한다. infrastructure adapter를 application use case에 주입하고 app에 준비된 operation을 노출한다.

`dependency-cruiser.config.cjs`와 `eslint.config.mjs`가 이 방향과 순환 의존성 금지를 검사한다.

## 요청 경계

조직 API 요청은 다음 경계를 통과한다.

1. Route가 path와 query 또는 body를 검증한다.
2. Better Auth session 또는 Bearer token으로 사용자를 인증한다.
3. URL의 `organizationId`로 조직 멤버십과 팀 역할을 조회한다.
4. Application use case가 scope와 action에 대한 domain 정책을 적용한다.
5. Repository가 모든 조회와 변경을 `organizationId`로 제한한다.
6. 공개 응답 변환기가 권한에 따라 ACL과 내부 필드를 제거한다.

브라우저의 unsafe method는 요청 origin이 실제 또는 설정된 application origin과 같아야 한다. Bearer 요청은 Agent 호출로 취급한다.

Better Auth의 user·session 생성 hook은 설정한 email domain을 인증 경계에서 검사한다. 전역 admin email은 조직 bootstrap만 허용하며, 생성된 조직 안에서는 다른 사용자와 동일하게 organization membership과 role 정책을 따른다.

## Scope와 권한

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

원본은 S3 호환 스토리지에 저장하고 metadata와 처리 상태는 PostgreSQL에 저장한다. Worker는 처리 claim마다 lease ID를 발급하므로 stale worker가 재claim 이후의 chunk나 상태를 덮어쓸 수 없다. 지원 MIME type의 text를 정규화하고 chunk를 생성하며, 실패한 문서는 안전한 공개 오류와 `failed` 상태를 남겨 retry 요청으로 다시 queue에 넣는다. 최초 queue 등록이 실패해도 document ID를 반환해 복구 경로를 유지한다. 검색은 `ready` 상태이고 호출자가 읽을 수 있는 chunk만 반환한다.

Knowledge extraction model을 설정하면 별도 pg-boss queue가 ready 문서의 chunk에서 entity와 relationship 후보를 생성한다. 이 실패는 문서의 ready 상태나 검색 가능성을 되돌리지 않는다. 후보는 source chunk, scope, model을 보존하며 chunk별로 중복 생성하지 않는다. AI 생성 결과는 graph에 직접 쓰지 않고 해당 scope의 `manage` 권한을 가진 사용자가 검토한 뒤 승격한다. 승인 transaction은 candidate를 잠그고 node·edge upsert와 reviewer audit을 함께 저장한다.

## Knowledge Graph와 통합 검색

Knowledge node와 edge는 scope와 여러 provenance를 가진다. 각 provenance 행은 DB constraint로 정확히 하나의 memory 또는 document chunk를 참조한다. Canonical resource가 여러 근거에서 발견되면 resource를 중복 생성하지 않고 provenance를 누적한다. 생성 시 호출자가 source를 읽을 수 있어야 하고 graph scope는 source scope보다 넓을 수 없다. 검색·Neighborhood·edge 생성은 source의 현재 권한과 active·유효·ready 상태를 다시 확인한다.

AI candidate는 graph와 분리된 검토 queue다. 거절은 graph를 변경하지 않으며, 승인된 candidate는 다시 거절할 수 없다. 승인·거절에는 reviewer와 선택형 사유를 남긴다.

통합 Context 검색은 같은 인증·scope 조건으로 memory, document chunk, knowledge node를 각각 검색하고 score 순으로 하나의 결과를 만든다. API와 MCP는 동일한 application operation을 사용한다.

## 관측성과 민감정보

Pino는 작업명, organization ID, 결과 수, 처리 시간을 구조화해 기록한다. 검색어와 본문은 retrieval log에 포함하지 않는다. Langfuse key가 모두 설정되면 OpenTelemetry trace를 내보내며 token과 secret을 마스킹하고 media upload를 비활성화한다. Embedding 입력과 출력은 telemetry 대상이 아니다.
