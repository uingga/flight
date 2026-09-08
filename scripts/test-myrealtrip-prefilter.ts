import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { myrealtripSkipReason, myrealtripCalendarOnce } from '../src/lib/myrealtrip-prefilter';

const eligibility = { nowMs: Date.parse('2026-09-08T00:00:00Z'), maxDays: 60, gidMap: { NRT: 123 } };
test('keeps existing inclusive 60-day boundaries and excludes past/invalid dates', () => {
    for (const date of ['2026-09-08', '2026-11-07']) assert.equal(myrealtripSkipReason(date, 'NRT', eligibility), null);
    for (const date of ['2026-09-07', '2026-11-08', '', 'invalid']) assert.equal(myrealtripSkipReason(date, 'NRT', eligibility), 'date');
    assert.equal(myrealtripSkipReason('2026-09-08', 'NRT', { ...eligibility, nowMs: eligibility.nowMs + 1 }), 'date');
});
test('unmapped links are rejected without a price-based exclusion', () => {
    assert.equal(myrealtripSkipReason('2026-09-09', 'XXX', eligibility), 'link');
    assert.equal(myrealtripSkipReason('2026-09-09', 'NRT', eligibility), null);
});
test('duplicate route calendars are reused only within this run, origins stay separate', async () => {
    const cache = new Map<string, number[]>();
    let calls = 0;
    const read = async () => { calls++; return [100, 200]; };
    await myrealtripCalendarOnce(cache, 'SEL|NRT|2026-09-08', read);
    await myrealtripCalendarOnce(cache, 'SEL|NRT|2026-09-08', read);
    await myrealtripCalendarOnce(cache, 'PUS|NRT|2026-09-08', read);
    assert.equal(calls, 2);
    await myrealtripCalendarOnce(new Map(), 'SEL|NRT|2026-09-08', read);
    assert.equal(calls, 3);
});
test('errors propagate and cannot populate the calendar cache', async () => {
    const cache = new Map();
    await assert.rejects(myrealtripCalendarOnce(cache, 'route', async () => { throw new Error('blocked'); }), /blocked/);
    assert.equal(cache.size, 0);
});
test('prefilter saves calls while retaining eligible candidates and their calendar prices', async () => {
    const candidates = [['2026-09-07', 'NRT'], ['2026-11-08', 'NRT'], ['2026-09-09', 'XXX'], ['2026-09-09', 'NRT'], ['2026-09-10', 'NRT']];
    let calls = 0;
    const cache = new Map();
    const kept = [];
    for (const [date, city] of candidates) {
        if (myrealtripSkipReason(date, city, eligibility)) continue;
        kept.push(await myrealtripCalendarOnce(cache, city, async () => { calls++; return [90000]; }));
    }
    assert.equal(calls, 1);
    assert.deepEqual(kept, [[90000], [90000]]);
});
test('production wiring gates before fetch and keeps price filtering and safe duplicate acceptance', () => {
    const scraper = fs.readFileSync('src/lib/scrapers/myrealtrip.ts', 'utf8');
    const main = scraper.slice(scraper.indexOf('export async function scrapeMyrealtripWithDiagnostics'));
    assert.ok(main.indexOf('myrealtripSkipReason(') < main.indexOf('myrealtripCalendarOnce('));
    assert.ok(main.indexOf('processedKeys.has(key)') < main.indexOf('myrealtripCalendarOnce('));
    assert.ok(main.indexOf('price > MAX_PRICE') < main.indexOf('processedKeys.add(key)'));
    const runner = fs.readFileSync('scripts/scrape-myrealtrip-prices.ts', 'utf8');
    assert.match(runner, /dateCandidates: quickDepartureCandidates,\s+eligibility,/);
    assert.match(runner, /const nowDate = new Date\(eligibility.nowMs\)/);
});
