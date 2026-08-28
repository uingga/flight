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

    return null;
}
