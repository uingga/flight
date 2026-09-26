# MRT 12:40 publication failure — 2026-09-26

## Outcome and boundary

- Archived successful collection was recovered through the existing scoped common
  writer, without any collector invocation. Commit
  `ed3f4d47dd971c9bca82e6598c39b2a2c5d4cd87` reached Vercel Production success
  at 14:41:41 KST. Public API returned 200; all three publicly eligible MRT cards
  matched archived prices. The source cache contains 117 flights before display
  filters. Other agencies were preserved.
- The original 12:40 slot completion receipt was created and read back at
  14:44:29 KST, pointing to its original owner. No active reservation was deleted,
  replaced or reacquired. No Naver collector was started manually.
- The already-running regular Naver bridge observed that completion at 14:44:53
  KST and continued its 13:23 round automatically. Read-only ledger check at
  14:49:12: phase running/parallel collecting, A89/C87 cumulative movements,
  2 currently pending, shared blocked=false. This is not a finished-crawl claim.
- Recurrence fixes below are **local, not deployed/applied**. User approval for
  production code/SQL deployment was requested separately. Do not confuse restored
  data and its Vercel deployment with deployment of these fixes.

## Confirmed evidence

- GitHub run `36215760862`, job `108331298551`: regular collection 162/164 success;
  successful result archive exists. Publication failed after collection.
- Source timestamp: `2026-09-26T04:55:26.538Z`. Archive hash verification passed.
- Request `b4dc82fa-ad32-4581-a749-152a2241963c` was **readInputs**, not commit.
  Read-only database inspection found this was the only MRT delivery since the
  slot, with state `claimed`, no completion and no commit request. Source code
  awaits readInputs before invoking its only commit call.
- PostgreSQL production logs: SQLSTATE 57014, statement timeout in
  `public.tikit_writer_queue`, line 13 at IF (13:55:25 KST). That line converts and
  compares both full JSON request bodies while holding the global transaction
  advisory lock. Other log entries show multi-second lock waits/timeouts.
- The failed readInputs itself was only 66 bytes. Large other submissions/polls
  share this lock; this is not evidence of a large readInputs request or an MRT
  website block. Retention was enabled and its scheduled cleanup succeeded.
- Code defects amplify the contention: DB heartbeat/complete exceptions become
  permanent-looking HTTP 409; the final heartbeat is outside acknowledgement
  retry, so a transient error discards the already-produced response and leaves
  the delivery claimed. Historical agent logs did not include a failure stage.
  **The exact final failed claim/heartbeat/complete call for this UUID cannot be
  proved from those logs**; do not invent it.

## Fixes

1. Existing receipt polling no longer takes the global admission lock. Identical
   frozen wire bytes use string equality; only differing legacy envelopes use
   semantic JSON comparison. Missing/new rows are rechecked under the original
   lock, and all transitions, collision checks and limits remain enforced.
2. Transient DB delivery errors return 503/unknown, not proof of rejection.
   A final heartbeat is retried within the acknowledgement deadline. Once claim
   validity is confirmed, only the exact completion is retried; the publication
   handler is not rerun. Lost ownership remains terminal.
3. Failure artifacts retain read_inputs versus unconfirmed phase and sanitized
   request diagnostics. Agent errors retain role, request ID and claim/heartbeat/
   complete/publication stage without messages, bodies, secrets or stacks.

## Executed validation

All regression requests used synthetic local inputs/loopback, not agency sites.

| Command | Result |
| --- | --- |
| `node --test scripts/test-writer-relay-heartbeat.mjs` before core fix | RED: 7 pass / 2 fail (final heartbeat timeout and 503) |
| Same suite with HTTP DB fault tests before handler fix | RED: 9 pass / 2 fail (HTTP 409 instead of recoverable acknowledgement) |
| `node scripts/run-local-postgres-relay-test.mjs` before SQL fix | RED: exit 1; receipt times out behind a held global lock |
| Same real PostgreSQL 18.4 isolated-cluster command after SQL fix | GREEN: exit 0; 7 groups, including concurrent claims, restart/no reclaim, retention, limits and lock-free receipt read; fixture server stopped |
| Eight Node regression files listed below | GREEN: exit 0; 87 pass / 0 fail |
| `node --test output/mrt-20260926/test-finalize.mjs` | GREEN: exit 0; 4 pass / 0 fail; owner conflicts and active collector refuse completion |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | GREEN: exit 0 with existing complete runtime dependencies |
| `node node_modules/next/dist/bin/next build` (`NEXT_TELEMETRY_DISABLED=1`) | GREEN: exit 0; full production build, no installation |

Regression files: `test-writer-relay-heartbeat.mjs`,
`test-writer-publication-ack.mjs`, `test-mrt-publication-recovery.mjs`,
`test-tripcom-committed-writer.mjs`, `test-mrt-finalization.mjs`,
`test-crawl-publication-blocker.mjs`, `test-merge-crawl-log.mjs`,
`test-writer-transport-limits.mjs` (all under `scripts/`).

The first typecheck used an existing project dependency directory missing Node/
React declarations and failed. Repointing only this worktree's junction to the
already-installed `C:/Users/ynal/Tikitikit/naver-crawler-runtime/node_modules`
resolved it. No source workaround or dependency installation was used.

## Artifacts

Worktree: `C:/Users/ynal/.codex/worktrees/mrt-relay-failure/260207_Test`.
Base: `9b4250d9b3a60c0729a346a584db5cdd2980fa5f`.
`evidence/`: PostgreSQL RED/GREEN summaries, regression log, typecheck/build logs,
code patch and SHA256 manifest. `output/mrt-20260926/`: recovery archives,
independent diagnosis, write journal, broker receipt, source/Production readback
and original slot completion. These incident data are local evidence, not code
deployment inputs. Never commit archives/auth files or output data wholesale.

## Remaining production application

1. After explicit code deployment approval, rebase only this code delta onto fresh
   main, preserve all other work/data, use `docs/DEPLOY.md`'s installed broker
   deployment entry and verify Production.
2. Separately save and compare the current live SQL function, then replace only
   the tested `public.tikit_writer_queue` body transactionally. Do not rerun
   retention enablement, change ACLs, purge receipts or reset claims.
3. The installed agent is newer than repository main: it includes
   `waitForPublication`, `publicationBusy`, `runDeliveryLoop`,
   `collectionControlGuard`. **Do not copy this older entire main startup/agent
   over the installed runtime.** Apply only tested acknowledgement/diagnostic
   deltas to that existing implementation and preserve its continuation behavior.
   Drain safely; do not interrupt an active publication/collection. Follow the
   existing installed-code validation/attestation procedure.
4. Existing uncertain claimed receipts stay untouched. This one-off saved-data
   recovery relied on independent proof that the failing action was read-only;
   it does not permit replay of unknown commit outcomes or a blanket retry mode.

Schedules, travel-agency collection policies, today-pick policy, browser profiles,
Naver budget/keys/locks/circuit state and credentials were not changed.
