// 노랑풍선만 크롤링 → 기존 캐시의 ybtour 데이터만 교체
import { scrapeYbtour } from '../src/lib/scrapers/ybtour';
import fs from 'fs';
import path from 'path';

async function main() {
    var start = Date.now();
    console.log('=== 노랑풍선 크롤링 시작 ===');

    try {
        var ybtourFlights = await scrapeYbtour();
        console.log('수집 완료: ' + ybtourFlights.length + '건 (' + ((Date.now() - start) / 1000).toFixed(1) + '초)');

        if (ybtourFlights.length === 0) {
            console.log('ERROR: 수집된 항공권이 0건입니다. 캐시를 업데이트하지 않습니다.');
            return;
        }

        // 기존 캐시 읽기
        var cachePath = path.join(process.cwd(), 'data', 'all-flights-cache.json');
        console.log('캐시 파일: ' + cachePath);

        var existing = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        console.log('기존 캐시: 총 ' + existing.count + '건, ybtour: ' + (existing.sources?.ybtour || 0) + '건');

        // ybtour 제외한 기존 데이터 보존
        var others = existing.flights.filter(function (f: any) { return f.source !== 'ybtour'; });
        console.log('다른 업체 데이터: ' + others.length + '건 보존');

        // 합치기
        var allFlights = [...others, ...ybtourFlights];

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
                ybtour: ybtourFlights.length,
            },
        };

        fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), 'utf-8');
        console.log('=== 완료! 총 ' + filteredFlights.length + '건 (ybtour: ' + ybtourFlights.length + ') ===');
        console.log('소요 시간: ' + ((Date.now() - start) / 1000).toFixed(1) + '초');
    } catch (error) {
        console.error('=== 크롤링 에러 ===');
        console.error(error);
    }
}

main();
