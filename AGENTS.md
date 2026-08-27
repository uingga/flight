# AGENTS.md — Tikitikit Flight Dashboard

## Project Overview

**티키티킷(tikitikit.kr)** — 한국 6개 여행사의 땡처리 항공권을 비교하는 Next.js 14 대시보드.

- **Stack**: Next.js 14 (App Router), TypeScript, CSS Modules, Playwright/Puppeteer
- **Deploy**: Vercel (https://tikitikit.kr)
- **Automation**: GitHub Actions — 하루 7회 자동 크롤링 (`daily-crawl.yml`)
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
| `.github/workflows/daily-crawl.yml` | GH Actions cron | 7 runs/day, auto-commit to `data/` |
| `data/all-flights-cache.json` | Core data file (~1MB) | Must be in git for Vercel deploy |

## MyRealTrip Integration

### Status: ✅ 완료 — 운영 중

### 실제 운영 구조 (2단계 — 2026-08-15 문서 정정)

1. **노선 시딩 (수동/간헐)**: `scripts/update-myrealtrip-cache.ts` → `src/lib/scrapers/myrealtrip.ts`의
   공개 API로 노선·날짜·대략 가격을 수집해 캐시의 마이리얼트립 항목을 통째로 교체. **시간 정보 없음.**
2. **가격·시간 갱신 (자동, 하루 2회 KST 01시/10시)**: `.github/workflows/myrealtrip-scrape.yml` →
   `scripts/scrape-myrealtrip-prices.ts`가 Playwright로 실제 예약 페이지(offers.k1)를 열어
   실시간 가격과 가는편·오는편 출발/도착 시간을 수집. 조회 실패 노선은 캐시에서 삭제.

⚠️ 일일 크롤(`crawl-all.ts`)은 마이리얼트립을 **실행하지 않고** 이전 캐시를 유지한다
(공개 API의 시간·가격이 부정확해 제외). "마이리얼트립 스크래퍼"를 수정할 때는 어느 단계인지 먼저 확인할 것.

### Public API Details (1단계 시딩용)

- **Public Bulk API**: `https://api3.myrealtrip.com/flight/api/price/calendar/bulk-lowest` — 전체 도시 최저가
- **Public Calendar API**: `https://api3.myrealtrip.com/flight/api/price/calendar` — 노선별 일별 최저가
- **인증**: 불필요 (공개 API) / 응답 필드는 날짜·항공사·가격뿐 (시간 없음)
- **Coverage**: ICN/PUS → 전체 도시, today+60 days
- **Rate limiting**: 300ms delay between requests, 3s retry on 429
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

- 티키티킷의 홍보·마케팅 전략, 콘텐츠, 알림 성장 전략을 기획하거나 수정할 때는 먼저 읽기용 원문인 `docs/티키티킷_홍보_마케팅_전략_원문_모음.md`를 참고한다. 같은 이름의 `.docx`는 원본 보관용이며, 내용이 바뀌면 Markdown 문서도 함께 갱신한다.
- 실행 기준은 Version 2인 `docs/branding-guide.md`, `docs/marketing-strategy.md`, 사용자의 최신 지시를 함께 확인한다. `*-v1.md` 문서는 이전 논의를 보관한 자료이므로 현재 기준으로 사용하지 않는다.
- 사용자가 앞으로 "블로그 글을 써달라"고 요청하면 비활성화된 기존 오후 4시 고정 TOP 3 자동 작업을 다시 켜거나 그대로 실행하지 않는다. `docs/marketing-strategy.md`의 콘텐츠 기준과 해당 시점의 사용자 지시에 따라 실제로 소개할 가치가 있는 항공권으로 새 글을 기획·생성한다.
- 조건형 알림 CTA의 현재 운영 문구인 `떠날 만한 표가 없나요? 좋은 표만 골라서 알려드려요`와 설명 문구는 사용자가 더 낫다고 확정했으므로 이전 Version 2 초안 문구로 되돌리지 않는다.
