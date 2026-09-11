import { connectOwnReplyTracking, extractTracking, type OwnReply } from '../threads-tracking';
import { connectVerifiedPostLinks } from '../threads-post-links';
import { observedMetrics, validNumber, type PromotionPost, type SourceResult } from '../promotion-daily';
import { boundedText, CollectionDeadline, CollectionError, safeReason } from './promotion-http';

const METRICS = ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'];
export function parseThreadMetrics(data: unknown): Record<string, number | null> {
    if (!Array.isArray(data)) throw new CollectionError('invalid_insights');
    return Object.fromEntries(METRICS.map(name => {
        const rows = data.filter(item => item?.name === name);
        if (rows.length !== 1) return [name, null];
        const row = rows[0];
        const total = typeof row.total_value === 'number' ? row.total_value : row.total_value?.value;
        if (validNumber(total)) return [name, total];
        const values = row.values;
        return [name, Array.isArray(values) && values.length > 0 && values.every(item => validNumber(item?.value))
            ? values.reduce((sum, item) => sum + item.value, 0) : null];
    }));
}
export async function collectThreads(day: string, accessToken: string | undefined, fetcher: typeof fetch = fetch, deadline = new CollectionDeadline()): Promise<SourceResult> {
    const now = () => new Date().toISOString();
    const result: SourceResult = { source: 'threads', outcome: 'failed', reason: 'token_missing', observedAt: now(), posts: [] };
    if (!accessToken) return result;
    let incomplete = false;
    const get = async (path: string, params: Record<string, string>) => {
        deadline.check();
        if (!/^(?:me\/(?:threads|replies)|\d+\/insights)$/.test(path)) throw new CollectionError('invalid_threads_path');
        const url = new URL(`https://graph.threads.net/v1.0/${path}`);
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
        // Header only: credentials never occur in stored URLs or error strings.
        const json = JSON.parse(await boundedText(url, { headers: { Authorization: `Bearer ${accessToken}` } }, fetcher, 2_000_000, { deadline }));
        if (json.error) throw new CollectionError('threads_api_error', [10, 102, 190, 200, 4, 613].includes(json.error.code));
        if (!Array.isArray(json.data)) throw new CollectionError('invalid_threads_response');
        return json;
    };
    try {
        const response = await get('me/threads', { fields: 'id,text,timestamp,permalink,link_attachment_url', limit: '30' });
        if (!response.data.length || response.data.length > 30) throw new CollectionError('invalid_recent30');
        const seen = new Set<string>();
        for (const post of response.data) {
            if (typeof post.id !== 'string' || !/^\d+$/.test(post.id) || seen.has(post.id)) throw new CollectionError('invalid_post_id');
            seen.add(post.id);
            let metrics = {};
            try { metrics = observedMetrics(parseThreadMetrics((await get(`${post.id}/insights`, { metric: METRICS.join(',') })).data), day, now()); }
            catch (error) {
                if (error instanceof CollectionError && (error.blocked || error.code === 'source_deadline')) throw error;
                incomplete = true;
            }
            if (Object.keys(metrics).length !== METRICS.length) incomplete = true;
            const text = `${post.text || ''}\n${post.link_attachment_url || ''}`;
            const links = (text.match(/https?:\/\/[^\s]+/gi) || []).map(extractTracking).filter(link => link.trackingContent);
            const ambiguous = new Set(links.map(link => link.trackingContent)).size > 1;
            result.posts.push({ id: post.id, platform: 'threads', title: String(post.text || 'Threads 글').slice(0, 1000),
                url: typeof post.permalink === 'string' && /^https:\/\/(?:www\.)?threads\.(?:net|com)\//.test(post.permalink) ? post.permalink : '',
                ...ambiguous ? { trackingContent: null, trackingIssue: 'multiple-links' } : extractTracking(text), metrics });
        }
        if (result.posts.some(post => !post.trackingContent)) {
            const replies: OwnReply[] = []; let after: string | undefined; let complete = false; let issue = 'replies-incomplete';
            const cursors = new Set<string>();
            const dates = response.data.map((post: { timestamp?: string }) => Date.parse(post.timestamp || '')).filter(Number.isFinite);
            try {
                for (let page = 0; page < 3; page++) {
                    const response = await get('me/replies', { fields: 'id,text,link_attachment_url,is_reply_owned_by_me,root_post,replied_to', limit: '50',
                        ...(dates.length ? { since: String(Math.floor(Math.min(...dates) / 1000)) } : {}), ...(after ? { after } : {}) });
                    if (response.data.length > 50) throw new CollectionError('invalid_reply_page');
                    replies.push(...response.data);
                    if (!response.paging?.next) { complete = true; break; }
                    after = response.paging.cursors?.after;
                    if (!after || cursors.has(after)) break;
                    cursors.add(after);
                }
            } catch (error) { issue = safeReason(error); }
            if (!complete) incomplete = true;
            const connected = connectOwnReplyTracking(result.posts.map(post => ({ ...post, shareCode: null, trackingContent: post.trackingContent || null })), replies, complete, issue);
            result.posts = connectVerifiedPostLinks(connected.map((post, index) => ({ ...post, permalink: post.url,
                ...(result.posts[index].trackingIssue === 'multiple-links' ? { trackingContent: null, trackingIssue: 'multiple-links' } : {}) })));
        }
        deadline.check();
        result.outcome = incomplete ? 'partial' : 'success'; result.reason = incomplete ? 'metrics_or_replies_incomplete' : 'recent30';
    } catch (error) { result.outcome = result.posts.length ? 'partial' : 'failed'; result.reason = safeReason(error); }
    const usage = new Map<string, number>();
    for (const post of result.posts) if (post.trackingContent) usage.set(post.trackingContent, (usage.get(post.trackingContent) || 0) + 1);
    result.posts = result.posts.map((post): PromotionPost => ({ ...post, shared: Boolean(post.trackingContent && (usage.get(post.trackingContent) || 0) > 1) }));
    result.observedAt = now(); return result;
}
