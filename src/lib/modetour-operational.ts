import type { Flight } from '../types/flight';
import { collectModeBrowser, modeBrowserPlan, modeScopeKey, validateModePlan, type ModePlan } from './modetour-browser';

export const MODE_REMOTE_PROTOCOL = 'modetour-20260907.1';
export interface ModeBundle {
    protocol: string; capturedAt: string; plan: ModePlan;
    raw: Record<string, unknown[]>;
    result: { flights: Flight[]; failed: Array<{ scope: string; status: number }>; listRequests: number; rawCount: number; status: string };
}
/** Independently rebuild from retained public rows. No browser/API requests. */
export async function validateModeBundle(bundle: ModeBundle, previous: Flight[] = [], baseline: Record<string, number> = {}, now = Date.now()) {
    const age = now - Date.parse(bundle?.capturedAt);
    if (bundle?.protocol !== MODE_REMOTE_PROTOCOL || !Number.isFinite(age) || age < -60000 || age > 6 * 3600000)
        throw new Error('stale_modetour_evidence');
    validateModePlan(bundle.plan);
    const expectedPlan = modeBrowserPlan(new Date(now));
    if (bundle.plan.from !== expectedPlan.from || bundle.plan.through !== expectedPlan.through)
        throw new Error('modetour_window_mismatch');
    const failed = bundle.result?.failed;
    if (!Array.isArray(failed) || failed.length > 1 || failed.some(f => f.scope !== 'CHI/TPE' || f.status !== 500)
        || bundle.result.listRequests !== 15 || !bundle.raw || typeof bundle.raw !== 'object') throw new Error('incomplete_modetour_evidence');
    const keys = [...Object.keys(bundle.raw), ...failed.map(f => f.scope)].sort();
    if (JSON.stringify(keys) !== JSON.stringify(bundle.plan.scopes.map(modeScopeKey).sort())) throw new Error('missing_modetour_scopes');
    for (const [key, rows] of Object.entries(bundle.raw)) {
        if (!Array.isArray(rows) || rows.length >= 500) throw new Error('invalid_modetour_checkpoint');
        if (baseline[key] > 0 && rows.length < baseline[key] * 0.6) throw new Error('source_count_collapse');
    }
    const rebuilt = await collectModeBrowser(bundle.plan, {
        read: async () => { throw new Error('offline_evidence_must_not_fetch'); }, wait: async () => {},
    }, async () => {}, previous, { cached: bundle.raw, failed, previousRequests: 15 });
    if (rebuilt.rawCount !== bundle.result.rawCount || rebuilt.status !== bundle.result.status
        || JSON.stringify(rebuilt.flights) !== JSON.stringify(bundle.result.flights)) throw new Error('modetour_evidence_mismatch');
    // A failed destination is not a new observation. Keep its original object/timestamps.
    const retained = failed.length ? previous.filter(f => f.source === 'modetour' && f.arrival?.airport === 'TPE') : [];
    const rawById = new Map<string, any>();
    for (const [key, rows] of Object.entries(bundle.raw)) for (const row of rows as any[])
        rawById.set(`modetour-${key.split('/')[0]}-${row.stockPackageNo}`, row);
    const flights = rebuilt.flights.map(f => {
        const row = rawById.get(f.id);
        const fare = (v: unknown) => /^\d+$/.test(String(v)) && Number.isSafeInteger(Number(v)) && Number(v) <= 20000000 ? Number(v) : undefined;
        const duration = (v: unknown) => typeof v === 'string' && /^\d{1,3}:[0-5]\d$/.test(v) ? v : undefined;
        return { ...f, flightNumber: [f.modetourDetail?.departureFlightNo, f.modetourDetail?.returnFlightNo].filter(Boolean).join(' / '),
            modetourDetail: { ...f.modetourDetail,
                flyingTime: duration(row.start?.flyingTime || row.start?.eft),
                returnFlyingTime: duration(row.eDate?.flyingTime || row.eDate?.eft),
                childBaseFare: fare(row.child?.value), childTax: fare(row.child?.tax), childTax2: fare(row.child?.tax2), infantFare: fare(row.infant?.value) } };
    });
    return { flights, retained, partial: failed.length > 0,
        rawCount: rebuilt.rawCount, capturedAt: bundle.capturedAt,
        scopeCounts: { ...baseline, ...Object.fromEntries(Object.entries(bundle.raw).map(([k,v]) => [k,v.length])) },
        detail: failed.length ? `타오위안(TPE) HTTP 500 — 기존 ${retained.length}건 유지, 나머지 14구간 반영` : '15구간 수집 완료' };
}
