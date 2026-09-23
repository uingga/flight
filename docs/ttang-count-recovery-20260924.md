# Ttang inventory decline recovery — 2026-09-24

The 2026-09-23 06:41 KST B PC primary run completed all 31 planned departure
dates with 31 promotion API requests and no restricted HTTP responses. Its
verified list evidence contained 607 unique flights. The previous complete run
had 1,378, so the generic 60% count guard discarded the new inventory and
opened a 24-hour soft-block circuit. The per-date response counts declined
across the shared date range; the run did not stop at a date or lose a region.

For the dedicated Ttang B/C PC worker only, a positive inventory count can
pass the relative count guard when the list manifest independently verifies
every planned date, request count, page contract, ordering, and raw count.
The worker's final bundle validator still checks that manifest, the detail
checkpoint, fresh cache timestamp, and valid flight products before A merges
anything. The generic guard remains active for other collectors and for a
missing or invalid Ttang manifest.

Zero results, explicit 401/403/429/CAPTCHA, empty-response collapse, malformed
data, incomplete dates, and failed details still preserve the previous cache.
The existing cooldown and scheduled request budget remain in force. This code
does not replay the rejected 607 flights or initiate a new collection; the next
eligible scheduled run must produce and publish a fresh, fully validated bundle.
