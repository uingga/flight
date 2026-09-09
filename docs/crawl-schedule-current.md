# Current collection schedule

Updated 2026-09-09. All times below are KST scheduled starts, not completion deadlines.

| Work | Scheduled starts |
| --- | --- |
| General GitHub round; ModeTour and OnlineTour PC primary after its completion | 06:17, 10:12, 13:23, 16:31 |
| Ttang PC primary | 06:17, 13:23 |
| MyRealTrip | 06:05, 15:03 |
| Naver initial / PC recovery / startup safety net | 10:12, 13:23, 16:31 |

The independent five-minute watchdog uses the same general and MyRealTrip slot definitions.
PC completion is awaited before freezing Naver recovery sources. All Naver phases share 200
navigations per KST day; the final trigger is not an unconditional third comparison run.
Ttang's five-hour minimum success interval and all source circuits remain unchanged.
No extra collection is requested solely to validate a schedule change. The regular watchdog
may recover a newly due slot after deployment. Old cron events are rejected by preflight.
