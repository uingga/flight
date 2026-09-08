# MyRealTrip scheduled-slot recovery

The existing authenticated `/api/internal/crawl-watchdog` endpoint, called by the external
five-minute clock, independently checks MyRealTrip's 07:05 and 16:03 KST slots.
After five minutes it dispatches an unstarted latest slot. Active runs, recent dispatches,
legacy successful runs and persistent reservations suppress dispatch. Failure of this
check does not stop the existing general-crawl watchdog.

Every scheduled/manual/watchdog run uses the same workflow concurrency group and must
atomically create `refs/tags/mrt-slot/<UTC slot>` before setup or agency requests.
These lightweight Git refs are durable reservations, not release tags. They are never
automatically removed. A failed or cancelled reserved run is not retried in that slot;
operators must diagnose before authorizing any recovery. GitHub API ambiguity fails closed.
Late schedules derive their original slot from the run's creation time and cron, not its
eventual start time. Superseded slots are skipped; the latest slot is handled separately.
Workflow re-runs and later arrivals cannot consume a reservation twice.

No agency circuit is reset. Existing 24-hour access restrictions remain authoritative.
No source cache or last-success timestamp is forged to suppress duplicates.
Deployment can let the existing clock dispatch today's overdue slot without a separate
manual dispatch. Always inspect run/claim state before requesting an additional run.
