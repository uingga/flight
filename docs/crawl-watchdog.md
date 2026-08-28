# 전체 수집 누락 자동 복구

GitHub 예약 실행이 늦거나 누락될 때도 전체 항공권 수집을 복구하기 위해 GitHub 밖에서
작은 확인 요청을 보낸다. 크롤러를 외부에서 직접 실행하지 않고, 누락이 확인됐을 때만
기존 `daily-crawl.yml`의 `workflow_dispatch`를 호출한다.

## 운영 구조

1. Supabase Cron이 20분마다 `GET /api/internal/crawl-watchdog`를 호출한다.
2. API는 `data/all-flights-cache.json`의 `timestamp`로 마지막 전체 수집 완료 시각을 확인한다.
3. 예정 회차가 60분 이상 늦었고 실행 중이거나 최근 요청된 보조 실행이 없을 때만
   `daily-crawl.yml`을 `trigger_source=watchdog`으로 실행한다.
4. 기존 preflight와 concurrency가 뒤늦은 예약 실행 및 중복 크롤을 한 번 더 막는다.

## 필요한 환경 변수

- Vercel: `WATCHDOG_SECRET`, `GH_PAT`
- Supabase Cron HTTP 요청: `Authorization: Bearer <WATCHDOG_SECRET>`

`WATCHDOG_SECRET`은 16자 이상의 임의 문자열을 사용한다. `GH_PAT`은 가능하면 해당
저장소의 Actions 쓰기 권한만 가진 세분화 토큰을 사용한다.

## Supabase Cron

Supabase Dashboard의 **Jobs**에서 HTTP 요청 작업을 만들고 다음과 같이 설정한다.

- Schedule: `*/20 * * * *`
- Method: `GET`
- URL: `https://tikitikit.kr/api/internal/crawl-watchdog`
- Header: `Authorization: Bearer <WATCHDOG_SECRET>`

API 응답의 `action`은 `none`, `skipped`, `dispatched` 중 하나다. `dispatched`일 때만
새 보조 실행을 요청한 것이다.
