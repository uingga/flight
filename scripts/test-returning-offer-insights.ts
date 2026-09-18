import assert from 'node:assert/strict';
import test from 'node:test';
import type { Flight } from '../src/types/flight';
import { OFFER_HISTORY_SOURCES, rememberFlightOffers, recordFlightOfferNews, restoreFlightOffers,
    mergeFlightOfferHistory } from '../src/lib/flight-offer-history.mjs';
import { matchRecordedPriceDrop, resolvePriceDrop, groupPriceDropFlights, priceDropLabel,
    type HistoricalFlightPrice } from '../src/lib/price-drop-insight';
import { isFirstDiscoveredOn } from '../src/lib/fresh-flight-insight';
import { recommendationNewsTimestamp } from '../src/lib/recommendation-news';
import { mergeCacheSource } from '../src/lib/merge-cache-source.mjs';

const before = '2026-09-10T03:00:00Z';
const returnedAt = '2026-09-18T03:00:00Z';
const now = Date.parse(returnedAt) + 1000;
const sample = (source: Flight['source'] = 'ybtour', price = 300000): Flight => ({
    source, id: source + '-original', price, airline: 'Jin Air', flightNumber: 'LJ1/LJ2',
    currency: 'KRW', link: 'https://example.invalid', firstSeen: '2026-09-10', priceCheckedAt: before,
    departure: { airport: 'PUS', city: '부산', date: '2026-11-01', time: '10:00' },
    arrival: { airport: 'CTS', city: '삿포로', date: '2026-11-05', time: '12:00' },
});
function reappear(source: Flight['source'], price: number) {
    const original = sample(source);
    const history = rememberFlightOffers({}, [original], before);
    const incoming = { ...original, price, firstSeen: '2026-09-18', priceCheckedAt: returnedAt };
    if (['ybtour', 'hanatour', 'myrealtrip'].includes(source)) incoming.id += '-changed';
    const [returned] = recordFlightOfferNews([], [incoming], returnedAt, history);
    const saved = rememberFlightOffers(history, [returned], returnedAt);
    return restoreFlightOffers([returned], saved)[0] as Flight;
}

for (const source of OFFER_HISTORY_SOURCES as Flight['source'][]) {
    test(`${source}: eight-day absence and 10,000 KRW decline reaches insight, never discovery`, () => {
        const flight = reappear(source, 290000);
        const record = resolvePriceDrop(flight, '', [], now)!;
        assert.ok(record);
        assert.equal(record.amount, 10000);
        assert.equal(record.currentPrice, flight.price);
        assert.equal(record.previousPrice, 300000, 'Card price excludes the fixed fee on both sides');
        assert.equal(record.previousDate, '2026-09-10');
        assert.equal(priceDropLabel(record), '이전 확인가보다');
        assert.equal(isFirstDiscoveredOn(flight, '2026-09-18'), false);
        assert.equal(flight.firstSeen, '2026-09-10');
        assert.equal(flight.recommendationNews?.drop, undefined, 'Under 5% must not change ranking');
        assert.equal(groupPriceDropFlights([flight], { [record.key]: record }, () => 'PUS-CTS', f => f.price).length, 1);
    });
    test(`${source}: same price return, rise, and declines under 10,000 do not become news`, () => {
        for (const price of [300000, 310000, 299500, 290001]) {
            const flight = reappear(source, price);
            assert.equal(resolvePriceDrop(flight, '', [], now), null);
            assert.equal(isFirstDiscoveredOn(flight, '2026-09-18'), false);
        }
    });
}

test('a recheck preserves the drop time; event expires after 72 hours even if cheaper than DB', () => {
    const f = reappear('ybtour', 270000);
    const [refreshed] = recordFlightOfferNews([f], [f], '2026-09-21T03:00:00Z');
    assert.equal(refreshed.recommendationNews.priceDrop.at, returnedAt);
    assert.ok(matchRecordedPriceDrop(refreshed, Date.parse('2026-09-21T03:00:00Z') - 1) === null,
        'Future observedAt is not valid evidence');
    assert.equal(resolvePriceDrop(refreshed, 'key', [dailyRow(300000)], Date.parse('2026-09-21T03:00:00Z')), null);
    assert.ok(matchRecordedPriceDrop(f, Date.parse(returnedAt) + 3 * 86400000 - 1));
    assert.equal(matchRecordedPriceDrop(f, Date.parse(returnedAt) + 3 * 86400000), null);
});

test('rise followed by return to an old low cannot regain either insight or ranking event', () => {
    const low = reappear('ybtour', 270000);
    let history = rememberFlightOffers({}, [low], returnedAt);
    const [up] = recordFlightOfferNews([], [{ ...low, price: 300000 }], '2026-09-18T04:00:00Z', history);
    history = rememberFlightOffers(history, [up], '2026-09-18T04:00:00Z');
    const [back] = recordFlightOfferNews([], [{ ...low, price: 270000 }], '2026-09-18T05:00:00Z', history);
    assert.equal(back.recommendationNews.priceDrop, null);
    assert.equal(back.recommendationNews.drop, undefined);
    assert.equal(resolvePriceDrop(back, 'key', [dailyRow(300000)], Date.parse('2026-09-18T05:00:01Z')), null);
});

test('conflicting older retained low prevents a false new insight during partial merges', () => {
    const oldLow = sample('ybtour', 260000);
    const oldHistory = rememberFlightOffers({}, [oldLow], before);
    const falseDrop = reappear('ybtour', 270000);
    const newerHistory = rememberFlightOffers({}, [falseDrop], returnedAt);
    for (const merged of [mergeFlightOfferHistory(oldHistory, newerHistory), mergeFlightOfferHistory(newerHistory, oldHistory)]) {
        const actual = restoreFlightOffers([falseDrop], merged)[0];
        assert.equal(actual.recommendationNews.priceDrop, null);
        assert.equal(resolvePriceDrop(actual, 'key', [dailyRow(300000)], now), null);
    }
});

test('old events with unknown comparison dates use honest labels without fabricating a date', () => {
    const flight = reappear('ybtour', 270000);
    delete flight.recommendationNews!.priceDrop;
    const result = matchRecordedPriceDrop(flight, now)!;
    assert.ok(result);
    assert.equal(result.previousDate, '');
    assert.equal(priceDropLabel(result), '이전 확인가보다');
});

test('different itineraries and missing historical identity never infer a returning-offer decline', () => {
    const original = sample();
    const history = rememberFlightOffers({}, [original], before);
    const changed = { ...original, price: 270000, departure: { ...original.departure, date: '2026-11-02' }, firstSeen: '2026-09-18' };
    const [flight] = recordFlightOfferNews([], [changed], returnedAt, history);
    assert.equal(resolvePriceDrop(flight, '', [], now), null);
    assert.equal(isFirstDiscoveredOn(flight, '2026-09-18'), true);
});

test('actual source-result merge restores discovery and carries the insight to the web reader', () => {
    const original = sample('myrealtrip');
    const target = { flights: [] as Flight[], timestamp: before,
        flightOfferHistory: rememberFlightOffers({}, [original], before) };
    const incoming = { ...original, id: 'myrealtrip-price-changed', price: 290000,
        firstSeen: '2026-09-18', priceCheckedAt: returnedAt };
    mergeCacheSource(target, { flights: [incoming], timestamp: returnedAt,
        sourceUpdatedAt: { myrealtrip: returnedAt } }, 'myrealtrip');
    const flight = restoreFlightOffers(target.flights, target.flightOfferHistory)[0];
    assert.equal(isFirstDiscoveredOn(flight, '2026-09-18'), false);
    assert.equal(resolvePriceDrop(flight, '', [], now)?.amount, 10000);
});

test('new discovery uses earliest known KST date; no dates and historical fallback are not today', () => {
    const f = sample();
    assert.equal(isFirstDiscoveredOn(f, '2026-09-18'), false);
    assert.equal(isFirstDiscoveredOn({ ...f, firstSeen: undefined }, '2026-09-18'), false);
    assert.equal(isFirstDiscoveredOn({ ...f, firstSeen: '2026-09-18' }, '2026-09-18'), true);
    const returned = reappear('ybtour', 300000);
    assert.equal(isFirstDiscoveredOn({ ...returned, firstSeen: '2026-09-18' }, '2026-09-18'), false);
    assert.equal(isFirstDiscoveredOn({ ...f, firstSeen: '2026-09-17T15:00:00Z' }, '2026-09-18'), true);
    assert.equal(isFirstDiscoveredOn({ ...f, firstSeen: '2026-09-17T14:59:59Z' }, '2026-09-18'), false);
});

function dailyRow(price: number, day = '2026-09-17'): HistoricalFlightPrice {
    const f = sample();
    return { flight_key: 'key', snapshot_date: day, price_checked_at: day + 'T03:00:00Z',
        source: f.source, departure_airport: 'PUS', arrival_airport: 'CTS', departure_date: f.departure.date,
        return_date: f.arrival.date, outbound_time: f.departure.time, return_time: f.arrival.time,
        airline: f.airline, listed_price: price };
}
test('legacy daily comparison selects the nearest quote BEFORE testing decline, not an older high', () => {
    const f = sample('ybtour', 270000);
    for (const price of [270000, 260000, 270500]) {
        assert.equal(resolvePriceDrop(f, 'key', [dailyRow(price), dailyRow(310000, '2026-09-16')], now), null);
    }
    assert.equal(resolvePriceDrop(f, 'key', [dailyRow(280000)], now)?.amount, 10000);
});

test('invalid evidence, mismatched price, future and expired trips are excluded', () => {
    const f = reappear('ybtour', 270000);
    assert.equal(matchRecordedPriceDrop({ ...f, price: 280000 }, now), null);
    assert.equal(matchRecordedPriceDrop(f, Date.parse(returnedAt) - 1), null);
    assert.equal(matchRecordedPriceDrop({ ...f, departure: { ...f.departure, date: '2026-09-17' } }, now), null);
    assert.equal(matchRecordedPriceDrop({ ...f, recommendationNews: { ...f.recommendationNews!, lowestPrice: 260000 } }, now), null);
    assert.equal(recommendationNewsTimestamp(f), Date.parse(returnedAt), 'Existing >=5% ranking bonus remains');
});
