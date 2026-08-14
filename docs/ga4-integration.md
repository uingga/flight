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
- [x] 3. 서비스 계정 생성 + JSON 키 다운로드 — `ga4-reader@tikitikit-admin.iam.gserviceaccount.com`, 키 파일 `tikitikit-admin-92556d77f851.json` (사용자 PC에 저장)
- [x] 4. GA4 속성 액세스 관리에 서비스 계정을 뷰어로 추가 — **속성 ID: `524973369`**
- [ ] 5. Vercel에 환경변수 3개 등록 (`GA4_PROPERTY_ID`, `GA4_CLIENT_EMAIL`, `GA4_PRIVATE_KEY`) ← **사용자가 직접**
- [x] 6. 맞춤 측정기준 — 기존 12개 이미 등록돼 있었음(`travel_agency`, `route`, `partner` 등). `entry_point`(알림 진입점)만 신규 추가
- [ ] 7. Claude Code에 "GA4 연동 구현해줘" 요청

### 5번에 넣을 값

| 환경변수 | 값 |
|---|---|
| `GA4_PROPERTY_ID` | `524973369` |
| `GA4_CLIENT_EMAIL` | `ga4-reader@tikitikit-admin.iam.gserviceaccount.com` |
| `GA4_PRIVATE_KEY` | 다운로드한 JSON 파일의 `private_key` 값 전체 |
