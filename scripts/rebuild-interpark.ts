import { scrapeInterparkBenchmark, resolveCityCode } from '../src/lib/scrapers/interpark';
import fs from 'fs';
import path from 'path';

async function main() {
    const cachePath = path.resolve(process.cwd(), 'data/all-flights-cache.json');
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));

    // 전체 항공편에서 도착 도시 코드 수집
    const arrCityCodes = new Set<string>();
    cache.flights.forEach((f: any) => {
        const code = resolveCityCode(f.arrival?.city || '', f.arrival?.airport);
        if (code) arrCityCodes.add(code);
    });

    console.log(`전체 도착 도시 코드: ${arrCityCodes.size}개`);
    console.log([...arrCityCodes].sort().join(', '));

    // 인터파크 벤치마크 수집
    const benchmark = await scrapeInterparkBenchmark(Array.from(arrCityCodes));

    // 저장
    const benchmarkPath = path.resolve(process.cwd(), 'data/interpark-prices.json');
    fs.writeFileSync(benchmarkPath, JSON.stringify(benchmark, null, 2), 'utf-8');

    const cityCount = Object.keys(benchmark.prices).length;
    let monthCount = 0;
    for (const city of Object.values(benchmark.prices)) {
        monthCount += Object.keys(city).length;
    }
    console.log(`\n=== 결과 ===`);
    console.log(`도시: ${cityCount}개 (기존 58개 → ${cityCount}개)`);
    console.log(`월별 가격: ${monthCount}개`);
}

main().catch(console.error);
