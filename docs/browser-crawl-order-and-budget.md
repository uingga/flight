# Browser collection order and request budgets (2026-09-08)

User-approved change: vary independent targets per round without sampling away cities/dates,
and replace the OnlineTour 40-request cutoff with room for complete visible coverage.
This is load scheduling, not an access-control bypass or a guarantee against blocking.

## Operational behavior

- OnlineTour: request-ID-seeded region/city ordering, initial entry and its already-fetched city
  stay first to avoid duplicate requests. Forward month links and pages remain sequential.
  Live waits add 0–3 seconds to the existing minimum (normally 5–8 seconds).
  Product request safety ceiling is 100, not a target to fill. All visible city-months and
  observed additional pages are counted in `requestBudget`; unseen regions remain explicitly
  unknown. Exact page counts are unavailable before the relevant first response, so estimates
  never imply a complete crawl. No extra discovery requests are made for budgeting.
  End-of-list ends collection early; hitting the ceiling or missing a month fails coverage and
  does not publish an apparently successful truncated catalogue. Zero operational retries remain.
- ModeTour: all 5 regions + 10 Chinese cities are permuted once using the request ID.
  Required list requests are derived from the complete scope array (15); safety ceiling stays 15.
  Each query already spans tomorrow through next month, so no per-day queries are added.
  Existing 3–5 second waits and TPE-only HTTP-500 preservation remain.
- Ttang: all existing one-month dates are permuted using the worker run ID, with no date-window
  expansion. Normal list requests equal the number of dates (29–32). The existing maximum of
  one retry per date is explicitly budgeted (58–64 attempts at most, not 58–64 normal queries).
  Listing waits and source failure guards remain unchanged. Detail requests remain capped at 20;
  only equal priority/last-attempt candidates are permuted. Previously validated times remain reusable.

## Persistence and safety

OnlineTour saves `plan.json` before requests; summaries/checkpoints retain the seed. Supported
checkpoint reuse rejects a different seed. ModeTour saves the actual ordered scope array in its
existing plan; continuation consumes that saved order. Ttang writes ordered `plannedDates`, seed,
expected count, attempt limit and completed-date evidence before/after requests. An existing list
checkpoint is never silently overwritten to restart the same run.

This does not introduce automatic process restart/resume after interruption, bypass immutable
slot markers, clear cooldowns, launch new profiles, change schedules or increase parallelism.
Uncertain interrupted runs still stop for review. Already fetched first-page responses are reused.
Page-loading assets/preflights are separate from these product/list-query budgets.

## Verification

Offline permutation/round-replay tests, 52-query OnlineTour full-coverage fixture, sequential
month/page checks, shuffled ModeTour A-side bundle verification, shuffled Ttang evidence rejection
tests, existing restriction/coverage tests, and the three crawler TypeScript configurations.
No travel-agency network queries are needed for these tests.
