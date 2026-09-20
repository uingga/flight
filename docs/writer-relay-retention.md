# Publication relay retention

## Scope

Only `tikit_writer_private.deliveries` (temporary publication requests and receipts).
This does not delete flight caches, price history, crawler checkpoints, coordinator
locks, request keys, usage accounting, or access-block records.

- Admission: at most 1,000 outstanding rows and 256 MiB outstanding logical bytes.
  Completed history does not consume this admission budget. Individual requests
  and responses keep their existing 24 MiB bound.
- Pending requests expire 24 hours after their original `relayIssuedAt` (legacy:
  enqueue time). Expiry is terminal; it never makes the request claimable again.
- A newer successful same-role daily/MRT commit with the same nonempty set of
  output paths supersedes an older pending commit. Read-only requests, partial
  batches with different output paths, other roles, and claimed work are excluded.
- Claimed requests heartbeat during execution. After 24 hours without a heartbeat,
  they become `PUBLICATION_EXPIRED_UNKNOWN`, not a retry. A failed heartbeat must
  not clear a coordinator writer lock or trigger another publication attempt.
- Terminal bodies and receipts remain seven days after completion/terminal expiry,
  then the database-owner cleanup removes them. Thus an abandoned request can stay
  about eight days from its last heartbeat, plus the hourly cleanup delay.
- Original dated packets cannot be replayed after receipt deletion. A caller that
  deliberately creates a new dated invocation is a new request; strict immutable
  base checks and the existing broker fence must still prevent publishing stale
  data. Timestamps are not a substitute for authentication or those checks.

## Two-phase deployment (do not skip)

1. Back up the live SQL function definition and inspect current queue state, writer,
   and workers. Apply `scripts/sql/writer-relay.sql` through the approved database
   owner path. This immediately repairs admission accounting, but creates the
   retention policy with `enabled=false`. It deletes no rows. Existing undated
   producers remain compatible while retention is disabled.
2. Deploy the web handler/client and watchdog changes through `docs/DEPLOY.md`.
   Confirm main, Vercel Production Ready and the API, not only a deployment receipt.
3. In an idle maintenance window, integrate the dated client and agent heartbeat
   changes into actual A/C/B installations as applicable. Installed runtimes may
   contain newer publication reconciliation code than main: preserve it. Verify
   digests and all producers, including GitHub, web-admin and PC tasks. Do not
   overwrite an installed file with an older main version wholesale.
4. Only after verification, enable retention as the database owner under the same
   advisory lock `(74152,190915)`. First give legacy claimed rows with NULL
   `heartbeat_at` a one-time activation-time heartbeat. Do not reset claims, states,
   coordinator locks or usage. Enable the singleton policy and register one hourly
   owner-run call to `tikit_writer_private.cleanup_deliveries()` using the existing
   database scheduler. Do not install a new extension or grant application roles
   DELETE, policy UPDATE, or cleanup EXECUTE privileges.
5. Enabling scheduled permanent deletion is a separate consequential UI action:
   apply the current action-time confirmation policy. Inspect affected row counts
   before the first cleanup. Verify the job and its execution history afterward.

The SQL migration deliberately does not enable cleanup or schedule a cron job.
Until step 4, automatic retention is **not operational**. Existing done rows have
unknown completion times; migration conservatively starts a full seven-day window
instead of guessing old completion times. SQL DELETE frees reusable DB space but
does not necessarily shrink the storage file immediately.

## Collection/publication separation

The watchdog reads GitHub job steps. Successful collection followed by failed or
missing publication means publication recovery, not permission to collect again.
Uncertain job evidence fails closed. Subsequent regular schedule slots are not
changed. Publication failures preserve the four collected files in a seven-day
GitHub artifact. Artifacts are evidence, not authorization to republish: check
original age (24h), newer batches, immutable base, locks and receipts first.

## Local verification

`node --test scripts/test-crawl-publication-blocker.mjs scripts/test-writer-relay-heartbeat.mjs scripts/test-writer-transport-limits.mjs`

`node scripts/run-local-postgres-relay-test.mjs` uses existing PostgreSQL 18 binaries,
creates only a disposable loopback fixture, and stops/removes that fixture after
testing. It does not connect to production. Full `npm run build` is also required.
