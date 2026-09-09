import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Flight } from '../src/types/flight';
import {
    buildRecommendationPresentation, buildRecommendationScoreState, compareRecommendedFlights,
    compareRecommendationTailFlights, getRecommendationPremiumMultiplier, getRecommendationTailScore,
} from '../src/lib/flight-recommendation';
import { applyManualFlightOrder } from '../src/lib/manual-flight-order';

const now = Date.parse('2026-09-09T09:42:19.441Z');
const ids = (flights: Flight[]) => flights.map(flight => flight.id);
function flight(id: string, city: string, price: number, naverLowest?: number): Flight {
    return {
        id, source: 'ybtour', airline: 'test', currency: 'KRW', price, seats: '4석', region: '일본',
        departure: { city: '인천', airport: 'ICN', date: '2026-09-18', time: '08:00' },
        arrival: { city, airport: 'TST', date: '2026-09-21', time: '12:00' },
        naverLowest, naverCheckedAt: new Date(now).toISOString(), priceCheckedAt: new Date(now).toISOString(),
        firstSeen: '2026-09-09',
    };
}
assert.equal(getRecommendationPremiumMultiplier(0), 0.8);
for (let i = 1; i <= 1000; i++) {
    assert(getRecommendationPremiumMultiplier(i / 1000) > getRecommendationPremiumMultiplier((i - 1) / 1000));
}
for (const boundary of [0, 0.03, 5000 / 202100, 0.1, 0.2]) {
    assert(Math.abs(getRecommendationPremiumMultiplier(boundary + 1e-8)
        - getRecommendationPremiumMultiplier(boundary - 1e-8)) < 1e-6);
}
const mild = flight('mild', '후쿠오카', 209000, 202100);
const higherDeal = flight('higher-deal', '삿포로', 269000, 354900);
const cheaperPremium = flight('cheaper-premium', '삿포로', 248300, 228400);
const missing = flight('missing', '비교없음', 210000);
const stale = { ...mild, id: 'stale', naverCheckedAt: new Date(now - 50 * 3600000).toISOString() };
const expired = { ...mild, id: 'expired', naverCheckedAt: new Date(now - 80 * 3600000).toISOString() };
const front = Array.from({ length: 9 }, (_, i) => flight(`front-${i}`, `도시${i}`, 100000, 200000));
const candidates = [...front, mild, higherDeal, cheaperPremium, missing, stale, expired];
const state = buildRecommendationScoreState(candidates, {}, now);
for (const f of [higherDeal, missing, stale, expired]) {
    const e = state.explanations.get(f.id)!;
    assert.equal(getRecommendationTailScore(e), e.score, `${f.id}: preserve non-premium evidence`);
}
const mildExplanation = state.explanations.get(mild.id)!;
assert.equal(mildExplanation.topRecommendationTier, 4, 'First-screen tier stays strict');
assert(getRecommendationTailScore(mildExplanation) < mildExplanation.score, 'Small premium no longer jumps to 1.6');
const ranked = candidates.slice().sort((a, b) => compareRecommendedFlights(a, b, state.scores, now, state.explanations));
const presentation = buildRecommendationPresentation(ranked, state, { now, balanceIncheon: false });
assert.deepEqual(new Set(ids(presentation.orderedFlights.slice(0, 9))), new Set(ids(front)));
assert(presentation.orderedFlights.indexOf(higherDeal) < presentation.orderedFlights.indexOf(cheaperPremium),
    'Tail must not swap a worse bargain into an earlier same-route slot');
assert.deepEqual([...ids(presentation.orderedFlights)].sort(), [...ids(candidates)].sort());
assert.equal(new Set(ids(presentation.orderedFlights)).size, candidates.length);
assert.equal(presentation.explanations.get(mild.id)?.display.tailScore, getRecommendationTailScore(mildExplanation));
const priceSorted = candidates.slice().sort((a, b) => a.price - b.price);
assert.deepEqual(ids(buildRecommendationPresentation(priceSorted, state, { diversify: false, now }).orderedFlights), ids(priceSorted));
const pinned = front[0];
const withPinned = buildRecommendationPresentation(ranked, state, { pinnedFlight: pinned, now });
assert(!withPinned.orderedFlights.some(f => f.id === pinned.id));
assert.equal(withPinned.explanations.get(pinned.id)?.display.displayPosition, 1);
assert.equal(buildRecommendationPresentation([], buildRecommendationScoreState([], {}, now), { now }).orderedFlights.length, 0);
const single = [flight('single', '한도시', 220000)];
assert.deepEqual(ids(buildRecommendationPresentation(single, buildRecommendationScoreState(single, {}, now), { now }).orderedFlights), ['single']);
const scoreMap = new Map(candidates.map(f => [f.id, getRecommendationTailScore(state.explanations.get(f.id)!)]));
const compare = (a: Flight, b: Flight) => compareRecommendationTailFlights(a, b, scoreMap);
assert.deepEqual(ids(candidates.slice().sort(compare)), ids(candidates.slice().reverse().sort(compare)));
const older = { ...missing, id: 'older', firstSeen: '2026-09-08' };
const newer = { ...missing, id: 'newer', firstSeen: '2026-09-09' };
assert(compareRecommendationTailFlights(newer, older, new Map([['older', 100], ['newer', 100]])) < 0);
console.log('PASS tail: continuous strong premium, stale/missing evidence, first-screen tiers, same-route deals, price sort, pinned/empty/single, stable ordering, newness tie-break');

// Optional offline replay: the approved full 466-card order must match, not only top100.
const snapshotPath = process.argv.find(arg => arg.startsWith('--snapshot='))?.slice(11);
const expectedPath = process.argv.find(arg => arg.startsWith('--expected='))?.slice(11);
if (snapshotPath && expectedPath) {
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
    const { data, now: at } = snapshot;
    const flights: Flight[] = data.flights;
    const scoreState = buildRecommendationScoreState(flights, data.interparkPrices || {}, at, data.priceHistory || {});
    const rankedFlights = [...flights].sort((a, b) => compareRecommendedFlights(a, b, scoreState.scores, at, scoreState.explanations));
    const today = flights.find(f => f.id === data.todayPickId);
    const result = buildRecommendationPresentation(rankedFlights, scoreState, { pinnedFlight: today, now: at });
    const ordered = applyManualFlightOrder([...(today ? [today] : []), ...result.orderedFlights], data.manualFlightOrder?.placements || [], { sort: 'recommended', pinnedId: today?.id });
    assert.deepEqual(ids(ordered), expected.orders.strong, 'Production implementation exactly matches approved experiment');
    assert.deepEqual(ids(ordered.slice(0, 9)), expected.orders.current.slice(0, 9));
    console.log(`PASS approved snapshot: all ${ordered.length} positions match; TOP9 unchanged`);
}
