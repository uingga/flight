import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cityDisplayName, citySearchMatches } from '../src/lib/utils/city-display';
import { normalizeCity } from '../src/lib/utils/flight-helpers';

const groups: Array<[string, string[]]> = [
    ['상하이', ['상해', '상하이', '상해(푸동)', '상해(푸동공항)', '상해(PVG)', '상하이(SHA)']],
    ['마쓰야마', ['마츠야마', '마쓰야마', '마쓰야마(MYJ)']],
    ['다카마쓰', ['다카마쓰', '다카마츠']],
    ['타이베이', ['대만(타이페이)', '타이페이', '타이베이', '타이페이(송산)']],
    ['성도', ['청두', '성도', '청두(TFU)', '청두(CTU)']],
    ['장가계', ['장자제', '장가계', '장가계(다융)']],
    ['계림', ['구이린', '계림', '계림(구이린)', 'KWL']],
    ['옌지', ['연길', '옌지', '연길(옌지)']],
    ['옌타이', ['연태', '옌타이', '연태(옌타이)']],
    ['푸켓', ['푸껫', '푸켓']],
    ['칭다오', ['청도', '칭다오']],
    ['광저우', ['광주(광저우)', '광저우 (CAN)', '광저우']],
    ['보라카이', ['칼리보(보라카이)', '보라카이(KLO)', '보라카이(깔리보)']],
];
for (const [label, aliases] of groups) {
    assert.equal(new Set(aliases.map(cityDisplayName)).size, 1, label);
    for (const city of aliases) {
        assert.equal(cityDisplayName(city), label, city);
        for (const query of aliases) assert.ok(citySearchMatches(city, query), `${city} / ${query}`);
    }
}
assert.equal(cityDisplayName('광주(KWJ)'), '광주');
assert.ok(!citySearchMatches('광주(KWJ)', '광저우'));
assert.ok(!citySearchMatches('하노이', '상해'));
assert.ok(!citySearchMatches('하노이', '(없는도시)'));
assert.ok(citySearchMatches('상하이', '상'));
assert.ok(citySearchMatches('상해(푸동)', '푸동'));
assert.ok(citySearchMatches('상하이', ''));
assert.notEqual(cityDisplayName('미야코지마'), cityDisplayName('시모지시마'));
assert.equal(normalizeCity('청두'), '청두', 'No history key migration');
assert.equal(normalizeCity('성도'), '성도', 'No history key migration');
assert.equal(normalizeCity('도쿄(NRT)'), '도쿄(나리타)');
assert.equal(normalizeCity('도쿄(HND)'), '도쿄(하네다)');
const cache = JSON.parse(fs.readFileSync('data/all-flights-cache.json', 'utf8'));
const before = JSON.stringify(cache);
const airports = new Map<string, Set<string>>();
for (const flight of cache.flights) {
    const names = airports.get(flight.arrival.airport) || new Set<string>();
    names.add(cityDisplayName(flight.arrival.city));
    airports.set(flight.arrival.airport, names);
}
assert.equal(JSON.stringify(cache), before, 'Display helpers must not mutate cached data');
for (const [airport, names] of airports) {
    if (names.size > 1) console.log('REVIEW', airport, [...names].join(' / '));
}
console.log(`PASS ${groups.length} alias groups, bidirectional search, airport boundaries and unchanged stored data`);
