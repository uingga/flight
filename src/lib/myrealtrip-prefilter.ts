export interface MyrealtripEligibility {
    nowMs: number;
    maxDays: number;
    gidMap: Record<string, number>;
}

/** Match the existing reservation-stage departure window; never filter by Bulk price. */
export function myrealtripSkipReason(
    date: string,
    destination: string,
    eligibility: MyrealtripEligibility,
): 'date' | 'link' | null {
    const departure = Date.parse(date);
    if (!Number.isFinite(departure) || departure < eligibility.nowMs
        || departure > eligibility.nowMs + eligibility.maxDays * 86_400_000) return 'date';
    if (!eligibility.gidMap[destination]) return 'link';
    return null;
}

/** Per-run only. Failed requests are not cached; different origins never share prices. */
export async function myrealtripCalendarOnce<T>(
    cache: Map<string, T>, key: string, fetchPrices: () => Promise<T>,
): Promise<T> {
    if (cache.has(key)) return cache.get(key)!;
    const value = await fetchPrices();
    cache.set(key, value);
    return value;
}
