import * as fs from 'fs';
import * as path from 'path';

interface CityStats {
    [cityName: string]: number;
}

interface RegionStats {
    [regionName: string]: CityStats;
}

interface SiteStats {
    /** 이번 크롤이 끝난 뒤 캐시에 실제로 담긴 개수. 보존된 경우 이전 값과 같다. */
    total: number;
    /** 스크래퍼가 이번에 실제로 긁어온 개수. 보존과 수집을 구분하려고 따로 남긴다. */
    scraped?: number;
    /** true면 수집에 실패해 이전 캐시를 그대로 유지한 것이다. */
    preserved?: boolean;
    /** 부분 복구 크롤에서 이 여행사는 실행하지 않았다는 뜻. 실패나 측정값으로 세지 않는다. */
    skipped?: boolean;
    /** 직전 크롤에 없던 표. 개수만 보면 표가 통째로 갈려도 0으로 보인다. */
    added?: number;
    /** 직전 크롤에 있다가 사라진 표. */
    removed?: number;
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
        // 부분 복구 크롤에서 실행하지 않은 여행사는 측정치가 아니다.
        if (current[siteName].skipped) continue;

        // 보존된 값은 측정치가 아니라 직전 캐시를 옮겨 적은 숫자다. 이것을 수집량과
        // 맞비교하면 '2082 → 246 (-88%)' 처럼 실제로는 없었던 감소가 보고된다.
        // 보존 사실 자체는 무결성 가드가 recordCrawlAlerts로 따로 남긴다.
        if (current[siteName].preserved || previous[siteName]?.preserved) continue;

        const currentTotal = current[siteName].scraped ?? current[siteName].total;
        const previousTotal = previous[siteName]?.scraped ?? previous[siteName]?.total ?? 0;

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
 * 무결성 경고를 이번 크롤 엔트리에 직접 기록한다.
 *
 * generateAlerts는 "이번에 저장된 수치"만 비교하는데, 반쪽 결과를 폐기하고 이전
 * 데이터를 유지하면 수치는 그대로라 아무 경고도 남지 않는다. 정작 사람이 알아야 할
 * 사건이 그때 일어나므로 호출부가 직접 남긴다.
 */
export function recordCrawlAlerts(alerts: string[]): void {
    if (alerts.length === 0) return;

    const history = loadLogHistory();
    const now = new Date();
    let currentEntry = history.entries.find(
        e => now.getTime() - new Date(e.timestamp).getTime() < 30 * 60 * 1000,
    );

    if (!currentEntry) {
        currentEntry = { timestamp: now.toISOString(), sites: {}, alerts: [] };
        history.entries.push(currentEntry);
    }

    currentEntry.alerts = Array.from(new Set([...currentEntry.alerts, ...alerts]));
    history.lastEntry = currentEntry;
    saveLogHistory(history);
}

/**
 * 크롤링 결과 로깅
 */
export function logCrawlResults(
    siteName: string,
    total: number,
    byRegion?: RegionStats,
    byCity?: CityStats,
    meta?: { scraped?: number; preserved?: boolean; skipped?: boolean; added?: number; removed?: number },
): void {
    const history = loadLogHistory();

    // 현재 실행의 타임스탬프를 기준으로 새 엔트리 생성 또는
    // 같은 크롤 세션(5분 이내)에서 이미 만들어진 엔트리 업데이트
    const now = new Date();
    let currentEntry = history.entries.find(e => {
        const entryTime = new Date(e.timestamp);
        return (now.getTime() - entryTime.getTime()) < 30 * 60 * 1000; // 30분 이내
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
        scraped: meta?.scraped,
        preserved: meta?.preserved || undefined,
        skipped: meta?.skipped || undefined,
        added: meta?.added,
        removed: meta?.removed,
        byRegion,
        byCity
    };

    // 이전 엔트리와 비교하여 경고 생성
    // 직전 엔트리가 부분 크롤이면 해당 여행사의 마지막 실제 측정치를 더 거슬러 올라가 찾는다.
    // 그렇지 않으면 다음 전체 크롤이 '건너뜀' 값을 기준선으로 삼게 된다.
    const previousMeasuredSites: Record<string, SiteStats> = {};
    for (const siteName of Object.keys(currentEntry.sites)) {
        for (let i = history.entries.length - 2; i >= 0; i--) {
            const candidate = history.entries[i].sites[siteName];
            if (candidate && !candidate.skipped) {
                previousMeasuredSites[siteName] = candidate;
                break;
            }
        }
    }

    const alerts = generateAlerts(currentEntry.sites, previousMeasuredSites);
    // ⚠️ 수치 비교 경고는 매번 다시 계산한다. 앞선 호출에서 임시로 생긴 경고를
    // 계속 합치면 같은 엔트리를 보완해도 이미 해소된 경고가 남는다.
    const explicitAlerts = currentEntry.alerts.filter(
        alert => alert.startsWith('🚨') || alert.startsWith('⚠️ 시간 정보:'),
    );
    currentEntry.alerts = Array.from(new Set([...explicitAlerts, ...alerts]));

    // 경고 출력
    if (alerts.length > 0) {
        console.log('\n🚨 크롤링 경고:');
        alerts.forEach(alert => console.log(`  ${alert}`));
    }

    // 크롤 횟수를 줄일지는 최소 2주 이상 봐야 판단할 수 있다. 회차별 변동 수치는
    // 최근 30일을 온전히 비교할 수 있도록 31일 보관하되, 용량이 큰 도시·지역 상세는 7일이 지나면 걷어낸다.
    const detailCutoff = new Date();
    detailCutoff.setDate(detailCutoff.getDate() - 7);
    const retentionCutoff = new Date();
    retentionCutoff.setDate(retentionCutoff.getDate() - 31);
    history.entries = history.entries
        .filter(e => new Date(e.timestamp) > retentionCutoff)
        .map(entry => {
            if (new Date(entry.timestamp) > detailCutoff) return entry;
            return {
                ...entry,
                sites: Object.fromEntries(Object.entries(entry.sites).map(([site, stats]) => [
                    site,
                    { ...stats, byRegion: undefined, byCity: undefined },
                ])),
            };
        });

    history.lastEntry = currentEntry;
    saveLogHistory(history);

    // 요약 출력
    console.log(`\n📊 ${siteName} 크롤링 로그 저장됨`);
    console.log(meta?.preserved
        ? `   총: ${total}개 (이번 수집 ${meta.scraped ?? 0}개가 실패해 이전 데이터를 유지함)`
        : meta?.skipped
            ? `   총: ${total}개 (부분 크롤에서 실행하지 않음)`
        : `   총: ${total}개`);
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
