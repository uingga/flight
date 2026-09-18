# Returning offers in discovery and price-drop insights

- The new-flight insight includes only offers first observed on the current KST date. The earliest retained discovery date wins, including when a listing disappears and returns. There is no fallback to an older discovery day.
- Collectors retain a separate `recommendationNews.priceDrop` observation when an offer reaches a new observed low at least KRW 10,000 below the preceding observed price. Unlike the recommendation ranking event, this has no 5% requirement. Ranking policy remains unchanged.
- This event survives listing absence and unchanged refreshes. Its original observation time is retained. The insight displays it for 72 hours, only while the current effective price still matches. A rise or reversal to an already observed low does not create another event.
- The comparison is labelled “이전 확인가보다”. When the exact previous observation time is unavailable in an older event, no comparison date is invented. The initial archive's three-day limit does not limit the length of a listing's absence.
- Existing `recommendationNews.drop` records are usable evidence during migration, at their original timestamp and amount. New collectors explicitly store `priceDrop: null` when no eligible event exists; this prevents older archive quotes from reviving a rejected or expired event. Missing pre-migration events are not reconstructed.
- For legacy listings without retained event tracking, the daily archive remains a fallback. Match the nearest exact observation before checking whether it is more expensive; never skip a same/lower recent quote in favour of an older high.
- Stored events include the existing Ttang KRW 20,000 issuance fee on both sides. The API converts them back to listed prices for comparison with the card's price; the decline amount is unchanged. Archive `listed_price` already matches the card. Do not mix effective and listed prices and thereby hide all Ttang insight cards.
- If the archive is unavailable, independently valid retained events can still appear. No example or inferred records are substituted.

## Release requirements

Publish the prepared code branch to GitHub before invoking the installed code-deployment entry: the broker reads the candidate commit through GitHub's API. Verify that both the exact base and candidate commits are readable. This preparatory branch upload does not replace the common writer's exclusive authority to update main.

This change includes `src/lib/flight-offer-history.mjs`, used by actual collectors and source-result mergers. Website deployment alone does not enable the new KRW 10,000/no-5%-minimum event on every PC. Update the versioned A/B/C common collector release and the protected Naver merge dependency through their existing hash-guarded, coordinated idle maintenance paths. Preserve active collection, schedules, profile/state paths, quotas, keys and blocks. No new crawl or data rewrite is needed. Do not patch immutable installed releases in place.

Existing events are displayed by the website immediately after its deployment; newly captured events take effect as normal observations flow through the updated common runtime. No historical backfill is claimed.
