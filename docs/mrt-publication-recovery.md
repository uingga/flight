# MyRealTrip publication recovery

This is a data-only operator recovery tool, not a crawler or a scheduled retry loop.
Existing collection schedules and circuit protection are unchanged.

## Failure evidence

The workflow saves the collection snapshot before publication and retains it for seven
days. A failed `writer-push.mjs myrealtrip` also records a credential-free diagnosis
artifact. Both artifacts must belong to the same GitHub run. A failed artifact upload
does not count as a saved snapshot. Collector failure is never accepted as a successful
publication-recovery input.

- `ENOBUFS` / HTTP 413: fix the capacity problem first.
- HTTP 401/403: fix the publication credential/permission problem first. This is not
  permission to bypass a travel agency access restriction.
- `ECONNREFUSED`: restore the publication service before an operator retry.
- HTTP 409/5xx, timeout, generic errors: outcome unknown. Read back the current source
  and inspect the central writer's in-flight state; do not automatically retry or change
  request identity. An operator flag alone cannot unlock this category in this tool.

## Inspect, then apply after resolving the cause

Place `manifest.json`, `all-flights-cache.json`, `crawl-log.json`, and
`mrt-publication-failure.json` from the matching artifacts into one dedicated directory.
Use the existing scoped MyRealTrip central-writer environment (`NAVER_COORDINATION=1`,
`TIKIT_WRITER_URL`, role token/file); never put credentials in the archive or command log.

```
node scripts/recover-mrt-publication.mjs --inspect <archive-directory>
node scripts/recover-mrt-publication.mjs --apply <archive-directory> capacity
```

The final argument is the diagnosed category whose underlying cause the operator has
actually resolved (`capacity`, `authorization`, or `connection_refused`). It is not an
override for an unknown publication outcome. Inspect mode only reads.

The tool validates snapshot hashes, successful-collector evidence, source timestamps,
nonempty results and source circuits. It skips an already-published or superseded source,
refuses equal timestamps with different content, and merges only MyRealTrip against a
fresh immutable base. Other agencies are retained; original collection timestamps stay
unchanged. The central writer enforces CAS and publication fencing.

Before a single publication call it records `publication-recovery-attempt.json` with the
request identity and base. A duplicate apply is refused even after a failed or uncertain
attempt. After publication it reads the source back and records the observed result.
Do not delete this journal to force another attempt. This tool does not release collector
locks, reset budgets, start scrapers, download artifacts automatically, or run periodically.

The existing archived-success lock-finalization policy remains separate: allowing the
next scheduled collection does not claim the saved result was published.
