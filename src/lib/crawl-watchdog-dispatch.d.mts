export interface GitHubWorkflowRunSummary {
    id?: number;
    status?: string;
    event?: string;
    created_at?: string;
    display_title?: string;
    html_url?: string;
}

export interface CrawlDispatchBlocker {
    reason: 'active_run' | 'recent_fallback';
    runId: number | null;
    runUrl: string | null;
}

export interface CrawlDispatchBlockerOptions {
    now?: string | number | Date;
    cooldownMinutes?: number;
}

export const CRAWL_FALLBACK_COOLDOWN_MINUTES: number;
export function getCrawlDispatchBlocker(
    runs: GitHubWorkflowRunSummary[],
    expectedAt: string,
    options?: CrawlDispatchBlockerOptions,
): CrawlDispatchBlocker | null;
