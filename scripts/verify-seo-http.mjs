import assert from 'node:assert/strict';

// Read-only checks against a running production build. No travel-agency calls.
const base = process.argv[2] || 'http://127.0.0.1:3108';
const origin = 'https://www.tikitikit.kr';
async function read(path) {
    const response = await fetch(new URL(path, base), {
        redirect: 'manual', signal: AbortSignal.timeout(20000),
    });
    const html = await response.text();
    const canonicals = [...html.matchAll(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"[^>]*>/g)]
        .map(match => match[1]);
    return { response, html, canonicals };
}

const missing = await read(`/flights/${encodeURIComponent('엔지')}`);
assert.equal(missing.response.status, 404);
assert.equal(missing.canonicals.length, 0, '404 must not point its canonical at home');
assert.match(missing.html, /<meta name="robots" content="noindex/);

const alias = await read(`/flights/${encodeURIComponent('옌지')}`);
assert.equal(alias.response.status, 308);
assert.equal(decodeURIComponent(alias.response.headers.get('location')), '/flights/연길');

const legacy = await read('/tips/regional-airports');
assert.equal(legacy.response.status, 308);
assert.equal(legacy.response.headers.get('location'), '/tips/price-watch');
assert.deepEqual(legacy.canonicals, [`${origin}/tips/price-watch`]);

const malformed = await read('/flights/100%25');
assert.equal(malformed.response.status, 404, 'Decoded percent sign must not throw a 500');

const sitemap = await read('/sitemap.xml');
assert.equal(sitemap.response.status, 200);
const urls = [...sitemap.html.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
assert.ok(urls.length > 0);
for (const url of urls) {
    assert.equal(new URL(url).origin, origin);
    const page = await read(new URL(url).pathname);
    assert.equal(page.response.status, 200, `${url}: sitemap must not list redirects/errors`);
    assert.deepEqual(page.canonicals.map(value => value.replace(/\/$/, '')), [url.replace(/\/$/, '')]);
    assert.ok(!/<meta[^>]*name="(?:robots|googlebot)"[^>]*content="[^"]*noindex/i.test(page.html), `${url}: noindex`);
}
console.log(`SEO HTTP checks passed: ${urls.length} sitemap URLs, alias 308, legacy 308, unknown/malformed 404.`);
