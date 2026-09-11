// Selection snapshots never use current flight prices.
export function collectTodayPickArchive(stored = {}, seed = []) {
    const seen = new Set();
    return [stored, ...(stored.history || []), ...(stored.recentPicks || []), stored.previousPick, ...seed]
        .filter(p => p && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.flightId && Number.isFinite(p.effectivePrice) && p.effectivePrice > 0)
        .filter(p => {
            const key = `${p.date}|${p.flightId}|${p.effectivePrice}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .map(p => ({date: p.date, flightId: p.flightId, source: p.source || null,
            arrivalCity: p.arrivalCity || null, destinationKey: p.destinationKey || '', effectivePrice: p.effectivePrice}))
        .sort((a, b) => b.date.localeCompare(a.date));
}
