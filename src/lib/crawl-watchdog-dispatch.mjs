export const CRAWL_FALLBACK_COOLDOWN_MINUTES = 45;

function toTimestamp(value) {
    const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * GitHub 실행 목록에서 새 보조 실행 요청을 막아야 할 이유를 찾는다.
 * 실행 중인 전체 크롤이 있거나 같은 회차의 보조 실행을 최근에 요청했다면 중복 요청하지 않는다.
 */
export function getCrawlDispatchBlocker(runs, expectedAt, options = {}) {
    const activeRun = runs.find(run => run?.status && run.status !== 'completed');
    if (activeRun) {
        return {
            reason: 'active_run',
            runId: activeRun.id ?? null,
            runUrl: activeRun.html_url ?? null,
        };
    }

    const nowTimestamp = toTimestamp(options.now ?? Date.now());
    if (nowTimestamp === null) throw new Error('Invalid current time');

    const cooldownMinutes = options.cooldownMinutes ?? CRAWL_FALLBACK_COOLDOWN_MINUTES;
    const cooldownMs = cooldownMinutes * 60_000;
    const recentFallback = runs.find(run => {
        if (run?.event !== 'workflow_dispatch') return false;
        const title = String(run.display_title || '');
        if (!title.includes('watchdog') || !title.includes(expectedAt)) return false;
        const createdAt = toTimestamp(run.created_at);
        return createdAt !== null
            && nowTimestamp >= createdAt
            && nowTimestamp - createdAt < cooldownMs;
    });

    if (recentFallback) {
        return {
            reason: 'recent_fallback',
            runId: recentFallback.id ?? null,
            runUrl: recentFallback.html_url ?? null,
        };
    }

    // 전체 크롤 커밋 뒤 Vercel 배포가 끝나기 전에는 캐시가 잠시 오래된 값으로 보일 수 있다.
    // 같은 cron 회차의 성공한 schedule 실행이 이미 있다면 이 짧은 틈에 보조 실행을 만들지 않는다.
    const expectedTimestamp = toTimestamp(expectedAt);
    const expectedCron = String(options.expectedCron || '').trim();
    const completedScheduledRun = expectedCron && expectedTimestamp !== null
        ? runs.find(run => {
            if (run?.event !== 'schedule' || run?.status !== 'completed' || run?.conclusion !== 'success') {
                return false;
            }
            if (!String(run.display_title || '').includes(expectedCron)) return false;
            const createdAt = toTimestamp(run.created_at);
            return createdAt !== null && createdAt >= expectedTimestamp && createdAt <= nowTimestamp;
        })
        : null;

    if (completedScheduledRun) {
        return {
            reason: 'recent_scheduled_run',
            runId: completedScheduledRun.id ?? null,
            runUrl: completedScheduledRun.html_url ?? null,
        };
    }

    return null;
}
