import {
    scrapeInterparkBenchmark,
    resolveCityCode,
    resolveInterparkOriginCityCode,
    type InterparkRouteTarget,
} from '../src/lib/scrapers/interpark';
import fs from 'fs';
import path from 'path';

async function main() {
    const cachePath = path.resolve(process.cwd(), 'data/all-flights-cache.json');
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));

    const routeTargets = new Map<string, InterparkRouteTarget>();
    cache.flights.forEach((f: any) => {
        const originCity = resolveInterparkOriginCityCode(f.departure?.city, f.departure?.airport);
        const destinationCity = resolveCityCode(f.arrival?.city || '', f.arrival?.airport);
        if (originCity && destinationCity) {
            routeTargets.set(`${originCity}|${destinationCity}`, { originCity, destinationCity });
        }
    });

    console.log(`전체 출발지·도착지 조합: ${routeTargets.size}개`);
    console.log([...routeTargets.keys()].sort().join(', '));

    const benchmarkPath = path.resolve(process.cwd(), 'data/interpark-prices.json');
    const previousBenchmark = fs.existsSync(benchmarkPath)
        ? JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'))
        : null;

    const benchmark = await scrapeInterparkBenchmark(Array.from(routeTargets.values()), {
        previousBenchmark,
        maxPairsPerRun: 5,
    });

    // 저장
    fs.writeFileSync(benchmarkPath, JSON.stringify(benchmark, null, 2), 'utf-8');

    let monthCount = 0;
    for (const originPrices of Object.values(benchmark.pricesByOrigin || { SEL: benchmark.prices })) {
        for (const city of Object.values(originPrices)) monthCount += Object.keys(city).length;
    }
    console.log(`\n=== 결과 ===`);
    const pairCount = Object.values(benchmark.pricesByOrigin || {})
        .reduce((sum, originPrices) => sum + Object.keys(originPrices).length, 0);
    console.log(`조합: ${pairCount}개 (기존 값 보존 + 회차당 최대 5개 순환 갱신)`);
    console.log(`월별 가격: ${monthCount}개`);
}

main().catch(console.error);
