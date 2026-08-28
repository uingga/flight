import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const homePage = fs.readFileSync('src/app/page.tsx', 'utf8');

test('the browser tab keeps the stable home title', () => {
    assert.match(homePage, /const HOME_TITLE = '지금 나온 땡처리 항공권 \| 티키티킷'/);
    assert.match(homePage, /title: \{ absolute: HOME_TITLE \}/);
});

test('social previews keep the featured flight title', () => {
    assert.match(homePage, /openGraph: \{[\s\S]*?title: fullTitle/);
    assert.match(homePage, /twitter: \{[\s\S]*?title: fullTitle/);
});
