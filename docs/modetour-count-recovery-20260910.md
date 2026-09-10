# Modetour inventory decline handling

The 2026-09-10 06:41 run returned KHH 5 rows versus the previous 9.
All non-TPE list requests returned 200; TPE returned its known 500.
`source_count_collapse` incorrectly became an access restriction and a 24h cooldown.

Remove relative inventory thresholds from the browser collector, worker and
independent bundle validator. The unified crawler exempts only validated Modetour
browser results from its generic 60% decline guard. Other agencies are unchanged.
Keep exact scope coverage, schema, response totals/pagination, budget and access
validation. An entirely empty catalogue still preserves old inventory as a
collection failure, but is not automatically called an access restriction.
Only `access_restriction` opens the browser's 24h restriction circuit.

Operator authorized one collection and recovery of the proven false cooldown.
Retain the old failure evidence and archive the exact `source_count_collapse`
cooldown before removal. Do not clear unrelated or genuine access restrictions.
The existing 06:17/10:12/13:23/16:31 KST schedule remains unchanged.
