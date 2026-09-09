# 지식 워크스페이스 UI

이 문서는 현재 화면의 책임, 공통 상호작용과 검증 근거를 설명한다. 실제 조작 절차는 [사용자 가이드](user-guide.md), HTTP·MCP 입력과 응답은 [API 문서](api.md)를 기준으로 한다. 실행·채팅·도구 조립은 Agent Studio가 담당한다.

## 정보 구조

| 경로 | 화면 | 주요 작업 |
| --- | --- | --- |
| `/` | 비로그인 제품 안내 / 로그인 후 통합 검색 | 로그인, Memory·문서·Graph 검색과 근거 확인 |
| `/guide` | 공개 가이드 | 가입·문서 처리·지식 자동 승인/수동 검토/자동 제외·Agent 연결 안내 |
| `/onboarding` | 가입 요청·접근 상태 | 승인 대기와 접근 제한 안내 |
| `/memories` | Memory | 최신 목록·검색, 생성, 내용·출처, 수정·이력·archive |
| `/documents` | 문서 라이브러리 | 파일 업로드, 처리 상태, 실패 재처리, 처리된 원문 읽기 |
| `/knowledge` | Knowledge Graph | 지식 검색, 지도·노드 목록, 관계와 provenance 확인 |
| `/review` | AI 후보 검토 | 자동 검토 실행·처리 내역, 불확실한 지식의 통합 근거 비교와 부분 승인·거절 |
| `/members`, `/teams` | 회원·팀 관리 | 역할과 소속, 가입 승인, 접근 회수 |
| `/settings` | 조직·애플리케이션 설정 | 조직·온톨로지 및 전역 admin의 runtime override 관리 |
| `/connect` | Agent 연결 | endpoint·token·Studio 등록 템플릿 |

지식 화면은 활성 설치 멤버십을 요구한다. 조직 선택기는 없으며 사용자는 개인·팀·조직 scope로 지식을 구분한다. 조직 관리 메뉴는 admin·owner에게, 팀 메뉴는 관리 가능한 팀이 있는 사용자에게 표시한다. 전역 admin은 멤버십 상태와 관계없이 계정 메뉴에서 애플리케이션 설정에 접근할 수 있다.

## 표현과 상호작용

### 목록과 상세

검색과 라이브러리는 목록에서 대상을 고르고 상세에서 내용·출처를 읽는 구조다. 읽기 권한만 있어도 Memory의 본문과 허용된 근거를 읽을 수 있다. 수정·이력·archive는 서버가 반환한 capability에 따라 제공한다.

Memory는 내용·출처, 수정, 이력을 탭으로 구분한다. 저장 후 목록을 다시 조회해도 선택한 대상과 성공 안내를 유지한다. API 요청이 늦게 끝나더라도 이전 대상의 결과가 새 선택을 덮어쓰지 않도록 처리한다.

문서 원문은 처리된 chunk를 ordinal 순서로 25개씩 조회하고 `본문 더 보기`로 이어 읽는다. 원본 bytes 다운로드와 포맷 변환은 이 화면의 기능이 아니다. 선택한 문서가 바뀌면 이전 본문을 비우고 새 권한을 확인한다.

### 검색과 관계 지도

검색 종류와 query는 URL에 보존한다. 상대 관련도는 현재 결과 사이의 비교이며 신뢰 확률이 아니다. reranker 적용 여부는 [검색 계약](api.md#통합-context-검색)을 따른다.

Graph의 위치 계산과 선택 상태는 client가, 접근 가능한 node·edge·source 결정은 server가 소유한다. 지도와 키보드로 선택 가능한 노드 목록은 같은 선택을 공유한다. 중심 node가 바뀌면 제한된 depth·limit의 neighborhood를 새로 조회한다.

### 지식 자동 처리와 검토

`/review`는 확인 필요한 지식·청크별 검토·처리 내역으로 나뉜다. 확인 필요한 지식은 동일 scope의 개체·관계를 출처별로 묶으며, 원문과 이유를 비교해 출처를 선택하고 부분 승인·거절한다. 자동 승인이 현재 strict 사전에 막힌 경우도 이 목록에서 확인한다. 빈 추출·검증 대기·자동 처리 완료 항목은 기본 수동 검토 목록에 넣지 않는다.

Graph의 진척 배너는 추출·검증·자동 처리 상태를 표시하며 수동 검토 완료를 뜻하지 않는다. 검색어 우선 처리는 이미 추출된 이름·별칭이 맞는 미완료 후보만 대상으로 하고 재추출하지 않는다. 공개 가이드와 홈페이지의 한국어·영어 설명도 이 흐름을 따른다.

### 반응형·접근성·상태

- 좁은 화면에서는 목록과 선택한 상세를 전환한다. 선택·닫기 때 focus를 옮겨 키보드 탐색을 이어간다.
- 한국어·영어, 라이트·다크·시스템 테마를 제공한다. locale과 theme은 UI 표시를 바꾸며 resource 이름·본문을 번역하지 않는다.
- 가입 대기, 로딩, 초기 상태, 빈 결과, 접근 상실, 실패, version 충돌에 각각 안내와 복구 동작을 제공한다.
- 중립 배경, indigo 강조색, 작은 radius를 사용한다. 위험 작업의 색상을 전역 스타일로 덮지 않는다.

## 구현 위치

| 책임 | 구현 |
| --- | --- |
| 메뉴·역할별 표시·계정 메뉴 | [app-shell.tsx](../src/app/app-shell.tsx) |
| 통합 검색·선택·관계 탐색 | [search-console.tsx](../src/app/search-console.tsx) |
| Memory 상세·수정·이력 | [memory-lifecycle.tsx](../src/app/memory-lifecycle.tsx) |
| 비로그인 홈페이지 | [page.tsx](../src/app/page.tsx) |
| 공개 제품 가이드 | [guide/page.tsx](../src/app/guide/page.tsx) |
| 번역 key와 기본 언어 | [en.ts](../src/app/_i18n/messages/en.ts), [ko.ts](../src/app/_i18n/messages/ko.ts) |

## 비교 화면

다음 이미지는 로컬 합성 fixture로 만든 레이아웃 참고 자료다. 현재 계약·문구·데이터는 위 구현과 사용자 가이드를 우선하며, 이미지로 검색 품질이나 성능을 판단하지 않는다.

- [검색 목록과 근거](ui/after-search.png)
- [Memory 목록과 상세](ui/after-memory.png)
- [원문과 AI 후보 비교](ui/after-review.png)
- [모바일 다크 테마의 문서 읽기](ui/after-document-mobile.png)

## 검증 범위

| 검증 | 근거 |
| --- | --- |
| 공개 화면·로그인·언어·테마 | [home.spec.ts](../e2e/home.spec.ts) |
| 가입 요청·승인·멤버 관리·Memory·MCP 연결 | [workspace.spec.ts](../e2e/workspace.spec.ts) |
| 근거·문서 상태·지연 응답·선택 유지·모바일 | [knowledge-workspace.spec.ts](../e2e/knowledge-workspace.spec.ts) |
| 권한·상태·동시성 및 계층 | unit test, PostgreSQL integration test, `pnpm architecture` |

인증 E2E에는 폐기 가능한 `_e2e` 또는 `_test` DB와 `E2E_AUTHENTICATED=true`가 필요하다. 미설정 시 인증 시나리오는 skip된다. 실행 방법은 [운영 가이드](operations.md#배포-전-확인)를 따른다.

E2E는 문서 worker 결과를 합성 DB fixture로 준비하고 일부 지연·오류 응답을 재현한다. Worker·외부 AI의 실제 운영 상태를 검증하는 검사는 아니다. 처리와 저장소 불변 조건은 application·integration 테스트로 따로 검증한다.
