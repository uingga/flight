import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const flight = readFileSync('src/app/api/og/FlightOgCard.tsx', 'utf8');
const brand = readFileSync('src/app/api/og/BlogBrandOgCard.tsx', 'utf8');
assert.match(flight, /ticketHeight = blog \? 460 : 520/);
assert.match(brand, /width: 1080, height: 460/);
for (const aspect of [5 / 3, 530 / 241, 2.3]) {
    const visibleHeight = 1200 / aspect;
    assert.ok((visibleHeight - 460) / 2 >= 30, `Missing safe margin for ${aspect}`);
}
console.log('Blog ticket safe area: PC, supplied mobile crop, and 2.3:1 pass.');
