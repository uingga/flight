# Threads 인사이트 연결

## 화면

- 어드민 `Threads` 탭에서 최근 30개 글의 본문과 게시 시각을 확인한다.
- 글마다 조회, 좋아요, 답글, 재게시, 인용, 공유, 반응률을 표시한다.
- Threads에서 사이트로 들어온 뒤 상세 열람과 여행사 예약 페이지 이동까지 GA4 데이터로 연결한다.
- 예약 이동은 실제 발권이나 결제 완료가 아니라 외부 여행사 예약 페이지로 나간 행동이다.

## 데이터 출처

- Threads API: `THREADS_ACCESS_TOKEN`으로 내 글과 글별 인사이트를 읽는다.
- GA4 Data API: `utm_source=threads` 세션과 `share_{공유코드}`별 방문, `detail_open`, `booking_click`을 읽는다.
- Threads 글 본문의 `/s/{공유코드}`와 GA4의 `utm_content=share_{공유코드}`를 자동으로 합친다. API 응답은 운영 화면에서 10분간 캐시한다.

## Threads 게시 링크

Threads에도 사이트에서 복사한 일반 공유 링크를 그대로 올린다.

```text
https://www.tikitikit.kr/s/{공유코드}
```

`/s/` 라우트가 모든 공유 링크에 아래 콘텐츠 식별자를 자동으로 붙인다.

```text
utm_content=share_{공유코드}
```

`threads.net` 또는 `threads.com` referrer가 전달되면 Threads 유입으로 확정한다. 앱이 referrer를 지워도 Threads 글 본문에 같은 공유코드가 있으면 글별 성과에 보완해서 넣는다. 따라서 `/t/`로 수동 변경할 필요가 없다.

같은 `/s/` 링크를 Threads와 카카오톡 등 여러 채널에 동시에 보내면 공유코드 기준 수치에는 다른 채널 클릭이 일부 섞일 수 있다. 어드민은 Threads 출처가 확실한 방문 수를 함께 표시한다. 같은 공유코드를 여러 Threads 글에서 다시 사용하면 해당 글 카드에도 중복 가능성을 표시한다.

## 보안과 운영

- `THREADS_ACCESS_TOKEN`은 Vercel Production의 Secret 환경 변수로만 저장한다.
- 토큰은 클라이언트 응답이나 로그에 포함하지 않는다.
- Meta에서 토큰을 폐기하거나 만료하면 어드민에 재발급 안내가 나타난다.
- 2026-08-28에 최초 연결했다. 장기 토큰은 만료 전에 Meta 개발자 화면에서 갱신하거나 재발급한다.
