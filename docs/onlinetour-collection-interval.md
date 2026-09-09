# OnlineTour low-frequency collection

OnlineTour alone uses a randomized 2–3 day interval. Existing general scheduler
slots remain polling opportunities, not permission to contact OnlineTour daily.
Collection resumes at the first eligible scheduled check after the interval.

The most recent persisted PC attempt or GitHub claim/attempt is the anchor,
including failures and verified empty inventory. A versioned SHA-256 hash of
that timestamp chooses 2 or 3 days with equal probability. This pseudorandom
choice is identical on A, B and GitHub and cannot change on polling or restart.
Legacy caches use the last attempt, or source update timestamp if absent.
Invalid timestamps fail closed; an entirely new source can perform its first run.

The shared PC dispatch/worker policy and GitHub dispatch/claim/pre-request guard
all apply this interval. A failed PC attempt therefore does not trigger immediate
GitHub fallback during the rest period. Existing circuit and slot safety checks
remain additional restrictions; recovery can be later than 3 days.
Explicit operator-approved manual collection remains separate from scheduling.

Other agencies, their cron times, and inventory are unchanged. Deployment must
include the policy, config and new interval module on A, B and GitHub together.
No live requests are required to test this scheduling change.
