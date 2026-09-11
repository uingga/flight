import { dayBefore, kstDay, type PromotionPost, type SourceResult } from '../promotion-daily';
import { TE31_POSTS } from '../te31-posts';
import { boundedText, CollectionDeadline, CollectionError } from './promotion-http';

export type RemoteSource = 'threads' | 'ga4';
export interface RemoteRequest { source: RemoteSource; day: string; runId: string }
export const REMOTE_SOURCE_URL = 'https://www.tikitikit.kr/api/internal/promotion-source';
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const only = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const iso = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
export function parseRemoteRequest(value: unknown): RemoteRequest {
    if (!object(value) || !only(value, ['source','day','runId']) || (value.source !== 'threads' && value.source !== 'ga4')
        || value.day !== kstDay() || typeof value.runId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.runId)) throw new CollectionError('invalid_remote_request');
    return value as unknown as RemoteRequest;
}
export function parseRemoteResult(value: unknown, request: RemoteRequest): SourceResult {
    const fail = (): never => { throw new CollectionError('invalid_remote_result'); };
    if (!object(value) || !only(value,['source','outcome','reason','observedAt','posts']) || value.source !== request.source
        || typeof value.outcome !== 'string' || !['success','partial','failed','unsupported'].includes(value.outcome) || !iso(value.observedAt)
        || typeof value.reason !== 'string' || !/^[a-z0-9_,]{1,200}$/.test(value.reason)
        || !Array.isArray(value.posts) || value.posts.length > (request.source === 'threads' ? 30 : 108)) return fail();
    const seen = new Set<string>();
    for (const post of value.posts) {
        if (!object(post) || !only(post,['id','platform','title','url','trackingContent','trackingIssue','trackingSource','shared','metrics'])
            || typeof post.id !== 'string' || typeof post.title !== 'string' || post.title.length > 1000 || typeof post.url !== 'string' || post.url.length > 2048
            || !object(post.metrics) || (post.platform !== 'threads' && post.platform !== 'te31')) return fail();
        const numericId = request.source === 'ga4' ? post.id.replace(/^(threads|te31):/, '') : post.id;
        if (!/^\d{1,32}$/.test(numericId) || (request.source === 'threads' && post.platform !== 'threads')
            || (request.source === 'ga4' && post.id !== `${post.platform}:${numericId}`)
            || (post.platform === 'te31' && !TE31_POSTS.some(item => String(item.id) === numericId))) return fail();
        if (post.url) {
            let url: URL; try { url = new URL(post.url); } catch { return fail(); }
            if (url.protocol !== 'https:' || url.username || url.password || url.port) return fail();
            if (post.platform === 'threads' && !['threads.net','www.threads.net','threads.com','www.threads.com'].includes(url.hostname)) return fail();
            if (post.platform === 'te31' && post.url !== `https://te31.com/rgr/view.php?id=freead&no=${numericId}`) return fail();
        }
        for (const key of ['trackingContent','trackingIssue','trackingSource']) if (post[key] !== undefined && post[key] !== null
            && (typeof post[key] !== 'string' || (post[key] as string).length > 1000)) return fail();
        if (post.shared !== undefined && typeof post.shared !== 'boolean') return fail();
        const metricNames = request.source === 'threads' ? ['views','likes','replies','reposts','quotes','shares'] : ['users','sessions','detailUsers','bookingUsers','bookingClicks','verifiedUsers'];
        let measuredDay = '';
        for (const [key, metric] of Object.entries(post.metrics)) {
            if (!metricNames.includes(key) || !object(metric) || !only(metric,['value','day','observedAt'])
                || !Number.isSafeInteger(metric.value) || (metric.value as number) < 0 || !iso(metric.observedAt) || typeof metric.day !== 'string'
                || !/^\d{4}-\d\d-\d\d$/.test(metric.day) || (measuredDay && measuredDay !== metric.day)
                || (request.source === 'threads' ? metric.day !== request.day : metric.day < dayBefore(request.day,3) || metric.day > dayBefore(request.day))) return fail();
            measuredDay = metric.day;
        }
        const key = `${post.id}:${measuredDay}`;
        if (seen.has(key)) return fail(); seen.add(key);
    }
    return value as unknown as SourceResult;
}
// Explicit DTO allowlist: no raw Graph objects, credentials or extra provider fields cross the server boundary.
export function remoteResultDto(result: SourceResult, request: RemoteRequest): SourceResult {
    const posts: PromotionPost[] = result.posts.map(post => ({ id: post.id, platform: post.platform, title: post.title, url: post.url,
        trackingContent: post.trackingContent ?? null, trackingIssue: post.trackingIssue ?? null,
        ...(post.trackingSource ? { trackingSource: post.trackingSource } : {}), ...(post.shared !== undefined ? { shared: post.shared } : {}), metrics: post.metrics }));
    return parseRemoteResult({ source: result.source, outcome: result.outcome, reason: result.reason, observedAt: result.observedAt, posts }, request);
}
export async function collectRemoteSource(source: RemoteSource, day: string, runId: string, fetcher: typeof fetch = fetch): Promise<SourceResult> {
    const request = parseRemoteRequest({ source, day, runId });
    const secret = process.env.PROMOTION_JOB_SECRET;
    if (!secret) throw new CollectionError('remote_secret_missing');
    const text = await boundedText(new URL(REMOTE_SOURCE_URL), { method:'POST', headers:{ Authorization:`Bearer ${secret}`, 'Content-Type':'application/json' }, body:JSON.stringify(request) },
        fetcher, 2_000_000, { timeoutMs:250_000, deadline:new CollectionDeadline(250_000) });
    const body: unknown = JSON.parse(text);
    if (!object(body) || !only(body,['day','runId','result']) || body.day !== day || body.runId !== runId) throw new CollectionError('invalid_remote_envelope');
    return parseRemoteResult(body.result, request);
}
