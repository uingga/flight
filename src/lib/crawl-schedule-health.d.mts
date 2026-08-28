export type CrawlScheduleStatus = 'healthy' | 'waiting' | 'late' | 'overdue';

export interface CrawlScheduleHealth {
    status: CrawlScheduleStatus;
    expectedAt: string | null;
    expectedCron: string | null;
    lastCompletedAt: string | null;
    delayMinutes: number;
    pendingSlots: number;
    warningMinutes: number;
    fallbackMinutes: number;
}

export interface CrawlScheduleHealthOptions {
    now?: string | number | Date;
    warningMinutes?: number;
    fallbackMinutes?: number;
    crons?: readonly string[];
}

export const DAILY_CRAWL_CRONS: readonly string[];
export const CRAWL_WARNING_MINUTES: number;
export const CRAWL_FALLBACK_MINUTES: number;
export function parseDailyCron(cron: string): { minute: number; hour: number } | null;
export function getScheduledAtForCron(cron: string, now?: string | number | Date): number | null;
export function getCrawlScheduleHealth(
    lastCompletedAt: string | number | Date | null | undefined,
    options?: CrawlScheduleHealthOptions,
): CrawlScheduleHealth;
