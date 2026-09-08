# Zero-seat visibility review — 2026-09-08

## Evidence and limitations

- Public `/api/flights` returned `ybtour-xyjhlc`, PUS–FUK, 2026-09-20 / 2026-09-22, KRW 155900, `seats: "0석"`, `minPax: 2`, with no `availableSeats`.
- The Ybtour mapper reads the hidden `_remainingSeat_` input. A raw `"0"` produces `"0석"`, but `parseInt(seats) || undefined` previously discarded its numeric zero. A missing input produces an empty string, **not** `"0석"`. This establishes the conversion bug; the stored evidence is consistent with a source-provided zero, not an unknown coerced to zero.
- A read-only request to the original booking/list URL and its own `listActive` endpoint (`/booking/findListDscInvSkdFare.lts`, `inhId=LJ0291PUSFUK-T5`) confirmed the source's `remainingSeat` inventory fields and the separate minimum-passenger field `ics_min_tcp_rt=2`. The response inspected returned October schedules. The September 20 schedule's **current** inventory/sold-out status was not independently confirmed. No reservation was initiated and no full crawler was run.
- The local historical cache has an older positive count for this ID. It was deliberately not edited; the regression uses the production zero-seat shape instead.

## Policy

- `0`, `"0"`, and `"0석"` are explicit zero; hide the flight.
- `null`, missing, empty and unparseable values are unknown; do not manufacture zero or hide solely for missing inventory.
- If either recognized field is zero, it wins over a positive value in the other field. For two differing positive values, use the smaller count. `resolveFlightSeats` reports conflicts; raw cache evidence is not rewritten by display filtering.
- `minPax` is not inventory. This change does not introduce a minimum-party-size filter.
- Known counts are normalized into matching public `availableSeats` / `seats` fields.
- Legacy realtime detail parsers use zero as an unknown sentinel. Those ambiguous old detail results are **not** promoted to explicit sold-out evidence. Historical inventory must not replace a fresh explicit zero.

## Paths reviewed

- All six sources: common API seat filtering before deduplication, with `filterSummary.reasons.soldOut`.
- Shared deduplication and city grouping protect SSR main/city pages, sitemap, share groups and manual today-pick candidates.
- Direct DROP, main OG and account snapshot readers use the same filter. Existing saved account history remains history with `availableNow=false`; favorites are not deleted.
- Share detail lookup defensively filters even a cached API response. Unavailable-share history remains archival rather than a bookable current offer.
- Deal-alert evaluation excludes zero seats, including send-time approval revalidation.
- Unified crawl route-minimum calculation ignores zero-seat entries before choosing the cheapest route. Raw source completeness/circuit checks are unchanged.
- Ybtour and Hanatour preserve raw numeric zero in browser extraction; OnlineTour preserves explicit `res_cnt=0` while leaving unknown unset. ModeTour already passes through `rSeat.value`; common normalization handles it. MyRealTrip without inventory remains unknown. Ttang historical timing no longer copies old seat counts, and time enrichment cannot overwrite a known count.

## Verification / delivery constraints

- `npx tsx scripts/test-flight-seats.ts`: 12 tests, including all six sources, legacy production shape, both conflict directions, unknown/minPax, actual inline mapper expressions, dedup alternative preservation, API + SSR fixture integration, alert exclusion and time-enrichment protection.
- `npx tsx scripts/test-scraper-response-contracts.ts`: existing contracts plus OnlineTour zero/unknown cases.
- `npx tsx scripts/test-ttang-time-enrichment.ts`, `npx tsx scripts/test-deal-alerts.ts`: existing regression suites.
- `npx tsc --noEmit --incremental false`, `git diff --check`.
- `npm run build`: passed, 94 pages generated. Existing CSS, Browserslist and react-datepicker warnings remain. An intermediate shared-page generic type error was fixed before the successful build.
- No production data deletion, push, merge, deployment or scheduled-runtime update is authorized or performed.
- This checkout contains unrelated user edits and is behind the known `origin/main` in manual ordering, city normalization and newer Ttang worker code. Do not overwrite those newer implementations when preparing a later deployment; apply the scoped seat changes and reverify on the approved integration branch. The old Ttang historical-seat-copy removal may already be superseded there.

## Approved integration

The user subsequently authorized deployment. The scoped changes were integrated onto latest `origin/main` in `output/zero-seat-deploy`, preserving manual ordering, city normalization and the newer Ttang worker. That worker already does not copy historical inventory; its current timing restoration now preserves an explicit zero instead of replacing or clearing it. The API regression stubs the server-only marker for its new order-store import, with no network or production writes.

Both A PC source fallback and Naver jobs were running during preparation. Their live directories were not modified or stopped. The source fallback launcher pulls/rebases main before a run and again before merging its result; deployment changes no data files, schedules, request limits or endpoints. Current collection may finish with the old mapper, but public filtering rejects explicit zero independently of mapper version.
