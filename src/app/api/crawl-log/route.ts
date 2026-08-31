import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getComparisonFreshness } from '@/lib/price-quality';
import { getUsableNaverComparison, type NaverComparisonEntry } from '@/lib/naver-comparison';
import type { NaverCrawlHistoryEntry } from '@/lib/utils/naver-crawl-history';
import { getCrawlScheduleHealth, getFullCrawlUpdatedAt } from '@/lib/crawl-schedule-health.mjs';

const CACHE_FILE_PATH = path.join(process.cwd(), 'data', 'all-flights-cache.json');
// 저장소가 공개라 코드에 박아 둔 기본값은 그대로 공개 열쇠가 된다.
// 환경변수가 없으면 조용히 열리는 대신 인증을 전부 거부한다.
const ADMIN_KEY = process.env.ADMIN_KEY;

interface Flight {
    id: string;
    source: string;
    airline: string;
    departure: { city: string; airport: string; date: string };
    arrival: { city: string; airport: string; date: string };
    price: number;
    currency: string;
    seats: string;
    region: string;
}

// 항공사명 정규화 맵 (flights/route.ts와 동일)
const AIRLINE_NAME_MAP: Record<string, string> = {
    '베트남 항공': '베트남항공',
    '비엣젯 항공': '비엣젯항공',
    '아시아나 항공': '아시아나항공',
    '에미레이트 항공': '에미레이트항공',
    '에어로케이항공': '에어로케이',
    '중화 항공': '중화항공',
    '타이 비엣젯 항공': '타이비엣젯항공',
    '타이 비엣젯항공': '타이비엣젯항공',
    '터키 항공': '터키항공',
    '티웨이 항공': '티웨이항공',
    '필리핀 항공': '필리핀항공',
    '에티하드 항공': '에티하드항공',
    '투르크메니스탄 항공': '투르크메니스탄항공',
    'Airasia': '에어아시아',
    'ANA항공': 'ANA',
    '홍콩에어': '홍콩항공',
};

function normalizeAirline(name: string): string {
    if (!name) return name;
    const trimmed = name.trim();
    return AIRLINE_NAME_MAP[trimmed] || trimmed;
}

export async function GET(request: NextRequest) {
    const key = request.nextUrl.searchParams.get('key');

    if (!ADMIN_KEY || key !== ADMIN_KEY) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        if (!fs.existsSync(CACHE_FILE_PATH)) {
            return NextResponse.json({ error: 'Cache file not found' }, { status: 404 });
        }

        const raw = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
        const cache = JSON.parse(raw);
        const flights: Flight[] = cache.flights || [];
        const timestamp = cache.timestamp || new Date().toISOString();

        // 소스별 통계
        const bySource: Record<string, number> = {};
        const byRegion: Record<string, number> = {};
        const byCity: Record<string, number> = {};
        const byAirline: Record<string, number> = {};
        const byDepartureCity: Record<string, number> = {};
        const priceBySource: Record<string, number[]> = {};
        const priceByRegion: Record<string, { min: number; max: number; avg: number; count: number }> = {};

        for (const f of flights) {
            // 소스별
            bySource[f.source] = (bySource[f.source] || 0) + 1;

            // 지역별
            const region = f.region || '기타';
            byRegion[region] = (byRegion[region] || 0) + 1;

            // 도착 도시별
            const city = f.arrival?.city || '알 수 없음';
            byCity[city] = (byCity[city] || 0) + 1;

            // 항공사별
            const airline = normalizeAirline(f.airline || '알 수 없음');
            byAirline[airline] = (byAirline[airline] || 0) + 1;

            // 출발 도시별
            const depCity = f.departure?.city || '알 수 없음';
            byDepartureCity[depCity] = (byDepartureCity[depCity] || 0) + 1;

            // 소스별 가격 분포
            if (!priceBySource[f.source]) priceBySource[f.source] = [];
            priceBySource[f.source].push(f.price);

            // 지역별 가격 통계
            if (!priceByRegion[region]) {
                priceByRegion[region] = { min: f.price, max: f.price, avg: 0, count: 0 };
            }
            const rp = priceByRegion[region];
            rp.min = Math.min(rp.min, f.price);
            rp.max = Math.max(rp.max, f.price);
            rp.avg = ((rp.avg * rp.count) + f.price) / (rp.count + 1);
            rp.count += 1;
        }

        // 소스별 평균 가격
        const avgPriceBySource: Record<string, number> = {};
        for (const [source, prices] of Object.entries(priceBySource)) {
            avgPriceBySource[source] = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
        }

        // 최저가 TOP 10
        const cheapest = [...flights]
            .sort((a, b) => a.price - b.price)
            .slice(0, 10)
            .map(f => ({
                route: `${f.departure.city} → ${f.arrival.city}`,
                airline: f.airline,
                price: f.price,
                date: f.departure.date,
                source: f.source,
            }));

        // 크롤링 히스토리 로드
        let crawlHistory: Array<{
            timestamp: string;
            sites: Record<string, { total: number; scraped?: number; preserved?: boolean; skipped?: boolean; manual?: boolean; added?: number; removed?: number }>;
            alerts: string[];
        }> = [];
        try {
            const logPath = path.join(process.cwd(), 'data', 'crawl-log.json');
            if (fs.existsSync(logPath)) {
                const logData = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
                // 하루 4회 기준 30일치를 넉넉히 담는다. 7일이 지난 기록은 로거가
                // 도시·지역 상세를 제거하므로 장기 보관해도 파일이 크게 불어나지 않는다.
                crawlHistory = (logData.entries || []).slice(-200);
            }
        } catch { }

        // 네이버 비교가 갱신 상태 — 로컬 PC 예약 작업이 조용히 멈춰도 알아채기 위한 지표.
        // 화면과 동일하게 24시간 이내이며 최신 시도가 정상 빈 결과/노선 오류가 아닌 값만 센다.
        let naverStatus: {
            lastCrawledAt: string | null;
            lastAttemptAt: string | null;
            ageDays: number | null;
            freshEntries: number;
            pricedEntries: number;
            expiredEntries: number;
            failedEntries: number;
            neverCheckedEntries: number;
            totalEntries: number;
        } | null = null;
        try {
            const naverPath = path.join(process.cwd(), 'data', 'naver-prices.json');
            if (fs.existsSync(naverPath)) {
                const naverData = JSON.parse(fs.readFileSync(naverPath, 'utf-8')) as Record<string, NaverComparisonEntry & {
                    lastAttemptAt?: string;
                    firstQueuedAt?: string;
                }>;
                const entries = Object.values(naverData);
                let lastCrawledAt: string | null = null;
                let lastAttemptAt: string | null = null;
                let freshEntries = 0;
                let pricedEntries = 0;
                let expiredEntries = 0;
                let failedEntries = 0;
                let neverCheckedEntries = 0;
                for (const entry of entries) {
                    const price = Number(entry.naverLowest);
                    const hasSuccessfulPrice = Number.isFinite(price) && price > 0 && Boolean(entry.crawledAt);
                    if (hasSuccessfulPrice) {
                        pricedEntries += 1;
                        if (!getComparisonFreshness(entry.crawledAt).usable) expiredEntries += 1;
                    } else {
                        neverCheckedEntries += 1;
                    }
                    if (entry.lastAttemptStatus && entry.lastAttemptStatus !== 'success') failedEntries += 1;
                    const attemptedAt = entry.lastAttemptAt || entry.crawledAt;
                    if (attemptedAt && (!lastAttemptAt || attemptedAt > lastAttemptAt)) lastAttemptAt = attemptedAt;

                    const comparison = getUsableNaverComparison(entry);
                    if (!comparison) continue;
                    freshEntries += 1;
                    if (!lastCrawledAt || comparison.checkedAt > lastCrawledAt) {
                        lastCrawledAt = comparison.checkedAt;
                    }
                }
                naverStatus = {
                    lastCrawledAt,
                    lastAttemptAt,
                    ageDays: getComparisonFreshness(lastCrawledAt ?? undefined).ageDays,
                    freshEntries,
                    pricedEntries,
                    expiredEntries,
                    failedEntries,
                    neverCheckedEntries,
                    totalEntries: entries.length,
                };
            }
        } catch { }

        // 부분 소스 복구도 cache.timestamp를 바꿀 수 있으므로, 전체 일반 여행사를
        // 실제로 시도한 완료 표식만 예약 회차 상태에 사용한다.
        const crawlScheduleHealth = getCrawlScheduleHealth(getFullCrawlUpdatedAt(cache));

        let naverCrawlHistory: NaverCrawlHistoryEntry[] = [];
        try {
            const historyPath = path.join(process.cwd(), 'data', 'naver-crawl-history.json');
            if (fs.existsSync(historyPath)) {
                const parsed = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
                if (Array.isArray(parsed?.entries)) {
                    // 하루 여러 회차가 쌓여도 60일 기록은 충분히 볼 수 있도록 넉넉히 반환한다.
                    naverCrawlHistory = parsed.entries.slice(-180);
                }
            }
        } catch { }

        // 하루 한 번 여행사별 대표 링크를 확인한 결과. 땡처리닷컴은 GitHub 요청 차단을
        // 유발하지 않도록 외부 접속 없이 최신 정상 크롤 증거와 예약 URL 구조만 확인한다.
        let bookingLinkHealth: Record<string, unknown> | null = null;
        try {
            const healthPath = path.join(process.cwd(), 'data', 'booking-link-health.json');
            if (fs.existsSync(healthPath)) {
                const parsed = JSON.parse(fs.readFileSync(healthPath, 'utf-8'));
                if (parsed && Array.isArray(parsed.entries)) bookingLinkHealth = parsed;
            }
        } catch { }

        return NextResponse.json({
            timestamp,
            totalFlights: flights.length,
            // 여행사별 마지막 성공 갱신 시각과 연속 실패 횟수. 무결성 가드가 새 결과를 폐기하면
            // sourceUpdatedAt이 멈추므로, 어느 여행사가 며칠째 굳어 있는지 여기서 드러난다.
            sourceUpdatedAt: (cache.sourceUpdatedAt || {}) as Record<string, string>,
            staleStreak: (cache.staleStreak || {}) as Record<string, number>,
            sourceCircuits: (cache.sourceCircuits || {}) as Record<string, {
                reason: 'blocked' | 'rate_limited';
                openedAt: string;
                nextProbeAt: string;
                resumePolicy: 'cooldown_or_adapter_change';
                adapterVersion: string;
                status?: number;
                detail: string;
                localFallback?: {
                    status: 'success' | 'blocked' | 'failed';
                    lastAttemptAt: string;
                    nextProbeAt?: string;
                    detail: string;
                };
            }>,
            manualCaptureStatus: (cache.manualCaptureStatus || {}) as Record<string, {
                capturedAt: string;
                lastImportedAt: string;
                accepted: number;
                review: number;
                filtered: number;
                completeRegions?: string[];
                emptyRegions?: string[];
                excludedRegions?: string[];
                naverPending?: boolean;
                naverPendingAt?: string;
                naverLastAttemptAt?: string;
                naverProcessedAt?: string;
                naverDeferred?: number;
            }>,
            naverStatus,
            naverCrawlHistory,
            bookingLinkHealth,
            bySource,
            byRegion,
            byCity,
            byAirline,
            byDepartureCity,
            avgPriceBySource,
            priceByRegion,
            cheapest,
            crawlHistory,
            crawlScheduleHealth,
        });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to read cache data' }, { status: 500 });
    }
}
