# Current collection schedule

Updated 2026-09-25 after synchronized installation. All times below are KST
scheduled starts, not completion deadlines. The first full six-round day still
needs normal-run verification; no extra crawl was launched for this change.

| Work | Scheduled starts |
| --- | --- |
| General GitHub round; ModeTour, OnlineTour and Ttang PC primary after its completion | 06:17, 10:12, 13:23, 16:31, 19:31 |
| Ttang GitHub collection | 06:17, 13:23 |
| Ttang PC primary | 06:17, 10:12, 13:23, 16:31, 19:31 |
| Coordinated PC agency regular round (B: YB/Hana/Online; C: Mode/Ttang/Lotte) | 20:30 |
| MyRealTrip (GitHub/C/GitHub/C/B/GitHub) | 05:35, 09:35, 12:40, 15:55, 18:55, 20:15 |
| Naver A/C coordinated collection (after publication) | 06:17, 10:12, 13:23, 16:31, 19:31, 20:30; the last round uses only the remaining shared 450-navigation daily budget |
| Trip.com B/C parallel, 10 cities per host per round | 06:17, 08:14, 10:12, 11:48, 13:23, 14:57, 16:31, 18:01, 19:31, 20:30; adjacent successful rounds cover 40 cities |

The 20:30 Naver round is separate from the 19:31 GitHub round. It waits for the
published 20:30 PC agency result and the exact sixth MyRealTrip completion. It does not
reserve or reset any Naver budget. The first MyRealTrip round starts at 05:35 because
recent 06:17 general rounds published near 06:37 and MyRealTrip typically took 61–66
minutes. The middle four rounds already finish near their general counterparts. The
20:15 start is provisional: a 63-minute MyRealTrip run would finish near 21:18, but the
new three-agencies-per-host 20:30 PC round has no successful duration sample yet.
Actual completion also depends on the live site, GitHub scheduling, and publication delays.

The independent five-minute watchdog uses the same general slot definitions.
Ttang's PC primary now follows all five general slots. Its GitHub backup remains on two slots.
PC completion is awaited before freezing Naver recovery sources. A and C share a 450-navigation
daily cap (A 200, C 250); each trigger waits for the corresponding published agency round.
Ttang's duplicate-slot guard and source circuits remain active; consecutive successful slots have no five-hour minimum interval.
The 20:30 PC round has its own source-scoped slot and waits for the 19:31 general result; it is not a GitHub fallback or a rerun of 19:31.
No extra collection is requested solely to validate a schedule change. The regular watchdog
may recover a newly due slot after deployment. Old cron events are rejected by preflight.
