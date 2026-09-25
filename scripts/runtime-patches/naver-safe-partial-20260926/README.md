# Naver interrupted-round publication overlay — 2026-09-26

Status: **approved and installed on A/C on 2026-09-26**. No additional live
collection was started. Final installed runner digest:
`373597065c963ca206a76ebd238cfae0e865ec03ea14809795dab620f69fe59e`.
See `docs/crawl-reliability-repair-20260926.md` for the coordinated rollout.
The manifest's before-hashes describe the preserved pre-installation baseline;
do not reapply this patch to the already updated live files.

The installed A/C runtime contains parallel scheduling and previously approved
maintenance fixes absent from the current repository `main`. Do not replace it
with the older repository coordinator or copy an entire development worktree.
This narrowly scoped patch is based on the exact installed source file hashes
in `manifest.json`. It preserves the existing operator actions and role ACLs.

## Behavior

- A worker may attest a stopped collection only after browser cleanup succeeds,
  all its movements are settled, and its result checkpoint is saved.
- The launcher must receive successful process exits from both workers before
  entering the existing publication path. SSH loss/crash remains unresolved.
- The coordinator independently verifies both terminal checkpoints, run/plan
  identity, the complete ledger, and existing per-host/day debits and keys.
- Only classified transient/route-error interruptions with at least one current
  successful search can publish. Pending requests, explicit access restrictions,
  unclassified failures, missing cleanup, or zero success remain stopped.
- Only success/miss keys are merged onto the latest publication inputs. Unknown
  rows cannot overwrite a previous valid comparison. No additional queries occur.
- Publication still uses the current fenced writer and exact cache/price/base
  proofs. A failed or uncertain publication/readback retains ownership. It is
  never reported as successful, retried with a fresh request, or manually pushed.
- Only exact readback closes the interrupted round. Original debits, keys and
  unknown outcomes are retained. The existing later-regular-round validator
  permits a new plan; neither the same slot nor the interrupted key is replayed.
- Interrupted results never select today's pick. History counters come from
  the ledger, not guesses based on the number of stored price rows. Existing
  per-run histories are not duplicated. Missing queue totals remain unknown,
  not zero; the companion web history normalizer must be deployed with this change.

## Offline validation

Run from an isolated candidate populated from the matching installed source:

```powershell
node node_modules/tsx/dist/cli.mjs --test scripts/test-naver-parallel-partial.ts scripts/test-naver-live-paths.ts scripts/test-naver-ac-transport.mjs scripts/test-naver-admission.mjs scripts/test-naver-coordination-contract.mjs
```

41 tests passed. Tests use temporary SQLite databases, mock browsers and local
publication fixtures; they do not navigate to Naver or mutate production state.
The new integration test exercises the real runner, coordinator, publisher,
broker payload restrictions, exact readback, and admission of the next round.

`git apply --check` passed against a private copy of the matching baseline.
Applying the patch and normalizing ONLY its listed files to LF reproduced all
twelve expected output hashes. Scoped strict TypeScript checking of the runner,
publisher and runtime configuration also passed. After approved installation,
A ran all 41 tests successfully. C ran the 14 existing checks plus the same 27
new integration checks successfully; the latter were run as a direct test script
because Node 22's test child-process transport failed to deserialize its output.
This changed only test execution isolation, not assertions or production behavior.

The final overlay also corrects a duplicate browser-options binding caught by
installed-source syntax validation before any live collection. Every changed MJS
file must pass `node --check` before installation; TypeScript `allowJs` inspection
alone is not sufficient. All twelve final after-hashes were reconstructed from
the preserved original backup and match the installed files.

An additional pre-existing `test-writer-broker.mjs` fixture fails in both the
unchanged installed runtime and the candidate: its fake Git uses `initial`/`sN`
instead of 40-character Git object IDs required by the current commit guard.
That legacy fixture was not modified or counted among the 41 passing tests.

## Installation and rollback precautions

1. Obtain explicit operational deployment/installation approval. Confirm all
   affected collection and publication processes are idle, including B/C.
2. Re-read current operations/deployment instructions. Require every existing
   file's `beforeSha256` to match and every new file to be absent. If anything
   changed, rebase/review the patch rather than forcing an overwrite.
3. Preserve an exact rollback copy. Apply to a NEW candidate, not the running
   directory. Normalize listed source/test files to LF and verify `afterSha256`.
   Verify the patch's own hash as well.
4. Re-run tests and the established runner-set attestation/install procedure.
   Add the new helper to the manifest (included in this patch). Verify A/C exact
   installed bytes and the complete approved runner digest before resuming.
5. Preserve credentials, ACLs, original ledger, budgets, keys, circuits, receipts,
   and schedules. Never instantiate `Coordinator` against the live database for
   diagnostics: its constructor changes the fencing epoch.
6. Use the next regular round for live confirmation. Do not launch an extra
   collection, clear protection, or infer deployment from a successful test.

This patch is not a generic installer and does not authorize operational writes.
