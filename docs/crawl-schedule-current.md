# Current collection schedule

Updated 2026-09-24. All times below are KST scheduled starts, not completion deadlines.

| Work | Scheduled starts |
| --- | --- |
| General GitHub round; ModeTour, OnlineTour and Ttang PC primary after its completion | 06:17, 10:12, 13:23, 16:31, 19:31 |
| Ttang GitHub collection | 06:17, 13:23 |
| Ttang PC primary | 06:17, 10:12, 13:23, 16:31, 19:31 |
| MyRealTrip | 05:00, 12:05 |
| Naver initial / PC recovery / startup safety net | 10:12, 13:23, 16:31 |

The independent five-minute watchdog uses the same general and MyRealTrip slot definitions.
Ttang's PC primary now follows all five general slots. Its GitHub backup remains on two slots.
PC completion is awaited before freezing Naver recovery sources. A and C share a 450-navigation
daily cap (A 200, C 250); the final trigger is not an unconditional third comparison run.
Ttang's duplicate-slot guard and source circuits remain active; consecutive successful slots have no five-hour minimum interval.
No extra collection is requested solely to validate a schedule change. The regular watchdog
may recover a newly due slot after deployment. Old cron events are rejected by preflight.
