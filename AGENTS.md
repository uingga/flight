# AGENTS.md — Tikitikit Flight Dashboard

## Project Overview

**티키티킷(tikitikit.kr)** — 한국 6개 여행사의 땡처리 항공권을 비교하는 Next.js 14 대시보드.

- **Stack**: Next.js 14 (App Router), TypeScript, CSS Modules, Playwright/Puppeteer
- **Deploy**: Vercel (https://tikitikit.kr)
- **Automation**: GitHub Actions — 일반 여행사 하루 4회 자동 크롤링 (`daily-crawl.yml`)
- **Package Manager**: npm

## Data Sources (6 Travel Agencies)

| Key | Agency | Scraper | File |
|-----|--------|---------|------|
| `ybtour` | 노랑풍선 | Playwright | `src/lib/scrapers/ybtour.ts` |
| `hanatour` | 하나투어 | Playwright | `src/lib/scrapers/hanatour.ts` |
| `modetour` | 모두투어 | API | `src/lib/scrapers/modetour.ts` |
| `onlinetour` | 온라인투어 | Playwright | `src/lib/scrapers/onlinetour.ts` |
| `ttang` | 땡처리닷컴 | Playwright | `src/lib/scrapers/ttang.ts` |
| `myrealtrip` | 마이리얼트립 | Partner API (NEW, WIP) | `src/lib/scrapers/myrealtrip.ts` |

Plus `interpark.ts` for benchmark pricing (not a display source).

## Architecture & Data Flow

```
scripts/crawl-all.ts (entry point)
  → 6 scrapers run in parallel (Promise.allSettled)
  → Route-level min-price filtering
  → Expired & one-way flight removal
  → Interpark benchmark filter (remove if > monthly avg)
  → Discount rate calculation
  → Save to data/all-flights-cache.json

src/app/api/flights/route.ts (GET)
  → Load all-flights-cache.json
  → Apply filters, sort, pagination
  → Return JSON

src/components/Dashboard.tsx (client component)
  → Fetch /api/flights
  → Render flight cards with agency badges, prices, booking links
  → Filters: source, region, city, airline, price sort
```

## Key Files

| File | Purpose | Notes |
|------|---------|-------|
| `src/types/flight.ts` | `Flight` interface | `source` union type includes all 6 agencies |
| `src/components/Dashboard.tsx` | Main UI (~2300 lines) | Very large file — target specific functions |
| `src/components/Dashboard.module.css` | Dashboard styles (~64KB) | CSS Modules — use `styles.className` |
| `scripts/crawl-all.ts` | Unified crawler (~360 lines) | Orchestrates all scrapers + filtering |
| `.github/workflows/daily-crawl.yml` | GH Actions cron | 5 runs/day, auto-commit to `data/` |
| `data/all-flights-cache.json` | Core data file (~1MB) | Must be in git for Vercel deploy |

## MyRealTrip Integration

### Status: ✅ 완료 — 운영 중

### 실제 운영 구조 (2단계 — 2026-08-30 문서 정정)

1. **노선 시딩 (자동 회차 내부)**: `scripts/scrape-myrealtrip-prices.ts`가 먼저
   `src/lib/scrapers/myrealtrip.ts`의 공개 API로 노선·날짜·대략 가격을 메모리에 수집한다.
   요청은 20초 제한·일시 오류 최대 1회 재시도·0.8~1.6초 간격을 적용한다. 원래 비어 있는 개별
   출발지는 허용하지만 모든 출발지가 0건이거나 기존에 있던 출발지가 사라지면 이전 캐시를
   보존하며, 429·CAPTCHA·Calendar 응답 붕괴에는 다음 요청을 보내지 않는다. **이 단계의 가격에는 시간 정보가 없다.**
2. **가격·시간 갱신 (자동, 하루 2회 KST 07:05/18:03)**: `.github/workflows/myrealtrip-scrape.yml` →
   `scripts/scrape-myrealtrip-prices.ts`가 Playwright로 실제 예약 페이지(offers.k1)를 열어
   실시간 가격과 가는편·오는편 출발/도착 시간을 수집. 조회 실패 노선은 캐시에서 삭제.
   네이버 운영 수집은 호출하지 않는다. 워커 1개로 직렬 실행하고 노선 사이 4~8초, 10건마다
   30~60초를 쉰다. 8건 연속 빈 운임 또는 20건 표본 성공률 20% 미만이면 즉시 중단하고
   기존 캐시를 유지한 채 24시간 마이리얼트립 회로를 저장한다. 동시 워크플로는 금지하고 최근
   성공 후 6시간 안의 중복 실행도 건너뛴다.

### 일반 여행사 차단 보호

- 일반 5개 여행사는 하루 4회만 실행하며 워크플로 시작 0~5분, 소스 시작 최대 90초를 분산한다.
- 401·403·429·CAPTCHA, 원본 0건, 직전 정상 원본의 60% 미만 급감은 소스별 차단으로 판정해
  이전 항공권을 유지하고 GitHub 요청을 24시간 중단한다.
- 전체 결과까지 폐기되는 회차에도 항공권 timestamp는 갱신하지 않되 차단 회로·실패 횟수와
  `fullCrawlUpdatedAt`은 저장해 watchdog이 같은 회차를 재요청하지 않게 한다.
- 차단된 일반 여행사는 Windows PC가 해당 소스만 대체 수집한다. PC에서도 차단되면 그 소스의
  PC 대체 수집을 24시간 중단한다. 상세 기준은 `docs/travel-agency-crawl-safety.md`를 따른다.

### Naver 비교가 확인 스케줄

- GitHub `naver-crawl.yml`은 운영 데이터를 쓰지 않는 수동 진단 전용이다. `myrealtrip` 최대 3건만
  확인하며 대조 조회도 같은 상한에 포함한다. 실제 진단 뒤 24시간 재실행을 막고 어떤 자동
  워크플로도 이를 호출하지 않는다.
- Windows `TikitikitNaverCrawl`은 10:00 KST부터 최신 `main`의 11:12 일반 크롤 완료 여부를
  2분 간격으로 확인하고, 반영되는 즉시 `SOURCE_FILTER=all`, `MAX_FLIGHTS=200`으로 하루 최대
  한 번 실행한다. 마이리얼트립은 당시 최신 캐시를 포함하지만 완료를 기다려 시작을 늦추지 않는다.
  대기 확인은 네이버 요청을 만들지 않으며, upstream 지연 시 20:30 폴백 정책을 적용한다.
- Windows `TikitikitBlockedSourceCrawl`은 일반 크롤과 같은 08:17/11:12/14:23/17:31 KST에
  시작해 해당 회차의 `main` 반영을 기다린다. GitHub 차단 회로가 열린 일반 여행사만 PC
  주거용 회선에서 부분 크롤하며, 성공해도 GitHub의 24시간 회로는 닫지 않는다. PC에서도
  차단 신호가 나오면 그 여행사의 PC 대체 수집도 24시간 중단한다.
- 명시적 접근 제한은 같은 KST 날짜에 다시 실행하지 않고 다음 날 정규 네이버 회차에서 한 번
  재탐색한다. 정확히 24시간을 계산해 다음 날 회차까지 건너뛰지는 않는다. 같은 날 자동 재실행,
  동시 수동 실행, Task Scheduler 재시작은 허용하지 않는다.
- 네이버 페이지 이동은 대조 노선을 포함해 하루 최대 200회다. 성공 키는 최소 실제 24시간 동안
  재조회하지 않고, 변경 없는 키는 통상 2일 간격으로 확인한다. 실제 브라우저 실행에는
  `NAVER_LIVE_RUN=1`이 필요해 예약 실행기를 우회한 실수성 직접 실행을 막는다.
- 오늘의 표는 Windows PC 네이버 필터가 성공해 운영 API에 반영된 직후 하루 1회만 선정한다.
  일반 여행사·마이리얼트립 크롤 회차에서는 선정하거나 복구하지 않는다. 네이버 결과가 운영에
  반영되지 못한 날은 억지로 선정하지 않으며, 선정 뒤 표가 사라지면 그날은 노출을 중단하고
  다음 날 다시 선정한다. 최근 7일 내 선정된 목적지는 그 기간의 최저 선정가보다 더 싸졌을 때만
  다시 선정할 수 있다.

⚠️ 일일 크롤(`crawl-all.ts`)은 마이리얼트립을 **실행하지 않고** 이전 캐시를 유지한다
(공개 API의 시간·가격이 부정확해 제외). "마이리얼트립 스크래퍼"를 수정할 때는 어느 단계인지 먼저 확인할 것.

### Public API Details (1단계 시딩용)

- **Public Bulk API**: `https://api3.myrealtrip.com/flight/api/price/calendar/bulk-lowest` — 전체 도시 최저가
- **Public Calendar API**: `https://api3.myrealtrip.com/flight/api/price/calendar` — 노선별 일별 최저가
- **인증**: 불필요 (공개 API) / 응답 필드는 날짜·항공사·가격뿐 (시간 없음)
- **Coverage**: ICN/PUS → 전체 도시, today+60 days
- **Rate limiting**: Calendar 요청 0.8~1.6초, 출발지 사이 2~4초. 429는 같은 회차에 재시도하지 않음
- **파트너 딥링크**: `gid-map.json` 기반 생성, 파트너 링크 ID `1849392`

### Notes

- `MYREALTRIP_API_KEY`는 `.env.local`에 보관 중이나 현재 스크래퍼에서 사용하지 않음 (공개 API만 사용)
- GitHub Secrets 추가 불필요
- 향후 파트너 전용 API 연동 시 필요할 수 있음

## Environment Variables

Other existing env vars: `EMAIL_USER`, `EMAIL_PASS`, `GH_PAT`, `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`

Supabase 장기 가격 기록용: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. GitHub Actions에서 `scripts/archive-flight-prices.ts`가 정상 크롤링 뒤 `flight_price_daily`, `route_price_daily`에 일별 upsert한다. 테이블 정의와 운영 방식은 `docs/long-term-price-history.md` 참고.

GA4 어드민 통계용 (Vercel + `.env.local`): `GA4_PROPERTY_ID`, `GA4_CLIENT_EMAIL`, `GA4_PRIVATE_KEY`.
없으면 `/api/ga-stats`가 안내 문구로 폴백한다. 절차와 조회 항목은 `docs/ga4-integration.md` 참고.

## Build & Run

```bash
npm install                          # Install dependencies
npm run crawl:all                    # Run all scrapers
npm run dev                          # Dev server (localhost:3000)
npm run build                        # Production build
npx tsx scripts/test-myrealtrip.ts   # Test MyRealTrip API
```

## Deploy & Rollback

`main`에 푸시하면 Vercel이 자동 재배포한다. **코드를 푸시하기 전에 반드시 안전 지점을 남긴다.**

```bash
git pull                             # 자동 크롤링 데이터까지 최신화
npm run build                        # 빌드 통과 확인
npm run deploy:mark                  # ★ 되돌아갈 지점 표시 (safe/YYYYMMDD-HHMM 태그)
git push
npm run deploy:rollback              # 문제 시: 코드만 되돌림 (data/ 는 최신 유지)
```

자세한 절차와 Vercel 즉시 롤백은 `docs/DEPLOY.md` 참고.

## Important Conventions

1. **City normalization**: `normalizeCity()` in Dashboard.tsx maps variant names to canonical form (e.g., 화련→화롄, 칼리보→보라카이)
2. **Airport mapping**: `CITY_TO_AIRPORT` record maps Korean city names to IATA codes
3. **Crawl failure recovery**: If a source returns 0 results, previous cache data is preserved
4. **Interpark benchmark**: Flights priced above Interpark monthly average are auto-filtered
5. **CSS Modules**: All Dashboard styles use `styles.className` pattern
6. **Data must be in git**: `data/all-flights-cache.json` is committed to git for Vercel static reads
7. **Booking URL patterns vary by source**: Each agency has different URL manipulation in `buildBookingUrl()`
8. **Redesign UI system**: 운영 메인 리디자인의 글자·색상 규격은 `docs/ui-design-system.md`를 따른다. 폰트 굵기는 실제 로드된 `400/600/700/800`만 사용하고, 일반 패널 제목과 버튼에 `800`을 사용하지 않는다.

## Marketing Reference

- `docs/branding-guide.md`와 `docs/marketing-strategy.md`는 2026-08-26부로 사용 보류 상태다. 사용자가 다시 사용하라고 명시하기 전까지 읽거나 현재 기준으로 삼지 않는다.
- 기존 DROP을 새로 설계하기로 했으므로 `docs/drop-guide.md`와 `docs/drop-article-template.md`도 2026-08-26부로 사용 보류 상태다. 사용자가 다시 사용하라고 명시하기 전까지 새 DROP 작업에 읽거나 재사용하지 않는다.
- 새 DROP·CLUB 제품 작업의 현재 기준은 `docs/tikit-drop-product-strategy-v1.md`다. 메인·DROP·CLUB·콘텐츠·실험 기능의 역할 구분, 아이디어 배치, 화면별 유쾌함의 강도, 개별 DROP 상세 원칙은 이 문서를 따른다. DROP을 티키티킷다운 모든 아이디어의 통합 서랍처럼 사용하지 않고, CLUB은 별도 회원·관계 레이어로 다룬다.
- 홍보·마케팅 원문 모음과 `*-v1.md`, `*-v2.md`, `*-v3.md`는 과거 논의 보관 자료다. 사용자가 요청하지 않는 한 새 작업의 기준으로 사용하지 않는다.
- 콘텐츠와 문구는 사용자의 최신 지시를 최우선으로 따른다. Threads 운영은 `docs/threads-operation-playbook-v2.md`를 따르고 `docs/threads-copy-reference-v2.md`는 캐릭터와 문장 리듬을 맞추는 참고 사례로만 사용한다. 기존 문구를 순환 게시하거나 도시·가격만 바꾸지 않고 실제 항공권에서 매번 새 문장을 만든다. 가격·일정·예약 가능 여부는 게시 직전에 확인한다. 이전 `docs/threads-operation-playbook.md`와 `docs/threads-copy-candidates.md`는 롤백용으로 보존하며 현재 기준으로 사용하지 않는다.
- 웹사이트 TIKIT DROP 카드 문구는 `docs/tikit-drop-copy-library.md`를 사용한다. 일반 항공권 카드·인사이트바·SNS·블로그에 옮겨 쓰지 않으며, 상단 롤링 경보 띠 전용 문구도 문서에 적힌 위치와 조건에서만 사용한다. 데이터 치환·입증 조건과 사이트 공통 14일 재사용 제한을 지킨다.
- 사용자가 앞으로 "블로그 글을 써달라"고 요청하면 비활성화된 기존 오후 4시 고정 TOP 3 자동 작업을 다시 켜거나 그대로 실행하지 않는다. 해당 시점의 사용자 지시에 따라 실제로 소개할 가치가 있는 항공권으로 새 글을 기획·생성한다.
- 조건형 알림 CTA의 현재 운영 문구인 `떠날 만한 표가 없나요? 좋은 표만 골라서 알려드려요`와 설명 문구는 사용자가 더 낫다고 확정했으므로 이전 Version 2 초안 문구로 되돌리지 않는다.
- `docs/copy-feedback-log.md`는 2026-08-26부로 사용이 종료된 과거 기록이다. 새 원고를 만들 때 읽거나 기준으로 삼지 않고, 새 피드백도 추가하지 않는다.
