import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CRAWL_SLOT_MINUTES_KST, ONLINE_SLOT_MINUTES_KST, recentSlotTimes, isSourceScheduledAt } from '../src/lib/admin-source-slots';
import { DAILY_CRAWL_CRONS, ONLINE_CRAWL_CRONS, TTANG_CRAWL_CRONS } from '../src/lib/crawl-schedule-health.mjs';
import { MRT_CRONS } from '../src/lib/myrealtrip-schedule.mjs';
assert.deepEqual([...CRAWL_SLOT_MINUTES_KST], [377,612,803,991,1171]);
assert.deepEqual([...ONLINE_SLOT_MINUTES_KST], [377,612,803,991,1171]);
const times = recentSlotTimes(Date.parse('2026-09-10T23:59:00+09:00'), 5);
assert.deepEqual(times.map(t => new Date(t+9*3600000).toISOString().slice(11,16)), ['06:17','10:12','13:23','16:31','19:31']);
assert.deepEqual(times.map(t => isSourceScheduledAt('ttang',t)), [true,true,true,true,false]);
assert.equal(isSourceScheduledAt('ttang',Date.parse('2026-09-24T19:31:00+09:00')),true);
assert.deepEqual(DAILY_CRAWL_CRONS, ['17 21 * * *','12 1 * * *','23 4 * * *','31 7 * * *','31 10 * * *']);
assert.deepEqual(ONLINE_CRAWL_CRONS, DAILY_CRAWL_CRONS);
assert.equal(isSourceScheduledAt('onlinetour',Date.parse('2026-09-10T19:31:00+09:00')),true);
assert.equal(isSourceScheduledAt('hanatour',Date.parse('2026-09-10T19:31:00+09:00')),true);
assert.deepEqual(TTANG_CRAWL_CRONS, ['17 21 * * *','23 4 * * *']);
assert.deepEqual(MRT_CRONS, ['25 21 * * *','40 3 * * *','0 12 * * *']);
for(const [file, expected] of [['scripts/install-source-fallback-task.ps1',['06:17','10:12','13:23','16:31','19:31']],['scripts/install-naver-crawl-task.ps1',['06:17','10:12','13:23','16:31','19:31','20:30']]] as const) {
 const text=fs.readFileSync(file,'utf8');
 assert.deepEqual([...text.matchAll(/New-ScheduledTaskTrigger -Daily -At '([^']+)'/g)].map(m=>m[1]),expected);
}
console.log('PASS: admin, GitHub, MyRealTrip and PC schedule alignment');
