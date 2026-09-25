# Modetour remote admission repair — 2026-09-25

## Root cause

The 19:31 A launcher correctly assigned Modetour to C using
`scripts/ttang-worker-routing.mjs`. C's legacy entry forwards to its verified
collector release; the apparent file in `ac-staged-20260916` is only a bridge.

The actual C release was
`7c3f4c339bc107a989003e61e6fc10ae6c1ca9d8a5ed6d734cc438de45cb7401` (106 files).
Its Modetour worker used another table, `agency-slot-policy.mjs`, which recognized
four daytime slots and 20:30 but omitted 19:31. A read-only call against that
installed module accepted 16:31 on C and rejected 19:31 with
`source_slot_mismatch`. No travel-site request was made by this check.

The outer worker error handler then discarded protocol/request identity and the
actual error. A therefore reported `remote_identity_mismatch`. This is not
evidence of a wrong SSH machine or a travel-site access block. C hostname and
release integrity were independently verified and its shared run lock was absent.

## Fix

- The tracked Modetour worker now uses the same daytime B/C routing module as A,
  eliminating the duplicated admission table for this path.
- A valid request's failure response keeps its protocol, ID, phase and sanitized
  reason, including failures before browser creation. Mismatched response IDs still
  fail closed. Private exception bodies/paths are not included.
- Success is emitted only after cleanup returns. Cleanup failure cannot append a
  second JSON reply after a success reply.
- Failure messages identify the actual B/C worker rather than always saying B.
- Request age, assigned host, source eligibility, preceding snapshot, cooldowns,
  shared lock, same-slot claim, browser budget and independent result validation
  remain enforced. The 20:30 agency-evening-v2 path is unchanged.

## Verification and operational boundary

Offline tests cover every configured general cron, C 19:31, wrong-host requests,
stale/future requests, duplicate/cooldown rejection, correlated failures, and a real
worker-entry failure that stops before browser creation. Existing Modetour browser,
PC overlap, shared routing and 20:30 policy tests are included.

Code publication and installed collector updates are separate operations. Obtain
explicit operational deployment approval, use the official common writer entry,
then preserve each host's active release and state before installing the narrow
overlay into a new immutable release. Do not edit files inside an active release
or overwrite a bridge. Verify A/B/C use matching repaired code and exercise the
same offline admission test on the installed copies. No extra manual crawl,
past-slot retry, spent-key reset or cooldown/lock reset is authorized by this fix.

The failed 19:31 run has no saved new Modetour inventory. Keep its previous good
data until a later normal collection publishes a verified result.
