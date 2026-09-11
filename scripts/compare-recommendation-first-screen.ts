import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as after from '../src/lib/flight-recommendation';
import type { Flight } from '../src/types/flight';

async function main() {
    const argument = (key: string) => process.argv.find(arg => arg.startsWith(`--${key}=`))?.split('=').slice(1).join('=');
    const baseline = argument('baseline');
    const snapshot = argument('snapshot');
    if (!baseline || !snapshot) throw new Error('--baseline=<original module> --snapshot=<json> required');
    // Only our public API is read on explicit capture; no travel-agency or Naver requests.
    if (process.argv.includes('--capture')) {
        const response = await fetch('https://tikitikit.kr/api/flights');
        if (!response.ok) throw new Error(`Flight API ${response.status}`);
        const data = await response.json();
        if (!data.success || !Array.isArray(data.flights)) throw new Error('Invalid flight snapshot');
        fs.mkdirSync(path.dirname(path.resolve(snapshot)), { recursive: true });
        fs.writeFileSync(snapshot, JSON.stringify({ now: Date.now(), data }));
    }
    const { now, data } = JSON.parse(fs.readFileSync(snapshot, 'utf8'));
    const before = await import(pathToFileURL(path.resolve(baseline)).href);
    const flights: Flight[] = data.flights;
    const oldState = before.buildRecommendationScoreState(flights, data.interparkPrices, now, data.priceHistory);
    const state = after.buildRecommendationScoreState(flights, data.interparkPrices, now, data.priceHistory);
    assert.deepEqual([...state.explanations], [...oldState.explanations], 'All scores and evidence must match production');
    const results = [];
    for (const mode of ['all', 'dates', 'dates-incheon']) {
        const filtered = flights.filter(f => {
            const date = f.departure.date.replaceAll('.', '-').slice(0, 10);
            return (mode === 'all' || (date >= '2026-09-24' && date <= '2026-09-27'))
                && (mode !== 'dates-incheon' || /인천|김포|서울|ICN|GMP|SEL/.test(f.departure.city));
        });
        const ranked = [...filtered].sort((a, b) => after.compareRecommendedFlights(a, b, state.scores, now, state.explanations));
        const options = { now, balanceIncheon: mode !== 'dates-incheon',
            pinnedFlight: mode === 'all' ? flights.find(f => f.id === data.todayPickId) : undefined };
        const old = before.buildRecommendationPresentation(ranked, oldState, options).orderedFlights as Flight[];
        const current = after.buildRecommendationPresentation(ranked, state, options).orderedFlights;
        assert.deepEqual([...current.map(f => f.id)].sort(), [...old.map(f => f.id)].sort(), 'No cards lost');
        const summary = (f: Flight) => ({ id: f.id, route: `${f.departure.city}→${f.arrival.city}`, price: f.price });
        const kobe = (list: Flight[]) => { const i = list.findIndex(f => f.arrival.airport === 'UKB' && f.price === 819000); return i < 0 ? null : i + 1; };
        const firstOld = old.slice(0, options.pinnedFlight ? 8 : 9).map(f => f.id);
        const firstNew = current.slice(0, options.pinnedFlight ? 8 : 9).map(f => f.id);
        results.push({ mode, total: current.length, kobeBefore: kobe(old), kobeAfter: kobe(current),
            changedPositions: current.filter((f, index) => f.id !== old[index]?.id).length,
            firstScreenSameOrder: JSON.stringify(firstOld) === JSON.stringify(firstNew),
            before: old.slice(0, 9).map(summary), after: current.slice(0, 9).map(summary) });
    }
    console.log(JSON.stringify({ snapshotAt: new Date(now).toISOString(), unchangedScores: flights.length,
        manualPlacements: data.manualFlightOrder?.placements?.length || 0, results }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
