import { NextRequest, NextResponse } from 'next/server';
import { dim, ga4Config, num, runReport, type ReportResponse } from '@/lib/ga4';
import {
    getThreadsPostInsights,
    hasThreadsInsightsConfig,
    ThreadsApiError,
    type ThreadsPostInsight,
} from '@/lib/server/threads-insights';

const ADMIN_KEY = process.env.ADMIN_KEY;
const CACHE_TTL_MS = 10 * 60 * 1000;

interface AttributionRow {
    content: string;
    sessions: number;
    users: number;
    detailOpens: number;
    detailUsers: number;
    bookingClicks: number;
    bookingUsers: number;
}

interface CachedPayload {
    at: number;
    body: unknown;
}

let cache: CachedPayload | null = null;

const threadsSourceFilter = {
    filter: {
        fieldName: 'sessionSource',
        stringFilter: { value: 'threads', matchType: 'EXACT', caseSensitive: false },
    },
};

async function getAttribution(): Promise<{ available: boolean; rows: AttributionRow[]; message?: string }> {
    const config = ga4Config();
    if (!config) return { available: false, rows: [], message: 'GA4 연결 정보가 없어 사이트 이동은 표시할 수 없습니다.' };

    try {
        const [traffic, events] = await Promise.all([
            runReport(config, {
                dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
                dimensions: [{ name: 'sessionManualAdContent' }],
                metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
                dimensionFilter: threadsSourceFilter,
                orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
                limit: 100,
            }),
            runReport(config, {
                dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
                dimensions: [{ name: 'sessionManualAdContent' }, { name: 'eventName' }],
                metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
                dimensionFilter: {
                    andGroup: {
                        expressions: [
                            threadsSourceFilter,
                            {
                                orGroup: {
                                    expressions: ['detail_open', 'booking_click'].map(value => ({
                                        filter: {
                                            fieldName: 'eventName',
                                            stringFilter: { value, matchType: 'EXACT', caseSensitive: false },
                                        },
                                    })),
                                },
                            },
                        ],
                    },
                },
                limit: 200,
            }),
        ]);

        const rows = new Map<string, AttributionRow>();
        const ensure = (content: string) => {
            const key = content || '(not set)';
            const existing = rows.get(key);
            if (existing) return existing;
            const created: AttributionRow = {
                content: key,
                sessions: 0,
                users: 0,
                detailOpens: 0,
                detailUsers: 0,
                bookingClicks: 0,
                bookingUsers: 0,
            };
            rows.set(key, created);
            return created;
        };

        (traffic.rows || []).forEach(row => {
            const target = ensure(dim(row));
            target.sessions += num(row, 0);
            target.users += num(row, 1);
        });
        (events.rows || []).forEach(row => {
            const target = ensure(dim(row));
            const eventName = dim(row, 1);
            if (eventName === 'detail_open') {
                target.detailOpens += num(row, 0);
                target.detailUsers += num(row, 1);
            }
            if (eventName === 'booking_click') {
                target.bookingClicks += num(row, 0);
                target.bookingUsers += num(row, 1);
            }
        });

        return {
            available: true,
            rows: Array.from(rows.values()).sort((a, b) => b.sessions - a.sessions),
        };
    } catch (error) {
        console.error('Threads attribution report failed:', error);
        return { available: false, rows: [], message: 'Threads 유입의 사이트 이동 통계를 불러오지 못했습니다.' };
    }
}

function sumAttribution(rows: AttributionRow[]): Omit<AttributionRow, 'content'> {
    return rows.reduce((sum, row) => ({
        sessions: sum.sessions + row.sessions,
        users: sum.users + row.users,
        detailOpens: sum.detailOpens + row.detailOpens,
        detailUsers: sum.detailUsers + row.detailUsers,
        bookingClicks: sum.bookingClicks + row.bookingClicks,
        bookingUsers: sum.bookingUsers + row.bookingUsers,
    }), { sessions: 0, users: 0, detailOpens: 0, detailUsers: 0, bookingClicks: 0, bookingUsers: 0 });
}

function attachAttribution(posts: ThreadsPostInsight[], rows: AttributionRow[]) {
    const byContent = new Map(rows.map(row => [row.content, row]));
    return posts.map(post => ({
        ...post,
        attribution: post.trackingContent ? byContent.get(post.trackingContent) || null : null,
    }));
}

export async function GET(request: NextRequest) {
    if (!ADMIN_KEY || request.nextUrl.searchParams.get('key') !== ADMIN_KEY) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasThreadsInsightsConfig()) {
        return NextResponse.json({
            available: false,
            message: 'Threads 연결 토큰이 아직 설정되지 않았습니다.',
            generatedAt: new Date().toISOString(),
            posts: [],
            attribution: { available: false, rows: [], totals: sumAttribution([]) },
        });
    }
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return NextResponse.json(cache.body);

    try {
        const [posts, attribution] = await Promise.all([getThreadsPostInsights(30), getAttribution()]);
        const body = {
            available: true,
            generatedAt: new Date().toISOString(),
            posts: attachAttribution(posts, attribution.rows),
            attribution: {
                ...attribution,
                totals: sumAttribution(attribution.rows),
            },
        };
        cache = { at: Date.now(), body };
        return NextResponse.json(body);
    } catch (error) {
        console.error('Threads insights failed:', error);
        const status = error instanceof ThreadsApiError && error.status === 401 ? 401 : 502;
        const tokenExpired = error instanceof ThreadsApiError && [190, 102].includes(error.code || 0);
        return NextResponse.json({
            available: false,
            message: tokenExpired
                ? 'Threads 연결 토큰이 만료됐습니다. Meta 개발자 화면에서 토큰을 다시 발급해야 합니다.'
                : 'Threads 인사이트를 불러오지 못했습니다.',
            generatedAt: new Date().toISOString(),
            posts: [],
            attribution: { available: false, rows: [], totals: sumAttribution([]) },
        }, { status });
    }
}
