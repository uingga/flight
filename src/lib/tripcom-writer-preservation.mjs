// A non-Trip.com writer may have started its crawl before Trip.com published.
// Preserve the Trip.com-owned slice from the exact parent commit it publishes on.
export function preserveTripcomForForeignWriter(current, entries, rawEntries) {
    if (!Array.isArray(current?.flights) || !Array.isArray(entries)) throw Error('invalid writer cache');
    const index = entries.findIndex(([file]) => file === 'data/all-flights-cache.json');
    if (index < 0) return {entries, rawEntries};
    const proposed = entries[index][1];
    if (!Array.isArray(proposed?.flights)) throw Error('invalid proposed cache');
    const owned = current.flights.filter(flight => flight.source === 'tripcom');
    const next = structuredClone(proposed);
    next.flights = [...next.flights.filter(flight => flight.source !== 'tripcom'), ...owned];
    next.count = next.flights.length;
    for (const key of ['tripcomPrimary']) {
        if (Object.hasOwn(current, key)) next[key] = structuredClone(current[key]);
        else delete next[key];
    }
    for (const key of ['sources', 'sourceUpdatedAt']) {
        const currentMap = current[key];
        const proposedMap = next[key];
        if (currentMap && Object.hasOwn(currentMap, 'tripcom')) {
            next[key] = {...proposedMap, tripcom: structuredClone(currentMap.tripcom)};
        } else if (proposedMap && Object.hasOwn(proposedMap, 'tripcom')) {
            delete proposedMap.tripcom;
        }
    }
    const updatedEntries = entries.map((entry, offset) => offset === index ? [entry[0], next] : entry);
    const updatedRaw = rawEntries?.map((entry, offset) => offset === index ? [entry[0], JSON.stringify(next)] : entry);
    return {entries: updatedEntries, rawEntries: updatedRaw};
}
