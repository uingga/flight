/** Public list request observed 2026-09-09. Keep legacy pages compatible; never rewrite requests. */
export const isOnlineLowestOrder = (value: unknown): value is string => value === 'LP' || value === 'LOW';
export const ONLINE_EXTRA_QUERY_KEYS = ['searchStartDate', 'searchEndDate', 'useYn'];
export function validOnlineExtraQuery(q: URLSearchParams): boolean {
    const present = ONLINE_EXTRA_QUERY_KEYS.filter(k => q.has(k));
    return !present.length || (present.length === 3
        && ONLINE_EXTRA_QUERY_KEYS.every(k => q.getAll(k).length === 1)
        && q.get('searchStartDate') === '' && q.get('searchEndDate') === '' && q.get('useYn') === 'N');
}
