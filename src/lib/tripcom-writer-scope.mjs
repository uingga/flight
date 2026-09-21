import { isDeepStrictEqual } from 'node:util';

// Defense in depth: this publisher cannot rewrite another agency or a ledger.
export function assertTripcomWriterScope(previous, next) {
    if (!Array.isArray(previous?.flights) || !Array.isArray(next?.flights)) throw Error('invalid cache');
    const outside = cache => cache.flights.filter(f => f.source !== 'tripcom');
    if (!isDeepStrictEqual(outside(previous), outside(next))) throw Error('other agency changed');
    const metadata = cache => {
        const value = structuredClone(cache);
        delete value.flights;
        delete value.tripcomPrimary;
        delete value.count;
        if (value.sources) delete value.sources.tripcom;
        if (value.sourceUpdatedAt) delete value.sourceUpdatedAt.tripcom;
        // An absent map and a map with no other agency values are equivalent.
        for (const key of ['sources','sourceUpdatedAt']) {
            if (value[key] && Object.keys(value[key]).length === 0) delete value[key];
        }
        return value;
    };
    if (!isDeepStrictEqual(metadata(previous), metadata(next))) throw Error('unrelated metadata changed');
    if (next.count !== next.flights.length) throw Error('invalid count');
    const flights = next.flights.filter(f => f.source === 'tripcom');
    if (flights.length > 40 || new Set(flights.map(f => f.arrival?.city)).size !== flights.length) throw Error('city limit');
    for (const f of flights) {
        if (!Number.isSafeInteger(f.price) || f.price <= 0 || !f.id?.startsWith('tripcom-')) throw Error('invalid quote');
    }
}
