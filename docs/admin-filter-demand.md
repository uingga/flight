# Admin filter demand

`visitor-dates` now shows departure/destination, price/airline/agency and departure dates in three views. Bars show the share of confirmed selections within each card. The first six values appear initially; remaining values can be expanded.

The authenticated GA stats API reads `filter_change` using event-scoped `filter_type` and `filter_value` custom definitions, plus `destination_search` using `destination`. Configure missing definitions in GA4 before expecting new records; registration does not restore historical values. Failed, truncated, sampled or thresholded reports remain unavailable, independently by report. No production setup or deployment is performed by the implementation.

Counts include repeated actions. `totalUsers` is queried per exact value across the entire date range, never summed across days, aliases or filters. Date buckets remain counts only. All/reset actions are excluded from preference shares; missing values are not reconstructed. Impressions are never queried. Existing administrator exclusion and event emission are unchanged.

Destination searches include only exact city matches with existing results that emitted an event; repeated identical searches and searches without results are not comprehensively captured. The report is not a count of all search attempts, combined conditions, bookings or unmet demand. `range_days` is the departure search window, not trip duration. `date_period` and sorting are not added to date selection counts.

Verification: `npx tsx scripts/test-filter-demand.ts`, `node scripts/test-admin-filter-demand-ui.mjs`, `npm run build`. Local-only fixture: `/preview/filter-demand` with optional `state=empty|unavailable|partial`. It requires the isolated preview environment and loopback host; production returns 404. Example numbers never substitute for live statistics.

2026-09-08 verification: production build/type/lint passed (existing react-datepicker/Browserslist warnings), parser/loader tests passed, UI tests passed at 1200/390/320 px including independent unavailable reports, expansion and authentication/host guards. Read-only inspection of the production GA4 custom-definition list found 18 definitions; `filter_type` and `filter_value` are absent. Both event-scoped definitions must be registered when activating this feature. No definitions were changed. Existing `destination` and the four date definitions are present.
