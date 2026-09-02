import * as fs from 'fs';
import * as path from 'path';
import type { NaverSellerProbeSummary } from '../naver-seller-probe';

export interface NaverCrawlHistoryEntry {
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
    transientResumes?: number;
    abortedEarly: boolean;
    abortReason?: string;
    partialResultsPublishable?: boolean;
    sellerProbe?: NaverSellerProbeSummary;
}

interface NaverCrawlHistoryFile {
    entries: NaverCrawlHistoryEntry[];
}

const HISTORY_FILE = path.join(process.cwd(), 'data', 'naver-crawl-history.json');
const RETENTION_DAYS = 60;

/**
 * 빈 대기열 레코드 때문에 0으로 저장된 구버전 이력도 보정한다.
 * 신규 후보 중 실제 시도하지 못한 수는 최소한 신규 수 - 신규 시도 수다.
 */
export function getEffectiveDeferredNeverChecked(
    entry: Pick<NaverCrawlHistoryEntry, 'deferredNeverChecked' | 'newRoutes' | 'newRoutesAttempted'>,
): number {
    const recorded = Math.max(0, Number(entry.deferredNeverChecked) || 0);
    const inferred = Math.max(
        0,
        (Number(entry.newRoutes) || 0) - (Number(entry.newRoutesAttempted) || 0),
    );
    return Math.max(recorded, inferred);
}

export function normalizeNaverCrawlHistoryEntry(
    entry: NaverCrawlHistoryEntry,
): NaverCrawlHistoryEntry {
    return {
        ...entry,
        deferredNeverChecked: getEffectiveDeferredNeverChecked(entry),
    };
}

export function recordNaverCrawlHistory(entry: NaverCrawlHistoryEntry): void {
    let history: NaverCrawlHistoryFile = { entries: [] };
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
            if (Array.isArray(parsed?.entries)) history = parsed;
        }
    } catch {
        console.warn('⚠️ 기존 네이버 크롤 기록을 읽지 못해 새 기록으로 시작합니다.');
    }

    const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
    const byId = new Map<string, NaverCrawlHistoryEntry>();
    for (const item of [...history.entries, entry]) {
        if (!item?.id || new Date(item.timestamp).getTime() < cutoff) continue;
        byId.set(item.id, normalizeNaverCrawlHistoryEntry(item));
    }

    history.entries = Array.from(byId.values())
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
}
