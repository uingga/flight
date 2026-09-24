/** Normalize the two public list envelopes observed from OnlineTour. */
export function normalizeOnlineTourPaging(data: unknown, pageNo: number): { totalCount: number; lastPage: number } | null {
    if (!data || typeof data !== 'object' || !Number.isSafeInteger(pageNo) || pageNo < 1) return null;
    const value = data as { list?: unknown; count?: unknown; paging?: unknown };
    if (!Array.isArray(value.list) || value.list.length > 20) return null;
    const paging = value.paging;
    let totalCount: unknown, lastPage: unknown;
    if (paging === null || paging === undefined) {
        // The live 2026-09-24 response has data.count but no paging object.
        // pageSize=20 is checked against the site's own request before this runs.
        totalCount = value.count;
        if (!Number.isSafeInteger(totalCount) || (totalCount as number) < 0) return null;
        lastPage = Math.ceil((totalCount as number) / 20);
    } else {
        if (typeof paging !== 'object' || Array.isArray(paging)) return null;
        const fields = paging as { curPage?: unknown; totalCount?: unknown; totalLastPage?: unknown };
        if (fields.curPage !== pageNo) return null;
        totalCount = fields.totalCount ?? value.count;
        lastPage = fields.totalLastPage;
    }
    if (!Number.isSafeInteger(totalCount) || (totalCount as number) < value.list.length
        || !Number.isSafeInteger(lastPage) || (lastPage as number) < 0
        || ((totalCount as number) > 0 && (lastPage as number) < 1)) return null;
    return { totalCount: totalCount as number, lastPage: lastPage as number };
}
