# Browser collector recovery and temporary B-to-A handover

Status: 2026-09-26 KST. B is fenced, A is prepared but not yet active.
The user approved code changes and operational installation for temporary A replacement.

## Evidence, not assumptions

- B's fixed Chrome listener existed, but WMI process-owner inspection timed out.
  The Ttang failure was before collection (`dedicated_chrome_owner_unverified`).
- B's selected collector dependency tree was a junction into Dropbox. A bounded
  read-only dependency check stalled on a cloud-backed package file. The recorded
  request-to-claim interval was 9 minutes 41.710 seconds.
- Modetour's old SSH wrapper discarded the information needed to distinguish
  transport, startup, and timeout failures. Its exact historical branch cannot
  be reconstructed from that log alone.
- The user subsequently reported a black B desktop with an error dialog and no
  working clicks. The dialog text is not legible enough to identify the process.
  SSH hostname and non-WMI process enumeration still respond. This does not prove
  that the interactive Windows session is healthy.
- No website 401/403/429/CAPTCHA was established for the above Ttang preflight
  failure. No existing circuit or unknown-completion record was cleared.

## Prepared changes

1. Read the fixed listener using netstat and query its Chrome process using
   limited-information Windows APIs. Keep exact owner, profile, loopback,
   debugging-port, and before/after ownership checks. Failure remains closed.
2. Classify Ttang preflight failures only with correlated protocol/request ID,
   explicit zero site requests, completed cleanup, and no restriction/uncertainty.
   Only that evidence prevents a NEW 24-hour cooldown. The spent-slot marker
   remains; legacy replies and existing cooldowns do not silently qualify.
3. Record bounded, sanitized SSH transport timing and failure categories in the
   existing logs. No retries, request expansion, or longer source deadlines.
4. Prepare exact-lock dependencies in a new local immutable directory, without
   lifecycle scripts or browser downloads. Reject cloud-backed dependency paths
   before per-package reads. Do not change an active junction or release pointer.

## Validation

- Regression tests: 182 passed, one optional saved-capture replay skipped.
- Modetour TypeScript project check: passed.
- Production Next.js build: passed (618 generated pages; existing warnings).
- Native process helper: A Chrome PID identity/name/command-line availability
  verified with no site requests (652 ms). This is an API check, not proof that
  this browser is an authorized dedicated collector profile.
- Real dependency preparation: 206 exact-lock packages validated, activated=false.
  Lock SHA: `2ab553c115d9e3598382058fed379b381569e73d076be83c6f7133586bfcf4ab`.
  Initially prepared under this worktree's output/dependency-validation-20260926.
  The output directory is not tracked and must not be added to a code commit.
- No new crawl, production code publication, B/C installation replacement, browser
  termination, lock deletion, or circuit/budget reset was performed.

## Temporary B-to-A request

The user requested A to cover B until B recovers. Preserve C assignments and
Naver A/C operation. Replacement must inherit B-assigned slot identities and
existing admissions, budgets, unknown states and website protections; it is not
permission to rerun already-spent slots or bypass a shared-network block.

Read-only prerequisite findings:

- A collector configuration currently permits only `general` and `dispatch`.
- Browser worker host checks currently permit B/C, not A. Changing an SSH address
  alone is therefore not a supported handover.
- A has an existing dedicated-profile directory, but the Chrome process owning
  port 9222 lacks the expected dedicated-profile command-line flags. Do not attach
  a collector to it, close it, or weaken ownership validation.
- B's legacy `TikitikitTripcomCrawl` task is disabled. This says nothing about a
  differently named parallel task; inventory it before fencing/reassigning B.
- A's current source-fallback, MRT, and Naver scheduled tasks were Running during
  inspection. Do not restart or mutate those active runs for this handover.

Required activation work, subject to the project's operational code approval:

1. Inventory current B launch entry points and unresolved claims; fence only new
   B collection starts and save the prior configuration for deliberate rollback.
2. Add an explicit temporary A execution target rather than impersonating B's
   physical hostname. Preserve B's logical slot/quota ownership in the coordinator.
3. Prepare A's collector browser without disturbing its personal Chrome or Naver.
   Never copy B/C login profiles or cookies.
4. Install matching signed manifests and local dependencies, test host/slot fencing,
   and activate only unspent eligible regular slots. Do not reset an unknown run.
5. Verify normal result publication through the existing writer and operating API.
   Restoration to B requires another idle/ownership check, not an automatic overlap.

## 2026-09-26 approved handover evidence

- B collector and MRT/evening entries refuse new work while the exact maintenance
  marker exists. Original entries and the Trip.com task/config are backed up in
  B's `AppData/Local/Tikitikit/deployment-backups/b-on-a-20260926`.
- B's hung Trip.com scheduled task was disabled, then stopped after the central
  ledger proved B had never acquired today's slot. Its configuration is disabled.
  The B browser itself was not killed, and its profile was not copied.
- 172 agency state files and 35 Trip.com state files were copied byte-for-byte to
  a new A state root. No active locks were present. Circuits and processed keys
  remain intact. The exact source-state hashes are in local preparation receipts.
- A uses its own existing `tmp/chrome-debug` profile at port 9223. Native owner
  and before/after CDP validation passed without a website request. Personal
  Chrome at port 9222 is untouched. Trip.com uses A's existing, separate
  `tmp/chrome-tripcom` profile through the unchanged installed B worker.
- Physical A execution is explicitly identified while retaining logical B's
  central assignment. C and Naver are unchanged; Trip.com remains B10+C10 at
  the same ten regular times. A's replacement task is prepared disabled.
- For the stranded 06:17 Trip.com group, B was finalized as explicitly
  inconclusive with zero requests, not as collected. C's immutable artifact was
  preserved, and the existing writer published commit
  `6dac484e4b537c40b777ecf3269441453eeddcad`; its receipt confirmed Production/API
  verification at 11:27:35 KST. The maintenance closure has five passing offline
  tests, including refusal of claimed B, unknown local state, and an open circuit.

No past slot was replayed. The earlier Ttang cooldown ending 2026-09-27
06:57:39 KST remains preserved; host replacement does not remove it.

## 11:48 replacement startup correction

The first regular A replacement startup exited before admission because its
loopback URL omitted the required `/tripcom` path. This was a configuration
contract defect, not evidence of a Trip.com restriction. Correct both preparation
and runtime validation to `http://127.0.0.1:47832/tripcom` without weakening the
Python transport's loopback, path, credential, proxy, or redirect checks.

Preparation and every scheduled launch now instantiate the actual installed
Python `Client` using a dummy credential, without calling it. This offline startup
contract catches cross-language configuration errors before a browser or slot
is opened. Nine launcher/fencing tests and seven maintenance-closure tests pass;
the installed Python contract passes with zero network requests.

At 11:57:43 KST the five reviewed files and the URL were installed on idle A,
with backups and a new verified release manifest. No worker, coordinator, C task,
profile, dependency, circuit, state, quota, or processed key was reset. A's next
regular Trip.com task remains 13:23; the failed 11:48 slot is not replayed.

C's completed 11:48 artifact contains ten attempted cities and nine observed
fares. An evidenced A pre-admission failure is finalized explicitly as zero
requests/inconclusive so the original common writer can publish the successful
C results. This closure refuses running/unknown A state, any admitted logical B
worker, an open shared circuit, or an existing publication needing reconciliation.
