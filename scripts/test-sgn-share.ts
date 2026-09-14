import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET } from '../src/app/t/[code]/route';
import { SHARE_GROUPS, resolveShareGroupFlights } from '../src/lib/share-groups';
import type { Flight } from '../src/types/flight';

async function main() {
    const group = SHARE_GROUPS['sgn-260914'];
    const flights = group.flightIds.map(id => ({ id } as Flight));
    assert.equal(group.price, 210000);
    assert.equal(flights.length, 2);
    assert.deepEqual(resolveShareGroupFlights(group, [...flights, { id: 'yonago' } as Flight]), flights);
    assert.deepEqual(resolveShareGroupFlights(group, flights.slice(1)), flights.slice(1));
    for (const code of ['m20136580', 'g-sgn-260914']) {
        const response = await GET(new NextRequest(`http://localhost/t/${code}`), { params: Promise.resolve({ code }) });
        const target = new URL(response.headers.get('location')!);
        assert.equal(target.pathname, '/share-group/sgn-260914');
        assert.equal(target.searchParams.get('utm_source'), 'threads');
        assert.equal(target.searchParams.has('flight'), false);
    }
    console.log('SGN collection: exact tickets, expiry, both links and list-only redirect passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
