import { buildAdminCrawlRounds } from './admin-crawl-rounds';
import { recentSlotTimes } from './admin-source-slots';

export interface CrawlTurnoverFlight {
    id: string;
    airline: string;
    route: string;
    departureDate: string;
    returnDate: string;
    price: number;
}

export interface CrawlHistoryEntry {
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
    onlinetour: '온라인투어', ttang: '땡처리닷컴', myrealtrip: '마이리얼트립',
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
    const runs: CollectionRun[] = buildAdminCrawlRounds(history, sources).map(round => ({
        id: `general-${round.slotAt}`, timestamp: round.timestamp, slotAt: round.slotAt,
        title: '일반 여행사 수집', sites: round.sites, alerts: round.alerts,
    }));
    for (const entry of history) {
        const stat = entry.sites.myrealtrip;
        // Old general runs sometimes contain an unchanged MRT cache without an actual attempt.
        if (!stat || stat.skipReason === 'not-requested' || (stat.scraped === undefined && !stat.preserved && !stat.skipped && !stat.manual)) continue;
        runs.push({ id: `mrt-${entry.timestamp}`, timestamp: entry.timestamp, title: '마이리얼트립 수집', sites: { myrealtrip: stat }, alerts: entry.alerts });
    }
    if (active && Number.isFinite(Date.parse(active.startedAt))) {
        const slot = new Date(recentSlotTimes(Date.parse(active.startedAt), 1)[0]).toISOString();
        const matching = runs.find(run => run.slotAt === slot);
        if (matching) { matching.active = active; matching.timestamp = active.startedAt; }
        else runs.push({ id: `general-${slot}`, slotAt: slot, timestamp: active.startedAt, title: '일반 여행사 수집', sites: {}, alerts: [], active });
    }
    for (const entry of naver) runs.push({ id: `naver-${entry.id}`, timestamp: entry.timestamp, title: '네이버 가격 확인', sites: {}, alerts: [], naver: entry });
    return runs.filter(run => Number.isFinite(Date.parse(run.timestamp))).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}
