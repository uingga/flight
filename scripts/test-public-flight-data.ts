import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    compactPublicPriceHistory,
    publicFlightRouteKey,
} from '../src/lib/public-flight-data';

const fixedNow = new Date('2026-08-26T00:00:00+09:00');
const fixture = {
    '서울-타이페이': [
        { date: '2026-06-27', minPrice: 80000, avgPrice: 100000, count: 9 },
        { date: '2026-06-28', minPrice: 120000, avgPrice: 150000, count: 2 },
        { date: '2026-08-25', minPrice: 110000, avgPrice: 140000, count: 3 },
    ],
    '인천-타이베이': [
        { date: '2026-08-25', minPrice: 99000, avgPrice: 130000, count: 4 },
        { date: '2026-08-27', minPrice: 50000, avgPrice: 60000, count: 1 },
    ],
    '부산-세부': [
        { date: '2026-08-25', minPrice: 150000, avgPrice: 180000, count: 5 },
    ],
    invalid: [{ date: '2026-08-25', minPrice: 1 }],
};

const compact = compactPublicPriceHistory(fixture, {
    now: fixedNow,
    allowedRoutes: new Set([publicFlightRouteKey('인천', '대만')]),
});

assert.deepEqual(compact, {
    '인천-타이베이': [
        { date: '2026-06-28', minPrice: 120000, count: 2 },
        { date: '2026-08-25', minPrice: 99000, count: 7 },
    ],
});
assert.equal(JSON.stringify(compact).includes('avgPrice'), false);

const dataDir = path.join(process.cwd(), 'data');
const rawHistory = JSON.parse(fs.readFileSync(path.join(dataDir, 'price-history.json'), 'utf8')) as unknown;
const cache = JSON.parse(fs.readFileSync(path.join(dataDir, 'all-flights-cache.json'), 'utf8')) as {
    flights?: Array<{ departure?: { city?: string }; arrival?: { city?: string } }>;
};
const visibleRoutes = new Set((cache.flights || []).map(flight => (
    publicFlightRouteKey(flight.departure?.city || '', flight.arrival?.city || '')
)).filter(Boolean));
const publicHistory = compactPublicPriceHistory(rawHistory, { allowedRoutes: visibleRoutes });
const beforeBytes = Buffer.byteLength(JSON.stringify(rawHistory));
const afterBytes = Buffer.byteLength(JSON.stringify(publicHistory));

assert(afterBytes < beforeBytes);
assert.equal(JSON.stringify(publicHistory).includes('avgPrice'), false);
assert(Object.values(publicHistory).every(entries => entries.length <= 60));

console.log(JSON.stringify({
    rawBytes: beforeBytes,
    publicBytes: afterBytes,
    savedBytes: beforeBytes - afterBytes,
    reductionPercent: Number(((1 - afterBytes / beforeBytes) * 100).toFixed(1)),
    rawRoutes: Object.keys(rawHistory as Record<string, unknown>).length,
    publicRoutes: Object.keys(publicHistory).length,
}, null, 2));
