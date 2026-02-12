import { scrapeOnlineTour } from '../src/lib/scrapers/onlinetour';
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

    const onlinetourFlights = await scrapeOnlineTour();
    console.log('수집 완료: ' + onlinetourFlights.length + '건 (' + ((Date.now() - start) / 1000).toFixed(1) + '초)');

    if (onlinetourFlights.length === 0) {
        console.error('WARNING: 0 flights collected!');
        logFile.end();
        return;
    }

    // 기존 캐시 읽기
    var cachePath = path.join(process.cwd(), 'data', 'all-flights-cache.json');
    var existing = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
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

    var cacheData = {
        timestamp: new Date().toISOString(),
        count: filteredFlights.length,
        flights: filteredFlights,
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

main();
