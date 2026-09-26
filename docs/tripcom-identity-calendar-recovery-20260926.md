# Trip.com flight identity and calendar seed recovery — 2026-09-26

## Scope and evidence

The user approved installation on the temporary A logical-B worker and C, with
no manual collection, additional requests, schedule or protection changes.
Physical B remains fenced. Preserve the current outbound selection / return-list
stop, 60-day departure window, regional stay limits and 10+10 city allocation.

The 14:57 regular run had `selected_identity_ambiguous` for TPE/DPS; 16:31 had
the same TPE error. The selector truncated multiline flight labels to their
first line and omitted the observed fare. Separate fares for the same flight
therefore matched the same selector. An offline browser fixture reproduces the
old failure and selects the correct cheapest fare with the new exact-label
selector. Proper CSS escaping preserves line breaks, quotes and backslashes.
Actual duplicate labels or changed prices still fail closed. There is no
arbitrary first-card fallback. Failed live card DOM was not retained, so the
fixture is a structural reproduction, not a reconstruction of those live cards.

The initial calendar request used a three-night stay for every destination,
although long-haul candidates require 5–12 nights. The existing one calendar
navigation now starts with five nights for long-haul and retains three nights
for short-haul. Candidate filtering is unchanged. This removes an inconsistent
query condition; it does not claim an exhaustive search of every stay length
or prove that every previous SYD/HNL empty result had that cause. Bounded row
rejection counts and observed night counts distinguish future empty responses.

## Source and installation

The installed collector is newer than the repository collector. Do not replace
it wholesale with the repository version. Apply
`scripts/tripcom/runtime-identity-calendar.patch` only to a staging copy of the
exact installed baseline using `git apply --unidiff-zero`, and add these helpers and tests:

- `tripcom_result_selection.py`, `tripcom_calendar_seed.py`
- `test_tripcom_result_selection.py`, `test_tripcom_selection_browser.py`
- `test_tripcom_calendar_seed_runtime.py`

Baseline SHA-256 (A worker, A central runtime and C must match before rollout):

- `tripcom_dom.py`: `f00c47ed395b4802e2cd94af8182b425db58491a09cfc3f441bd0f51cde16422`
- `crawl_tripcom_40destinations.py`: `2e58a22f791415f79b3f7a1fa2cc8b183790b53a860806b3e8309b1c6c480513`

Stage and patch without touching configuration, profiles or state. Install only
after both workers and publication are idle with sufficient time to the next
regular run. Back up the touched modules and A manifest/config/activation. Update
the A Python manifest version and its matching configuration together. Restart
only the idle Trip.com central service, whose collector imports need refreshing.
Check installed hashes, manifest, state/ledger fingerprints and unchanged task
definitions. Web code publication uses the approved entry in `DEPLOY.md`; main
publication alone does not update the workers.

Evidence is stored in this task worktree under
`output/tripcom-identity-recovery-20260926/`. Installation receipts, rather than
this preparation note, establish whether each host was actually updated.

## Verification before installation

- Staged installed-runtime suite: 181 tests passed, including eight offline
  browser regressions and four in-memory calendar navigation regressions.
- Repository suite: 111 passed, 12 explicitly installed-runtime/browser tests
  skipped. These twelve passed in the staged run above.
- Temporary worker admission, publication and writer preservation: 15 passed.
- Production build passed (618 generated pages); existing Browserslist and
  react-datepicker warnings remain unchanged.
- Saved successful observations: 69 roundtrips / 138 legs replayed; all existing
  flight fields unchanged and no live requests or publication calls.
- Browser fixtures use a fresh ephemeral context and abort all network requests.
  Access restriction fixtures still stop on 401/403/429 without retries.

An unrelated existing UI test was attempted without its required local preview
server and reported connection refused; it is not counted as a passed test.
No UI behavior changes are part of this patch. Actual recovery of previously
failed cities must be checked in a subsequent regular run, not inferred from
offline tests.
