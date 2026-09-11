import assert from 'node:assert/strict';
import type { Flight } from '../src/types/flight';
import { buildRecommendationScoreState, compareRecommendedFlights, buildRecommendationPresentation } from '../src/lib/flight-recommendation';

const now = Date.parse('2026-09-10T09:00:00Z');
const checked = new Date(now).toISOString();
const make = (id: string, price: number, naverLowest?: number): Flight => ({
    id, price, source: 'ybtour', airline: '제주항공', currency: 'KRW', region: '일본',
    departure: { city: '인천', airport: 'ICN', date: '2026-09-25', time: '13:20' },
    arrival: { city: id, airport: id, date: '2026-09-27', time: '16:00' },
    naverLowest, naverCheckedAt: checked, priceCheckedAt: checked,
});
const kobe = { ...make('고베', 819000, 868900), source: 'ttang' as const,
    nearbyNaverBaseline: 293650, nearbyNaverSampleCount: 10 };
const cheaper = Array.from({ length: 10 }, (_, i) => make(`대안${i}`, 220000 + i * 1000, 210000));
const pool = [kobe, ...cheaper];
const state = buildRecommendationScoreState(pool, {}, now);
const ranked = [...pool].sort((a, b) => compareRecommendedFlights(a, b, state.scores, now, state.explanations));
assert.equal(ranked[0].id, kobe.id, 'Reproduce high-tier Kobe anchor before display protection');
assert.equal(state.explanations.get(kobe.id)?.expensivePromotionEligible, false);
const originalState = JSON.stringify({ scores: [...state.scores], explanations: [...state.explanations] });
const presentation = buildRecommendationPresentation(ranked, state, { now, balanceIncheon: false });
assert(presentation.orderedFlights.indexOf(kobe) >= 9, 'Lower-tier eligible alternatives must displace Kobe from the first nine');
assert.deepEqual(new Set(presentation.orderedFlights.map(f => f.id)), new Set(pool.map(f => f.id)));
assert.equal(presentation.orderedFlights.length, pool.length);
assert.equal(JSON.stringify({ scores: [...state.scores], explanations: [...state.explanations] }), originalState,
    'Display rule must not change scores or evidence tiers');
assert.deepEqual(buildRecommendationPresentation(ranked, state, { now, diversify: false }).orderedFlights, ranked,
    'Other sort/search paths retain their supplied order');
const onlyExpensive = [kobe, make('고가2', 900000)];
assert.equal(buildRecommendationPresentation(onlyExpensive, buildRecommendationScoreState(onlyExpensive, {}, now), { now })
    .orderedFlights.length, 2, 'No alternatives: keep all results, no blank list');
const shortPool = [kobe, cheaper[0]];
const shortState = buildRecommendationScoreState(shortPool, {}, now);
assert.deepEqual(buildRecommendationPresentation(shortPool, shortState, { now, balanceIncheon: false }).orderedFlights,
    [cheaper[0], kobe], 'Short lists prefer available alternatives without deleting expensive results');
const unknownCheap = make('비교가없음', 290000);
const unknownPool = [kobe, unknownCheap];
assert.equal(buildRecommendationPresentation(unknownPool, buildRecommendationScoreState(unknownPool, {}, now), { now })
    .orderedFlights[0].id, unknownCheap.id, 'Missing comparison is not itself a first-screen rejection');
// A qualified expensive deal must remain eligible; reuse the existing evidence decision, not a new formula.
const qualifiedState = buildRecommendationScoreState(pool, {}, now);
qualifiedState.explanations.get(kobe.id)!.expensivePromotionEligible = true;
assert(buildRecommendationPresentation(ranked, qualifiedState, { now, balanceIncheon: false }).orderedFlights.indexOf(kobe) < 9);
const pinned = buildRecommendationPresentation(ranked, state, { now, pinnedFlight: kobe });
assert(!pinned.orderedFlights.includes(kobe));
assert.equal(pinned.explanations.get(kobe.id)?.display.displayPosition, 1, 'Explicit today-pick pin remains unchanged');
console.log('PASS first-screen protection: Kobe/tier fallback, scores unchanged, no lost/duplicate cards, alternate sorts, short/all-expensive lists, unknown cheap, qualified deal, pinned pick');
