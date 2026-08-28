import 'server-only';

const THREADS_API_BASE = 'https://graph.threads.net/v1.0';
const POST_FIELDS = 'id,text,timestamp,permalink,media_type,shortcode,is_quote_post';
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
}

export class ThreadsApiError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly code?: number,
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
    url.searchParams.set('access_token', accessToken);

    const response = await fetch(url, { cache: 'no-store' });
    const json = await response.json() as T;
    if (!response.ok || json.error) {
        const detail = json.error?.message || `Threads API request failed (${response.status})`;
        throw new ThreadsApiError(detail, response.status, json.error?.code);
    }
    return json;
}

function insightValue(insight: ThreadsInsight | undefined): number {
    if (!insight) return 0;
    if (typeof insight.total_value === 'number') return insight.total_value;
    if (insight.total_value && typeof insight.total_value.value === 'number') return insight.total_value.value;
    return (insight.values || []).reduce((sum, item) => sum + (Number(item.value) || 0), 0);
}

function extractTracking(text: string): { trackingContent: string | null; shareCode: string | null } {
    const urlMatch = text.match(/https?:\/\/(?:www\.)?tikitikit\.kr\/(?:s|t)\/([^\s?#]+)/i);
    if (!urlMatch) return { trackingContent: null, shareCode: null };

    const shareCode = decodeURIComponent(urlMatch[1]);
    const fullUrlMatch = text.match(/https?:\/\/(?:www\.)?tikitikit\.kr\/(?:s|t)\/[^\s]+/i)?.[0];
    if (fullUrlMatch) {
        try {
            const content = new URL(fullUrlMatch).searchParams.get('utm_content');
            if (content) return { trackingContent: content, shareCode };
        } catch {
            // 줄바꿈이나 문장부호가 URL 끝에 붙어도 공유 코드만으로 추적할 수 있다.
        }
    }
    return { trackingContent: `share_${shareCode}`, shareCode };
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
    const tracking = extractTracking(post.text || '');

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
            const tracking = extractTracking(post.text || '');
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
    return results.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}
