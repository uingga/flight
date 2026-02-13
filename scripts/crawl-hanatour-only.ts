// 하나투어만 크롤링 → 기존 캐시의 hanatour 데이터만 교체
import { scrapeHanatour } from '../src/lib/scrapers/hanatour';
import fs from 'fs';
import path from 'path';

async function main() {
    var start = Date.now();
    console.log('=== 하나투어 크롤링 시작 ===');

    try {
        var hanatourFlights = await scrapeHanatour();
        console.log('수집 완료: ' + hanatourFlights.length + '건 (' + ((Date.now() - start) / 1000).toFixed(1) + '초)');

        // 기존 캐시 읽기
        var cachePath = path.join(process.cwd(), 'data', 'all-flights-cache.json');
        var existing = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        console.log('기존 캐시: 총 ' + existing.count + '건, hanatour: ' + (existing.sources?.hanatour || 0) + '건');

        // hanatour 제외한 기존 데이터 보존
        var others = existing.flights.filter(function (f: any) { return f.source !== 'hanatour'; });

        // 합치기
        var allFlights = [...others, ...hanatourFlights];

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
                hanatour: hanatourFlights.length,
            },
        };

        fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), 'utf-8');
        console.log('=== 완료! 총 ' + filteredFlights.length + '건 (hanatour: ' + hanatourFlights.length + ') ===');
        console.log('소요 시간: ' + ((Date.now() - start) / 1000).toFixed(1) + '초');
    } catch (error) {
        console.error('=== 크롤링 에러 ===');
        console.error(error);
    }
}

main();
