export interface CrawlCacheSafetyInput<TCache extends Record<string, any>> {
    previous: TCache;
    sourceCircuits: Record<string, unknown>;
    staleStreak: Record<string, number>;
    scrapedCounts: Record<string, number>;
    integrityAlerts: string[];
    fullCrawlCompletedAt?: string;
}

/**
 * 전체 결과를 폐기해 이전 항공권을 유지하더라도 차단 회로와 실패 메타데이터는 잃지 않는다.
 * 실제 항공권과 데이터 timestamp는 이전 값을 유지하고, 예약 회차 완료 표식만 별도로 갱신한다.
 */
export function preserveCrawlCacheWithSafetyState<TCache extends Record<string, any>>(
    input: CrawlCacheSafetyInput<TCache>,
): TCache {
    return {
        ...input.previous,
        ...(input.fullCrawlCompletedAt ? { fullCrawlUpdatedAt: input.fullCrawlCompletedAt } : {}),
        staleStreak: input.staleStreak,
        scrapedCounts: {
            ...(input.previous.scrapedCounts || {}),
            ...input.scrapedCounts,
        },
        integrityAlerts: input.integrityAlerts,
        sourceCircuits: input.sourceCircuits,
    };
}
