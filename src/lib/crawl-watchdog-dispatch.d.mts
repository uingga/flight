export interface GitHubWorkflowRunSummary {
    id?: number;
    status?: string;
    conclusion?: string | null;
    event?: string;
    created_at?: string;
    display_title?: string;
    html_url?: string;
}

export interface CrawlDispatchBlocker {
    reason: 'active_run' | 'recent_fallback' | 'recent_scheduled_run';
    runId: number | null;
    runUrl: string | null;
}

export interface CrawlDispatchBlockerOptions {
    now?: string | number | Date;
    cooldownMinutes?: number;
    expectedCron?: string;
}

export const CRAWL_FALLBACK_COOLDOWN_MINUTES: number;
export function getCrawlDispatchBlocker(
    runs: GitHubWorkflowRunSummary[],
    expectedAt: string,
    options?: CrawlDispatchBlockerOptions,
): CrawlDispatchBlocker | null;
