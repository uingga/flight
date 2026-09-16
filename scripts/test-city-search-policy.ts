import assert from 'node:assert/strict';
import {FEATURED_TRAVEL_CITIES,isIndexableCity} from '../src/lib/city-search-policy';
import {KNOWN_FLIGHT_CITIES} from '../src/lib/known-flight-cities';
import sitemap from '../src/app/sitemap';
for(const city of FEATURED_TRAVEL_CITIES){assert.equal(isIndexableCity(city,3),true);assert.equal(isIndexableCity(city,2),false);assert.equal(isIndexableCity(city,0),false);}
for(const city of ['창사','오랄','빈','리장']){assert.ok((KNOWN_FLIGHT_CITIES as readonly string[]).includes(city));assert.equal(isIndexableCity(city,50),false);}
assert.equal(isIndexableCity('오사카(KIX)',3),true);
const urls=sitemap().map(item=>item.url);
assert.ok(!urls.some(url=>url.includes('/tips/price-watch')));
for(const url of urls.filter(url=>url.includes('/flights/')))assert.ok((FEATURED_TRAVEL_CITIES as readonly string[]).includes(decodeURIComponent(url.split('/flights/')[1])));
console.log('PASS: featured city inventory threshold, retained legacy cities, sitemap exclusions');
