import * as fs from 'fs';
import * as path from 'path';

export interface NaverCrawlHistoryEntry {
    id: string;
    timestamp: string;
    runner: 'local' | 'github' | 'manual';
    sourceFilter: string;
    maxFlights: number;
    needed: number;
    attempted: number;
    newRoutes: number;
    newRoutesAttempted: number;
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
}

interface NaverCrawlHistoryFile {
    entries: NaverCrawlHistoryEntry[];
}

const HISTORY_FILE = path.join(process.cwd(), 'data', 'naver-crawl-history.json');
const RETENTION_DAYS = 60;

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
        byId.set(item.id, item);
    }

    history.entries = Array.from(byId.values())
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
}
