---
description: 블로그 포스트 내용 수정 가이드
---

# 블로그 포스트 가이드

> ⚠️ **쓰레드 글** 수정은 이 파일이 아닙니다! `/threads` 워크플로우를 참고하세요.

블로그 포스트는 **두 종류**로 나뉩니다:
- **A. 일일 특가 포스트** — `generate-blog.js`로 자동 생성, 매일 발행
- **B. 정보성 포스트** — 수동 작성, 에버그린 콘텐츠

---

## A. 일일 특가 포스트 (땡처리 Top 5)

### 생성 방법

// turbo
1. `node scripts/generate-blog.js` 실행
2. 스크립트가 자동으로 수행:
   - `all-flights-cache.json`에서 Top 5 특가 추출
   - 카드 이미지(rank_1~5.png, icn_1~3.png) 스크린샷 캡처
   - 네이버 블로그용 HTML 파일 생성 (`blog-post-YYMMDD.html`)
3. 썸네일 이미지 2종 생성 (아래 참고)
4. 생성된 `public/blog-post-YYMMDD.html`을 브라우저에서 확인
5. Ctrl+A → Ctrl+C → 네이버 에디터에 Ctrl+V

### 썸네일 / 헤더 이미지 생성

매 포스트마다 **2종**의 이미지를 생성:

#### 1. 정사각형 썸네일 (1:1) — 네이버 대표이미지용
- `generate_image` 도구로 AI 생성
- 3분할 세로 패널 배경 (TOP 5 중 대표 3개 도시)
- 텍스트 3줄: "오늘의 땡처리 항공권" / "특가 TOP 5" / "18만원대~"
- 저장: `public/thumbnail-YYMMDD-square.png`

#### 2. 와이드 헤더 (2:1, 960x480) — 포스트 상단 배너용
- `public/blog-thumbnail-template.html`을 수정 후 Playwright로 캡처
- 3분할 세로 패널 배경 (경계선 없이 자연스럽게 붙인다)
- 텍스트: 포스트 제목 (예: "[2/27] 땡처리 항공권 특가 Top 5 🔥 / 다카마쓰 왕복 18만원대 ✈️")
- 하단에 "티키티킷 tikitikit.kr" 뱃지
- 캡처 명령:
```
node -e "const {chromium}=require('playwright'); (async()=>{const browser=await chromium.launch(); const page=await browser.newPage({viewport:{width:960,height:480}}); await page.goto('http://localhost:3000/blog-thumbnail-template.html'); await page.waitForTimeout(2000); await page.locator('#wide-banner').screenshot({path:'./public/thumbnail-YYMMDD-wide.png'}); await browser.close();})();"
```
- 저장: `public/thumbnail-YYMMDD-wide.png`

### ⚠️ 실행 전 주의사항

- **로컬 dev 서버가 실행 중이어야 합니다** (`npm run dev`)
  - 카드 스크린샷을 localhost에서 캡처하기 때문
- **캐시 데이터가 최신인지 확인** — 매진·편도 항공권이 남아있을 수 있음
  - 편도 확인: `sDate === eDate`면 편도
  - 사이트에서 실제 존재하는지 확인 권장

### 수정 가능 영역

| 영역 | 위치 |
|------|------|
| 도시별 여행 설명 | `CITY_DESCRIPTIONS` 객체 |
| 시즌 관련 텍스트 | `SEASON_CONTEXT` 객체 |
| 항공권 꿀팁 | `TIP_POOLS` 배열 |
| Top 5 선정 기준 | `selectTop5WithIncheon()` 함수 |
| 인사말/도입부 | `generateBlogHTML()` 내 intro 영역 |
| 에디터 추천 | `generateEditorPick()` 함수 |
| 해시태그 | `generateBlogHTML()` 하단 |

### 수정 후 확인

// turbo
1. `node scripts/generate-blog.js` 실행
2. 생성된 HTML을 브라우저에서 확인

---

## B. 정보성 포스트 (에버그린 콘텐츠)

수동으로 작성하는 검색 유입용 포스트. 한번 쓰면 오래 효과 지속.

- 기획 목록: `docs/blog-content-calendar.md` 참고
- 파일명: `public/blog-post-{번호}.html`
- 스타일: 기존 01, 02번 포스트 형식 참고

---

## CTA 전략 (필수 준수)

> ⚠️ **광고 느낌 나는 CTA 절대 금지!** 보라색 버튼, "👉 확인하기" 스타일 링크 사용하지 않음.

### 원칙
- CTA 버튼/배너 **0개**
- 사이트 노출은 **자연스러운 문맥 안에서만**
- 독자가 "이건 광고다"라고 느끼는 순간 실패
- **여행사 이름(모두투어, 노랑풍선 등) 절대 나열하지 않음**
- **"5곳" 같은 구체적 숫자 쓰지 않음** — "여러 여행사"로 표현

### 허용되는 노출 방식
1. **데이터 출처 표기** — 표/가격 아래에 작은 글씨로 `*가격 데이터 출처: 티키티킷(tikitikit.kr)`
2. **P.S. 한 줄** — 글 마지막에 `P.S. 여행사 땡처리 특가 비교는 tikitikit.kr에서 하고 있습니다.`
3. **팁 안에 실행 방법으로 녹이기** — "~하려면 tikitikit.kr이 편합니다" (단, 과하면 삭제)

### 링크 삽입 위치 (모든 포스트 공통)
| 위치 | 문구 | 스타일 |
|------|------|--------|
| TOP 5 가격 아래 | `*가격 데이터 출처: 티키티킷(tikitikit.kr)` | 13px, #999 |
| 에디터 픽 마지막 | `👉 다른 날짜도 궁금하다면 tikitikit.kr에서 확인해보세요.` | 14px, #999 |
| 인천 출발 섹션 소제목 | `(tikitikit.kr 기준 실시간 최저가)` | 13px, #999 |
| 하단 CTA | `tikitikit.kr` (기존 유지) | cta-link 스타일 |

### 마무리 스타일
- 댓글 유도형 ("실패담/성공담 공유해주세요")
- A/B 선택형 ("어떤 스타일이신가요? 댓글로")
- 거짓 경험 금지 — 직접 경험 없으면 "주변에서 들었다" 식으로

---

## 저장 유발 콘텐츠 점검 (발행 전 체크)

> 발행 전에 아래 항목으로 글을 점검한다. 5개 이상 ✅이면 저장 잘 되는 글.

### 구조
- [ ] **표/인포그래픽** 1개 이상 (→ "나중에 다시 볼 거")
- [ ] **구체적 숫자** 포함 (가격, 날짜, 기간)
- [ ] 제목에 **"총정리", "완벽 가이드"** 같은 저장 트리거 워드
- [ ] 카드 3개 이상 연속 시 중간 환기 요소

### 정보 신뢰도
- [ ] **시즌/가격이 정확** — 비수기 최저가를 성수기에 쓰지 않기
- [ ] **주제와 안 맞는 정보 과감히 삭제**
- [ ] 사실이 아닌 경험 쓰지 않기

### 감성/참여
- [ ] **"이거 나인데?"** 포인트 1개 이상
- [ ] 마지막에 **댓글 유도**
- [ ] 사진 3장 이상 (메인 + 감성 + 사이트 캡처)

### SEO
- [ ] 제목에 핵심 키워드 앞배치
- [ ] 해시태그 12개 이상
- [ ] 발행 시간: **오전 7~8시** 또는 **점심 12~13시**
