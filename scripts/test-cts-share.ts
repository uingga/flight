import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET } from '../src/app/t/[code]/route';
import { SHARE_GROUPS, resolveShareGroupFlights } from '../src/lib/share-groups';
import type { Flight } from '../src/types/flight';

async function main() {
    const group = SHARE_GROUPS['cts-260915'];
    const active = { id: 'ttang-7C1501ICNCTS-G3-2026-09-20' } as Flight;
    const expired = { id: 'ttang-7C1501ICNCTS-G3-2026-09-19' } as Flight;
    assert.deepEqual(group.flightIds, [active.id]);
    assert.equal(group.price, 199000);
    assert.equal(group.dateText, '9.20(일)–9.23(수)');
    assert.deepEqual(resolveShareGroupFlights(group, [expired, active]), [active]);
    assert.deepEqual(resolveShareGroupFlights(group, [expired]), []);
    const code = 'g-cts-260915';
    const response = await GET(new NextRequest(`https://www.tikitikit.kr/t/${code}`), { params: Promise.resolve({ code }) });
    const target = new URL(response.headers.get('location')!);
    assert.equal(target.pathname, '/share-group/cts-260915');
    assert.equal(target.searchParams.get('utm_source'), 'threads');
    assert.equal(target.searchParams.get('utm_content'), 'share_group_cts-260915');
    assert.equal(target.searchParams.has('flight'), false);
    console.log('CTS share: exact schedule, expiry and tracked list redirect passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
