/** First-party visit contracts. Never persist URLs, flight data or account identifiers. */
export const VISIT_CHANNELS = ['direct', 'search', 'social', 'ai', 'referral', 'campaign', 'unknown'] as const;
export type VisitChannel = typeof VISIT_CHANNELS[number];
export type VisitAction = 'visit' | 'detail' | 'booking';
export const VISIT_IDLE_MS = 30 * 60_000;
export const VISITOR_TTL_MS = 90 * 86_400_000;
export const VISIT_STORAGE_KEY = 'tikitikit_visit_v1';
export const VISITOR_STORAGE_KEY = 'tikitikit_visitor_v1';
export const VISIT_EXCLUSION_KEY = 'tikitikit_analytics_excluded';
export const CHANNEL_LABELS: Record<VisitChannel, string> = {
    direct: '직접 방문·출처 없음', search: '검색', social: 'SNS', ai: 'AI 서비스',
    referral: '외부 링크', campaign: '기타 캠페인', unknown: '출처 확인 불가',
};
export interface VisitState {
    id: string; visitorId: string; startedAt: number; lastActivityAt: number; channel: VisitChannel;
}
export interface VisitPayload {
    visitId: string; visitorId: string; startedAt: number; channel: VisitChannel; action: VisitAction;
}
export interface VisitReport {
    available: boolean; mode: 'shadow'; message?: string; day?: string; generatedAt?: string;
    firstRecordedAt?: string | null; users?: number; sessions?: number;
    detailUsers?: number; detailSessions?: number; bookingUsers?: number; bookingSessions?: number;
    channels?: Array<{ channel: VisitChannel; users: number; sessions: number }>; reconciled?: boolean;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isVisitId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
export const koreaVisitDay = (at: number) => new Date(at + 9 * 3_600_000).toISOString().slice(0, 10);
export function isPublicVisitPath(path: string) {
    return path === '/' || /^\/(flights|tips|drop|share|share-group)(\/|$)/.test(path) || path === '/about';
}
const isDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
export function classifyVisit(url: string, referrer: string): VisitChannel {
    try {
        const location = new URL(url);
        const source = (location.searchParams.get('utm_source') || '').toLowerCase();
        const medium = (location.searchParams.get('utm_medium') || '').toLowerCase();
        // The agency filter `source` is not a campaign parameter.
        if (source || medium) {
            if (/^(chatgpt(\.com)?|perplexity(\.ai)?|claude(\.ai)?|gemini)$/.test(source)) return 'ai';
            if (/^(naver_blog|threads|instagram|facebook|youtube|twitter|tiktok|user_share)$/.test(source)
                || /^(social|social-network|social-media)$/.test(medium)) return 'social';
            if (medium === 'organic') return 'search';
            return 'campaign';
        }
        if (!referrer) return 'direct';
        const host = new URL(referrer).hostname.toLowerCase();
        if (isDomain(host, 'tikitikit.kr') || host === location.hostname) return 'unknown';
        if (['chatgpt.com', 'perplexity.ai', 'claude.ai', 'gemini.google.com'].some(d => isDomain(host, d))) return 'ai';
        if (['blog.naver.com', 'm.blog.naver.com', 'cafe.naver.com', 'instagram.com', 'facebook.com', 'threads.net', 'threads.com', 'youtube.com', 't.co', 'x.com', 'tiktok.com'].some(d => isDomain(host, d))) return 'social';
        if (['search.naver.com', 'm.search.naver.com', 'google.com', 'google.co.kr', 'bing.com', 'search.daum.net', 'duckduckgo.com'].some(d => isDomain(host, d))) return 'search';
        return 'referral';
    } catch { return 'unknown'; }
}
export function reusableVisit(value: unknown, visitorId: string, now: number): value is VisitState {
    if (!value || typeof value !== 'object') return false;
    const v = value as VisitState;
    return isVisitId(v.id) && v.visitorId === visitorId && VISIT_CHANNELS.includes(v.channel)
        && Number.isFinite(v.startedAt) && Number.isFinite(v.lastActivityAt)
        && v.startedAt <= v.lastActivityAt && v.lastActivityAt <= now
        && now - v.lastActivityAt < VISIT_IDLE_MS && koreaVisitDay(v.startedAt) === koreaVisitDay(now);
}
export function parseVisitPayload(value: unknown, now: number): VisitPayload | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const v = value as VisitPayload;
    if (Object.keys(v).sort().join(',') !== 'action,channel,startedAt,visitId,visitorId') return null;
    if (!isVisitId(v.visitId) || !isVisitId(v.visitorId) || !VISIT_CHANNELS.includes(v.channel)
        || !['visit', 'detail', 'booking'].includes(v.action) || !Number.isSafeInteger(v.startedAt)) return null;
    if (v.startedAt > now + 10_000 || v.startedAt < now - 86_520_000) return null;
    const day = koreaVisitDay(v.startedAt);
    // KST midnight split with two minutes of delivery grace. Never arbitrary backfill.
    if (day !== koreaVisitDay(now) && day !== koreaVisitDay(now - 120_000)) return null;
    return v;
}
