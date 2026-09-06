# 온라인투어 일반 Chrome 수집 — staging 전용

> 기존 첫 페이지 pilot과 별도 목록 순회 CLI를 구분한다. `crawl-onlinetour-browser.ts`는 종전 단일 reload 경계를 유지한다. 새 `crawl-onlinetour-browser-lists.ts`는 현재 화면 읽기 또는 명시한 범위·예산 안의 목록 순회용이며, 전체 실사이트 수집과 운영 반영은 별도 승인 대상이다.

## A PC 인수인계 시 주의 — 보관 브랜치

- `tibo/ttang-schedule-fix`는 로컬 수정본 전달용이며 운영·배포 승인이 아니다. 실제 staging 결과와 인증 정보는 포함하지 않는다. 아래 과거 실행 증거 경로는 B PC 로컬에만 남아 있다.
- 푸시 전 오프라인 회귀와 기본 프로젝트 타입 검사를 통과했다. 루트 tsconfig에서 빠지는 변경 스크립트도 별도로 포함해 ES2015 target 타입 검사를 통과했다. 기존 `crawl-all.ts`의 Set spread 5곳은 ES5 target 확장 검사에서 TS2802가 발생하는 기존 코드이며 이번 전달에서 변경하지 않았다. 테스트의 `guard` 타입 누락은 명시적 타입으로 보정했다.
- **후속 실행 전 확인할 미해결 위험:** 목록 adapter가 마지막 페이지를 반환한 뒤 정리 중 받은 429를 내부 실패로 기록해도 `close()`가 정상 반환하면 목록 CLI가 성공 상태를 유지할 수 있다. 검토자의 네트워크 없는 모의 CDP 재현과 코드 확인으로 발견했다. `onlinetour-browser-adapter.ts`의 실패 latch/`close()`와 `crawl-onlinetour-browser-lists.ts`의 cleanup 후 status 결정을 함께 보완해야 한다. 지역 CLI의 종료 시 실패 전파와는 별개다. 이번 요청은 수정본 전달이므로 동작 변경은 하지 않았으며, 이 브랜치의 테스트 통과를 운영 준비 완료로 해석하지 않는다.

## 전 지역 준비 상태

후속 CH→JA 단일 진단에서 `invalid_paused_request`의 직접 조건은 메인 프레임과 다른 frameId로 확인됐다. 요청 목적·생성 주체는 아직 미확정이며 보조 프레임 허용 정책은 변경하지 않았다. JA 화면의 HND/KIX 두 도시는 별도 읽기 전용 staging으로 보존했으나 자동 지역 실행과 상품 수집은 실패 상태다. 이 진단은 문서 전송 허용 1회·상품 0회·재시도 0회이며, EU/HN/US/GS와 전 도시·월 전수 탐색은 미완료다. 이전 코드 검사 결과는 adapter 40개/CLI 6개 및 타입 오류 0이며 이번에는 운영 수집 코드를 수정하지 않았다. 근거는 [onlinetour-scope-workload.md](onlinetour-scope-workload.md)에 기록했다.

## 실행 경계

이 수집기는 기존 운영 크롤러와 별개다. **현재 열려 있는 목록 한 탭을 한 번 새로고침**하고 사이트가 직접 보내는 첫 JSONP 목록 응답만 받는다. 도시·월·정렬·검색값을 입력하거나 API를 직접 호출하지 않는다. 사이트 기본 `GET /v2/flight/international/dcair/list`, `pageNo=1`, `pageSize=20`, `pageYn=Y`만 허용한다. 결과가 1~20건 모두 검증되어도 **부분 범위 `pilot_ready_for_review`**이지 소스 전체 성공/운영 반영 준비 완료가 아니다.

- 실행 대상: 사용자 Google 로그인 상태를 확인한 **일반 Chrome의 기존 User Data**. 임시/전용 프로필·headless·브라우저 재실행·새 context/tab·쿠키 복사·헤더 위장·직접 API fetch는 없다.
- 발견 파일: `%LOCALAPPDATA%/Google/Chrome/User Data/DevToolsActivePort`만 읽는다. 포트 1~65535와 `/devtools/browser/<UUID>` 경로를 엄격히 검증해 `ws://127.0.0.1:...`를 구성한다. HTTP `/json/version` 탐색이나 임의 endpoint 옵션은 없다.
- 기존 탭 메타데이터에서 `https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList`의 정확한 origin/path 탭이 하나여야 한다. 기존 query는 유지하며 동일 탭이 여러 개면 중단한다.
- 같은 context에 `https://myaccount.google.com/` 홈 origin/path 탭이 있어야 한다(`/intro`, 로그인 페이지는 불허). URL 존재만 기록하며 이메일·제목·Google DOM·storage·쿠키는 읽거나 저장하지 않는다. **이는 보수적 사전 증거이지 현재 로그인 유효성이나 이후 세션 만료 방지의 증명이 아니다.** 운영자가 실제 인증 화면을 먼저 확인해야 한다. Google 웹 로그인과 Chrome 동기화는 다르다.

## 전체 순회 설계 합의 — 목록 변동 시 재조회하지 않음

아래는 사용자와 합의한 전체 순회 기준이다. 순회·재시도·중복 제거 판단은 `src/lib/onlinetour-list-traversal.ts`에 구현했다. 기존 Chrome pilot은 그대로 두고, 별도 `src/lib/onlinetour-browser-adapter.ts`와 `scripts/crawl-onlinetour-browser-lists.ts`로 실제 화면 읽기·버튼 조작·응답 관측을 연결한다. **전체 실사이트 수집은 보류**하며, 코드 구현 승인을 대규모 조회나 운영 반영 승인으로 해석하지 않는다.

- 수집 중 전체 건수/페이지 수가 바뀌었다는 이유만으로 해당 도시·월 목록을 처음부터 재조회하지 않는다. 한 시점의 완벽한 스냅샷보다 추가 요청 억제를 우선한다.
- 정상 수신·검증된 상품을 보존하고 상품 ID로 중복 제거한다. 원본 관측 수, 고유 상품 수, 중복 수를 구분해 남긴다. 같은 ID의 값이 달라져도 서로 다른 응답의 필드를 섞어 새 상품을 만들지 않는다.
- 업데이트된 상품만 정확히 식별해 제외할 수 있다고 가정하지 않는다. 페이지 경계 이동에 따른 누락 가능성은 허용하되, 수집 중 목록 변동 사실과 완전성 미확정을 기록한다. 받은 고유 상품 수를 사이트 전체 상품 수라고 표시하지 않는다.
- 변동으로 놓친 상품은 향후 승인된 정기 회차의 확인 대상으로 남기며, 이번 회차에 보충 조회나 자동 재시작을 추가하지 않는다. 정기 실행은 아직 연결하지 않았다.
- 목록 변동 허용은 응답 실패, 접근 제한, 잘못된 데이터, 비정상 급감을 정상 처리하는 예외가 아니다. 401/403/429/CAPTCHA 중단, 유효성 검사, 운영 미반영 경계를 유지한다. 변화 원인을 단순 업데이트로 확정하지 않는다.
- 향후 순회 종료 조건과 요청 상한은 별도로 검증한다. 상품이 늘어날 때마다 마지막 페이지를 무한히 따라가지 않으며 화면이 제공하지 않는 다음 요청을 만들지 않는다.

## 요청 절감 코드 적용 범위 — 오프라인 순회 엔진

`src/lib/onlinetour-list-traversal.ts`는 정규화된 목록 페이지를 읽는 함수 `readPage`를 받아 실제 순회 결정을 실행한다. 브라우저 연결부와 분리되어 있어 합성 자료 재생과 실제 화면 연결에 같은 정책을 적용한다. 기존 `collectBrowserPilot`과 단일 페이지 live CLI는 수정하지 않았다. 아래 오프라인 CLI 외에 별도 browser-lists CLI가 실제 adapter를 주입한다.

1. 목록 응답만 입력으로 사용한다. 개별 상품 상세 조회 함수가 없다. 기존 pilot의 가격·왕복 시간·좌석 엄격 검증을 재사용한다.
2. 출발지·도시·월이 같은 범위는 한 번만 순회한다. 정렬·필터 정보는 조회 범위에서 제거하며 페이지 읽기 함수에 전달하지 않는다. 로컬 가격 정렬/운영 필터 자체를 새로 구현한 것은 아니다.
3. 마지막 페이지 정보와 화면에서 확인한 `nextPageAvailable`을 함께 사용한다. 화면의 다음 이동이 없으면 요청 없이 끝을 확인한다. 다음 이동이 실제 제공될 때만 최초 마지막 페이지 뒤 확인을 최대 한 페이지 허용한다. 증가한 페이지 수를 계속 따라가지 않으며 범위 변동과 완전성 미확정을 남긴다.
4. `transient`로 분류된 일시 오류만 동일 페이지를 한 번 재시도한다. `access`·`validation`·알 수 없는 오류는 재시도하지 않고 이후 범위도 중단한다. 상품 수 변동으로 목록 전체를 재시작하지 않는다. 실제 HTTP/API/CAPTCHA 분류와 대기 취소는 별도 브라우저 연결부가 담당한다. 사이트가 실패 중에도 페이지 번호를 올린 경우에는 같은 페이지를 다시 누를 수 없으므로, 다음 페이지로 건너뛰지 않고 실패로 중단한다.

엔진 기본 제한은 전체 읽기 시도 100회, 범위당 20페이지, 다음 요청 간 5초, 오류 재시도 전 10초다. **전체 실수집의 예상 횟수나 안전 보장 수치가 아니라 코드의 유한 실행 기본값**이다. 현재 오프라인 재생은 실제 요청이 없으므로 대기 함수를 무동작으로 주입한다. 실행 범위는 전달된 범위 목록뿐이며 모든 도시를 발견했다고 주장하지 않는다.

산출물은 정상 고유 상품을 ID별 최초 수신 값 그대로 보존하고, 원본 관측·고유 상품·중복·실패 수를 구분한다. 동일 ID의 새 가격을 이전 행의 다른 필드와 섞지 않는다. `review_ready_with_changes`는 목록 변동이 있는 검토용 결과이며, 항상 `productionReady=false`, `snapshotComplete=false`다. 무응답·잘못된 페이지·행 오류를 목록 변동 경고로 바꿔 성공시키지 않는다. 기존 운영 급감 검사나 운영 병합은 연결하지 않았다.

### 오프라인 실행

```bash
node node_modules/tsx/dist/cli.mjs scripts/replay-onlinetour-list-traversal.ts --fixture scripts/fixtures/onlinetour-list-traversal-offline.json
node node_modules/tsx/dist/cli.mjs --test scripts/test-onlinetour-list-traversal.ts scripts/test-onlinetour-traversal-replay.ts
```

포함된 fixture는 **합성 자료**다. 일시 오류, 중복 조건, 페이지 경계 중복, 건수 증가, 마지막 확인을 재현한다. 이전 실제 상품 행을 재생할 때도 페이지 수·다음 버튼 상태를 합성한 경우 `saved_rows_with_synthetic_paging`으로 명시한다. 둘 다 새로운 실수집이나 실제 화면 연결 검증이 아니다.

재생 결과는 기존 안전한 UUID staging 경로에만 저장한다. `summary.json`의 `offlineOnly=true`, `fixtureEvidence`, `siteRequestCount=0`, `replayedRequestCount`로 실수집과 구분한다. 관측 순서가 실행 요청과 다르거나 성공 후 미소비 관측이 남으면 성공으로 표시하지 않는다. 로컬 JSON 입력만 지원하고 live/endpoint/profile/output 옵션은 없다.

오프라인 검증 기록: 새 순회/재생 테스트 45개와 기존 pilot 회귀 52개, 합계 97개 통과. 프로젝트 설정으로 신규 scripts까지 포함한 TypeScript 진단 0건. 검증 근거는 `.local-crawler/verification/onlinetour_policy_verification.json`, `onlinetour_policy_typecheck_result.json`, `onlinetour_policy_replays.json`이다. 합성 순회는 읽기 재생 4회(그중 재시도 1회), 원본 관측 5행→고유 4상품·중복 1행, `review_ready_with_changes`였다. 저장된 실제 20행의 합성 페이지 재생은 고유 20상품을 보존했다. 실제 사이트 요청은 두 재생 모두 0회다. 운영 데이터·기존 scraper·live pilot 등 보호 파일 8개의 해시가 실행 전과 일치했다.

## 별도 실제 화면 연결부와 제한 시험

- 구현 파일: `src/lib/onlinetour-browser-adapter.ts`, 실행기 `scripts/crawl-onlinetour-browser-lists.ts`.
- 일반 Chrome의 공식 연결 동의를 거쳐 raw CDP로 **정확한 목록 탭 하나만** attach한다. Playwright가 브라우저 전체 초기화 중 멈추는 경우에도 새 브라우저를 만들거나 개인 프로필을 복제하지 않는다. Google 홈은 기존 탭 URL 메타데이터만 확인한다.
- 현재 목록의 `getDcairMainList` 함수에 포함된 출발지·도시·월 리터럴과 실제 DOM을 읽는다. 함수 소스를 가져다 실행하거나 API key를 출력하지 않는다. 확인한 도시 radio·이전/다음 월 button의 정확한 handler를 가진 보이는 요소만 클릭한다. 한 번의 화면 조작으로 도달할 수 없는 범위, 제한 필터, 알 수 없는 화면 상태는 조회 전에 거부한다.
- 다음 페이지는 실제 `#btn_more` 버튼이다. `#pageNo`는 **다음 요청 번호**이며, 사이트가 요청 실패 때도 값을 올릴 수 있다. 숨은 입력값을 되돌리거나 임의 API 호출로 재시도를 만들지 않는다.
- 현재 범위의 첫 페이지는 한 번 reload하고 사이트가 스스로 요청하게 한다. 후속 페이지는 더보기 클릭으로만 요청한다. 응답 시작·HTTP·완료 이벤트를 해당 행동 및 요청 ID에 연결하며, 콜백·범위·페이지·필터·실제 페이지 정보를 검증한다. 이전 응답을 새 수집으로 인정하지 않는다.
- `--inspect --consent-confirmed`는 현재 화면 읽기만 한다. 별도의 상품 조회·새로고침·탭 이동 없이 종료하고 CDP 연결만 해제한다. 실제 현재 화면 읽기 성공 증거는 `.local-crawler/verification/onlinetour_browser_adapter_live_inspect.log`이며, ICN/PQC/202609 및 다음 월 UI, 다음 페이지 번호 2를 읽었고 행동/상품/문서 요청 계수는 모두 0이었다.
- `--run`에는 `--consent-confirmed`, 명시적 범위 JSON인 `--scopes`, `--max-requests`, `--max-pages`가 모두 필요하다. 플래그 없는 실행은 거부한다. 출발지·도시·월 외 필터/정렬/임의 URL은 범위 파일에 넣을 수 없다. 전 지역·전 도시 범위를 자동 발견했다고 주장하지 않는다.
- 상품 조회 상한은 엔진 호출 횟수뿐 아니라 **실제 전송 허용 전**에 검사한다. 소유한 수집 동작에서만 해당 탭의 정확한 목록 API에 한정해 `Fetch` guard를 켜고, 사이트 요청을 수정 없이 허용하거나 초과/작업 밖 요청을 중단한다. URL·헤더·본문·쿠키를 위장하거나 새 API 요청을 만들지 않는다. `permittedProductRequests`는 전송 허용 예약 수, `blockedProductRequests`는 차단 수, `productRequests`는 Network 이벤트에서 관측한 시작 수로 구분한다. 시작 이벤트가 guard보다 먼저 올 수 있으므로 마지막 값을 실제 전송 허용 수라고 단정하지 않는다.
- 문서/DOM 완료 전에 정상 상품을 받았다면 실패 뒤에도 보존한다. `completedPageCounts`와 `incompletePages`/`incompleteRawCount`를 구분하고, ID 중복은 최초 정상 행/매핑 쌍을 유지한다. 뒤 단계 실패나 불완전 페이지 증거가 있으면 최종 상태는 실패이며 요청을 추가해서 성공을 만들지 않는다.
- 결과는 기존 canonical UUID staging에만 쓴다. 실패·부분 결과를 운영 준비 완료로 바꾸지 않으며 `productionReady=false`를 유지한다.

오프라인 연결부 검증: adapter 44개 + CLI 11개 + 기존 회귀 97개, **합계 152개 통과**, 신규 scripts를 포함한 TypeScript 진단 0건. 저장된 실제 20행도 합성 단일 페이지/오프라인 adapter를 통해 새 CLI와 UUID staging까지 통과했으며, 실사이트 요청 증거로 취급하지 않는다. 집계·보호 8파일 해시·오프라인 replay 근거는 `.local-crawler/verification/onlinetour_browser_adapter_checks.json`이다.

2026-09-06 사용자가 승인한 제한 시험은 **ICN/PQC/202609 한 범위, 실제 상품 목록 조회 최대 2회(재시도 포함), 정상 간격 5초**다. 페이지 HTML 및 정적 자산 요청과 상품 목록 조회는 구분한다. 이 승인은 전 도시 수집이나 반복 시험의 무제한 승인이 아니다. 첫 검토에서 실제 전송 요청 상한 및 실패 페이지 증거 보존 결함이 확인되어, 수정·재검토 전에는 상품 조회 시험을 시작하지 않았다. 결과는 아래 실제 검증 기록에 별도 기록한다.

```bash
# 화면 읽기 전용 — 별도의 상품 요청 없음
node node_modules/tsx/dist/cli.mjs scripts/crawl-onlinetour-browser-lists.ts --inspect --consent-confirmed

# 승인된 단일 범위/2회 시험용. 기록 확인 없이 다시 실행하지 않는다.
node node_modules/tsx/dist/cli.mjs scripts/crawl-onlinetour-browser-lists.ts --run --consent-confirmed --scopes .local-crawler/verification/onlinetour_browser_adapter_two_query_plan.json --max-requests 2 --max-pages 2
```

## 기존 단일 페이지 pilot — 승인 후 수동 실행

일반 Chrome의 `chrome://inspect/#remote-debugging` 설정 및 매 연결의 허용 대화상자는 승인받은 운영자가 처리한다. 아래 플래그는 실행 권한 확인이며 Chrome의 실제 동의를 대신하거나 우회하지 않는다.

```bash
# 오프라인 도움말 — 연결/쓰기 없음
node node_modules/tsx/dist/cli.mjs scripts/crawl-onlinetour-browser.ts --help

# 사용자 승인 후에만 실행 (아래 실제 실행 기록 참조)
node node_modules/tsx/dist/cli.mjs scripts/crawl-onlinetour-browser.ts --consent-confirmed
```

연결/동의 대기는 최대 180초이며 연결 뒤 수집 전체는 기본 90초 제한이다(대상 CDP 세션 준비, reload, 응답/본문 대기 포함). 정리의 stop/detach/disconnect는 각각 최대 1초 추가 대기한다. 탭을 다른 페이지로 이동하거나 조건을 변경하지 말고 수집이 끝날 때까지 기다린다. CLI의 출력은 run UUID, 상태, 건수, 부분 범위 여부뿐이다. endpoint·계정 정보·원시 Playwright 오류는 출력하지 않는다.

401/403/429, JSONP API 접근 제한 상태, CAPTCHA/접근 제한 안내는 대상 로딩을 중단하고 실패한다. 네트워크 오류·본문 오류·시간 초과도 실패이며 **자동 재시도는 없다.** 차단 뒤 수동 재실행으로 우회하지 말고 기존 프로젝트 차단/휴식 정책과 사용자 승인을 따른다. 이번 pilot은 운영 차단 회로를 읽거나 쓰지 않으며 예약 실행에 연결하지 않는다.

종료 시 대상 `Page.stopLoading`, CDP 세션 detach, Playwright의 CDP 연결 `browser.close()`(클라이언트 disconnect)를 사용한다. CDP `Browser.close`·사용자 탭 close·기존 context close는 호출하지 않는다. 일반 Chrome은 유지된다.

## 산출물과 검증

고정 저장 위치: 저장소의 `.local-crawler/staging/<새 UUID>/`.

| 파일 | 내용 |
|---|---|
| `raw-products.json` | 첫 응답의 `data.list` 원본 필드. 무효 행도 보존 |
| `flights.json` | 엄격한 검증을 통과한 최대 20개 매핑. 운영 필터/최저가 필터 없음 |
| `summary.json` | 상태, 원본/매핑 건수, 행 번호별 오류, Google 홈 메타데이터 사전 증거, 부분 범위, 시각 |

연결 이전 실패는 산출물 없이 종료할 수 있다. 연결 실패는 생성된 run에 실패 summary만 남긴다. 응답을 못 받은 실패 run의 빈 배열은 **수집 실패 증거**이지 실제 판매 상품 0건의 증거가 아니다. 부분 매핑 파일이 존재해도 summary가 실패면 검토용일 뿐이다.

staging 경로의 모든 조상, `.local-crawler`, `staging`, run 디렉터리에서 symlink/junction과 canonical 경로 불일치를 거부한다. UUID 디렉터리를 독점 생성하고 허용된 세 파일만 `wx`로 쓴다. 쓰기 전 경로를 다시 검증한다. output/cwd/profile/endpoint 지정 옵션은 없다. 테스트에서만 임시 저장소 root와 모의 Browser를 주입한다. Node 경로 확인은 적대적 로컬 프로세스의 동시 디렉터리 교체에 대한 OS 수준 트랜잭션 잠금이 아니므로 해당 디렉터리는 신뢰된 사용자만 수정해야 한다.

- JSONP는 실행하지 않고 기존 `parseOnlineTourJsonp`로 파싱한다. callback 불일치·추가 JavaScript·빈 목록·20건 초과·중복 ID는 실패다.
- 네 시간은 원본이 정확한 `HHmm` 또는 `HH:mm`이고 00:00~23:59여야 한다. 모르는 시간을 채우거나 자르거나 이동시키지 않는다.
- 날짜는 실제 달력 날짜, 복귀 출발일은 출국 출발일 이후여야 한다. 원본의 연도 없는 `MM-DD(요일)`은 기존 mapper의 출국일 기준 연도 규칙을 따른다.
- `adult_price`는 화면 총액으로 보존한다. `adult_fee_price`를 차감하지 않는다. 총액은 양의 안전한 정수, 수수료와 `res_cnt`는 0 이상의 안전한 정수여야 한다. 알려진 좌석 0은 0으로 보존한다.
- 기존 `mapOnlineTourFlight`는 수정하지 않는다. 새 collector의 mapper 입력에서만 legacy 수수료 차감을 중립화하고 총액을 명시적으로 설정한다. raw에는 실제 수수료가 그대로 남는다.
- 현재 확인된 `event_status_code="00"`만 매핑한다. 다른 상태/미지 상태/누락은 `unsupported_event_status`로 실패하며 임의로 예약 가능 상태로 해석하지 않는다.
- 한 행이라도 매핑에 실패하면 `failed_validation`. 성공적인 20건 파싱도 `productionReady=false`, `partialScope=true`다. 상세 예약 가능성이나 미래 가격 유효성을 보장하지 않는다.

## 단계별 진단과 증거 보존

`summary.json.diagnostics`는 이번 실행에서 **관측한** 단계만 기록한다. `stages`에는 CDP 준비, reload 시작/완료, 대상 문서 응답/본문, 상품 요청/응답/본문, 검증 완료, 요청 실패의 최초·최종 경과 밀리초와 관측 횟수가 들어간다. 고정된 단계 이름으로만 집계하여 크기가 제한되며, URL/query·헤더·쿠키·콘솔 원문·HTML은 담지 않는다. `http`에는 대상 문서/API의 마지막 관측 HTTP 상태만 기록한다.

- `waitingAtFailure`: 시간 초과 시 끝나지 않은 대기 조건 목록이다. 명시적인 HTTP/형식/네트워크 오류는 미응답으로 오해하지 않도록 빈 목록이며 오류 이유·HTTP 상태로 구분한다. `cdp_attachment`, `navigation`, `api_request`, `api_response`, `api_body`, `validation`, `document_body`를 구분한다. 여러 조건을 동시에 기다리면 함께 남는다. 접근 제한/형식 오류에서는 해당 실패 이유·HTTP 상태를 먼저 보고 이 목록만으로 원인을 판단하지 않는다.
- `api_response_unmatched`: 상품 응답은 보았지만 이번 reload의 request 이벤트와 연결하지 못한 횟수다. 이 경우 요청이 없었다고 단정하거나 이전 응답을 새 응답으로 채택하지 않는다.
- 상품을 파싱·검증했으면 **문서/reload 대기 전에 메모리에 증거를 보존**한다. 이후 시간 초과나 접근 제한이 나도 정상적인 실패 정리 과정에서 raw/매핑 파일과 실제 건수를 저장한다. 실패 상태를 성공으로 바꾸지는 않는다. 강제 프로세스 종료에 대한 중간 파일 checkpoint는 아니다.
- 종료 후 늦게 도착한 응답은 반환 summary와 저장 파일을 갱신하지 않는다. 원본/매핑 파일을 먼저 독점 저장한 다음 summary를 저장하는 순서는 유지한다.

기존 온라인투어 코드는 도시·출발 월·콜백·페이지 검증, 응답과 변환의 경계를 참고했다. 기존 직접 HTTP fetch/헤더/재시도/운영 쓰기는 가져오지 않았다. 이전 진단은 reload 대기 후 별도 상품 대기를 두지만 새 collector는 전체 90초이며 문서 검증도 기다린다. 이 차이를 구분하려고 기록을 추가했으며, 시간 제한 연장이나 문서 검증 생략으로 성공을 만들지 않았다.

오프라인 재현에서는 정상 상품 수신 뒤 navigation만 멈추면 이전 코드가 raw/mapped 0을 저장하는 결함을 확인했다. 수정 뒤에는 같은 조건에서 `failed_timeout`, 수신 건수 보존, `waitingAtFailure=["navigation"]`이 된다. **이 결함의 재현은 과거 실사이트 시간 초과의 원인이 확정됐다는 뜻이 아니다.** 이번 단계에서는 실Chrome 연결/실사이트 재요청을 하지 않았다.

보강 후 검증: 관련 테스트 **52/52**, CLI·테스트를 포함한 TypeScript 진단 **0건**, 기존 응답 계약/접근 제한 회로 테스트 통과. 증거: `.local-crawler/verification/onlinetour_debug_tests.json`. HTTP 403/500을 받았을 때 `api_response` 미응답으로 잘못 표시하던 진단 문제도 실패 테스트로 재현 후 수정했다. 명시 오류의 대기 목록은 비우고, 받은 HTTP 상태와 실패 이유를 남긴다.

## 오프라인 검증

```bash
node node_modules/tsx/dist/cli.mjs --test scripts/test-onlinetour-browser-collector.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

테스트는 실제 공개 샘플에서 필요한 필드만 옮긴 고정 fixture와 모의 브라우저로 작동한다. `.local-crawler/verification/onlinetour-probe-products.json`이 있으면 저장된 실제 20행을 **합성 JSONP envelope로 감싼 오프라인 replay**도 검증한다(없으면 그 테스트만 skip). fixture/replay를 새 실사이트 수집 결과로 보고하지 않는다. 네트워크/Chrome 연결은 없고 임시 테스트 디렉터리는 삭제한다.

전 도시/월 순회, 다음 페이지, 상세 확인, 운영 cache 병합, 타 여행사 필터, 자동 일정, 회로 갱신, commit/push/deploy는 범위 밖이다.

## 실제 검증 기록 — 2026-09-06

- 독립 브라우저 진단의 단일 reload에서는 HTTP/API 200, 푸꾸옥 2026-09 상품 20행을 받았다. `.local-crawler/verification/onlinetour-network-diagnosis.json`과 `onlinetour-probe-products.json`에 증거가 있다.
- 실제 Chrome의 상품 카드 20개와 위 응답을 화면 순서로 대조하여 네 시간/총액/좌석 20개 모두 일치했다. 증거: `.local-crawler/verification/onlinetour-screen-comparison.json`.
- 새 CLI의 실제 실행 `2f1ffc99-274c-4f54-87b5-f50639dbeb62`는 **90초 제한으로 `failed_timeout`, raw/mapped 0**이었다. 증거: 해당 staging run의 `summary.json`과 `.local-crawler/verification/onlinetour-cli-live.log`. 접근 제한으로 판정된 실행은 아니며, 이전 진단 성공을 새 CLI 성공으로 취급하지 않는다. 실패 뒤 자동 재시도하지 않았다. 요청 미발생/응답 지연/수신 처리 지연의 세부 구분은 아직 미확정이다.
- 부모의 관련 테스트 46개 통과, 기존 scraper-contracts/source-circuit 통과, `npm run build` exit 0. 테스트·합성 envelope replay는 오프라인 검증이지 새 CLI의 실수집 성공 증거가 아니다.
- 실행 전후 운영 cache/crawl-log, package-lock, 기존 온라인투어 scraper/runner의 SHA-256 일치와 일반 Chrome 프로세스 유지 확인. **당시 단일 페이지 pilot 상태는 코드·오프라인 검증 완료, 새 CLI 실수집 안정화 미완료, 운영 미반영**이었다. 이후 별도 연결부 시험은 아래에 기록한다.

## 실제 연결부 제한 시험 — 2026-09-06 후속

- 최종 코드 검토는 `onlinetour_browser_adapter_review_chronology.json`에서 통과했다. 1차 검토의 redirect/읽기 전용/부분 증거/재시도/실제 전송 상한 결함과, 후속 검토의 관측 순서 중복 처리 결함을 수정했다. 최종 재검토의 adapter 해시는 앞선 범위 검토와 동일하며 마지막 검토는 변경된 순서 처리 부분에 한정됐다.
- 새 자동 CLI 실행 `a2d9957a-db4d-4fc4-be67-30d2a013ea0c`는 exit 1, `failed/request_budget_exhausted`다. 브라우저 새로고침 2회·읽기 재시도 1회를 사용했고, 실제 전송 허용 및 Network 시작 관측 상품 요청은 1회였다. **첫 페이지 20행을 정상 검증·staging 저장**했지만, 읽기 시도 상한을 소진해 두 번째 페이지 전에 중단했다. 최초 재시도의 자세한 원인은 이 summary만으로 확정하지 않는다.
- 승인한 실제 상품 조회 2회 중 남은 1회를 사용하여, 새로고침 없이 기존 화면의 더보기만 읽었다. 일회성 검증 도구 `.local-crawler/verification/onlinetour_browser_adapter_finish_page2.ts`는 위 source run·현재 scope·다음 번호 2·보이는 버튼을 확인하고 **실제 adapter.readPage(scope, 2, 1) 한 번**, 전송 허용 상한 1회, 재시도 없이 실행했다. 도시/월/필터 이동이나 전체 재시작은 하지 않았다.
- 이어진 진단 run `3cdecc05-9fa7-4e58-83ba-8038fb40f8a2`는 exit 0, `page_diagnostic_ready_for_review`, 정상 2행이다. 실제 더보기 클릭 1회·상품 전송 허용/관측 1회·문서 요청 0회였고, 응답 총수 22·마지막 페이지 2·`nextPageAvailable=false`를 확인했다.
- 두 run의 정확한 raw/Flight/summary를 다시 읽어 **원본 22행, 고유 ID 22개, 중복 0개, 상품 전송 허용 합계 2회**를 검증했다. 행의 네 시간·총액·좌석은 기존 엄격 validator/mapper를 통과했다. 이번 22개에 대한 별도의 화면 값 전수 대조를 했다고 주장하지 않는다.
- 자동 CLI 단독으로 한 번에 끝까지 완료한 것은 아니다. 첫 run의 실패 상태는 유지하며, 후속 더보기 진단을 붙여 최초 run을 성공으로 바꾸지 않았다. `singleAutomaticRunSucceeded=false`, 전 도시/월 수집 미실행, 운영 미반영이다.
- 두 연결 정리 완료, 새 실행 프로세스 종료, 일반 Chrome 유지, 보호 8파일 SHA-256 불변을 확인했다. 최종 증거: `.local-crawler/verification/onlinetour_browser_adapter_live_verification.json`. **승인한 2회의 상품 조회는 모두 사용했으므로 자동 추가 실행하지 않는다.**

## 자동 연속 실행 확인 — 2026-09-06

- 후속 사용자 승인: 푸꾸옥·2026-09 단일 범위, 상품 조회 예상 2회/상한 3회, 정상 간격 5초, transient 동일 페이지 10초 후 1회 재시도, 접근 제한 즉시 중단, staging-only.
- 원인: CLI가 동일한 `maxRequests`를 실제 전송 허용 수와 엔진 읽기 시도 수 모두에 적용했다. 상품 요청이 없었던 문서 실패도 읽기 시도 상한을 소진했다. CLI에서 읽기 시도 상한만 `maxRequests * 2`로 분리했다. adapter의 UI 동작 전/전송 전 상품 상한, 페이지별 최대 1회 재시도, 접근 제한 중단은 변경하지 않았다. 엔진 `requestCount`는 여전히 시도 수다.
- 회귀 테스트: 첫 문서 실패(상품 요청 0) → 첫 페이지 재시도 → 두 번째 페이지 자동 완료를 RED/GREEN으로 확인. 상품 상한 1이면 더보기를 누르지 않는 반대 조건도 검증했다. 관련 153개 사례 통과(Node wrapper 110개 중 adapter wrapper 1개를 실제 44개 사례로 대체), TypeScript 진단 0. 독립 리뷰를 다시 했다는 뜻은 아니다.
- 실제 자동 run `79beb106-e433-4821-9099-a466d4ca7907`: exit 0, `review_ready`, 168.693초. 읽기 시도 3회/재시도 1회, **실제 상품 전송 허용·관측 2회**, 문서 요청 2회, 초과 요청 차단 0회. 페이지 2개, 원본/고유 상품 22개, 중복 0개, 실패 행/페이지 0개, 마지막 화면 확인 완료. 최초 읽기 실패는 자동 복구됐지만 세부 원인이 확정된 것은 아니다.
- 동일 UUID의 raw/Flight/summary 재읽기로 건수·고유 ID·총액·terminal 확인, 연결 정리/프로세스 종료/일반 Chrome 유지, 보호 8파일 SHA 불변 검증. 단일 자동 실행 완주이며 이전 두 run을 합친 결과가 아니다. `productionReady=false`, 전체 도시/월 수집·운영 반영·배포는 하지 않았다.
- 증거: `.local-crawler/verification/onlinetour_budget_red.log`, `onlinetour_budget_green.log`, `onlinetour_budget_live.log`, `onlinetour_budget_verification.json` 및 해당 staging run.
