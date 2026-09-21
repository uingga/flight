import assert from 'node:assert/strict';
import { airlineDisplayName } from '../src/lib/utils/airline-display';
import { normalizeAirline, normalizeAirlineDisplay } from '../src/lib/utils/flight-helpers';

const aliases = ['티웨이항공', '티웨이 항공', '트리니티항공', '트리니티 항공', '트리니티항공(구)티웨이항공', "T'way항공", 't way항공', 'TW', 'Tway Air'];
for (const name of aliases) {
    assert.equal(airlineDisplayName(name), '트리니티항공', name);
    assert.equal(normalizeAirlineDisplay(name), '트리니티항공', name);
    assert.equal(normalizeAirline(name), '티웨이항공', 'stable history key: ' + name);
}
assert.equal(new Set(aliases.map(normalizeAirlineDisplay)).size, 1);
assert.equal(airlineDisplayName('제주항공'), '제주항공');
assert.equal(normalizeAirline('7C'), '제주항공');
console.log('PASS airline aliases share one display/filter identity; other airlines unchanged');
