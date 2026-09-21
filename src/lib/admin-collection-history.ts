
export interface CrawlTurnoverFlight {
    id: string;
    airline: string;
    route: string;
    departureDate: string;
    returnDate: string;
    price: number;
}

export interface CrawlHistoryEntry {
    sessionId?: string;
    timestamp: string;
    runKind?: 'pc_fallback' | 'pc_primary' | 'github_fallback';
    sites: Record<string, { total: number; scraped?: number; partial?: boolean; detail?: string; preserved?: boolean; skipped?: boolean; skippedUntil?: string; skipReason?: 'schedule' | 'circuit' | 'not-requested'; manual?: boolean; localFallback?: boolean; added?: number; removed?: number; addedFlights?: CrawlTurnoverFlight[]; removedFlights?: CrawlTurnoverFlight[] }>;
    alerts: string[];
}

export type ActiveCollectionRun = {
        id: number;
        title: string;
        status: string;
        stage: 'queued' | 'preparing' | 'crawling' | 'publishing';
        event: string;
        startedAt: string;
        updatedAt: string;
        url: string;
        plannedSources: string[];
        skippedSources: string[];
    };
export interface NaverCollectionEntry {
        id: string;
        timestamp: string;
        startedAt?: string;
        durationSeconds?: number;
        runner: 'local' | 'github' | 'manual';
        sourceFilter: string;
        maxFlights: number;
        navigationLimit?: number;
        needed: number;
        attempted: number;
        navigations?: number;
        skippedFresh?: number;
        newRoutes: number;
        newRoutesAttempted: number;
        changedRoutes?: number;
        periodicRoutes?: number;
        reasonCounts?: Record<string, number>;
        priorityGroups?: Record<string, number>;
        selectedPriorityGroups?: Record<string, number>;
        deferred: number;
        deferredNeverChecked: number;
        oldestDeferredHours: number | null;
        success: number;
        misses: number;
        noResult?: number;
        routeErrors?: number;
        transientErrors?: number;
        blocked?: number;
        healthChecks?: number;
        abortedEarly: boolean;
        abortReason?: string;
}

export const COLLECTION_SOURCES: Record<string, string> = {
    ybtour: '노랑풍선', hanatour: '하나투어', modetour: '모두투어',
    onlinetour: '온라인투어', ttang: '땡처리닷컴', myrealtrip: '마이리얼트립', lottetour: '롯데관광', tripcom: '트립닷컴',
};
export type CollectionStat = CrawlHistoryEntry['sites'][string];
export type CollectionRun = {
    id: string; timestamp: string; title: string; slotAt?: string;
    sites: Record<string, CollectionStat>; alerts: string[];
    active?: ActiveCollectionRun; naver?: NaverCollectionEntry;
};
export function collectionStatus(stat: CollectionStat): string {
    if (stat.preserved) return '실패 · 이전 표 유지';
    if (stat.skipped) return stat.skipReason === 'schedule' ? '일정상 휴식' : '요청 중단 · 이전 표 유지';
    if (stat.partial) return '일부 반영 · 이전 표 유지';
    if (stat.manual) return '수동 반영';
    return '완료';
}
export function collectionChange(stat: CollectionStat): number | null {
    if (stat.preserved || stat.skipped || stat.added === undefined || stat.removed === undefined) return null;
    return stat.added - stat.removed;
}
export function buildCollectionHistory(history: readonly CrawlHistoryEntry[], naver: readonly NaverCollectionEntry[], active?: ActiveCollectionRun | null): CollectionRun[] {
    const sources = Object.keys(COLLECTION_SOURCES).filter(source => source !== 'myrealtrip');
    const runs: CollectionRun[] = [];
    for (let index = 0; index < history.length; index += 1) {
        const entry = history[index];
        const sites = Object.fromEntries(sources.filter(source => entry.sites[source]
            && entry.sites[source].skipReason !== 'not-requested').map(source => [source, entry.sites[source]]));
        if (Object.keys(sites).length) runs.push({
            id: `general-${entry.sessionId || entry.timestamp}-${index}`, timestamp: entry.timestamp,
            title: entry.runKind === 'pc_fallback' ? '일반 여행사 PC 대체 수집'
                : entry.runKind === 'pc_primary' ? '일반 여행사 PC 수집' : '일반 여행사 수집',
            sites, alerts: entry.alerts,
        });
        const stat = entry.sites.myrealtrip;
        // Old general runs sometimes contain an unchanged MRT cache without an actual attempt.
        if (!stat || stat.skipReason === 'not-requested' || (stat.scraped === undefined && !stat.preserved && !stat.skipped && !stat.manual)) continue;
        runs.push({ id: `mrt-${entry.timestamp}`, timestamp: entry.timestamp, title: '마이리얼트립 수집', sites: { myrealtrip: stat }, alerts: entry.alerts });
    }
    if (active && Number.isFinite(Date.parse(active.startedAt))) {
        // A shared scheduled slot does not prove two events belong to the same execution.
        runs.push({ id: `active-${active.id}`, timestamp: active.startedAt, title: '일반 여행사 수집', sites: {}, alerts: [], active });
    }
    for (const entry of naver) runs.push({ id: `naver-${entry.id}`, timestamp: entry.timestamp, title: '네이버 가격 확인', sites: {}, alerts: [], naver: entry });
    return runs.filter(run => Number.isFinite(Date.parse(run.timestamp))).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}
