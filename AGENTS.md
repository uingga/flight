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

### MyRealTrip Scraper Details

- **Public Bulk API**: `https://api3.myrealtrip.com/flight/api/price/calendar/bulk-lowest` — 전체 도시 최저가
- **Public Calendar API**: `https://api3.myrealtrip.com/flight/api/price/calendar` — 노선별 일별 최저가
- **인증**: 불필요 (공개 API)
- **Coverage**: ICN/PUS → 전체 도시, today+60 days
- **Rate limiting**: 300ms delay between requests, 3s retry on 429
- **파트너 딥링크**: `gid-map.json` 기반 생성, 파트너 링크 ID `1849392`

### Notes

- `MYREALTRIP_API_KEY`는 `.env.local`에 보관 중이나 현재 스크래퍼에서 사용하지 않음 (공개 API만 사용)
- GitHub Secrets 추가 불필요
- 향후 파트너 전용 API 연동 시 필요할 수 있음

## Environment Variables

Other existing env vars: `EMAIL_USER`, `EMAIL_PASS`, `GH_PAT`, `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`

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
