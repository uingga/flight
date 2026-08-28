import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const apiRoute = fs.readFileSync('src/app/api/flights/route.ts', 'utf8');
const feed = fs.readFileSync('src/app/preview/mobile-redesign/MobileRedesignPreview.tsx', 'utf8');
const feedStyles = fs.readFileSync('src/app/preview/mobile-redesign/page.module.css', 'utf8');

test('the API only exposes a valid pick from the current KST date', () => {
    assert.match(apiRoute, /const todayPickId = todayPickDate === todayKstDate/);
    assert.match(apiRoute, /allFlights\.some\(f => f\.id === todayPick\.flightId\)/);
});

test('the fixed selection wins before the dynamic fallback candidate', () => {
    assert.match(feed, /const flight = fixedTodayPick\s*\|\| flights/);
});

test('today pick is named explicitly on both compact and desktop labels', () => {
    assert.equal((feed.match(/>오늘의 표</g) || []).length, 2);
    assert.match(feedStyles, /@media[^}]*min-width[\s\S]*?\.todayPickInline\s*\{[\s\S]*?display:\s*inline-flex/);
});

test('a repeated pick selected after a price drop exposes and displays that reason', () => {
    assert.match(apiRoute, /todayPickRepeatOverride/);
    assert.match(feed, /어제보다 \$\{todayPickRepeatOverride\.dropAmount/);
    assert.match(feed, /내려 다시 선정/);
    assert.match(feed, /!featuredPick\?\.repeatPriceDrop && averageDiscountRate >= 5/);
});
