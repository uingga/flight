---
description: 블로그 포스트 내용 수정 가이드
---

# 블로그 포스트 가이드

> ⚠️ **쓰레드 글** 수정은 이 파일이 아닙니다! `/threads` 워크플로우를 참고하세요.

블로그 포스트는 **두 종류**로 나뉩니다:
- **A. 일일 특가 포스트** — `generate-blog.js`로 자동 생성, 매일 발행
- **B. 정보성 포스트** — 수동 작성, 에버그린 콘텐츠

---

## A. 일일 특가 포스트 (땡처리 Top 3)

### 생성 방법

// turbo
1. `node scripts/generate-blog.js` 실행
2. 스크립트가 자동으로 수행:
   - `all-flights-cache.json`에서 Top 3 특가 추출
   - 카드 이미지(rank_1~3.png, icn_1~2.png) 스크린샷 캡처 (Playwright API mock 방식)
   - 네이버 블로그용 HTML 파일 생성 (`blog-post-YYMMDD.html`)

> ⚠️ **카드 스크린샷은 반드시 Playwright 스크립트로 캡처!**
> `browser_subagent`로 직접 캡처하지 않는다. API mock으로 1개 항공편만 표시 후 `.card` 요소를 캡처하는 방식.

#### 수동 큐레이션 시 (Top 3를 직접 선택할 때)
- `scripts/capture-cards-manual.js`의 `MANUAL_CARDS` 배열을 수정
- `node scripts/capture-cards-manual.js` 실행 → 카드 이미지 캡처
- `blog-post-YYMMDD.html`을 직접 작성/수정

3. 썸네일 이미지 2종 생성 (아래 참고)
4. 생성된 `public/blog-post-YYMMDD.html`을 브라우저에서 확인
5. Ctrl+A → Ctrl+C → 네이버 에디터에 Ctrl+V

### 썸네일 / 헤더 이미지 생성

> ⚠️ **`generate_image` AI 도구로 직접 생성하지 않는다!**
> 한글 렌더링이 깨지므로 반드시 **HTML 템플릿 + Puppeteer 캡처** 방식 사용.

매 포스트마다 **2종**의 이미지를 생성:

#### 생성 절차

1. **배경 이미지 준비** — TOP 3 도시 사진 3장
   - `generate_image`로 도시별 여행 사진 생성 (텍스트 없이 배경만)
   - `public/images/thumb_{도시명}.png`로 저장 (예: `thumb_shizuoka.png`)
   - 기존에 있는 이미지 재활용 가능

2. **HTML 템플릿 작성** — `public/blog-thumbnail-YYMMDD.html`
   - 기존 템플릿 복사 후 수정 (참고: `blog-thumbnail-260310.html`)
   - 사선(clip-path) 3분할 패널 배경 + 텍스트 오버레이
   - 와이드(960×480) + 정사각(800×800) 두 버전 포함
   - 수정할 부분:
     - `.panel-1/2/3`의 `background-image` URL → 새 도시 이미지
     - `.line1` / `.line2` / `.line-accent` → 날짜, TOP 3, 가격 텍스트

3. **Puppeteer로 캡처** — `scripts/capture-thumb-YYMMDD.js`
   - 기존 캡처 스크립트 복사 후 날짜만 수정 (참고: `capture-thumb-260310.js`)
   - 실행: `node scripts/capture-thumb-YYMMDD.js`
   - 출력:
     - `public/images/blog-thumb-YYMMDD-wide.png` (와이드 배너)
     - `public/images/blog-thumb-YYMMDD-square.png` (정사각 썸네일)

#### 정사각형 썸네일 (800×800) — 네이버 대표이미지용
- 텍스트 3줄: `[M/D]` / `땡처리 항공권` / `특가 Top 3 🔥`
- 금색 악센트: `{1위 도시} {가격} · {2위 도시} {가격}`
- 하단 뱃지: `티키티킷 tikitikit.kr`

#### 와이드 헤더 (960×480) — 포스트 상단 배너용
- 텍스트: `[M/D] 땡처리 항공권 특가 Top 3 🔥`
- 서브: `{1위 도시} 왕복 {가격}만원대 ✈️`
- 하단 뱃지: `티키티킷 tikitikit.kr`

4. **블로그 포스트에 삽입** — 캡처 완료 후 자동으로 포스트 HTML 상단에 삽입
   - `blog-post-YYMMDD.html`의 `<h1>` 태그 **바로 위**에 정사각형 + 와이드 이미지 순서로 추가:
   ```html
   <p><img src="images/blog-thumb-YYMMDD-square.png" alt="썸네일" style="max-width: 100%; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);"></p>
   <p>&nbsp;</p>
   <p><img src="images/blog-thumb-YYMMDD-wide.png" alt="헤더" style="max-width: 100%; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);"></p>
   <p>&nbsp;</p>
   ```

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
| Top 3 선정 기준 | `selectTopWithIncheon()` 함수 |
| 인사말/도입부 | `generateBlogHTML()` 내 intro 영역 |
| 에디터 추천 | `generateEditorPick()` 함수 |
| 해시태그 | `generateBlogHTML()` 하단 |

### 인천 출발 섹션 규칙

- **총 3개만** 표시
- Top 3에 포함된 인천 출발 **1개** + Top 3에 없는 비중복 **2개**
- Top 3와 같은 도착지가 겹치지 않도록 선별

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

### 썸네일 / 헤더 이미지 생성

매 포스트마다 **2종**의 이미지를 생성:

#### 1. 정사각형 썸네일 (1:1) — 네이버 대표이미지용
- `generate_image` 도구로 AI 생성
- 주제를 시각적으로 표현하는 배경 이미지 (여행 사진 스타일)
- 텍스트 2~3줄: 포스트 핵심 키워드 (예: "땡처리 항공권" / "Q&A 10가지")
- 하단에 "티키티킷" 로고/텍스트
- 저장: `public/images/blog-thumb-{번호}-square.png`

#### 2. 와이드 헤더 (2:1, 960x480) — 포스트 상단 배너용
- HTML 템플릿 또는 `generate_image`로 생성
- 포스트 제목을 담은 배너 이미지
- 하단에 "티키티킷 tikitikit.kr" 뱃지
- 저장: `public/images/blog-thumb-{번호}-wide.png`

#### 스타일 가이드
- 브랜드 컬러: 인디고(#4F46E5) 계열 유지
- 배경: 여행 관련 사진 또는 그라데이션 (주제에 맞게)
- 텍스트: Noto Sans KR Bold, 고대비 (흰색 + 반투명 오버레이)
- 땡처리 썸네일과 구분: 3분할 패널 대신 **단일 배경** 사용

---

## CTA 전략 (필수 준수)

> ⚠️ **본문 중간에 외부 링크 절대 금지!** 체류시간 저하 방지.

### 원칙
- CTA 버튼/배너 **0개**
- **본문 중간에 클릭 가능한 외부 링크 절대 넣지 않음** — 체류시간 저하 방지
- 독자가 "이건 광고다"라고 느끼는 순간 실패
- **여행사 이름(모두투어, 노랑풍선 등) 절대 나열하지 않음**
- **"5곳" 같은 구체적 숫자 쓰지 않음** — "여러 여행사"로 표현

### 허용되는 노출 방식
- **글 마지막 CTA 링크 1개만**: `tikitikit.kr` (클릭 가능)
- **본문 중간에 tikitikit.kr 출처 표기 금지** — "가격 데이터 출처: 티키티킷" 같은 문구도 넣지 않음
- **"(tikitikit.kr 기준 실시간 최저가)" 문구 사용 금지** — 광고처럼 보임
- 본문 중간에 텍스트로 언급은 가능하나 **클릭 가능한 링크는 금지**

### 인천 출발 섹션 코멘트
- 매 포스트마다 **같은 멘트를 반복하지 않는다**
- `generate-blog.js`의 `getIcnComment()` 함수 로테이션 활용
- 수동 작성 시에도 이전 포스트와 다른 표현 사용

### 마무리 스타일
- 자연스러운 마무리 문장 (예: "좋은 여행 되세요 ✈️")
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
