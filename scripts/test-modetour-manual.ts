import assert from 'node:assert/strict';
import { importModetourManualCapture } from './import-modetour-manual';
import { validateModetourManualCard } from '../src/lib/scrapers/modetour-manual';
import { Flight } from '../src/types/flight';

const capturedAt = new Date('2026-08-31T01:00:00.000Z');
const kumamotoCard = {
    airline: '이스타항공',
    departureTime: '12:30',
    departureCity: '부산',
    departureMonthDay: '09/16',
    returnTime: '14:50',
    arrivalCity: '구마모토',
    returnMonthDay: '09/19',
    flyingTime: '01시간 20분',
    isDirect: true,
    seats: 10,
    price: 194_000,
    normalPrice: 861_000,
    sourceDiscountRate: 77,
};

const accepted = validateModetourManualCard(kumamotoCard, 'JPN', capturedAt);
assert.equal(accepted.status, 'accepted');
if (accepted.status === 'accepted') {
    assert.equal(accepted.flight.departure.airport, 'PUS');
    assert.equal(accepted.flight.arrival.airport, 'KMJ');
    assert.equal(accepted.flight.departure.date, '2026-09-16');
    assert.equal(accepted.flight.arrival.date, '2026-09-19');
    assert.match(accepted.flight.link, /modetour\.com\/flights\/discount-flight/);
}

const unknownCity = validateModetourManualCard({
    ...kumamotoCard,
    arrivalCity: '글자가 흐린 도시',
}, 'JPN', capturedAt);
assert.equal(unknownCity.status, 'review');

const inconsistentDiscount = validateModetourManualCard({
    ...kumamotoCard,
    sourceDiscountRate: 30,
}, 'JPN', capturedAt);
assert.equal(inconsistentDiscount.status, 'review');

const oldFlight: Flight = {
    id: 'modetour-api-existing',
    source: 'modetour',
    airline: '이스타항공',
    departure: { city: '부산', airport: 'PUS', date: '2026-09-16', time: '12:30' },
    arrival: { city: '구마모토', airport: 'KMJ', date: '2026-09-19', time: '14:50' },
    price: 210_000,
    currency: 'KRW',
    link: 'https://example.invalid/old',
    firstSeen: '2026-08-20',
    naverLowest: 200_000,
};
const otherFlight: Flight = {
    id: 'other-source',
    source: 'ybtour',
    airline: '테스트항공',
    departure: { city: '인천', airport: 'ICN', date: '2026-09-10', time: '10:00' },
    arrival: { city: '후쿠오카', airport: 'FUK', date: '2026-09-13', time: '14:00' },
    price: 150_000,
    currency: 'KRW',
    link: 'https://example.invalid/other',
};

const result = importModetourManualCapture({
    input: {
        capturedAt: capturedAt.toISOString(),
        regions: [{
            continentCode: 'JPN',
            cards: [
                kumamotoCard,
                { ...kumamotoCard, arrivalCity: '글자가 흐린 도시' },
                { ...kumamotoCard, arrivalCity: '오사카', price: 430_000, normalPrice: undefined, sourceDiscountRate: undefined },
            ],
        }],
    },
    cache: {
        timestamp: '2026-08-31T00:00:00.000Z',
        fullCrawlUpdatedAt: '2026-08-31T00:00:00.000Z',
        count: 2,
        flights: [oldFlight, otherFlight],
        sources: { modetour: 1, ybtour: 1 },
        sourceUpdatedAt: { modetour: '2026-08-30T00:00:00.000Z' },
        staleStreak: { modetour: 2 },
        scrapedCounts: { modetour: 771 },
        sourceCircuits: { modetour: { reason: 'blocked' } },
    },
    benchmark: {
        prices: {
            KMJ: { '2026-09': { lowest: 200_000, avg: 300_000 } },
            KIX: { '2026-09': { lowest: 250_000, avg: 400_000 } },
        },
    },
    now: new Date('2026-08-31T01:05:00.000Z'),
    apply: true,
});

assert.equal(result.report.accepted, 1);
assert.equal(result.report.updated, 1);
assert.equal(result.report.inserted, 0);
assert.equal(result.report.review.length, 1);
assert.equal(result.report.filteredByBenchmark.length, 1);
assert.equal(result.cache.fullCrawlUpdatedAt, '2026-08-31T00:00:00.000Z');
assert.equal(result.cache.sourceUpdatedAt?.modetour, '2026-08-30T00:00:00.000Z');
assert.equal(result.cache.staleStreak?.modetour, 2);
assert.equal(result.cache.scrapedCounts?.modetour, 771);
assert.ok(result.cache.sourceCircuits?.modetour);
assert.equal(result.cache.flights.length, 2);
const updated = result.cache.flights.find(flight => flight.id === oldFlight.id);
assert.equal(updated?.price, 194_000);
assert.equal(updated?.firstSeen, '2026-08-20');
assert.equal(updated?.naverLowest, 200_000);
assert.equal(result.cache.flights.find(flight => flight.id === otherFlight.id)?.price, 150_000);

const completeResult = importModetourManualCapture({
    input: {
        capturedAt: capturedAt.toISOString(),
        completeRegions: ['JPN'],
        regions: [{ continentCode: 'JPN', cards: [kumamotoCard] }],
    },
    cache: {
        timestamp: '2026-08-31T00:00:00.000Z',
        count: 3,
        flights: [
            oldFlight,
            {
                ...oldFlight,
                id: 'old-japan-flight-not-in-capture',
                arrival: { city: '오사카', airport: 'KIX', date: '2026-09-20', time: '15:00' },
            },
            otherFlight,
        ],
    },
    benchmark: { prices: { KMJ: { '2026-09': { lowest: 200_000, avg: 300_000 } } } },
    now: new Date('2026-08-31T01:05:00.000Z'),
    apply: true,
});
assert.deepEqual(completeResult.report.completeRegionsApplied, ['JPN']);
assert.equal(completeResult.report.removedByCompleteRegion, 2);
assert.equal(completeResult.cache.flights.filter(flight => flight.source === 'modetour').length, 1);
assert.equal(completeResult.cache.flights.find(flight => flight.id === oldFlight.id)?.price, 194_000);
assert.equal(completeResult.cache.manualCaptureStatus?.modetour.naverPending, true);

const emptyEuropeResult = importModetourManualCapture({
    input: {
        capturedAt: capturedAt.toISOString(),
        completeRegions: ['EUR'],
        excludedRegions: ['CHI'],
        regions: [{ continentCode: 'EUR', cards: [] }],
    },
    cache: {
        timestamp: '2026-08-31T00:00:00.000Z',
        count: 2,
        flights: [
            {
                ...oldFlight,
                id: 'old-europe-flight',
                arrival: { city: '파리', airport: 'CDG', date: '2026-09-20', time: '15:00' },
                region: '유럽',
            },
            otherFlight,
        ],
    },
    benchmark: {},
    now: new Date('2026-08-31T01:05:00.000Z'),
    apply: true,
});
assert.equal(emptyEuropeResult.report.accepted, 0);
assert.equal(emptyEuropeResult.report.removedByCompleteRegion, 1);
assert.deepEqual(emptyEuropeResult.report.completeRegionsApplied, ['EUR']);
assert.deepEqual(emptyEuropeResult.cache.manualCaptureStatus?.modetour.emptyRegions, ['EUR']);
assert.deepEqual(emptyEuropeResult.cache.manualCaptureStatus?.modetour.excludedRegions, ['CHI']);
assert.equal(emptyEuropeResult.cache.flights.some(flight => flight.id === 'old-europe-flight'), false);

console.log('모두투어 수동 캡처 검증·부분 병합·완전 지역 교체 테스트 통과');
