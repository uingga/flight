# Recommendation tail ranking — 2026-09-09

The approved strong-premium experiment applies only to the recommendation presentation
after the first screen. The first nine cards (including today's pinned card when present)
retain their existing representative, tier, departure, destination and price-composition
selection. Explicit price sorting and search paths with `diversify: false` are unchanged.

For the remainder, reuse the existing evidence score. If a fresh full-strength same-date
Naver comparison is more expensive on our site, replace only its Naver multiplier with:

`0.8 + 2r + 24r²`, where `r = (effectivePrice - naverPrice) / naverPrice > 0`.

Lower scores rank first. This has no jump at 5,000 KRW or 3%. Discounts, missing comparisons,
reduced-confidence comparisons and alternative/history/freshness factors keep their existing
score. No newness bonus was added: firstSeen is a score tie-break, then effective price and ID.

The tail no longer uses hard tier ordering/gating or a final same-route ascending-price swap.
Its destination/price-composition constraints still use the existing diversity function.
When only one destination remains, the existing fallback may put its final cards together.
Manual admin placements and shared-link priority are still applied downstream as before.

`score` in explanations remains the first-screen evidence score; `display.tailScore` records
the actual score used for post-first-screen ordering. Candidate/input rank is not display rank.

Validation: `npx tsx scripts/test-recommendation-tail.ts`, existing flight-diversity/manual-order/
shared-context tests, and optional offline replay against the approved full 466-card snapshot
using `--snapshot=<path> --expected=<path>`. Private diagnostic snapshots are not committed.

This changes recommendation code only. It does not change prices, fees, crawler schedules,
Naver collection, cache files, today's selected flight, booking links or manual placements.
