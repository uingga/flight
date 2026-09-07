# Search indexing follow-up — 2026-09-07

This is an observation record, not a permanent content policy.

## Observed production state before this change

- Search Console screenshots: www property 75 indexed / 129 excluded; 111 discovered but not indexed, 14 crawled but not indexed, 2 duplicate without selected canonical. These are historical reports, not 129 confirmed technical failures.
- `/flights/엔지`: HTTP 404, but inherited the homepage canonical from the root layout. No active matching city exists; keep 404 instead of guessing a destination.
- `/tips/regional-airports`: already HTTP 308 to `/tips/price-watch`, but inherited the homepage canonical. The destination is HTTP 200 and self-canonical.
- Source cache labels `연길(옌지)` and `옌지` both use YNJ. SEO city grouping split these into separate pages.
- Apex `https://tikitikit.kr/` returns HTTP 307 to www at the hosting layer. This patch does not change domain settings. A permanent 308 is preferable if the host move is permanent; the redirect source itself is not an indexing target.

## Changes

- Remove the root-layout homepage canonical; public indexable pages already declare their own canonicals.
- Align the legacy tips redirect canonical with its existing destination.
- Consolidate YNJ city labels under the established `/flights/연길` URL, with permanent redirects for normalized aliases. Raw cache records and the main dashboard are unchanged.
- Explicitly mark unknown city metadata noindex, handle malformed percent signs safely, and restrict related-city links to the existing three-flight indexing threshold.
- Preserve thin-page filtering, redirects, source freshness policy and original data. Do not force-index every historical URL to clear report counts.

## Verification

From the repository directory:

```sh
node node_modules/tsx/dist/cli.mjs scripts/test-seo-canonical.ts
npm run build
npm run start -- --hostname 127.0.0.1 --port 3108
node scripts/verify-seo-http.mjs
```

Final local results: unit checks passed; production build passed; all 50 current sitemap URLs HTTP 200, self-canonical and indexable; alias and legacy tips redirect HTTP 308; unknown/malformed city URLs HTTP 404. Existing react-datepicker build warning remains.

## After deployment

- Inspect the two reported duplicate URLs with Search Console's live test, then restart validation for the duplicate issue. Expect the obsolete city to be classified as not found and the old tip as redirected, not newly indexed.
- Inspect/request indexing for the canonical `/flights/연길` and `/tips/price-watch` if needed; confirm the submitted sitemap is `https://www.tikitikit.kr/sitemap.xml`.
- The 111/14 categories require their actual example URLs to distinguish historical thin/expired URLs from current useful pages. The supplied screenshots contain no example list for these categories; do not claim all are fixed.
- Google chooses whether and when to index a page. Validation and report refresh are not immediate. No Search Console validation or indexing request was submitted by this code change.

References: [Google canonicalization](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [redirects](https://developers.google.com/search/docs/crawling-indexing/301-redirects), [indexing FAQ](https://developers.google.com/search/help/crawling-index-faq).
