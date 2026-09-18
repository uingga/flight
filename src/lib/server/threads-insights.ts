import 'server-only';
import { connectOwnReplyTracking, extractTracking, type OwnReply } from '@/lib/threads-tracking';
import { connectVerifiedPostLinks } from '@/lib/threads-post-links';

const THREADS_API_BASE = 'https://graph.threads.net/v1.0';
const POST_FIELDS = 'id,text,timestamp,permalink,media_type,shortcode,is_quote_post,link_attachment_url';
const POST_METRICS = ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'] as const;

type PostMetric = typeof POST_METRICS[number];

interface ThreadsApiErrorBody {
    error?: {
        message?: string;
        type?: string;
        code?: number;
    };
}

interface ThreadsMedia {
    id: string;
    text?: string;
    timestamp?: string;
    permalink?: string;
    media_type?: string;
    shortcode?: string;
    is_quote_post?: boolean;
    link_attachment_url?: string;
}

interface ThreadsMediaList extends ThreadsApiErrorBody {
    data?: ThreadsMedia[];
}

interface ThreadsInsightValue {
    value?: number;
}

interface ThreadsInsight {
    name?: string;
    values?: ThreadsInsightValue[];
    total_value?: { value?: number } | number;
}

interface ThreadsInsightList extends ThreadsApiErrorBody {
    data?: ThreadsInsight[];
}

export interface ThreadsPostInsight {
    id: string;
    text: string;
    timestamp: string;
    permalink: string;
    mediaType: string;
    shortcode: string;
    isQuotePost: boolean;
    metrics: Record<PostMetric, number>;
    engagementRate: number | null;
    trackingContent: string | null;
    shareCode: string | null;
    trackingReplyIds?: string[];
    trackingIssue?: string | null;
    trackingSource?: 'verified-link';
    trackingVerifiedReplyUrl?: string;
}

export class ThreadsApiError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly code?: number,
        public readonly unsupportedReplyAttachment = false,
    ) {
        super(message);
        this.name = 'ThreadsApiError';
    }
}

function token(): string | null {
    return process.env.THREADS_ACCESS_TOKEN?.trim() || null;
}

export function hasThreadsInsightsConfig(): boolean {
    return Boolean(token());
}

async function threadsGet<T extends ThreadsApiErrorBody>(path: string, params: Record<string, string>): Promise<T> {
    const accessToken = token();
    if (!accessToken) throw new ThreadsApiError('Threads access token is not configured', 503);

    const url = new URL(`${THREADS_API_BASE}/${path.replace(/^\/+/, '')}`);
    Object.entries(params).forEach(([name, value]) => url.searchParams.set(name, value));
    const response = await fetch(url, { cache: 'no-store',
        headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) });
    const json = await response.json() as T;
    if (!response.ok || json.error) {
        const detail = json.error?.message || `Threads API request failed (${response.status})`;
        throw new ThreadsApiError(detail, response.status, json.error?.code,
            json.error?.code === 100 && /nonexisting field|non.?existing field|unknown field/i.test(detail)
                && /link_attachment_url/.test(detail));
    }
    return json;
}

function insightValue(insight: ThreadsInsight | undefined): number {
    if (!insight) return 0;
    if (typeof insight.total_value === 'number') return insight.total_value;
    if (insight.total_value && typeof insight.total_value.value === 'number') return insight.total_value.value;
    return (insight.values || []).reduce((sum, item) => sum + (Number(item.value) || 0), 0);
}

async function ownReplies(since?: string): Promise<{ replies: OwnReply[]; complete: boolean; issue?: string }> {
    const replies: OwnReply[] = [];
    let after: string | undefined;
    const seenCursors = new Set<string>();
    let includeAttachment = true;
    try {
        // Bounded, cached by the admin API; never fetch replies once per displayed post.
        for (let page = 0; page < 3; page++) {
            let response: ThreadsApiErrorBody & {
                data?: OwnReply[]; paging?: { next?: string; cursors?: { after?: string } };
            };
            try { response = await threadsGet('me/replies', {
                fields: `id,text,${includeAttachment ? 'link_attachment_url,' : ''}is_reply_owned_by_me,root_post,replied_to`,
                limit: '50', ...(since ? { since } : {}), ...(after ? { after } : {}),
            }); } catch (error) {
                // Only a confirmed optional-field rejection permits one compatibility request.
                // It consumes the same three-request budget; auth/rate/network errors never retry.
                if (includeAttachment && error instanceof ThreadsApiError && error.unsupportedReplyAttachment) {
                    includeAttachment = false;
                    continue;
                }
                throw error;
            }
            if (!Array.isArray(response.data)) return { replies, complete: false, issue: 'replies-request-failed' };
            replies.push(...response.data);
            if (!response.paging?.next) return { replies, complete: true };
            after = response.paging.cursors?.after;
            if (!after || seenCursors.has(after)) break;
            seenCursors.add(after);
        }
    } catch (error) {
        // Return only safe diagnostic codes, never Graph error bodies, URLs or tokens.
        const issue = error instanceof ThreadsApiError && [190, 102].includes(error.code || 0)
            ? 'replies-token-expired'
            : error instanceof ThreadsApiError && ([10, 200].includes(error.code || 0) || error.status === 403)
                ? 'replies-permission-denied'
                : error instanceof ThreadsApiError && (error.status === 429 || [4, 17, 32, 613].includes(error.code || 0))
                    ? 'replies-rate-limited'
                    : error instanceof ThreadsApiError && error.code === 100 ? 'replies-invalid-request' : 'replies-request-failed';
        console.warn('Threads replies unavailable', { issue,
            status: error instanceof ThreadsApiError ? error.status : undefined,
            code: error instanceof ThreadsApiError ? error.code : undefined });
        return { replies, complete: false, issue };
    }
    return { replies, complete: false, issue: 'replies-incomplete' };
}

async function postInsights(post: ThreadsMedia): Promise<ThreadsPostInsight> {
    let response: ThreadsInsightList;
    try {
        response = await threadsGet<ThreadsInsightList>(`${post.id}/insights`, {
            metric: POST_METRICS.join(','),
        });
    } catch (error) {
        // 일부 계정/글에서 shares가 아직 열리지 않아도 핵심 5개 지표는 살린다.
        response = await threadsGet<ThreadsInsightList>(`${post.id}/insights`, {
            metric: POST_METRICS.filter(name => name !== 'shares').join(','),
        });
    }
    const metrics = Object.fromEntries(POST_METRICS.map(name => [
        name,
        insightValue((response.data || []).find(item => item.name === name)),
    ])) as Record<PostMetric, number>;
    const interactions = metrics.likes + metrics.replies + metrics.reposts + metrics.quotes + metrics.shares;
    const tracking = extractTracking(`${post.text || ''}\n${post.link_attachment_url || ''}`);

    return {
        id: post.id,
        text: post.text || '',
        timestamp: post.timestamp || '',
        permalink: post.permalink || '',
        mediaType: post.media_type || '',
        shortcode: post.shortcode || '',
        isQuotePost: Boolean(post.is_quote_post),
        metrics,
        engagementRate: metrics.views > 0 ? Number(((interactions / metrics.views) * 100).toFixed(1)) : null,
        ...tracking,
    };
}

export async function getThreadsPostInsights(limit = 30): Promise<ThreadsPostInsight[]> {
    const response = await threadsGet<ThreadsMediaList>('me/threads', {
        fields: POST_FIELDS,
        limit: String(Math.min(Math.max(limit, 1), 50)),
    });

    // 한 글의 인사이트 실패 때문에 전체 화면이 비지 않도록 5개씩 나눠 호출한다.
    const posts = response.data || [];
    const results: ThreadsPostInsight[] = [];
    for (let index = 0; index < posts.length; index += 5) {
        const batch = posts.slice(index, index + 5);
        const settled = await Promise.allSettled(batch.map(postInsights));
        settled.forEach((result, batchIndex) => {
            if (result.status === 'fulfilled') {
                results.push(result.value);
                return;
            }
            const post = batch[batchIndex];
            const tracking = extractTracking(`${post.text || ''}\n${post.link_attachment_url || ''}`);
            results.push({
                id: post.id,
                text: post.text || '',
                timestamp: post.timestamp || '',
                permalink: post.permalink || '',
                mediaType: post.media_type || '',
                shortcode: post.shortcode || '',
                isQuotePost: Boolean(post.is_quote_post),
                metrics: { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0, shares: 0 },
                engagementRate: null,
                ...tracking,
            });
        });
    }
    const sorted = results.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    if (sorted.every(post => post.trackingContent)) return sorted;
    const dates = sorted.map(post => Date.parse(post.timestamp)).filter(Number.isFinite);
    const since = dates.length ? String(Math.floor(Math.min(...dates) / 1000)) : undefined;
    const { replies, complete, issue } = await ownReplies(since);
    return connectVerifiedPostLinks(connectOwnReplyTracking(sorted, replies, complete, issue));
}
