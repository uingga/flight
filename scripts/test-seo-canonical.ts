import assert from 'node:assert/strict';
import fs from 'node:fs';
import { displayCity, decodeCitySlug, groupByCity } from '../src/lib/flight-static';
import type { Flight } from '../src/types/flight';
import sitemap from '../src/app/sitemap';

const fixture = (id: string, city: string): Flight => ({
    id, source: 'modetour', airline: 'Test', price: 100000,
    departure: { airport: 'ICN', city: '인천', date: '2026-10-01', time: '10:00' },
    arrival: { airport: 'YNJ', city, date: '2026-10-04', time: '11:00' },
} as Flight);

assert.equal(displayCity('연길(옌지)'), '연길');
assert.equal(displayCity('옌지'), '연길');
assert.equal(displayCity('연길'), '연길');
assert.equal(displayCity('도쿄(나리타)'), '도쿄');
assert.equal(displayCity('100%'), '100%');
assert.equal(decodeCitySlug(encodeURIComponent('옌지')), '옌지');
assert.equal(decodeCitySlug('연길'), '연길');
assert.equal(decodeCitySlug('100%'), '100%');
const rows = [fixture('a', '연길(옌지)'), fixture('b', '옌지')];
const before = JSON.stringify(rows);
const groups = groupByCity(rows);
assert.equal(groups.length, 1);
assert.equal(groups[0].city, '연길');
assert.equal(groups[0].flights.length, 2);
assert.equal(JSON.stringify(rows), before, 'SEO grouping must not mutate source data');

const urls = sitemap().map(entry => entry.url);
assert.equal(new Set(urls).size, urls.length);
assert.ok(urls.every(url => new URL(url).origin === 'https://www.tikitikit.kr'));
assert.ok(!urls.some(url => decodeURIComponent(url).endsWith('/flights/옌지')));
assert.ok(!urls.some(url => url.endsWith('/tips/regional-airports')));

const layout = fs.readFileSync('src/app/layout.tsx', 'utf8');
const cityPage = fs.readFileSync('src/app/flights/[city]/page.tsx', 'utf8');
const home = fs.readFileSync('src/app/page.tsx', 'utf8');
assert.ok(!/canonical:\s*['"]\/['"]/.test(layout), 'Root layout must not canonicalize all URLs to home');
assert.match(home, /canonical:\s*['"]\/['"]/);
assert.match(cityPage, /permanentRedirect\(`/);
assert.ok(cityPage.includes('decodeCitySlug('), 'Malformed percent signs must be handled safely');
assert.match(cityPage, /c\.city !== data\.city && c\.flights\.length >= MIN_INDEXABLE_CITY_FLIGHTS/);
console.log(`SEO canonical checks passed (${urls.length} sitemap URLs; source data unchanged).`);
