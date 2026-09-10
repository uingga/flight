import assert from 'node:assert/strict';
import { normalizeCity, CITY_TO_AIRPORT } from '../src/lib/utils/flight-helpers';
import { cityDetailName, cityDisplayName, citySearchMatches } from '../src/lib/utils/city-display';
import { buildFlightDisplayKey } from '../src/lib/flight-visibility';
import type { Flight } from '../src/types/flight';

const aliases = ['계림', '구이린', '구이린시', 'KWL', 'kwl', '계림(KWL)', '구이린(KWL)', '계림(구이린)'];
const flight: Flight = {
    id: 'guilin-display-fixture', source: 'modetour', airline: '제주항공',
    departure: { city: '인천', airport: 'ICN', date: '2026-10-01', time: '10:00' },
    arrival: { city: '구이린', airport: 'KWL', date: '2026-10-05', time: '15:00' },
    price: 305000, currency: 'KRW', availableSeats: 4, link: 'https://example.invalid/booking',
};
const before = JSON.stringify(flight);
for (const alias of aliases) {
    assert.equal(normalizeCity(alias), '구이린', 'Keep the canonical history key');
    assert.equal(CITY_TO_AIRPORT[normalizeCity(alias)], 'KWL');
    assert.equal(cityDisplayName(alias), '계림');
    assert.equal(cityDetailName(alias), '계림(구이린)');
    for (const term of ['계림', '구이린', '구이린시', 'KWL', 'kwl']) {
        assert.ok(citySearchMatches(alias, term), `${alias} / ${term}`);
    }
    assert.equal(buildFlightDisplayKey({ ...flight, arrival: { ...flight.arrival, city: alias } }), buildFlightDisplayKey(flight));
}
assert.equal(JSON.stringify(flight), before);
assert.equal(cityDisplayName('도쿄(나리타)'), '도쿄');
assert.equal(cityDetailName('하노이'), '하노이');
assert.ok(citySearchMatches('하노이', '하노'));
assert.ok(!citySearchMatches('하노이', 'KWL'));
assert.ok(!citySearchMatches('구이린', '하노이'));
console.log('PASS Guilin labels, search aliases, stable route identity and unrelated cities');
