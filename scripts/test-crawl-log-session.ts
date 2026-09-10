import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildSourceSlotBars } from '../src/lib/admin-source-slots';
import { mergeCrawlLogHistories } from './merge-crawl-log.mjs';

async function main() {
    const mode = process.argv[2];
    if (mode) {
        let now = Date.parse(`2026-09-10T${mode === 'mrt' ? '07:27' : '07:52'}:00Z`);
        const RealDate = Date;
        globalThis.Date = new Proxy(RealDate, {
            construct(target, args) { return Reflect.construct(target, args.length ? args : [now]); },
            get(target, key) { return key === 'now' ? () => now : Reflect.get(target, key); },
        });
        const { logCrawlResults, recordCrawlAlerts } = await import('../src/lib/utils/crawl-logger');
        if (mode === 'mrt') logCrawlResults('myrealtrip', 151, undefined, undefined, { scraped: 188 });
        else if (mode === 'general') {
            recordCrawlAlerts(['🚨 isolated warning']);
            logCrawlResults('ybtour', 159, undefined, undefined, { scraped: 268 });
            now += 40 * 60_000;
            logCrawlResults('hanatour', 28, undefined, undefined, { scraped: 98 });
        } else {
            logCrawlResults('modetour', 111, undefined, undefined, { scraped: 872, separateSession: true, collectionMode: 'pc_primary' });
            recordCrawlAlerts(['🚨 pc warning']);
            logCrawlResults('ttang', 80, undefined, undefined, { scraped: 100, separateSession: true });
        }
        return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tikit-crawl-session-'));
    const file = path.join(dir, 'crawl-log.json');
    try {
        const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
        const run = (kind: string) => {
            const result = spawnSync(process.execPath, [...process.execArgv, process.argv[1], kind], {
                env: { ...process.env, TIKITIKIT_DATA_DIR: dir }, encoding: 'utf8',
            });
            assert.equal(result.status, 0, result.stderr);
        };
        run('mrt');
        const original = read().entries[0];
        run('general');
        const history = read();
        assert.equal(history.entries.length, 2, 'different processes within 30 minutes stay separate');
        assert.deepEqual(history.entries[0], original, 'prior MRT result stays untouched');
        const general = history.entries[1];
        assert.deepEqual(Object.keys(general.sites), ['ybtour', 'hanatour'], 'same execution stays grouped beyond 30 minutes');
        assert.deepEqual(general.alerts, ['🚨 isolated warning'], 'warnings belong to the same execution');
        for (const source of ['ybtour', 'hanatour']) {
            const bars = buildSourceSlotBars({ source, now: Date.parse('2026-09-10T09:00:00Z'),
                completedThrough: Date.parse('2026-09-10T08:32:00Z'), events: [{
                    timestamp: general.timestamp, value: general.sites[source].scraped,
                    preserved: false, skipped: false, manual: false, localFallback: false,
                }],
            });
            assert.equal(bars.at(-1)?.slotAt, '2026-09-10T07:31:00.000Z');
            assert.equal(bars.at(-1)?.status, 'auto', `${source}: latest slot must not be missing`);
        }
        run('pc');
        const pcHistory = read();
        assert.equal(pcHistory.entries.length, 4, 'explicit sessions remain separate');
        assert.equal(new Set(pcHistory.entries.map((e: any) => e.timestamp)).size, 4, 'same millisecond cannot collide');
        assert.deepEqual(pcHistory.entries[2].alerts, ['🚨 pc warning']);
        const merged = mergeCrawlLogHistories(history, pcHistory, ['modetour', 'ttang'], Date.parse('2026-09-10T09:00:00Z')).history;
        assert.equal(merged.entries.length, 4);
        assert.equal(merged.entries.find((e: any) => e.sites.modetour).sessionId, pcHistory.entries[2].sessionId);
        console.log('PASS: session isolation, prior history, long execution, alerts, both admin slots, explicit sessions, timestamp collisions, merge identity');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
