import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CRAWL_SLOT_MINUTES_KST, recentSlotTimes, isSourceScheduledAt } from '../src/lib/admin-source-slots';
import { DAILY_CRAWL_CRONS, TTANG_CRAWL_CRONS } from '../src/lib/crawl-schedule-health.mjs';
import { MRT_CRONS } from '../src/lib/myrealtrip-schedule.mjs';
assert.deepEqual([...CRAWL_SLOT_MINUTES_KST], [377,612,803,991]);
const times = recentSlotTimes(Date.parse('2026-09-10T23:59:00+09:00'), 4);
assert.deepEqual(times.map(t => new Date(t+9*3600000).toISOString().slice(11,16)), ['06:17','10:12','13:23','16:31']);
assert.deepEqual(times.map(t => isSourceScheduledAt('ttang',t)), [true,false,true,false]);
assert.deepEqual(DAILY_CRAWL_CRONS, ['17 21 * * *','12 1 * * *','23 4 * * *','31 7 * * *']);
assert.deepEqual(TTANG_CRAWL_CRONS, ['17 21 * * *','23 4 * * *']);
assert.deepEqual(MRT_CRONS, ['5 21 * * *','3 6 * * *']);
for(const [file, expected] of [['scripts/install-source-fallback-task.ps1',['06:17','10:12','13:23','16:31']],['scripts/install-naver-crawl-task.ps1',['10:12','13:23','16:31']]] as const) {
 const text=fs.readFileSync(file,'utf8');
 assert.deepEqual([...text.matchAll(/New-ScheduledTaskTrigger -Daily -At '([^']+)'/g)].map(m=>m[1]),expected);
}
console.log('PASS: admin, GitHub, MyRealTrip and PC schedule alignment');
