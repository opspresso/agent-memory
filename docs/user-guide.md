# 사용자 가이드

이 문서는 운영 콘솔에서 지식을 읽고 관리하는 절차를 설명한다. 설치는 [시작 가이드](getting-started.md), 서비스 client의 입력·응답은 [HTTP API와 MCP](api.md)를 따른다. 로그인 전후에 `/guide`에서도 제품 흐름을 읽을 수 있다.

| 하려는 일 | 메뉴 |
| --- | --- |
| 여러 종류의 지식과 근거를 함께 찾기 | [통합 검색](#통합-검색) |
| 기억 생성·수정·이력·보관 | [Memory](#memory-lifecycle) |
| 파일 업로드와 처리된 원문 읽기 | [문서 수집](#문서-수집) |
| 관계와 원문 근거 탐색 | [Knowledge Graph](#knowledge-graph-탐색) |
| 자동 처리 내역 확인·애매한 지식 검토 | [AI 후보 검토](#ai-후보-검토) |
| 서비스에 MCP 연결 | [Agent 연결](#agent-연결) |
| 가입 승인·소속·조직 설정 관리 | [회원·팀·설정](#조직과-팀-관리) |

지식 화면은 활성 설치 멤버십과 scope 권한을 요구한다. 조직 admin·owner에게 관리 메뉴가, team manager에게 팀 메뉴가 표시된다. 전역 admin은 조직 가입 상태와 관계없이 상단 계정 메뉴의 `설정`에서 애플리케이션 설정을 관리할 수 있다.

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

Knowledge·문서 상세의 `검색 진단 정보`를 펼치면 상대 관련도와 lexical·vector score를 확인한다. 상대 관련도는 현재 결과 집합의 최대 양수 score를 100%로 정규화한 표시다. 최대 score가 0 이하이면 모두 0%로 표시하며, 이 값은 정확도나 신뢰 확률이 아니다. reranker는 `모든 지식` 검색과 MCP `recall`에 적용한다. 개별 `Memory`·`Documents`·`Graph` 검색은 hybrid score를 사용한다. 재정렬이 성공하면 최종 score는 reranker relevance이며, 미설정·실패 시 hybrid score를 사용한다. 최소 relevance 설정은 재정렬 성공 시에만 적용하며 결과가 모두 제외될 수 있다.

## Memory lifecycle

`Memory`에서 현재 유효하고 읽을 수 있는 Memory를 최신순으로 둘러보거나 검색한다. `새 Memory`에서 종류·제목·내용·공유 범위를 입력하면 사용자 출처의 Memory가 생성된다. 기본 범위는 개인이며 조직과 팀 범위는 현재 쓰기 권한에 따라 선택한다.

목록에서 항목을 선택하면 상세 패널의 `내용과 출처`, `수정`, `Version 이력` 탭을 사용한다. 읽기 권한만 있으면 내용과 출처만 표시된다. 상세 URL의 `memory` 값으로 직접 진입할 수 있다.

### 상태와 접근

| Memory 상태 | 검색·목록·회상 | ID로 내용 조회 |
| --- | --- | --- |
| active이며 현재 유효 | 읽기 권한이 있으면 표시 | 읽기 권한이 있으면 가능 |
| active지만 만료·미래 유효 | 제외 | 읽기 권한이 있으면 가능 |
| archived | 제외 | 일반 조회에서 제외 |

유효기간이 지났다고 원본이 삭제되지는 않는다. Archive와 만료는 서로 다르며 archive를 되돌리는 UI·API는 제공하지 않는다.

### Revision 생성

1. 상세의 `수정` 탭에서 title 또는 content를 수정한다.
2. 필요하면 다음 사용자가 변경 이유를 이해할 수 있도록 선택 항목인 `변경 사유`를 입력한다.
3. `Revision 저장`을 선택한다.

저장 요청은 화면을 열 때 받은 현재 version을 `If-Match`로 전송한다. 다른 사용자가 먼저 수정했다면 `409` 충돌을 표시하며 최신 상태를 다시 불러와야 한다.

### Version 이력

`Version 이력` 탭을 열면 최신 version부터 25개씩 조회하며 `이전 version 더 보기`로 이어서 읽는다. 이력 조회가 실패하면 해당 페이지를 다시 시도할 수 있고 현재 본문은 계속 읽을 수 있다. Revision에는 당시의 content, source, 유효기간, access grant, 변경 사용자와 변경 사유가 보존된다. 이력 조회에는 `manage` 권한이 필요하다.

### Archive

`Archive`는 Memory를 삭제하지 않고 새 archived version을 만든다. Archived Memory는 일반 검색에서 제외되고 Graph의 유효한 근거로 사용되지 않는다. Graph resource에 다른 읽을 수 있는 유효한 근거가 있으면 해당 resource는 계속 보일 수 있다.

## 문서 수집

`문서 수집`에서 문서 목록과 상태를 확인한다. `문서 업로드`를 선택하고 공유 범위와 파일을 입력한다. 업로드가 완료되면 해당 문서를 상세 패널에서 선택한다.

- user scope: 본인만 선택할 수 있다.
- team scope: 해당 팀 멤버와 조직 `admin`·`owner`가 선택할 수 있다. 먼저 공유할 팀을 선택하라.
- organization scope: 조직 `admin`·`owner`만 선택할 수 있다.

- 지원 형식: TXT·Markdown·CSV·JSON·XML·HTML·PDF·DOCX·PPTX·XLSX·XLS·EPUB (텍스트 파일은 UTF-8)
- 최대 원본 크기: 10 MiB, 추출 결과 최대 512 chunks
- 기본 quota: organization 누적 원본 1 GiB, 처리 대기·진행 100건, 사용자별 시간당 업로드 100건(운영 환경변수로 조정)
- title을 생략하면 파일 이름을 사용한다.

PDF·Office·HTML·EPUB는 본문을 Markdown으로 변환한다. 제목·표·시트·슬라이드 구조는 원본에서 추출할 수 있는 범위에서 보존한다. 스캔 PDF와 이미지 OCR, 암호화 문서, 구형 Word `.doc`·PowerPoint `.ppt`, HWP, 이미지·음성 파일은 지원하지 않는다. 스캔 문서는 OCR을 적용하고 암호화 문서는 암호를 해제한 파일을 업로드하라.

파일 변환은 최대 60초, 출력은 8 MiB다. DOCX·PPTX·XLSX·EPUB는 압축 해제 크기 64 MiB와 항목 수 4,096개를 넘을 수 없다. 한도를 넘으면 문서를 나눠 업로드하라. API의 `sourceUri`는 출처 metadata이며 원격 파일을 내려받는 주소로 사용하지 않는다.

처리 흐름은 다음과 같다.

```text
upload → pending → processing → ready
                         └──→ failed → retry
```

문서 상세에서 상태와 처리 시도 횟수, 실패 사유를 확인한다. 쓰기 권한이 있으면 `failed` 문서의 재처리를 요청할 수 있다. 재처리 요청 성공은 queue 등록 수락을 뜻하며 응답 상태가 여전히 `failed`일 수 있다. 처리 완료를 뜻하지 않는다. 화면은 실제 상태를 최대 2분 동안 확인하며 비활성 탭에서는 조회를 쉬고, 이후에는 새로고침으로 다시 확인한다. 문서가 `pending`에 머물면 document worker가 실행 중인지 확인한다. 원본은 S3 호환 storage에 있고 검색용 chunk와 상태는 PostgreSQL에 저장된다.

`사용 가능`은 문서 검색 준비가 끝났다는 뜻이며 AI 지식 추출과 검증은 별도로 진행된다.

`사용 가능` 문서를 선택하면 상세의 `문서 내용`에서 처리된 원문을 본문 순서대로 읽는다. 한 번에 25개 본문을 불러오며 `본문 더 보기`로 이어서 읽는다. 원본 파일 다운로드가 아니라 검색·Graph에서 사용하는 처리된 원문의 조회다. 다른 문서를 선택하면 이전 본문을 지우고 접근 권한을 다시 확인한다.

문서 삭제는 원본과 provenance를 보존하는 archive다. Archive해도 저장 용량 quota가 줄어들지는 않는다. Archive된 문서는 검색, 상태 조회, retry, AI 후보 검토에서 제외되며 해당 scope의 `manage` 권한이 필요하다.

## Knowledge Graph 탐색

Graph는 개체(node)와 관계(edge)를 연결한 지도다. 관계 이름(predicate)은 두 개체가 어떻게 연결되는지 나타낸다. 원문 근거에서 해당 연결을 뒷받침하는 자료를 확인한다.

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

Node를 선택하면 해당 node와 직접 연결된 관계가 강조되고 inspector가 바뀐다. inspector의 `탐색`을 선택하면 해당 node를 중심으로 neighborhood를 다시 조회한다. 키보드에서는 node에 focus한 뒤 `Enter` 또는 `Space`로 선택할 수 있다.

Neighborhood가 바뀌면서 node 수가 늘거나 줄 수 있다. 서버는 새 중심에서 접근 가능한 source를 다시 검사하고 제한된 depth·limit 안에서 관계를 반환한다.

Graph node와 edge 삭제에는 해당 scope의 `manage` 권한이 필요하다. Edge를 삭제해도 연결 node와 source는 유지된다. Node를 삭제하면 연결 edge도 함께 삭제되지만 근거인 Memory나 document는 유지된다.

이름이 같은 개체가 여러 개 보이면 종류와 원문 근거를 비교한다. 새 개체는 현재 읽을 수 있는 출처 이름으로 동일 개체임을 확인한 경우에만 기존 ID를 사용한다. 표시명이 같다는 이유만으로 자동 병합하지 않는다.

직접 합치려면 `중복 병합`에서 대상을 확인하고 사유를 입력한다. 병합은 출처와 관계를 보존하지만 되돌릴 수 없다. 같은 실제 개체인지 먼저 확인한다.

Graph 화면의 처리 진척은 추출·검증·자동 처리한 청크 수를 표시한다. 수동 검토 완료 수나 추출 정확성 점수가 아니며, 진행 중인 Graph는 전체 자료의 최종 결과가 아니다. 이미 추출된 이름·별칭이 검색어와 일치하는 미완료 후보를 우선 처리하고 `관계 새로고침`으로 새 연결을 불러올 수 있다. 이 작업은 전체 원문 재검색이나 재추출이 아니다.

| 하려는 일 | 조작 |
| --- | --- |
| 개체 위치 고정 | 개체를 드래그한다. 종류 필터로 숨겨도 고정 위치를 유지한다. |
| 지도 이동 | 배경을 드래그한다. |
| 확대·축소 | 휠·핀치 또는 확대·축소 버튼을 사용한다. |
| 모든 개체 보기 | `화면에 맞춤`을 선택한다. |
| 고정을 풀고 다시 배치 | `배치 초기화`를 선택한다. |
| 넓게 보기 | `전체 화면`을 선택한다. 종료 버튼 또는 Esc로 돌아온다. |

모션 감소 설정을 사용하면 초기 애니메이션을 생략한다.

## AI 후보 검토

지식 추출 기능이 켜져 있으면 `ready` 문서의 본문 조각에서 개체와 관계 후보를 만든다. 별도 AI 검증을 통과한 지식은 Graph에 자동 반영한다. 불확실하거나 충돌하는 지식은 사람이 검토한다. 근거가 없거나 사소한 항목은 자동 제외한다.

| 탭 | 확인할 내용 |
| --- | --- |
| `확인 필요한 지식` | 같은 개체·관계의 판단 이유와 문서별 근거. 현재 strict 사전에 막힌 자동 승인 항목도 포함한다. |
| `청크별 검토` | 아직 검토 중인 추출 묶음, 기존 개체와의 중복 안내, 모델 정보 |
| `처리 내역` | 최근 검증 50건의 판단 이유·원문·자동 또는 수동 처리 기록 |

`확인 필요한 지식`에서는 문서·지식 이름으로 검색하고 페이지를 이동할 수 있다. 자동 승인·제외 수와 검증 대기 수도 표시한다. 빈 추출, 검증 대기, 자동 처리 완료 항목은 수동 검토 목록에 나타나지 않는다. 목록의 우선순위나 인용의 존재가 사실 정확성을 보장하지는 않는다.

기존 문서의 미완료 처리를 시작하려면 `AI 자동 검토 실행`을 선택한다. 관리 가능한 `ready` 문서의 미추출 청크와 미검증·자동 처리 미완료 추출을 대기열에 등록한다. 새 추출은 이 버튼을 누르지 않아도 검증한다.

검토할 항목은 다음 순서로 확인한다.

1. 문서 제목과 본문 번호, 개체의 별칭·설명을 읽는다.
2. `원문 펼치기 / 접기`로 본문과 인용 근거를 비교한다. 인용 근거가 없는 기존 추출에는 안내가 표시된다.
3. 같은 이름이라도 다른 사건·시점의 관계인지 확인한다.
4. 반영할 출처를 선택한다. 온톨로지 위반이 있으면 경고를 확인한다. Strict 모드에서는 위반 항목을 승인할 수 없다.

### 승인

`선택한 출처 N곳 승인`은 선택한 출처의 해당 지식만 반영한다. 관계 승인은 양 끝 개체도 함께 승인하며, 같은 청크의 나머지 지식은 대기 상태로 남긴다. 동일 identity의 노드·관계는 새로 만들지 않고 provenance를 누적한다. 출처별 처리는 각각 원자적이며 일부 요청이 실패하면 완료 건수와 오류를 표시하고 목록을 갱신한다.

### 거절

`선택한 지식 거절`은 해당 항목에 reviewer와 사유를 기록한다. 개체를 거절하면 아직 검토하지 않은 연결 관계도 함께 거절한다. 이미 승인한 Graph는 거절로 삭제하지 않는다.

`청크별 검토` 탭에서는 원래 추출 묶음, 기존 노드와의 중복 안내, 모델 정보를 확인하고 남은 항목 전체를 승인·거절할 수 있다. 원래 graph와 항목별 검토 기록은 보존한다.

검토 권한은 candidate의 현재 출처 문서 scope를 따른다. 문서의 공유 범위가 바뀌면 검토 권한도 함께 바뀐다.

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

### 조직 설정과 전역 설정

`설정`은 조직 관리와 설치 운영으로 나뉜다. `조직 프로필`에서 이름·기본 팀을, `지식 사전`에서 검증 모드·node kind·edge predicate와 추천 용어를 관리한다. 두 분류의 입력은 이동해도 유지되며 `설정 저장`으로 함께 저장한다. 기본 팀이 설정되면 신규 회원이 활성화될 때 해당 팀에 배정된다.

전역 admin에게는 `AI 모델`, `문서 처리`, `인증 및 접근`, `스토리지`, `로그 및 모니터링`이 표시된다. 이름 또는 환경 변수로 설치 설정 전체를 검색할 수 있다. 활성 분류는 URL에 보존되며, 조직·설치 설정의 저장 범위는 서로 분리된다.

설정은 다음 순서로 바꾼다.

1. 항목 이름이나 환경 변수로 설정을 찾는다.
2. 현재 값의 출처를 확인한다. 화면은 직접 설정·배포 환경·기본값·미설정으로 구분한다.
3. 값을 바꾸고 저장 바의 변경 수·재시작 대상 수를 확인한다.
4. 해당 저장 범위의 저장 버튼을 선택한다. 저장이 실패해도 입력값은 유지된다.
5. 재시작이 필요한 값을 바꿨다면 모든 앱·worker 인스턴스를 재시작한다. 설정 화면이 서버를 재시작하지는 않는다.

| 조작 | 결과 |
| --- | --- |
| `기본 설정 사용` | 직접 설정한 값의 제거를 예약한다. 저장 전에는 취소할 수 있다. |
| `변경 취소` | 마지막 저장 상태로 돌아간다. |
| 비밀값 입력 | 기존 값은 표시하지 않는다. 교체할 때만 새 값을 입력한다. |
| 비밀값의 `값 지우기` | 빈 값을 저장하도록 지정한다. |
| API 주소 변경 | 연결된 API 키도 명시적으로 교체하거나 제거해야 한다. |
| `ALLOWED_EMAIL_DOMAINS` 비우기 | 모든 이메일 도메인을 허용한다. |

분류 사이를 이동해도 편집값은 유지된다. 다른 페이지로 이동하거나 새로고침·닫기를 하면 미저장 변경을 확인한다. 저장 중에는 입력을 잠근다.

팀을 삭제해도 S3 호환 storage의 문서 원본 object는 자동으로 제거되지 않는다. 원본 삭제가 필요하면 PostgreSQL metadata가 사라지기 전에 대상 object를 식별하거나 운영 환경의 object lifecycle을 따른다.

`ADMIN_EMAILS`의 전역 권한은 최초 owner 준비와 애플리케이션 설정 관리를 허용한다. 기존 조직 안에서는 항상 실제 organization membership과 role을 사용한다.

## Agent 연결

`Agent 연결`에는 현재 사이트 주소에 `/api/mcp`를 붙인 전체 Streamable HTTP MCP endpoint가 표시된다. 조직 slug나 조직 선택 parameter는 사용하지 않는다. `복사`를 선택해 client 설정에 붙여 넣어라.

```text
http://localhost:3100/api/mcp
```

### Credential 준비

Organization `admin` 또는 `owner`는 같은 화면에서 MCP 전용 Agent token을 생성한다. 생성된 원문을 복사해 Agent Studio MCP registry entry의 `Authorization` header에 저장하라. 이후 `Token 보기`로 원문을 다시 확인하고 `Token 숨기기`로 화면에서 제거할 수 있다.

```http
Authorization: Bearer <amt_token>
```

### Agent Studio 연결

1. `Agent 연결`에서 `Agent Studio 등록 템플릿`을 연다.
2. 각 복사 버튼으로 값을 Agent Studio의 `Tools → Register MCP server`에 붙여 넣는다.
3. Headers의 `<amt_token>`을 실제 token으로 바꾼다. 템플릿에는 실제 token이 포함되지 않는다.
4. `Test connection`으로 도구 목록이 보이는지 확인한다.
5. 사용할 project의 version에 서버를 연결하고 실제 호출을 확인한다.

| 항목 | 작성 기준 |
| --- | --- |
| Name | Version이 참조하는 서버 식별자. 조직 이름으로 만들며 새 설치의 기본값은 `agent-memory`다. 이름에서 식별자를 만들 수 없으면 조직 slug를 기준으로 만든다. 식별자가 `-memory`로 끝나지 않으면 이 접미사를 붙인다. |
| URL | 현재 사이트의 `/api/mcp`. Name을 바꿔도 URL은 바뀌지 않는다. |
| Description | 모델과 capability 검색에 전달할 서버의 용도·기능 |
| Headers | Key는 `Authorization`, Value는 `Bearer` 뒤에 공백과 실제 token |
| Content | 선택 항목인 운영자 메모. 모델에 전달되지 않는다. |

모델이 따라야 할 저장 조건·응답 규칙은 version의 system prompt 또는 Skill에 쓴다. 개별 도구의 설명과 입력 schema는 MCP 서버에서 읽는다. Token을 다시 생성하면 version의 header override도 확인한다. 이 값이 registry header보다 우선한다.

### 사용자 위임과 접근 범위

Agent token만 전달하면 발급자에게 귀속되는 organization service principal로 동작하며 organization scope만 검색·변경할 수 있다. Agent Studio는 로그인 사용자의 `X-User-Email`을 함께 전달하므로 해당 조직의 활성 멤버 권한으로 개인·팀 문서와 허용된 Memory도 검색한다. 다른 client는 실제 사용자의 email을 이 header로 전달하거나 해당 사용자의 Better Auth Bearer token을 사용하라. 조직 Agent token은 조직 내 사용자를 대신할 수 있으므로 사용자 신원을 검증하는 신뢰된 server-side client에만 제공하라. 잘못된 email은 `400`, 활성 멤버가 아닌 email은 `403`으로 거부한다.

### 도구 선택과 자동 회상

| 작업 | MCP 도구 |
| --- | --- |
| 기억 저장·회상·잊기 | `remember`, `recall`, `forget` |
| Memory·RAG·Graph 통합 검색 | `context_search` |
| 문서 또는 Graph 검색 | `document_search`, `knowledge_search` |
| Graph 관계 탐색 | `knowledge_neighborhood` |

도구의 입력과 응답 형식은 [MCP 계약](api.md#mcp)을 따른다.

Agent Studio에서 version에 서버를 직접 bind하고 `memoryRecall`을 켜면 실행 전 `recall`을 호출해 관련 Memory를 system prompt에 넣는다. Binding의 도구 선택에서 `recall`을 허용해야 하며 dynamic discovery만으로 추가된 서버는 자동 회상 대상이 아니다. `remembered` text는 전체 4,000자로 제한된다. 서비스는 `remember`로 기억을 저장하고, `recall` 결과의 Memory ID·version을 `forget`에 전달해 기억을 archive한다. 잊기에는 해당 Memory의 manage 권한이 필요하다. Memory 회상에도 설정된 reranker를 적용하며 실패하면 hybrid 순위로 복귀한다. RAG·Graph를 포함한 통합 검색은 `context_search`를 사용한다.

재생성은 이전 token을 즉시 무효화하며 폐기하면 연결된 Agent가 더 이상 인증되지 않는다. Hash만 저장된 기존 token은 한 번 재생성해야 `Token 보기`를 사용할 수 있다. Token lifecycle과 MCP client 설정 예시는 [HTTP API와 MCP](api.md#조직-agent-token)를 따른다.
