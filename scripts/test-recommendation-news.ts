import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Flight } from '../src/types/flight';
import { recordRecommendationNews } from './lib/recommendation-news';
import { recommendationNewsTimestamp } from '../src/lib/recommendation-news';
import { diversifyFlightDestinationsWithDecisions } from '../src/lib/flight-diversity';

const time = '2026-09-17T03:00:00Z';
const flight = (id: string, price = 300000, city = '미야코지마'): Flight => ({
    id, source: 'ybtour', airline: '진에어', price, currency: 'KRW', link: 'https://example.invalid',
    departure: { city: '부산', airport: 'PUS', date: '2026-11-01', time: '13:25' },
    arrival: { city, airport: city === '미야코지마' ? 'SHI' : city, date: '2026-11-05', time: '16:45' },
    firstSeen: '2026-09-12', flightNumber: 'LJ635',
});
test('price-derived ID changes do not turn an existing itinerary into a discovery', () => {
    const [f] = recordRecommendationNews([flight('old',339900)], [flight('new',279900)], time);
    assert.equal(f.recommendationNews?.drop?.from,339900);
    assert.equal(recommendationNewsTimestamp(f),Date.parse(time));
    assert.equal(f.recommendationNews?.firstSeenAt,'2026-09-11T15:00:00.000Z');
});
test('unchanged refresh preserves the original drop timestamp indefinitely', () => {
    const [f] = recordRecommendationNews([flight('old',339900)],[flight('new',279900)],time);
    const [later] = recordRecommendationNews([f],[{...f}], '2026-10-17T03:00:00Z');
    assert.equal(recommendationNewsTimestamp(later),Date.parse(time));
});
test('1000 won, less than 5 percent, and a different itinerary do not earn a drop event', () => {
    for (const price of [299000,290000]) {
        assert.equal(recordRecommendationNews([flight('old')],[flight('new',price)],time)[0].recommendationNews?.drop,undefined);
    }
    const different=flight('new',200000); different.departure.date='2026-11-02';
    assert.equal(recordRecommendationNews([flight('old')],[different],time)[0].recommendationNews?.drop,undefined);
});
test('price rise invalidates the event and return to the same low cannot refresh it', () => {
    const [down]=recordRecommendationNews([flight('old',339900)],[flight('down',279900)],time);
    const [up]=recordRecommendationNews([down],[flight('up',339900)],'2026-09-18T03:00:00Z');
    const [again]=recordRecommendationNews([up],[flight('again',279900)],'2026-09-19T03:00:00Z');
    assert.equal(up.recommendationNews?.drop,undefined);
    assert.equal(again.recommendationNews?.drop,undefined);
});
test('stale replay does not refresh an event', () => {
    const [f]=recordRecommendationNews([flight('old',339900)],[flight('down',279900)],time);
    const [stale]=recordRecommendationNews([f],[flight('stale',250000)],'2026-09-16T03:00:00Z');
    assert.equal(stale.recommendationNews?.drop?.at,time);
    assert.notEqual(recommendationNewsTimestamp(stale),Date.parse(time));
});
const order=(items: Flight[],scores: Map<string,number>)=>diversifyFlightDestinationsWithDecisions(items,{
    topWindow:0,balanceIncheon:false,scoreOf:f=>scores.get(f.id)!,recentChangeOf:recommendationNewsTimestamp,
}).flights;
test('recent event wins within 15 percent but cannot displace a much better price score', () => {
    const old=flight('old',200000,'AAA');
    const fresh={...flight('fresh',210000,'BBB'), firstSeen:'2026-09-17'};
    assert.equal(order([old,fresh],new Map([['old',100],['fresh',114]]))[0].id,'fresh');
    assert.equal(order([old,fresh],new Map([['old',100],['fresh',116]]))[0].id,'old');
});
test('cheapest same-route ticket precedes a newer expensive ticket even with a better score', () => {
    const cheap=flight('cheap',279900),expensive={...flight('expensive',377000),firstSeen:'2026-09-17'};
    assert.equal(order([expensive,cheap],new Map([['expensive',100],['cheap',110]]))[0].id,'cheap');
});
test('a more recent competing event wins without a clock decay or stacking', () => {
    const [a]=recordRecommendationNews([flight('a',339900)],[flight('a',279900)],time);
    const b={...flight('b',280000,'BBB'),firstSeen:'2026-09-18'};
    assert.equal(order([a,b],new Map([['a',100],['b',105]]))[0].id,'b');
});
test('different city labels for the same airport cannot put the expensive schedule first', () => {
    const cheap=flight('cheap',279900,'시모지시마(SHI)'); cheap.arrival.airport='SHI';
    const expensive={...flight('expensive',377000),firstSeen:'2026-09-17'};
    assert.equal(order([expensive,cheap],new Map([['expensive',100],['cheap',110]]))[0].id,'cheap');
});
