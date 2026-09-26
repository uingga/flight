# Trip.com connection labels — 2026-09-25

## Approved scope

Do not reject an otherwise validated roundtrip because direct status is unknown
or the selected itinerary has connections. No exhaustive date searches: retain
the current 60-day calendar candidate, stay lengths, one candidate per city,
city/request budgets, schedule, admission locks and access protection.

The selected outbound and return cards supply independent connection evidence.
Explicit connections are labelled with their stop counts when available. Missing
evidence remains `unknown`, never implicitly direct. Calendar `direct` is not proof.
Required price, times, endpoint airports, itinerary dates, airline and sold-out
checks remain. A structurally unreadable endpoint/card still fails validation.

Published `tripcomDetail.legs` carries outbound/inbound `status`, nullable
`stopCount`, observed `durationMinutes` and local `arrivalDate`. Durations are
itinerary totals including connections, not local clock differences modulo 24h.
Main cards, detail legs, Drop hero, share recommendations, recent cards and legacy
detail display confirmed connections only (latest user instruction). Direct and
unknown states, including missing legacy metadata, have no connection label or
empty badge. Mixed roundtrips label only the confirmed connecting leg. Internal
unknown/direct evidence is retained; no cache rewriting or invented flags occurs.

## Source vs installed runtime

The installed collector is ahead of the repository collector (return-list stop,
60-day/stay policy and button fixes). Do NOT replace the installed collector with
the older repository version or overwrite the full installed runtime.

`scripts/tripcom/runtime-connection-policy.patch` contains only the connection
changes for the installed `tripcom_dom.py`, `tripcom_flight_contract.py` and their
existing DOM test. Copy the new `tripcom_connections.py` and its new test alongside
those files in a separate staging directory before testing.

Original installed SHA-256 values (A scripts and worker-release matched):

- `tripcom_dom.py`: `6db3868e0e99cb3c9712b102a07546b01e64248a1cb39c141e28226267ef8503`
- `tripcom_flight_contract.py`: `bf22ca53499f69203027db12b8511da25431516f21eea0fc53e6a8f97752faca`

Prepared copy is in this task worktree's `output/connection-runtime/tripcom`.
It includes the installed runtime's existing publication reconciliation unchanged.
Only the three collector/contract/helper modules require eventual installation;
do not overwrite the service, publication code, configuration, state or profile.

Before an approved rollout, recheck current hashes and A/B/C idle/ownership state.
Apply the web UI first, verify production, then update the central conversion and
B/C worker modules through their existing maintenance path. Do not restart a live
collection or trigger an extra collection. If hashes changed, rebase the narrow
patch, not the entire runtime. Deployment requires the user's approval and the
installed code-deploy entry in DEPLOY.md.

## Verification (no live travel-site requests)

- Repository Python suite: 98 tests passed.
- Prepared current-runtime Python suite: 138 tests passed.
- Connection labels/duration tests: 4 passed; existing trip-length tests: 7 passed.
- Initial connection implementation `npm run build` passed (typecheck and 620 pages). Existing Browserslist
  staleness and react-datepicker dynamic-import warnings remain unchanged.
- Confirmed-only label refinement: 4 focused tests, TypeScript no-emit check and
  390px/1440px UI checks passed. Direct/unknown cards have no text or empty badge;
  only confirmed connecting legs are labelled. Collector/runtime code unchanged.
- Existing saved collection: 17 roundtrips / 34 legs replayed, all IDs and prices
  unchanged. Unlabelled cards reused the airline already verified in the saved
  result because the original airline-hint DOM attributes are not retained there.
- Isolated local fixture UI: 390px and 1440px passed connection labels, mixed legs,
  unknown handling, 28h10m itinerary, observed next-day arrival and no horizontal
  overflow. Screenshots under `output/connection-ui/` were visually inspected.
- Full generic redesign flow did not finish and was stopped; not counted as passed.
  The initial invocation also required starting the local test server. Focused
  connection UI tests above completed against that server.

No production data, schedules, live installed modules, locks or counters changed.

## Approved rollout preparation — 2026-09-26

The 13:23 regular collection returned 17 verified roundtrips; KUL, DLI and HKT
failed at `outbound_card_parse` with `connecting_leg_not_verified`. The original
failed card DOM was not retained, so the regression fixtures for those three
cities are synthetic, not reconstructed live quotes. The actual A temporary
logical-B worker, C worker and central converter still matched the old module
hashes above. This explains why the previously prepared fix had no runtime effect.

The user approved web deployment and installation on the temporary A worker and
C, without additional collection. Physical B remains fenced. Apply only the narrow
runtime patch and helper; retain the newer installed return-list stop, 60-day/stay
policy, profiles, schedule, 10+10 allocation, admission and access protection.
The temporary A Python manifest and matching config version must be updated
together; central imports require an idle Trip.com-service-only restart.

Additional regression cases keep tentative or negated connection descriptions
unknown. KUL/DLI/HKT fixtures cover explicit connections and unknown status, while
missing roundtrip prices and mismatched route airports continue to fail closed.

Current validation: 159 staged installed-runtime tests, 101 repository Trip.com
tests, 7 closure tests with installed-runtime dependencies, and 11 TypeScript
connection/trip-length tests passed. The production build passed (618 pages).
The local, off-origin-network-blocked UI checks passed at 390px and 1440px; card
and detail screenshots were visually inspected. No travel-site request was made.
Actual success for the three cities remains to be checked in a future regular
collection; code validation alone is not a live success claim.
