// Adds already-published quotes to an approved ordinary comparison only.
// Never creates a run, extends a budget, or waits for Trip.com collection.
export function isFreshTripcomQuote(flight, now = Date.now()) {
    if (flight.source !== 'tripcom' || !(flight.price > 0)) return false;
    const checked = Date.parse(flight.priceCheckedAt || '');
    const time = Number(new Date(now));
    return Number.isFinite(checked) && checked <= time && time - checked <= 48 * 3600000;
}

export function includePublishedTripcom(policy, cache, now = Date.now()) {
    if (!policy.shouldRun || !Array.isArray(policy.sources)) return policy;
    const fresh = (cache?.flights || []).some(flight => isFreshTripcomQuote(flight, now));
    if (!fresh) return policy;
    return { ...policy, sources: [...new Set([...policy.sources, 'tripcom'])] };
}
