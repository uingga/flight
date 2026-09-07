import puppeteer, { type HTTPRequest, type HTTPResponse } from 'puppeteer';
import { discoverDedicatedChromeEndpoint } from './onlinetour-dedicated-chrome';
import { assertNoSourceAccessBlockText } from './scrapers/source-response';
import { MODE_BROWSER_URL, MODE_LIST_URL, modePageUrl, validateModeListUrl, isModeListPreflight,
    type ModeBackend, type ModeEvidence, type ModePlan, type ModeScope } from './modetour-browser';

/** Uses the existing signed-in profile, without launching Chrome or reading authentication data. */
export async function openModeBrowser(maxRequests = 15): Promise<ModeBackend & { close(): Promise<void>; diagnostics(): unknown }> {
    if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 15) throw new Error('invalid_request_budget');
    const browser = await puppeteer.connect({ browserWSEndpoint: await discoverDedicatedChromeEndpoint(),
        defaultViewport: null, protocolTimeout: 20_000 });
    let page;
    try { page = await browser.newPage(); } catch (e) { browser.disconnect(); throw e; }
    let active: { scope: ModeScope; plan: ModePlan } | null = null;
    let stopped: Error | null = null, requests = 0, scopeRequests = 0;
    const observations: Array<Record<string, unknown>> = [];
    let deliver: ((e: ModeEvidence) => void) | undefined;
    let reject: ((e: Error) => void) | undefined;
    const fail = (reason: string) => {
        stopped ||= new Error(reason);
        reject?.(stopped);
    };
    try { await page.setRequestInterception(true); }
    catch (e) { await page.close().catch(() => {}); browser.disconnect(); throw e; }
    const requestHandler = async (req: HTTPRequest) => {
        if (req.isInterceptResolutionHandled()) return;
        try {
            const u = new URL(req.url());
            if (stopped) { await req.abort(); return; }
            if (u.origin + u.pathname === MODE_LIST_URL) {
                observations.push({ kind: 'list_request', method: req.method(),
                    queryKeys: Array.from(u.searchParams.keys()),
                    query: Object.fromEntries(Array.from(u.searchParams.entries()).filter(([key]) =>
                        ['continentcode', 'arrivalcity', 'departurecity', 'departuredate', 'arrivaldate', 'page', 'itemcount'].includes(key.toLowerCase()))) });
                if (!active) throw new Error('unexpected_list_request');
                // Browsers can send an OPTIONS request with no search parameters before GET.
                // It is not a product query; keep exact endpoint checks, but validate the
                // actual search scope only on the following data request.
                if (isModeListPreflight(req.method(), req.url())) { await req.continue(); return; }
                validateModeListUrl(req.url(), active.plan, active.scope);
                if (req.method() !== 'OPTIONS') {
                    if (req.method() !== 'GET' || ++scopeRequests > 1 || ++requests > maxRequests)
                        throw new Error('list_budget_exceeded');
                }
            } else if (req.isNavigationRequest() && req.frame() === page.mainFrame()
                && (u.origin + u.pathname !== MODE_BROWSER_URL || req.url() !== modePageUrl(active!.plan, active!.scope))) {
                throw new Error('unexpected_navigation');
            }
            await req.continue();
        } catch (e) {
            fail(e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : 'request_guard_failure');
            if (!req.isInterceptResolutionHandled()) await req.abort().catch(() => {});
        }
    };
    const responseHandler = async (res: HTTPResponse) => {
        try {
            const u = new URL(res.url());
            if (!['https://www.modetour.com', 'https://b2c-api.modetour.com'].includes(u.origin)) return;
            if (u.origin + u.pathname === MODE_LIST_URL || res.request().isNavigationRequest())
                observations.push({ kind: 'response', path: u.pathname, status: res.status() });
            if ([401, 403, 429].includes(res.status())) { fail('access_restriction'); return; }
            if (u.origin + u.pathname !== MODE_LIST_URL || res.request().method() === 'OPTIONS') return;
            if (!active || stopped) return;
            validateModeListUrl(res.url(), active.plan, active.scope);
            const body = await res.text();
            if (stopped) return;
            deliver?.({ url: res.url(), status: res.status(), contentType: res.headers()['content-type'] || '', body });
        } catch { fail('list_response_unreadable'); }
    };
    page.on('request', requestHandler);
    page.on('response', responseHandler);
    return {
        diagnostics: () => ({ listRequests: requests, failure: stopped?.message, observations }),
        wait: () => new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000)),
        async read(scope, plan) {
            if (stopped) throw stopped;
            active = { scope, plan }; scopeRequests = 0;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const evidence = new Promise<ModeEvidence>((resolve, rejectPromise) => {
                deliver = resolve; reject = rejectPromise;
                timer = setTimeout(() => fail('list_timeout'), 25_000);
            });
            // Attach a rejection handler before navigation starts (including immediate HTTP blocks).
            const settled = evidence.then(value => ({ value }), error => ({ error }));
            try {
                const navigation = await page.goto(modePageUrl(plan, scope), { waitUntil: 'domcontentloaded', timeout: 25_000 });
                if (stopped) throw stopped;
                if (!navigation || navigation.status() !== 200) throw new Error('document_failure');
                const body = await page.evaluate(() => document.body?.innerText || '');
                try { assertNoSourceAccessBlockText('modetour', body); } catch { fail('access_restriction'); }
                const result = await settled;
                if (stopped) throw stopped;
                if ('error' in result) throw result.error;
                return result.value;
            } catch (e) {
                fail(e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : 'browser_read_failure');
                throw stopped;
            } finally {
                if (timer) clearTimeout(timer);
                deliver = undefined; reject = undefined;
            }
        },
        async close() {
            stopped ||= new Error('collector_closed');
            try { await page.close({ runBeforeUnload: false }); }
            finally { browser.disconnect(); }
        },
    };
}
