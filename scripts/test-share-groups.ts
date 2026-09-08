import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET } from '../src/app/c/[code]/route';
import { SHARE_GROUPS, resolveShareGroupFlights } from '../src/lib/share-groups';
import type { Flight } from '../src/types/flight';
async function main() {
    const code = 'pus-260908', group = SHARE_GROUPS[code];
    assert.equal(group.routes?.length, 5);
    assert.equal(group.flightIds.length,12);
    assert.deepEqual(group.routes!.flatMap(route => route.flightIds), group.flightIds);
    assert.equal(new Set(group.flightIds).size,12);
    const flights = group.flightIds.map(id => ({id} as Flight));
    assert.equal(resolveShareGroupFlights(group,flights).length,12);
    assert.equal(resolveShareGroupFlights(group,flights.slice(1)).length,11);
    assert.deepEqual(resolveShareGroupFlights(group,[]),[]);
    assert.ok(SHARE_GROUPS[code]);
    const response=await GET(new NextRequest(`http://localhost/c/te31-${code}`),{params:Promise.resolve({code:`te31-${code}`})});
    assert.equal(response.status,307);
    const target=new URL(response.headers.get('location')!);
    assert.equal(target.pathname,`/share-group/${code}`);
    assert.deepEqual(Object.fromEntries(target.searchParams),{utm_source:'te31',utm_medium:'community',utm_campaign:`tikitikit_te31_${code}`,utm_content:`share_group_${code}`});
    const legacy=await GET(new NextRequest('http://localhost/c/te31-pqc1438'),{params:Promise.resolve({code:'te31-pqc1438'})});
    assert.equal(new URL(legacy.headers.get('location')!).pathname,'/share-group/pqc1438');
    const invalid=await GET(new NextRequest('http://localhost/c/te31-unknown'),{params:Promise.resolve({code:'te31-unknown'})});
    assert.equal(invalid.status,302);
    console.log('Multi-route registration, exact ID expiry, UTM redirect and legacy links passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
