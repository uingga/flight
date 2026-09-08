import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateMetadata } from '../src/app/share/[id]/page';

const cases = [
    ['2026-09-17', '2026-09-21', '9.17(목)–9.21(월)'],
    ['2026.09.17', '20260921', '9.17(목)–9.21(월)'],
    ['2026-12-31', '2027-01-01', '12.31(목)–1.1(금)'],
    ['2028-02-29', '2028-03-01', '2.29(화)–3.1(수)'],
    ['2025-09-17', '2025-09-21', '9.17(수)–9.21(일)'],
    ['2026-09-17', '', '9.17(목)'],
];

async function run() {
    const originalFetch = globalThis.fetch;
    const originalUrl = process.env.SUPABASE_URL;
    const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    // All requests are intercepted; no live API, crawler or database access.
    process.env.SUPABASE_URL = 'https://archive.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
    try {
        for (const archived of [false, true]) {
            for (const [departure, arrival, expected] of cases) {
                globalThis.fetch = async (input) => {
                    const url = String(input);
                    if (url.endsWith('/api/flights')) {
                        return Response.json({ flights: archived ? [] : [{
                            id: 'modetour-CHI-20107438', source: 'modetour', price: 258000,
                            departure: { city: '부산', date: departure },
                            arrival: { city: '타이중', date: arrival },
                            airline: '진에어', availableSeats: 4,
                        }] });
                    }
                    assert.ok(url.startsWith('https://archive.invalid/rest/v1/flight_price_daily?'));
                    return Response.json([{
                        flight_id: 'modetour-CHI-20107438', source: 'modetour',
                        departure_city: '부산', arrival_city: '타이중',
                        departure_date: departure, return_date: arrival || null,
                        airline: '진에어', listed_price: 258000,
                    }]);
                };
                const metadata = await generateMetadata({
                    params: Promise.resolve({ id: 'modetour-CHI-20107438' }),
                    searchParams: Promise.resolve({}),
                });
                const images = metadata.openGraph?.images as Array<{ url: string }>;
                const imageUrl = images[0].url;
                assert.equal(new URL(imageUrl).searchParams.get('date'), expected,
                    `${process.env.TZ}: ${archived ? 'archive' : 'live'} ${departure}`);
                assert.deepEqual(metadata.twitter?.images, [imageUrl]);
                if (archived) assert.ok(metadata.description?.includes(expected));
            }
        }
        console.log(`PASS ${process.env.TZ}: ${cases.length * 2} metadata cases (OG + Twitter)`);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalUrl === undefined) delete process.env.SUPABASE_URL;
        else process.env.SUPABASE_URL = originalUrl;
        if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    }
}

if (process.argv.includes('--worker')) {
    run().catch(error => { console.error(error); process.exitCode = 1; });
} else {
    for (const TZ of ['UTC', 'Asia/Seoul', 'America/Los_Angeles', 'Pacific/Honolulu']) {
        const result = spawnSync(process.execPath, ['--import', 'tsx', process.argv[1], '--worker'], {
            env: { ...process.env, TZ }, encoding: 'utf8',
        });
        process.stdout.write(result.stdout || '');
        process.stderr.write(result.stderr || '');
        if (result.error) throw result.error;
        if (result.status !== 0) process.exitCode = 1;
    }
}
