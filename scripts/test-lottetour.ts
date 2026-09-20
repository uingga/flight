import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixture from './fixtures/lottetour/public-snapshot.json';
import { lotteRows, parseLotteEnvelope, parseLotteFlight, scrapeLottetour } from '../src/lib/scrapers/lottetour';
import { classifySourceAccessRestriction, classifySourceResponseDrop } from '../src/lib/source-circuit';
import { getFlightBookingUrl } from '../src/lib/utils/booking-url';
import { filterStaleSourceFlights } from '../src/lib/source-freshness';
import { flightOfferKey, recordFlightOfferNews, rememberFlightOffers } from '../src/lib/flight-offer-history.mjs';

const checkedAt = '2026-09-21T02:00:00.000Z';
const group = lotteRows(fixture.list, 'disPriceList')[0];
const line = lotteRows(fixture.line, 'disPriceLine')[0];
const parse = (detail: Record<string, unknown> = fixture.detail) => parseLotteFlight(group, line, detail, checkedAt)!;
const low = (patch: object) => ({ ...fixture.detail, disPriceLow: JSON.stringify({ ...JSON.parse(fixture.detail.disPriceLow), ...patch }) });
const schedule = (patch: object, index = 0) => {
    const rows = JSON.parse(fixture.detail.disSchedule); rows[index] = { ...rows[index], ...patch };
    return { ...fixture.detail, disSchedule: JSON.stringify(rows) };
};
function replay(responses: Array<object | Response>, now = checkedAt) {
    const urls: URL[] = [], waits: number[] = [];
    const promise = scrapeLottetour({ now: () => new Date(now), sleep: async ms => { waits.push(ms); },
        fetcher: (async (input, init) => {
            const url = new URL(String(input)); urls.push(url);
            assert.equal(url.origin, 'https://m.lottetour.com');
            assert.equal(init?.method, 'POST');
            assert.equal(init?.redirect, 'error');
            assert.ok(['/discountAir/disPriceList', '/discountAir/disPriceLine', '/discountAir/disPriceLow'].includes(url.pathname));
            const response = responses.shift(); assert.ok(response, 'Unexpected request');
            return response instanceof Response ? response : Response.json(response);
        }) as typeof fetch });
    return { promise, urls, waits };
}

test('public snapshot: return-first schedule, adult total, airports, dates and minimum adults', () => {
    const flight = parse();
    assert.equal(flight.source, 'lottetour');
    assert.equal(flight.id, 'lottetour-D02J260923ZE005');
    assert.equal(flight.price, 380000);
    assert.equal(flight.availableSeats, 10);
    assert.equal(flight.minPax, 2);
    assert.equal(flight.region, '일본');
    assert.deepEqual(flight.departure, { city: '부산', airport: 'PUS', date: '2026-09-23', time: '08:55', arrivalTime: '09:55' });
    assert.deepEqual(flight.arrival, { city: '후쿠오카', airport: 'FUK', date: '2026-09-25', time: '16:55', arrivalTime: '18:05' });
    assert.equal(flight.flightNumber, 'ZE941/ZE944');
});
test('booking uses public listing on desktop/mobile, never the stateful checkout POST', () => {
    for (const mobile of [false, true]) assert.equal(getFlightBookingUrl(parse(), undefined, mobile), 'https://m.lottetour.com/discountAir#tr__3469');
});
test('detail total supersedes list minimum and includes fees exactly once', () => {
    const flight = parse(low({ priceAdt: 390000, pricChargeAdt: 10000 }));
    assert.equal(flight.price, 390000);
    assert.equal(flight.id, parse().id);
});
test('reject mismatched products, components, missing return, invalid dates and invalid times', () => {
    for (const data of [low({ evtCd: 'other' }), low({ blockId: 999 }), low({ priceAdt: 170000 }), low({ pricFueAdt: '' }),
        low({ priceAdt: 0 }), { ...fixture.detail, disSchedule: '[]' }, schedule({ dcDep: '2026-02-30' }), schedule({ depTm: '2560' }),
        schedule({ arrApoNm: '인천' }), schedule({ carrerNm: '' })]) {
        assert.throws(() => parse(data), /롯데관광/);
    }
});
test('minimum two adults: insufficient seats are not offered', () => {
    for (const seats of [0, 1]) assert.equal(parse(low({ avlbSeatCnt: seats })), null);
});
test('full snapshot replay is three sequential read calls with delays', async () => {
    const run = replay([fixture.list, fixture.line, fixture.detail]);
    const flights = await run.promise;
    assert.equal(flights.length, 1);
    assert.equal(run.urls.length, 3);
    assert.equal(run.urls[2].searchParams.get('evtCd'), 'D02J260923ZE005');
    assert.equal(run.urls[2].searchParams.get('blockId'), '3469');
    assert.equal(run.urls[2].searchParams.get('blockDetlId'), '12977');
    assert.equal(run.waits.length, 2);
    assert.ok(run.waits.every(ms => ms >= 1500 && ms < 2500));
});
test('expired and sold-out dates are skipped before requesting detail', async () => {
    const expired = replay([fixture.list, fixture.line], '2026-09-24T00:00:00Z');
    assert.deepEqual(await expired.promise, []); assert.equal(expired.urls.length, 2);
    const sold = replay([fixture.list, { result: true, disPriceLine: JSON.stringify([{ ...line, avlbSeatCnt: 0 }]) }]);
    assert.deepEqual(await sold.promise, []); assert.equal(sold.urls.length, 2);
});
for (const status of [401, 403, 429, 500]) test(`HTTP ${status} stops immediately, never retries`, async () => {
    const run = replay([fixture.list, new Response('error', { status })]);
    await assert.rejects(run.promise, error => {
        if (status !== 500) assert.ok(classifySourceAccessRestriction(error));
        return true;
    });
    assert.equal(run.urls.length, 2);
});
test('CAPTCHA in HTTP 200 is a source restriction', () => {
    assert.throws(() => parseLotteEnvelope('<html>CAPTCHA</html>'), error => !!classifySourceAccessRestriction(error));
});
test('empty response remains subject to common old-cache preservation', async () => {
    const run = replay([{ result: true, disPriceList: '[]' }]);
    assert.deepEqual(await run.promise, []);
    assert.ok(classifySourceResponseDrop(0, 1));
});
test('partial detail failure rejects the entire snapshot, no partial return', async () => {
    const two = { result: true, disPriceLine: JSON.stringify([line, { ...line, evtCd: 'SECOND', blockDetlId: 2 }]) };
    const run = replay([fixture.list, two, fixture.detail, { result: false }]);
    await assert.rejects(run.promise, /조회 실패/); assert.equal(run.urls.length, 4);
});
test('duplicate groups and malformed nested JSON fail closed', async () => {
    const dup = replay([{ result: true, disPriceList: JSON.stringify([group, group]) }, fixture.line, fixture.detail]);
    await assert.rejects(dup.promise, /중복 노선/);
    assert.throws(() => lotteRows({ disPriceList: '{' }, 'disPriceList'), /형식 변경/);
});
test('request cap aborts before call 81 without returning partial inventory', async () => {
    const groups = Array.from({ length: 80 }, (_, i) => ({ ...group, blockId: i + 1 }));
    const responses = [ { result: true, disPriceList: JSON.stringify(groups) },
        ...groups.map(g => ({ result: true, disPriceLine: JSON.stringify([{ ...line, blockId: g.blockId, evtCd: `ID${g.blockId}`, avlbSeatCnt: 0 }]) })) ];
    const run = replay(responses);
    await assert.rejects(run.promise, /상한/); assert.equal(run.urls.length, 80);
});
test('same-price reappearance keeps first discovery; lower reappearance gains price-drop history', () => {
    const first = recordFlightOfferNews([], [parse()], checkedAt);
    const history = rememberFlightOffers({}, first, checkedAt);
    assert.ok(flightOfferKey(first[0]));
    const nextAt = '2026-09-22T02:00:00Z';
    const same = recordFlightOfferNews([], [parse()], nextAt, history)[0];
    assert.equal(same.recommendationNews.firstSeenAt, checkedAt);
    assert.equal(same.recommendationNews.priceDrop, null);
    const lower = recordFlightOfferNews([], [{ ...parse(), price: 360000 }], nextAt, history)[0];
    assert.equal(lower.recommendationNews.priceDrop.from, 380000);
    assert.equal(lower.recommendationNews.priceDrop.to, 360000);
    assert.equal(lower.recommendationNews.firstSeenAt, checkedAt);
});
test('Lotte uses the same source freshness gate as other regular agencies', () => {
    assert.equal(filterStaleSourceFlights([parse()], { lottetour: checkedAt }, Date.parse(checkedAt)).length, 1);
    assert.equal(filterStaleSourceFlights([parse()], {}, Date.parse(checkedAt)).length, 0);
});
