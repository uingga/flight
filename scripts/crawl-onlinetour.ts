import { scrapeOnlineTour } from '../src/lib/scrapers/onlinetour';
import {
    classifySourceAccessRestriction,
    isSourceCircuitOpen,
    openSourceCircuit,
    SOURCE_ADAPTER_VERSIONS,
} from '../src/lib/source-circuit';
import fs from 'fs';
import path from 'path';

// Redirect console.log/error to file
const logFile = fs.createWriteStream(path.join(process.cwd(), 'data', 'crawl-onlinetour-log.txt'));
const origLog = console.log;
const origError = console.error;
console.log = (...args) => { const msg = args.map(String).join(' '); logFile.write(msg + '\n'); origLog(...args); };
console.error = (...args) => { const msg = args.map(String).join(' '); logFile.write('[ERROR] ' + msg + '\n'); origError(...args); };
console.warn = (...args) => { const msg = args.map(String).join(' '); logFile.write('[WARN] ' + msg + '\n'); };

async function main() {
    console.log('=== 온라인투어 크롤링 시작 ===');
    const start = Date.now();

    // 단독 복구 스크립트도 통합 크롤러와 같은 차단 안전장치를 우회하지 않는다.
    var cachePath = path.join(process.cwd(), 'data', 'all-flights-cache.json');
    var existing = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (isSourceCircuitOpen(existing.sourceCircuits?.onlinetour, SOURCE_ADAPTER_VERSIONS.onlinetour)) {
        console.error(`온라인투어 접근 제한 상태 — ${existing.sourceCircuits.onlinetour.nextProbeAt} 이후에 한 번 재탐색합니다.`);
        logFile.end();
        return;
    }

    let onlinetourFlights;
    try {
        onlinetourFlights = await scrapeOnlineTour();
    } catch (error) {
        const restriction = classifySourceAccessRestriction(error);
        if (restriction) {
            const sourceCircuits = { ...(existing.sourceCircuits || {}) };
            sourceCircuits.onlinetour = openSourceCircuit(
                restriction,
                SOURCE_ADAPTER_VERSIONS.onlinetour,
            );
            fs.writeFileSync(cachePath, JSON.stringify({ ...existing, sourceCircuits }, null, 2), 'utf-8');
            console.error(`온라인투어 접근 제한 감지 — ${sourceCircuits.onlinetour.nextProbeAt}까지 자동 요청을 쉽니다.`);
        }
        throw error;
    }
    console.log('수집 완료: ' + onlinetourFlights.length + '건 (' + ((Date.now() - start) / 1000).toFixed(1) + '초)');

    if (onlinetourFlights.length === 0) {
        console.error('WARNING: 0 flights collected!');
        logFile.end();
        return;
    }

    // 기존 캐시 읽기
    console.log('기존 캐시: 총 ' + existing.count + '건, onlinetour: ' + (existing.sources?.onlinetour || 0) + '건');

    // onlinetour 제외한 기존 데이터 보존
    var others = existing.flights.filter(function (f: any) { return f.source !== 'onlinetour'; });

    // 합치기
    var allFlights = [...others, ...onlinetourFlights];

    // 노선별 최저가 필터링
    var routeMinPrices: Record<string, number> = {};
    allFlights.forEach(function (f: any) {
        var key = f.source + '|' + (f.departure?.city || '') + '|' + (f.arrival?.city || '');
        if (f.price > 0) {
            if (!routeMinPrices[key] || f.price < routeMinPrices[key]) {
                routeMinPrices[key] = f.price;
            }
        }
    });
    var filteredFlights = allFlights.filter(function (f: any) {
        if (f.price <= 0) return false;
        var key = f.source + '|' + (f.departure?.city || '') + '|' + (f.arrival?.city || '');
        return f.price === routeMinPrices[key];
    });
    console.log('최저가 필터: ' + allFlights.length + '건 → ' + filteredFlights.length + '건');

    var sourceCircuits = { ...(existing.sourceCircuits || {}) };
    delete sourceCircuits.onlinetour;
    var cacheData = {
        ...existing,
        timestamp: new Date().toISOString(),
        fullCrawlUpdatedAt: existing.fullCrawlUpdatedAt,
        count: filteredFlights.length,
        flights: filteredFlights,
        sourceUpdatedAt: {
            ...(existing.sourceUpdatedAt || {}),
            onlinetour: new Date().toISOString(),
        },
        staleStreak: {
            ...(existing.staleStreak || {}),
            onlinetour: 0,
        },
        scrapedCounts: {
            ...(existing.scrapedCounts || {}),
            onlinetour: onlinetourFlights.length,
        },
        sourceCircuits,
        sources: {
            ...existing.sources,
            onlinetour: onlinetourFlights.length,
        },
    };

    fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), 'utf-8');
    console.log('=== 완료! 총 ' + filteredFlights.length + '건 (onlinetour: ' + onlinetourFlights.length + ') ===');
    console.log('소요 시간: ' + ((Date.now() - start) / 1000).toFixed(1) + '초');
    logFile.end();
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    logFile.end();
    process.exitCode = 1;
});
