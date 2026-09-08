import assert from 'node:assert/strict';
import { parseFilterDemand } from '../src/lib/filter-demand';
import { loadFilterDemand } from '../src/lib/server/filter-demand-report';
import type { ReportRow, ReportRequest } from '../src/lib/ga4';
const row = (dimensions: string[], count = 30, users = 1): ReportRow => ({ dimensionValues: dimensions.map(value => ({ value })), metricValues: [count, users].map(value => ({ value: String(value) })) });
async function main() {
    const parsed = parseFilterDemand({ rows: [row(['departure', '인천']), row(['departure', 'all'], 90), row(['departure', '(not set)'], 9), row(['reset', 'all'], 3), row(['max_price', '200000']), row(['source', 'ybtour']), row(['date_period', '이번 주']), row(['unknown', 'ignore'])] }, { rows: [row(['도쿄']), row(['동경'], 2, 2)] });
    assert.deepEqual(parsed.groups.departure.items, [{ key: '인천', label: '인천', count: 30, users: 1 }]);
    assert.equal(parsed.groups.departure.cleared, 90);
    assert.equal(parsed.groups.departure.missing, 9);
    assert.equal(parsed.resetCount, 3);
    assert.equal(parsed.groups.max_price.items[0].label, '200,000원 이하');
    assert.equal(parsed.groups.source.items[0].label, '노랑풍선');
    assert.equal(parsed.cities.items.length, 2); // Aliases must not sum non-additive users.
    assert.equal(parseFilterDemand({ rows: [row(['departure', '인천']), row(['departure', '인천'])] }).groups.departure.available, false);
    for (const report of [undefined, { rows: [], rowCount: 1 }, { metadata: { subjectToThresholding: true } }, { metadata: { dataLossFromOtherRow: true } }]) assert.equal(parseFilterDemand(report).groups.departure.available, false);
    assert.equal(parseFilterDemand({}).groups.departure.available, true);
    assert.equal(parseFilterDemand({ rows: [row(['departure', '인천'], 1, 30)] }).groups.departure.items[0].users, null);
    const requests: ReportRequest[] = [];
    const config = { propertyId: 'test', clientEmail: 'test', privateKey: 'test' };
    const loaded = await loadFilterDemand(config, 30, async (_config, request) => {
        requests.push(request);
        if (request.dimensions?.length === 1) return { rows: [row(['도쿄'])], rowCount: 1 };
        return { rows: [row(['departure', request.offset ? '부산' : '인천'])], rowCount: 2 };
    });
    assert.equal(loaded.groups.departure.items.length, 2);
    assert.equal(requests.length, 3);
    for (const request of requests) {
        assert.deepEqual(request.dateRanges, [{ startDate: '30daysAgo', endDate: 'yesterday' }]);
        assert.deepEqual(request.metrics, [{ name: 'eventCount' }, { name: 'totalUsers' }]);
        assert.ok(!request.dimensions?.some(item => item.name === 'date')); // Deduplicate over the whole period.
    }
    const partial = await loadFilterDemand(config, 30, async (_config, request) => { if (request.dimensions?.length === 2) throw Error('Unregistered'); return { rows: [row(['도쿄'])] }; });
    assert.equal(partial.groups.departure.available, false);
    assert.equal(partial.cities.available, true);
    console.log('Filter demand parsing, unique users, pagination and independent failures passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
