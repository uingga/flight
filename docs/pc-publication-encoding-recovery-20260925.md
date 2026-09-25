# PC collection publication recovery — 2026-09-25

## Incident

The 16:31 KST PC round collected Modetour (796 raw offers, 78 after filtering)
and Ttang (552 raw offers, 84 after filtering). The saved snapshots contain
source observation times 16:34:19 and 16:37:16 respectively. At 16:37:48,
`run-source-fallback-crawl.ps1` exited while reading the general publication
boundary, before submitting these results to the writer.

The overlap change was installed and collection started beside GitHub. The new
publication wait read UTF-8 cache JSON without an encoding argument. Task Scheduler
uses Windows PowerShell 5.1, so Korean text was decoded with the system code page
and `ConvertFrom-Json` failed. The same original file fails with default decoding
and succeeds with explicit UTF-8. This is not a travel-agency access restriction.

## Fix and regression coverage

- Read the publication-boundary cache with explicit UTF-8.
- On parsing failure, retain the saved cache/log files and record their exact paths
  plus the error identifier, without dumping the entire JSON into the log.
- Execute the actual read expression with the scheduled Windows PowerShell binary:
  Korean JSON with/without BOM succeeds; malformed JSON still fails closed.
- Keep the existing collection-before-publication ordering and source-scoped merge.
- `pc-publication-recovery.mjs` provides a pure planning function for saved successful
  Modetour/Ttang results. It requires the published general boundary, matching
  successful logs and same-day fresh observations. It refuses empty/failed/stale
  evidence and never clears current source protection. Already-current or newer
  sources are skipped. It does not collect, publish, release locks or rewrite times.

## Operational scope

The current two snapshots can be merged against fresh immutable main inputs through
the existing source-fallback writer without contacting either travel site again.
Preserve the recovery request ID/receipt on uncertain publication; no new request or
direct push is a fallback. Read back the source timestamps and source data, then
verify Vercel Production and the public API. Source cache counts are not necessarily
public display counts because normal visibility filters still apply.

The separate MRT startup problem (an obsolete GitHub-app private-key path) was
already fixed by `f50aab2f` and installed at 17:53 KST. Preserve that installed release.
Its scheduled-user authentication and B connection checks passed. The missed 15:55
round did not produce a new snapshot; do not invent a completed round or relaunch it
late. Check the next authorized 18:55 B round and its actual publication instead.

The website deployment, A installed launcher, remote B/C releases and actual round
completion are separate proofs. Do not infer all of them from a single passing test.
