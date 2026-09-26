# Trip.com Naver verification gate — 2026-09-27

Trip.com offers previously passed public filtering when no usable Naver comparison
existed. The required-comparison gate had only been applied to MyRealTrip.

`filterNaverVerifiedOffers` now requires an exact route (all four airports) and
departure/return-date comparison for both sources. The existing 24-hour validity,
unsuccessful lookup handling and price-difference rules are unchanged. Embedded
old comparison fields and nearby itinerary prices cannot substitute for that result.
MyRealTrip's independently verified observations and reported-fare safeguards remain.

This is a public-display rule only. Collection caches, history, comparison candidates,
query budgets, worker installations and schedules are unchanged. A retained fare can
become public after a valid comparison is published, without another source crawl.

Coverage: shared API/home response, static city/share-group/drop loading, shared
flight metadata and homepage OG feed. Deduplication runs after eligibility so a cheap
unverified offer cannot suppress an eligible offer from another agency. City pages
revalidate every minute even without a new crawl commit; the home snapshot cache key
is versioned to avoid reusing a pre-gate snapshot. Existing shared-detail lookup uses
only the public feed. Historic account records are not new sale offers and are retained.

Admin filter reasons distinguish Trip.com and MRT unverified/expired comparisons
from price-limit exclusions. No collected offer is manually deleted.

Regression tests:

```powershell
npx tsx --test scripts/test-naver-offer-visibility.ts scripts/test-flight-connection-visibility.ts scripts/test-flight-seats.ts scripts/test-myrealtrip-naver-verification.ts
npx tsx --test scripts/test-home-order-parity.ts scripts/test-home-share-metadata.ts
node --test scripts/test-share-price-freshness.mjs
npm run build
```

Deploy only through the installed code-deployment entry described in `DEPLOY.md`.
Verify Production and `/api/flights`, including exact comparison timestamps and the
`naverTripcomGate` count. This change does not require a crawler restart or a new crawl.
