// Own crawler tabs only. Never retain URLs, query strings, cookies or headers.
export function createTtangRequestAudit() {
    const counts = { started: 0, responses: 0, failed: 0, pending: 0,
        promotion: 0, schedule: 0, documents: 0, other: 0, restrictedResponses: 0 };
    const active = new Set();
    const responded = new Set();
    function request(req) {
        if (active.has(req)) return;
        active.add(req); counts.started++; counts.pending++;
        let kind = 'other';
        try {
            const u = new URL(req.url());
            if (u.origin === 'https://mm.ttang.com' && u.pathname === '/ttangair/search/promotion/allTtangListAct.do') kind = 'promotion';
            else if (u.origin === 'https://mm.ttang.com' && u.pathname === '/ttangair/search/city/scheduleAct.do') kind = 'schedule';
            else if (req.isNavigationRequest()) kind = 'documents';
        } catch { /* Unknown traffic still counts toward the total. */ }
        counts[kind]++;
    }
    function response(res) {
        const req = res.request();
        if (!active.has(req) || responded.has(req)) return;
        responded.add(req); counts.responses++;
        if ([401, 403, 429].includes(res.status())) counts.restrictedResponses++;
    }
    function finish(req, failed = false) {
        if (!active.delete(req)) return;
        responded.delete(req); counts.pending--;
        if (failed) counts.failed++;
    }
    return { request, response, finished: req => finish(req), failed: req => finish(req, true),
        snapshot: () => ({ ...counts }) };
}

// Observed 2026-09-07 page: totalCnt=RESPONSE_DATA.length; moreData renders
// indices (page-1)*scale..page*scale-1 of that same array, with no new request.
export function ttangListPageEvidence(date, returnedCount, attempt) {
    if (!/^\d{8}$/.test(date) || !Number.isSafeInteger(returnedCount) || returnedCount < 0
        || !Number.isSafeInteger(attempt) || attempt < 1) throw Error('invalid_ttang_page_evidence');
    return { date, page: 1, requestedScale: 200, returnedCount, attempt,
        coverage: 'verified', reason: 'client_array_pagination_20260907' };
}
