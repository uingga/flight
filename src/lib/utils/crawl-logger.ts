import * as fs from 'fs';
import * as path from 'path';

interface CityStats {
    [cityName: string]: number;
}

interface RegionStats {
    [regionName: string]: CityStats;
}

interface SiteStats {
    total: number;
    byRegion?: RegionStats;
    byCity?: CityStats;
}

interface CrawlLogEntry {
    timestamp: string;
    sites: {
        [siteName: string]: SiteStats;
    };
    alerts: string[];
}

interface CrawlLogHistory {
    entries: CrawlLogEntry[];
    lastEntry?: CrawlLogEntry;
}

const LOG_FILE_PATH = path.join(process.cwd(), 'data', 'crawl-log.json');
const ALERT_THRESHOLD = 0.3; // 30% 감소 시 경고

/**
 * 이전 크롤링 로그 로드
 */
function loadLogHistory(): CrawlLogHistory {
    try {
        if (fs.existsSync(LOG_FILE_PATH)) {
            const data = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.log('이전 로그 파일을 읽을 수 없습니다. 새로 생성합니다.');
    }
    return { entries: [] };
}

/**
 * 크롤링 로그 저장
 */
function saveLogHistory(history: CrawlLogHistory): void {
    const dir = path.dirname(LOG_FILE_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(LOG_FILE_PATH, JSON.stringify(history, null, 2), 'utf-8');
}

/**
 * 이전 기록과 비교하여 경고 생성
 */
function generateAlerts(
    current: { [siteName: string]: SiteStats },
    previous?: { [siteName: string]: SiteStats }
): string[] {
    const alerts: string[] = [];

    if (!previous) return alerts;

    for (const siteName of Object.keys(current)) {
        const currentTotal = current[siteName].total;
        const previousTotal = previous[siteName]?.total || 0;

        if (previousTotal > 0) {
            const changeRate = (currentTotal - previousTotal) / previousTotal;

            if (changeRate < -ALERT_THRESHOLD) {
                alerts.push(
                    `⚠️ ${siteName} 총 항공권 감소: ${previousTotal} → ${currentTotal} (${Math.round(changeRate * 100)}%)`
                );
            }
        }

        // 도시별 비교
        const currentCities = current[siteName].byCity || {};
        const previousCities = previous[siteName]?.byCity || {};

        for (const cityName of Object.keys(currentCities)) {
            const currentCount = currentCities[cityName];
            const previousCount = previousCities[cityName] || 0;

            if (previousCount > 10) { // 이전에 10개 이상이었던 도시만 체크
                const cityChangeRate = (currentCount - previousCount) / previousCount;

                if (cityChangeRate < -ALERT_THRESHOLD) {
                    alerts.push(
                        `⚠️ ${siteName} - ${cityName}: ${previousCount} → ${currentCount} (${Math.round(cityChangeRate * 100)}%)`
                    );
                }
            }
        }
    }

    return alerts;
}

/**
 * 크롤링 결과 로깅
 */
export function logCrawlResults(
    siteName: string,
    total: number,
    byRegion?: RegionStats,
    byCity?: CityStats
): void {
    const history = loadLogHistory();

    // 현재 실행의 타임스탬프를 기준으로 새 엔트리 생성 또는
    // 같은 크롤 세션(5분 이내)에서 이미 만들어진 엔트리 업데이트
    const now = new Date();
    let currentEntry = history.entries.find(e => {
        const entryTime = new Date(e.timestamp);
        return (now.getTime() - entryTime.getTime()) < 5 * 60 * 1000; // 5분 이내
    });

    if (!currentEntry) {
        currentEntry = {
            timestamp: now.toISOString(),
            sites: {},
            alerts: []
        };
        history.entries.push(currentEntry);
    }

    // 사이트 통계 저장
    currentEntry.sites[siteName] = {
        total,
        byRegion,
        byCity
    };

    // 이전 엔트리와 비교하여 경고 생성
    const previousEntry = history.entries.length > 1
        ? history.entries[history.entries.length - 2]
        : undefined;

    const alerts = generateAlerts(currentEntry.sites, previousEntry?.sites);
    currentEntry.alerts = Array.from(new Set([...currentEntry.alerts, ...alerts]));

    // 경고 출력
    if (alerts.length > 0) {
        console.log('\n🚨 크롤링 경고:');
        alerts.forEach(alert => console.log(`  ${alert}`));
    }

    // 최근 30일 로그만 유지
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    history.entries = history.entries.filter(
        e => new Date(e.timestamp) > thirtyDaysAgo
    );

    history.lastEntry = currentEntry;
    saveLogHistory(history);

    // 요약 출력
    console.log(`\n📊 ${siteName} 크롤링 로그 저장됨`);
    console.log(`   총: ${total}개`);
    if (byCity) {
        const topCities = Object.entries(byCity)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        console.log(`   상위 도시: ${topCities.map(([city, count]) => `${city}(${count})`).join(', ')}`);
    }
}

/**
 * 크롤링 요약 출력
 */
export function printCrawlSummary(): void {
    const history = loadLogHistory();

    if (!history.lastEntry) {
        console.log('저장된 크롤링 로그가 없습니다.');
        return;
    }

    console.log('\n═══════════════════════════════════════');
    console.log('📋 마지막 크롤링 요약');
    console.log(`⏰ ${history.lastEntry.timestamp}`);
    console.log('═══════════════════════════════════════');

    for (const [site, stats] of Object.entries(history.lastEntry.sites)) {
        console.log(`\n🏢 ${site}: ${stats.total}개`);

        if (stats.byRegion) {
            for (const [region, cities] of Object.entries(stats.byRegion)) {
                const regionTotal = Object.values(cities).reduce((a, b) => a + b, 0);
                console.log(`   📍 ${region}: ${regionTotal}개`);
            }
        }
    }

    if (history.lastEntry.alerts.length > 0) {
        console.log('\n🚨 경고:');
        history.lastEntry.alerts.forEach(alert => console.log(`   ${alert}`));
    }

    console.log('═══════════════════════════════════════\n');
}
