# GA4 → 어드민 연동 절차

> 작성: 2026-08-14. 목적: 어드민 페이지에서 GA4 링크로 나가지 않고
> 방문자 수·예약 클릭·알림 등록 등 유저 행동 통계를 직접 보는 것.
>
> 아래 1~5단계는 Google 계정 권한이 필요해서 **직접 하셔야 하는 부분**입니다.
> 끝나면 6단계(코드 구현)는 Claude Code에게 "GA4 연동 구현해줘"라고 하면 됩니다.

---

## 원리

GA4에 쌓인 데이터는 **GA4 Data API**로 조회할 수 있습니다. 사람 계정 대신
**서비스 계정**(로봇용 Google 계정)을 만들어 GA4 속성에 "뷰어"로 초대하고,
그 계정의 키를 Vercel에 넣어두면 서버가 GA4에 직접 질의합니다. 비용은 무료입니다
(이 규모에서는 무료 할당량으로 충분).

```
어드민 페이지 → /api/ga-stats (새로 만들 것)
  → 서비스 계정 키로 토큰 발급 → GA4 Data API 조회 → 표/차트 렌더링
```

---

## 1. Google Cloud 프로젝트 준비 (5분)

1. https://console.cloud.google.com 접속 (GA4를 관리하는 Google 계정으로 로그인)
2. 상단 프로젝트 선택 → **새 프로젝트** → 이름 예: `tikitikit-admin` → 만들기
3. 만든 프로젝트가 선택된 상태인지 상단에서 확인

## 2. GA4 Data API 활성화 (1분)

1. 콘솔 상단 검색창에 **"Google Analytics Data API"** 입력
2. 검색 결과에서 선택 → **사용(Enable)** 클릭

⚠️ 비슷한 이름의 "Google Analytics Admin API"가 아니라 **Data API**입니다.

## 3. 서비스 계정 + 키 만들기 (5분)

1. 좌측 메뉴 **IAM 및 관리자 → 서비스 계정** → **서비스 계정 만들기**
2. 이름 예: `ga4-reader` → 만들기
3. "역할 부여" 단계는 **건너뛰기** (프로젝트 역할 불필요 — GA4 쪽에서 권한을 줄 것)
4. 만들어진 계정 클릭 → **키** 탭 → **키 추가 → 새 키 만들기 → JSON** → 생성
5. JSON 파일이 다운로드됨. **이 파일이 비밀번호와 같으니** 절대 git에 커밋하거나
   채팅·메일에 붙여넣지 말 것. 사용 후 안전한 곳(비밀번호 관리자 등)에 보관.

## 4. GA4 속성에 서비스 계정 초대 (3분)

1. https://analytics.google.com → 좌측 하단 **관리(⚙️)**
2. 속성 열에서 **속성 액세스 관리**
3. 우측 상단 **+** → 사용자 추가
4. 이메일: 3번에서 만든 서비스 계정 이메일
   (JSON 파일 안 `client_email` 값, `ga4-reader@tikitikit-admin.iam.gserviceaccount.com` 형태)
5. 역할: **뷰어(Viewer)** — 더 높은 권한 불필요
6. 추가

같은 화면에서 **속성 ID**도 확인해 둘 것: 관리 → 속성 설정 → **속성 ID** (숫자,
예: `4XXXXXXXX`). 측정 ID(`G-BR7YJGLJ05`)와 다른 값이니 주의.

## 5. Vercel 환경변수 등록 (5분)

Vercel 대시보드 → 프로젝트 → **Settings → Environment Variables** 에 3개 추가
(Production 환경):

| 이름 | 값 |
|------|-----|
| `GA4_PROPERTY_ID` | 4단계에서 확인한 숫자 속성 ID |
| `GA4_CLIENT_EMAIL` | JSON의 `client_email` 값 |
| `GA4_PRIVATE_KEY` | JSON의 `private_key` 값 전체 (`-----BEGIN PRIVATE KEY-----`부터 끝까지, 줄바꿈 포함 그대로 붙여넣기) |

로컬에서도 테스트하려면 같은 3개를 `.env.local`에도 추가
(`.env.local`은 이미 gitignore 되어 있음).

## 6. 코드 구현 — Claude Code에게 요청

여기까지 끝났으면 "GA4 연동 구현해줘"라고 하면 됩니다. 구현 내용:

- `/api/ga-stats` 라우트: 서비스 계정 JWT로 토큰 발급 → Data API `runReport` 호출.
  `googleapis` 같은 무거운 의존성 없이 Node 내장 crypto로 구현 가능.
- 어드민에 표시할 항목(안):
  - 일별 방문자·페이지뷰 (최근 14일)
  - 이벤트별 발생 수: `booking_click`(예약 클릭), `alert_setup`(알림 등록),
    `card_click`, `share_flight`, `compare_click`, `deal_alert_setup`
  - 방문 → 예약 클릭 전환율
- 환경변수 없으면 지금의 유저 통계처럼 안내 문구로 폴백.

## 알아두면 좋은 제약

- **이벤트 파라미터별 분석은 추가 설정 필요**: "여행사별 예약 클릭"(`travel_agency`),
  "노선별 클릭"(`route`) 같은 파라미터 단위 집계는 GA4에서 해당 파라미터를
  **맞춤 측정기준(Custom Dimension)** 으로 등록해야 API로 조회 가능
  (관리 → 맞춤 정의 → 맞춤 측정기준 만들기, 이벤트 범위). 등록 시점 이후 데이터부터 집계됨.
- **데이터 지연**: GA4 표준 속성은 데이터가 24~48시간 지연될 수 있음.
  "오늘 실시간"이 아니라 "어제까지의 추이"를 보는 용도.
- **처음 며칠은 숫자가 비어 보일 수 있음**: 맞춤 측정기준 등록 전 데이터는
  파라미터 분해가 안 되기 때문. 이벤트 총량은 과거분도 조회됨.

---

## 체크리스트 (2026-08-14 Claude Code가 브라우저로 1~4, 6 수행)

- [x] 1. Cloud 프로젝트 생성 — `tikitikit-admin`
- [x] 2. Google Analytics **Data** API 활성화
- [x] 3. 서비스 계정 + JSON 키 — `ga4-reader@tikitikit-admin.iam.gserviceaccount.com`.
      최초 키(`92556d77f851…`)는 파일이 저장되지 않아 못 쓰게 되어 **삭제**했고,
      2026-08-14에 키를 재발급함: 키 ID `2c8e6276bdfc…`, 파일 `tikitikit-admin-2c8e6276bdfc.json`
      (사용자 PC 바탕화면). 현재 살아있는 키는 이것 하나뿐.
- [x] 4. GA4 속성 액세스 관리에 서비스 계정을 뷰어로 추가 — **속성 ID: `524973369`**
- [x] 5. Vercel에 환경변수 3개 등록 (`GA4_PROPERTY_ID`, `GA4_CLIENT_EMAIL`, `GA4_PRIVATE_KEY`)
- [x] 6. 맞춤 측정기준 — 기존 12개 이미 등록돼 있었음(`travel_agency`, `route`, `partner` 등). `entry_point`(알림 진입점)만 신규 추가
- [x] 7. 코드 구현 (2026-08-14) — `src/lib/ga4.ts`, `src/app/api/ga-stats/route.ts`, 어드민 "방문자와 행동(GA4)" 섹션

### 5번에 넣을 값

| 환경변수 | 값 |
|---|---|
| `GA4_PROPERTY_ID` | `524973369` |
| `GA4_CLIENT_EMAIL` | `ga4-reader@tikitikit-admin.iam.gserviceaccount.com` |
| `GA4_PRIVATE_KEY` | 다운로드한 JSON 파일의 `private_key` 값 전체 |

---

## 구현된 것 (7번)

| 파일 | 역할 |
|---|---|
| `src/lib/ga4.ts` | 서비스 계정 JWT를 Node `crypto`로 서명 → 액세스 토큰 발급 → Data API `runReport` 호출. 외부 의존성 없음. 토큰은 만료 전까지 재사용 |
| `src/app/api/ga-stats/route.ts` | 어드민 키로 보호. 리포트 6개를 병렬 조회해 하나의 JSON으로 반환. 응답은 10분간 캐시 |
| `src/app/admin/page.tsx` | 요약 카드 위쪽에 **"🌐 방문자와 행동 (GA4)"** 섹션 추가 |

조회 항목 (기본 최근 14일, `?days=` 로 2~90일 조정 가능):

- 방문자 / 방문 횟수 / 페이지뷰 (기간 합계 + 일별 막대)
- 행동별 발생 수 — `booking_click`, `affiliate_click`, `detail_open`, `alert_setup`,
  `deal_alert_setup`, `blog_flight_link_open`, `blog_alert_link_open`, `compare_click`,
  `share_flight`, `filter_change`, `date_filter`
- **퍼널** — 방문 → 상세 열람(`detail_open`) → 예약 클릭(`booking_click`).
  핵심 지표는 "전체 방문자 중 몇 %가 예약 페이지로 이동했는지"다.
  "상세를 연 사람 중 몇 %가 예약으로 갔는지"는 상세 화면의 설득력을 보는 보조 지표로 함께 표시한다
- 여행사별 예약 클릭 (`customEvent:travel_agency`)
- 예약 클릭이 많은 노선 (`customEvent:route`)
- 상세를 연 위치 / 알림 등록이 시작된 위치 (`customEvent:entry_point`)
- 유입 경로 (`sessionDefaultChannelGroup`)

### 카드 클릭 이벤트 변경 (2026-08-14)

원래 카드 본문 클릭은 `card_click`만 쏘고 **화면에서는 아무 일도 일어나지 않았다**.
그래서 그 숫자는 "카드를 눌렀는데 반응이 없어 당황한 사람" 수에 가까웠고,
정작 퍼널에서 제일 궁금한 구간(카드의 "예약하기 →" → 상세 시트 열림)은 추적되지 않았다.

바꾼 내용:

- 카드 본문 클릭이 이제 상세 시트를 연다 (`Dashboard.tsx`의 `openFlightDetail`)
- 상세 시트를 여는 모든 경로가 `detail_open`을 쏘고, `entry_point`로 출처를 남긴다 —
  `card_body`, `book_button`, `discovery_bar`, `shared_link`
- `card_click`은 중단. 어드민에는 과거 데이터 해석을 위해
  "카드 빈 곳 클릭 (8/14 이전, 반응 없던 클릭)"으로 남겨두었고, 14일이 지나면 표에서 자연히 사라진다

`entry_point`는 이미 등록된 맞춤 측정기준이라 **GA4에서 추가 설정할 것은 없다.**

### 날짜 필터 측정 보강 (2026-08-19)

날짜 필터가 방문자가 가장 많이 쓰는 조작(최근 14일 31명 중 14명)이라 무엇을 고르는지까지 남긴다.
`date_filter`에 파라미터 4개를 추가하고, 고른 날짜에 표가 하나도 없으면 `date_filter_empty`를 따로 쏜다.

맞춤 측정기준 4개를 GA4에 등록함 (13개 → 17개). **등록 시점 이후 데이터부터 집계된다.**

| 측정기준 이름 | 매개변수 | 값 |
|---|---|---|
| 출발까지 남은 일수 | `days_from_now` | 오늘로부터 며칠 뒤 출발인지 (숫자) |
| 선택한 기간 길이 | `range_days` | 고른 범위가 며칠짜리인지 (숫자) |
| 날짜 선택 방식 | `filter_method` | `calendar` / `preset` |
| 누른 날짜 칩 | `preset_label` | 이번 주말, 다음 주, 이번 달, 다음 달 |

`filter_method`는 GA4 표준 이벤트(share·login)가 쓰는 `method`와 겹치지 않도록 이름을 구분했다.
숫자 두 개는 그대로 나열하면 90줄이 되므로 `/api/ga-stats`에서 구간으로 묶어 어드민에 보여준다.

동작 원칙:

- **환경변수가 없으면** 기존 유저 통계처럼 안내 문구만 보여주고 나머지 어드민은 정상 동작한다.
- **맞춤 측정기준 리포트만 실패해도** 전체가 죽지 않는다. 해당 표만 "불러오지 못했습니다"로 표시되고
  섹션 하단에 ⚠️ 경고가 붙는다 (측정기준 미등록 시 이렇게 보임).
- GA4 무료 할당량을 아끼려고 서버에서 **10분간 응답을 캐시**한다.

### 운영 확인 (2026-08-14 완료)

프로덕션에서 실데이터 조회 성공. 맞춤 측정기준 리포트 4개 모두 정상(경고 없음).
`entry_point`(알림 진입점)만 등록 시점 이후 데이터가 없어 비어 있음 — 정상.

문제가 생기면 순서대로 확인:

1. 속성 ID가 측정 ID(`G-...`)가 아닌 숫자(`524973369`)인지
2. 서비스 계정이 GA4 속성에 **뷰어**로 들어가 있는지
3. `GA4_PRIVATE_KEY`에 `-----BEGIN PRIVATE KEY-----`부터 끝까지 줄바꿈 포함해 들어갔는지
   (Vercel에서 `\n` 문자열로 저장돼도 코드가 실제 줄바꿈으로 바꿔준다)
4. 환경변수를 바꿨다면 **재배포해야 반영**된다 (Vercel은 새 배포부터 적용)

### 도시별 관심과 탐색 깊이 (2026-08-31)

어드민의 도시별 관심은 단순 클릭 수가 아니라 실제 노출을 분모로 비교한다.

- `flight_impression`: 항공권 카드가 화면에 50% 이상 보인 상태로 1초간 유지됐을 때만 기록
- `city_detail_open`: 상세 열람 (`detail_open`과 함께 기록하는 도시 집계 전용 이벤트)
- `favorite_add`: 계정 저장이 실제로 성공했을 때 기록
- `city_share`: 공유 링크 복사 (`share_flight`와 함께 기록하는 도시 집계 전용 이벤트)
- `city_booking_click`: 여행사 예약 페이지 이동 (`booking_click`과 함께 기록하는 도시 집계 전용 이벤트)
- `destination_search`: 입력한 검색어가 현재 항공권의 도착 도시와 정확히 일치할 때 기록

모든 이벤트에 `destination`을 넣고, 도시 측정기준을 사용할 수 없는 환경에서는 기존
`route` 측정기준의 도착 도시를 임시로 합산한다. 임시 합산은 같은 사용자가 여러 출발지의
같은 도시를 본 경우 일부 중복될 수 있으므로 어드민에도 이 제한을 표시한다.

도시별 비율의 분모는 다음과 같다.

- 상세 열람·저장·예약 이동: 실제 항공권 노출 사용자
- 공유: 상세 열람 사용자

`userEngagementDuration`은 탭을 열어둔 시간 대신 실제 활성 시간을 사용한다. 방문당 상세
열람 수와 함께 보조 지표로만 표시하며, 체류시간이 길다는 이유만으로 좋은 방문이라고
판정하지 않는다. 최근 항공권 확인 일수는 Supabase `route_price_daily`에서 실제 기록이
존재하는 날만 센다.

### 네이버 블로그 유입 성과 (2026-09-01)

블로그 글별 링크는 다음 규칙으로 만든다.

```text
?utm_source=naver_blog&utm_medium=referral&utm_campaign=tikitikit_blog_001&utm_content=flight_1
```

- `utm_campaign`: 글마다 다른 `tikitikit_blog_NNN` 값. 기존 DROP은 `tikitikit_drop_NNN`을 유지한다.
- `utm_content`: `top_link`, `flight_1`, `bottom_link` 등 링크 위치. 지금부터 기록하되 화면에는 아직 노출하지 않는다.
- 어드민에는 유입자, 참여 유입률, 상세 열람률, 예약 이동률, 실제 상세로 본 도시를 핵심 지표로 보여준다.
- 평균 체류시간은 보조 지표로만 보여준다.
- 상세로 본 도시는 항공권 노출이 아니라 `city_detail_open`이 발생한 도시만 집계한다.
