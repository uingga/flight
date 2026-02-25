---
description: 블로그 포스트 내용 수정 가이드
---

# 블로그 포스트 수정

> ⚠️ **쓰레드 글** 수정은 이 파일이 아닙니다! `/threads` 워크플로우를 참고하세요.
> - **블로그** = `scripts/generate-blog.js` → 네이버 블로그용 HTML 포스트
> - **쓰레드** = `docs/threads-guide.md` → 인스타 쓰레드 게시물

블로그 포스트는 `scripts/generate-blog.js` 하나의 파일에서 생성됩니다.

사용자가 블로그 내용을 수정하고 싶다고 하면, 아래 섹션을 참고해서 해당 파일을 수정하세요.

## 수정 가능 영역

### 1. 인사말 / 도입부
`generateBlogHTML()` 함수 안에 `intro` 관련 HTML 문자열이 있음.
"안녕하세요! 여행사 땡처리..." 로 시작하는 부분.

### 2. 도시별 여행 설명
`CITY_DESCRIPTIONS` 객체에 도시명을 키로, 설명 텍스트를 값으로 저장.
새 도시 추가하거나 기존 설명 수정 가능.

### 3. 벚꽃/시즌 관련 텍스트
`getSeasonContext()` 함수에서 도시별 시즌 문구 생성.
CHERRY_BLOSSOM_CITIES 배열에 벚꽃 도시 목록 있음.

### 4. 항공권 꿀팁
`TIP_POOLS` 배열에 여행/예약 팁 목록이 있음.
매번 랜덤으로 선택되어 포스트에 들어감.

### 5. 에디터 추천 (Editor's Pick) 
`generateEditorPick()` 함수에서 생성.
추천 대상 선정 로직과 설명 텍스트 포함.

### 6. CTA (하단 유도 문구)
`generateBlogHTML()` 함수 하단에 "실시간 땡처리 티켓 보러 가기" 링크와 마무리 문구.

### 7. 해시태그
`generateBlogHTML()` 함수 마지막에 해시태그 목록.

### 8. Top 5 선정 기준
`selectTop5WithIncheon()` 함수. 가격순 정렬, 도착지 중복 제거, 인천 2개 이상 보장.

## 수정 후 확인

// turbo
1. `node scripts/generate-blog.js` 실행
2. 생성된 `public/blog-post-YYMMDD.html`을 브라우저에서 확인

## 콘텐츠 기획

정보성 포스트 기획 목록은 `docs/blog-content-calendar.md`를 참고하세요.
새 정보성 포스트를 작성할 때는 기존 01, 02번 포스트 스타일(`public/blog-post-01.html`)을 참고합니다.
