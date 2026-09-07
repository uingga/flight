import {
    classifyVisit, isPublicVisitPath, isVisitId, reusableVisit, VISITOR_STORAGE_KEY,
    VISITOR_TTL_MS, VISIT_EXCLUSION_KEY, VISIT_STORAGE_KEY, type VisitAction, type VisitPayload, type VisitState,
} from './visit-analytics';

const ENABLED = process.env.NEXT_PUBLIC_VISIT_ANALYTICS_ENABLED === 'true';
let entry: { url: string; referrer: string } | undefined;
let localQueue: Promise<void> = Promise.resolve();
const pending = new Set<string>();
const acknowledged = new Set<string>();
const attempts = new Map<string,number>();

function permitted() {
    if (!ENABLED || typeof window === 'undefined' || !isPublicVisitPath(window.location.pathname)) return false;
    if (navigator.webdriver || navigator.doNotTrack === '1'
        || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return false;
    if (process.env.NODE_ENV === 'production' && !['www.tikitikit.kr', 'tikitikit.kr'].includes(location.hostname)) return false;
    try { return localStorage.getItem(VISIT_EXCLUSION_KEY) !== 'true'; } catch { return false; }
}
function parse(raw: string | null): unknown {
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function clearVisitAnalytics() {
    acknowledged.clear();
    attempts.clear();
    try {
        localStorage.removeItem(VISIT_STORAGE_KEY);
        localStorage.removeItem(VISITOR_STORAGE_KEY);
        sessionStorage.removeItem(VISIT_STORAGE_KEY);
    } catch { /* Storage denial means no collection. */ }
}
function getVisit(now: number): VisitState | null {
    if (!permitted()) return null;
    try {
        const visitor = parse(localStorage.getItem(VISITOR_STORAGE_KEY)) as { id?: string; createdAt?: number } | null;
        const visitorId = visitor && isVisitId(visitor.id) && typeof visitor.createdAt === 'number'
            && visitor.createdAt <= now && now - visitor.createdAt < VISITOR_TTL_MS
            ? visitor.id : crypto.randomUUID();
        if (visitorId !== visitor?.id) localStorage.setItem(VISITOR_STORAGE_KEY, JSON.stringify({id:visitorId,createdAt:now}));
        // Without Web Locks, use tab-local sessions rather than race shared session state.
        const storage = navigator.locks ? localStorage : sessionStorage;
        const previous = parse(storage.getItem(VISIT_STORAGE_KEY));
        const state: VisitState = reusableVisit(previous, visitorId, now)
            ? { ...previous, lastActivityAt: now }
            : { id:crypto.randomUUID(), visitorId, startedAt:now, lastActivityAt:now,
                channel:classifyVisit(entry?.url || location.href, entry?.referrer || '') };
        storage.setItem(VISIT_STORAGE_KEY, JSON.stringify(state));
        entry = { url:location.origin + location.pathname, referrer:location.origin };
        return state;
    } catch { return null; }
}
async function send(payload: VisitPayload) {
    const key = `${payload.visitId}:${payload.action}`;
    if (pending.has(key) || acknowledged.has(key) || (attempts.get(key) || 0) >= 2 || !permitted()) return;
    pending.add(key);
    try {
        for (let attempt = 0; attempt < 2; attempt++) {
            if (!permitted() || (attempts.get(key) || 0) >= 2) break;
            attempts.set(key,(attempts.get(key) || 0) + 1);
            if (attempts.size > 200) attempts.delete(attempts.keys().next().value!);
            try {
                const response = await fetch('/api/visit-events', {
                    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload),
                    credentials:'same-origin', keepalive:true, signal:AbortSignal.timeout(4000),
                });
                if (response.ok) {
                    acknowledged.add(key);
                    acknowledged.add(`${payload.visitId}:visit`);
                    if (acknowledged.size > 200) acknowledged.clear();
                    break;
                }
                if (response.status < 500) break;
            } catch { /* Analytics never blocks a booking action. */ }
            if (!attempt) await new Promise(resolve => setTimeout(resolve, 700));
        }
    } finally { pending.delete(key); }
}
export function trackVisitAction(action: VisitAction) {
    if (!permitted()) return;
    const work = async () => {
        const state = getVisit(Date.now());
        if (state) void send({visitId:state.id, visitorId:state.visitorId, startedAt:state.startedAt, channel:state.channel, action});
    };
    // Never hold an identity lock while waiting for a network request.
    localQueue = localQueue.then(async () => {
        if (navigator.locks) await navigator.locks.request('tikitikit-visit-v1', work);
        else await work();
    }).catch(() => undefined);
}
export function startVisitAnalytics(url: string, referrer: string) {
    if (!permitted()) return () => {};
    entry = {url, referrer};
    let lastTouch = 0;
    const touch = () => {
        if (document.visibilityState !== 'visible') return;
        const now = Date.now();
        if (now - lastTouch < 15_000) return;
        lastTouch = now;
        trackVisitAction('visit');
    };
    touch();
    window.addEventListener('pointerdown', touch, {passive:true});
    window.addEventListener('keydown', touch, {passive:true});
    window.addEventListener('scroll', touch, {passive:true});
    const onVisible = () => { if (!lastTouch) touch(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
        window.removeEventListener('pointerdown', touch);
        window.removeEventListener('keydown', touch);
        window.removeEventListener('scroll', touch);
        document.removeEventListener('visibilitychange', onVisible);
    };
}
