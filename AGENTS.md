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

## Current WIP: MyRealTrip Integration

### Status: Code written, NOT committed, needs testing

### Uncommitted Changes (8 files)

**Modified:**
1. `src/types/flight.ts` — Added `'myrealtrip'` to `source` union
2. `scripts/crawl-all.ts` — Import + task array + source tracking for myrealtrip
3. `src/app/api/flights/route.ts` — myrealtrip count in API response
4. `src/components/Dashboard.tsx` — Filter option, badge style/name mapping, booking URL passenger substitution, city normalization (화련→화롄)
5. `src/components/Dashboard.module.css` — `.badgeMyrealtrip` style (blue #2563eb)
6. `.github/workflows/daily-crawl.yml` — Workflow changes

**New:**
7. `src/lib/scrapers/myrealtrip.ts` — MyRealTrip Partner API scraper (344 lines)
8. `scripts/test-myrealtrip.ts` — API test script

### MyRealTrip Scraper Details

- **API Base**: `https://partner-ext-api.myrealtrip.com`
- **Auth**: `Authorization: Bearer {MYREALTRIP_API_KEY}`
- **Calendar API**: `POST /v1/products/flight/calendar` — lowest fares per route
- **Landing URL API**: `POST /v1/products/flight/fare-query-landing-url` — booking deeplinks
- **Fallback URL**: `https://www.myrealtrip.com/flights/search/{dep}/{arr}/{depDate}/{retDate}/1/0/0/economy`
- **Coverage**: ICN/PUS → 26 destinations, today+60 days, 3-day trips
- **Rate limiting**: 300ms delay between requests, 3s retry on 429

### Remaining Tasks

- [ ] Test MyRealTrip API call: `npx tsx scripts/test-myrealtrip.ts`
- [ ] Test full crawl with myrealtrip: `npm run crawl:all`
- [ ] Verify dashboard displays myrealtrip flights correctly
- [ ] Verify booking link passenger substitution works
- [ ] Add `MYREALTRIP_API_KEY` to GitHub Repository Secrets
- [ ] Add env var to `daily-crawl.yml` Run crawler step:
  ```yaml
  env:
    CI: true
    MYREALTRIP_API_KEY: ${{ secrets.MYREALTRIP_API_KEY }}
  ```
- [ ] Remove hardcoded API key from `scripts/test-myrealtrip.ts` before commit

## Environment Variables

Required in `.env.local` (local) or GitHub Secrets (CI):

```
MYREALTRIP_API_KEY=<partner API key>
```

Other existing env vars: `EMAIL_USER`, `EMAIL_PASS`, `GH_PAT`, `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`

## Build & Run

```bash
npm install                          # Install dependencies
npm run crawl:all                    # Run all scrapers
npm run dev                          # Dev server (localhost:3000)
npm run build                        # Production build
npx tsx scripts/test-myrealtrip.ts   # Test MyRealTrip API
```

## Important Conventions

1. **City normalization**: `normalizeCity()` in Dashboard.tsx maps variant names to canonical form (e.g., 화련→화롄, 칼리보→보라카이)
2. **Airport mapping**: `CITY_TO_AIRPORT` record maps Korean city names to IATA codes
3. **Crawl failure recovery**: If a source returns 0 results, previous cache data is preserved
4. **Interpark benchmark**: Flights priced above Interpark monthly average are auto-filtered
5. **CSS Modules**: All Dashboard styles use `styles.className` pattern
6. **Data must be in git**: `data/all-flights-cache.json` is committed to git for Vercel static reads
7. **Booking URL patterns vary by source**: Each agency has different URL manipulation in `buildBookingUrl()`
