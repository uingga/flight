# Threads 인사이트 연결

## 화면

- 어드민 `Threads` 탭에서 최근 30개 글의 본문과 게시 시각을 확인한다.
- 글마다 조회, 좋아요, 답글, 재게시, 인용, 공유, 반응률을 표시한다.
- Threads에서 사이트로 들어온 뒤 상세 열람과 여행사 예약 페이지 이동까지 GA4 데이터로 연결한다.
- 예약 이동은 실제 발권이나 결제 완료가 아니라 외부 여행사 예약 페이지로 나간 행동이다.

## 데이터 출처

- Threads API: `THREADS_ACCESS_TOKEN`으로 내 글과 글별 인사이트를 읽는다.
- GA4 Data API: `utm_source=threads` 세션의 방문, `detail_open`, `booking_click`을 읽는다.
- 두 데이터는 `utm_content`로 합친다. API 응답은 운영 화면에서 10분간 캐시한다.

## Threads 게시 링크

Threads에 항공권 링크를 올릴 때는 일반 공유 링크의 `s`만 `t`로 바꾼다.

```text
https://www.tikitikit.kr/t/{공유코드}
```

주소는 짧게 유지되지만 서버가 아래 값을 붙여 이동시킨다.

```text
utm_source=threads
utm_medium=social
utm_campaign=tikitikit_threads
utm_content=share_{공유코드}
```

기존 `/s/{공유코드}` 링크도 `threads.net` 또는 `threads.com` referrer가 전달되면 같은 방식으로 분류한다. 다만 앱이 referrer를 지울 수 있으므로 새 Threads 글에는 `/t/` 링크를 쓰는 편이 안전하다.

## 보안과 운영

- `THREADS_ACCESS_TOKEN`은 Vercel Production의 Secret 환경 변수로만 저장한다.
- 토큰은 클라이언트 응답이나 로그에 포함하지 않는다.
- Meta에서 토큰을 폐기하거나 만료하면 어드민에 재발급 안내가 나타난다.
- 2026-08-28에 최초 연결했다. 장기 토큰은 만료 전에 Meta 개발자 화면에서 갱신하거나 재발급한다.
