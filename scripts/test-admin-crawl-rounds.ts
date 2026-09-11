import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAdminCrawlRounds } from '../src/lib/admin-crawl-rounds';

type Stat = { total: number; skipped?: boolean; skipReason?: string; partial?: boolean;
    preserved?: boolean; manual?: boolean; scraped?: number; detail?: string; added?: number; removed?: number };
type Entry = { timestamp: string; sites: Record<string, Stat>; alerts: string[] };
const sources = ['ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang'];
const entry = (time: string, sites: Record<string, Stat>, alerts: string[] = []): Entry =>
    ({ timestamp: `2026-09-11T${time}+09:00`, sites, alerts });
const skip: Stat = { total: 66, skipped: true, skipReason: 'schedule' };
const mode: Stat = { total: 92, scraped: 865, partial: true, detail: 'TPE HTTP 500 — 기존 4건 유지', added: 27, removed: 1 };
const logs = [
    entry('13:41:12', { ybtour: { total: 80 }, hanatour: { total: 45 }, modetour: skip, ttang: skip }),
    entry('13:48:10', { modetour: mode, ttang: skip }),
    entry('13:52:41', { ttang: { total: 126, scraped: 1497, added: 6, removed: 2 } }),
];
const original = JSON.stringify(logs);
const [round] = buildAdminCrawlRounds(logs, sources);
assert.equal(round.slotAt, '2026-09-11T04:23:00.000Z');
assert.deepEqual(round.sites.modetour, mode);
assert.equal(round.sites.ttang.total, 126);
assert.equal(round.sites.ybtour.total, 80);
assert.equal(round.sourceEntries.modetour.timestamp, logs[1].timestamp);
assert.equal(Object.values(round.sites).reduce((sum, stat) => sum + (stat.added || 0), 0), 33);
assert.equal(Object.values(round.sites).reduce((sum, stat) => sum + (stat.removed || 0), 0), 3);
assert.equal(JSON.stringify(logs), original, 'raw sessions must remain unchanged');
assert.deepEqual(buildAdminCrawlRounds([...logs].reverse(), sources), [round], 'sort incoming sessions');

const skippedLater = buildAdminCrawlRounds([...logs,
    entry('14:00:00', { modetour: skip, ttang: { total: 0, skipped: true, skipReason: 'not-requested' } }),
], sources)[0];
assert.deepEqual(skippedLater.sites.modetour, mode, 'later placeholder cannot erase partial success');
assert.equal(skippedLater.sites.ttang.total, 126);

const failure = entry('14:05:00', { modetour: { total: 92, preserved: true } }, ['모두투어 요청 실패']);
const recovered = entry('14:10:00', { modetour: { total: 93, manual: true } });
assert.equal(buildAdminCrawlRounds([...logs, failure], sources)[0].sites.modetour.preserved, true);
const recoveryRound = buildAdminCrawlRounds([...logs, failure, recovered], sources)[0];
assert.equal(recoveryRound.sites.modetour.manual, true, 'manual recovery supersedes failure');
assert.deepEqual(recoveryRound.sourceEntries.modetour.alerts, [], 'old errors are not final source errors');
assert.match(recoveryRound.alerts[0], /^14:05 기록/);

const next = buildAdminCrawlRounds([...logs, entry('16:31:00', { ttang: skip })], sources);
assert.equal(next.length, 2);
assert.equal(next[1].sites.modetour, undefined, 'do not carry an earlier round success forward');
assert.equal(next[1].sites.ttang.skipped, true);
assert.equal(buildAdminCrawlRounds([
    entry('15:03:00', { myrealtrip: { total: 100 } }),
    entry('16:32:00', { modetour: { total: 92, skipReason: 'not-requested' } }),
    { ...logs[0], timestamp: 'invalid' },
], sources).length, 0, 'exclude unrelated, unrequested and invalid sessions');
assert.equal(buildAdminCrawlRounds([], sources).length, 0);
const overnight = buildAdminCrawlRounds([
    { ...logs[0], timestamp: '2026-09-11T00:10:00+09:00' },
    entry('06:17:00', { modetour: skip }),
], sources);
assert.equal(overnight[0].slotAt, '2026-09-10T07:31:00.000Z');
assert.equal(overnight[1].slotAt, '2026-09-10T21:17:00.000Z');

// Replay stored operating logs without making any requests or altering data.
if (process.argv.includes('--replay-20260911')) {
    const stored = JSON.parse(readFileSync('data/crawl-log.json', 'utf8')).entries as Entry[];
    const actual = buildAdminCrawlRounds(stored, sources).find(item => item.slotAt === '2026-09-11T04:23:00.000Z');
    assert.ok(actual, 'reported production round must be present in replay');
    assert.equal(actual.sites.modetour.partial, true);
    assert.equal(actual.sites.modetour.total, 92);
    assert.equal(actual.sites.modetour.scraped, 865);
    assert.equal(actual.sites.ttang.total, 126);
    console.log('PASS: September 11 production replay');
}
console.log('PASS: per-source scheduled rounds, placeholder protection, latest failure/recovery, turnover, isolation, immutable logs');
