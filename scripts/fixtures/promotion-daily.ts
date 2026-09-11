import { mergeLatest, observedMetrics, type DailyHistory, type SourceResult } from '../../src/lib/promotion-daily';
// Entirely synthetic UI data. These numbers are not observations of any live listing or API.
export function promotionFixture(): DailyHistory {
    const make = (day: string, source: string, value: number): SourceResult => ({ source, outcome: 'success', reason: source === 'ga4' ? 'daily_kst_recent3_provisional' : 'recent30', observedAt: `${day}T00:01:00Z`,
        posts: [{ id: source === 'ga4' ? 'te31:fixture' : 'fixture', platform: source === 'threads' ? 'threads' : 'te31', title: '화면 검증용 예시 글 · 운영 수치가 아닙니다', url: '', trackingContent: source === 'threads' ? null : 'fixture_campaign',
            metrics: observedMetrics(source === 'ga4' ? { users: value, bookingClicks: 0 } : { views: value, comments: 0, likes: 0 }, source === 'ga4' ? '2026-09-09' : day, `${day}T00:01:00Z`) }] });
    const before = make('2026-09-10', 'te31', 10); const current = make('2026-09-11', 'te31', 12);
    current.outcome = 'partial'; current.reason = 'registered_posts_or_counts_missing';
    const threads = make('2026-09-11', 'threads', 0); const ga4 = make('2026-09-11', 'ga4', 3);
    return { runs: [{ day: '2026-09-11', id: 'fixture', status: 'incomplete', started_at: '2026-09-11T00:00:00Z', finished_at: '2026-09-11T00:01:00Z' }],
        sources: [before, current, threads, ga4].map(payload => ({ day: payload.observedAt.slice(0, 10), source: payload.source, payload })),
        latest: [{ source: 'te31', payload: mergeLatest(mergeLatest(undefined, before), current) }, { source: 'threads', payload: mergeLatest(undefined, threads) }, { source: 'ga4', payload: mergeLatest(undefined, ga4) }] };
}
