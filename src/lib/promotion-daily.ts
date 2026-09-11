// Shared serializable contract. No credentials or network access in this module.
export type Outcome = 'success' | 'partial' | 'failed' | 'unsupported';
export interface Metric { value: number; observedAt: string; day: string }
export interface PromotionPost {
    id: string; platform: string; title: string; url: string;
    trackingContent?: string | null; trackingIssue?: string | null;
    trackingSource?: string; shared?: boolean;
    metrics: Record<string, Metric>;
}
export interface SourceResult {
    source: string; outcome: Outcome; reason: string; observedAt: string;
    posts: PromotionPost[];
}
export interface SourceLatest extends SourceResult { lastSuccessAt: string | null }
export interface DailyRun {
    day: string; id: string; status: 'running' | 'complete' | 'incomplete';
    started_at: string; finished_at: string | null;
}
export interface DailyHistory {
    runs: DailyRun[];
    sources: { day: string; source: string; payload: SourceResult }[];
    latest: { source: string; payload: SourceLatest }[];
    dispatches?: { day: string; claimed_at: string; status: 'claimed' | 'dispatched' | 'failed' }[];
}
export const PROMOTION_SOURCES = ['threads', 'te31', 'ga4'] as const;
export const METRIC_LABELS: Record<string, string> = {
    views: '조회', likes: '좋아요', replies: '답글', reposts: '재게시', quotes: '인용', shares: '공유',
    comments: '댓글', recommendations: '추천', users: '방문', sessions: '접속',
    detailUsers: '상세 열람', bookingUsers: '예약 이동 인원', bookingClicks: '예약 이동 횟수',
    verifiedUsers: 'Threads 출처 확인 방문',
};
export function kstDay(now = new Date()): string { return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10); }
export function dayBefore(day: string, count = 1): string {
    return new Date(Date.parse(`${day}T00:00:00Z`) - count * 86400_000).toISOString().slice(0, 10);
}
export function validNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
export function observedMetrics(values: Record<string, unknown>, day: string, observedAt: string): Record<string, Metric> {
    return Object.fromEntries(Object.entries(values).filter(([, value]) => validNumber(value))
        .map(([key, value]) => [key, { value: value as number, day, observedAt }]));
}
// Merge at metric granularity, retaining the real observation timestamp on every old cell.
// Older GA4 corrections live in history; they must not replace a more recent daily value.
export function mergeLatest(previous: SourceLatest | undefined, result: SourceResult): SourceLatest {
    const posts = new Map((previous?.posts || []).map(post => [post.id, post]));
    for (const post of result.posts) {
        const old = posts.get(post.id);
        const metrics = { ...old?.metrics };
        for (const [key, metric] of Object.entries(post.metrics)) {
            if (validNumber(metric.value) && (!metrics[key] || metric.day >= metrics[key].day)) metrics[key] = metric;
        }
        posts.set(post.id, { ...post, metrics });
    }
    return { ...result, posts: Array.from(posts.values()), lastSuccessAt: result.outcome === 'success' ? result.observedAt : previous?.lastSuccessAt || null };
}
export function dailyDelta(metric: Metric, postId: string, key: string, source: string, history: DailyHistory['sources']): number | null {
    const previousDay = dayBefore(metric.day);
    // Multiple GA4 corrections: use the latest actual observation for the preceding calendar day.
    const candidates = history.filter(row => row.source === source).flatMap(row => row.payload.posts)
        .filter(post => post.id === postId).map(post => post.metrics[key])
        .filter((cell): cell is Metric => Boolean(cell && cell.day === previousDay))
        .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
    return candidates.length ? metric.value - candidates[0].value : null;
}
