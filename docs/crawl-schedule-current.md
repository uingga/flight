# Current collection schedule

Updated 2026-09-25. All times below are KST scheduled starts, not completion deadlines.

| Work | Scheduled starts |
| --- | --- |
| General GitHub round; ModeTour, OnlineTour and Ttang PC primary after its completion | 06:17, 10:12, 13:23, 16:31, 19:31 |
| Ttang GitHub collection | 06:17, 13:23 |
| Ttang PC primary | 06:17, 10:12, 13:23, 16:31, 19:31 |
| Coordinated PC agency regular round (B: YB/Hana; C: Mode/Ttang) | 20:30 |
| MyRealTrip | 05:00, 08:55, 12:05, 15:15, 19:15 |
| Naver PC collection (after each published general round) | 06:17, 10:12, 13:23, 16:31, 19:31 |

## Pending synchronized schedule change

The following starts are prepared in code but are **not operational** until the GitHub workflow,
A coordinator, B/C worker releases and Windows task triggers have all been installed and checked.
Times are KST; the MyRealTrip finish times are estimates, not deadlines.

| Work | Planned starts / owner |
| --- | --- |
| General agency rounds | 06:17, 10:12, 13:23, 16:31, 19:31 (GitHub plus existing PC primary) |
| Evening regular agency round | 20:30 (B: YB, Hana, Online; C: Mode, Ttang, Lotte) |
| MyRealTrip, six rounds | 06:25 GitHub, 09:35 C, 12:40 GitHub, 15:55 C, 18:55 B, 21:00 GitHub |
| Naver | 06:17, 10:12, 13:23, 16:31, 19:31, 20:30 A/C coordination; the last round uses only the remaining shared 450-navigation daily budget after agency and MRT publication |
| Trip.com | 06:17, 08:14, 10:12, 11:48, 13:23, 14:57, 16:31, 18:01, 19:31, 20:30; B/C each attempt 10 cities per round. Adjacent rounds cover 40 cities only if both complete. |

The 20:30 Naver round is separate from the 19:31 GitHub round. It waits for the
published 20:30 PC agency result and the exact sixth MyRealTrip completion. It does not
reserve or reset any Naver budget. The morning and afternoon MyRealTrip starts are shifted
using recent 61–66 minute run durations to finish near the other agencies; actual completion
depends on live site and publication delays.

The independent five-minute watchdog uses the same general slot definitions.
Ttang's PC primary now follows all five general slots. Its GitHub backup remains on two slots.
PC completion is awaited before freezing Naver recovery sources. A and C share a 450-navigation
daily cap (A 200, C 250); each trigger waits for the corresponding published agency round.
Ttang's duplicate-slot guard and source circuits remain active; consecutive successful slots have no five-hour minimum interval.
The 20:30 PC round has its own source-scoped slot and waits for the 19:31 general result; it is not a GitHub fallback or a rerun of 19:31.
No extra collection is requested solely to validate a schedule change. The regular watchdog
may recover a newly due slot after deployment. Old cron events are rejected by preflight.
