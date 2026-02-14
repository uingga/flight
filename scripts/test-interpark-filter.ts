import { scrapeInterparkBenchmark, resolveCityCode } from '../src/lib/scrapers/interpark';
import fs from 'fs';

async function test() {
    const data = JSON.parse(fs.readFileSync('data/all-flights-cache.json', 'utf8'));
    const flights = data.flights;

    const arrCityCodes = new Set<string>();
    flights.forEach((f: any) => {
        const code = resolveCityCode(f.arrival?.city || '');
        if (code) arrCityCodes.add(code);
    });

    const benchmark = await scrapeInterparkBenchmark(Array.from(arrCityCodes));

    let removed = 0, kept = 0, noData = 0;
    flights.forEach((f: any) => {
        const cityCode = resolveCityCode(f.arrival?.city || '');
        if (!cityCode) { noData++; return; }

        const depDate = f.departure?.date || '';
        const dateStr = depDate.replace(/[^0-9\-\.]/g, '').replace(/\./g, '-').replace(/-+$/, '');
        const dateMatch = dateStr.match(/^(\d{4})-(\d{2})/);
        if (!dateMatch) { noData++; return; }

        const yearMonth = `${dateMatch[1]}-${dateMatch[2]}`;
        const cityPrices = benchmark.prices[cityCode];
        if (!cityPrices || !cityPrices[yearMonth]) { noData++; return; }

        // 월 평균가 기준
        if (f.price > cityPrices[yearMonth].avg) {
            removed++;
        } else {
            kept++;
        }
    });

    console.log(`\n=== 월 평균가 기준 ===`);
    console.log(`전체: ${flights.length}개`);
    console.log(`유지: ${kept}개 (${Math.round(kept / flights.length * 100)}%)`);
    console.log(`제거: ${removed}개 (${Math.round(removed / flights.length * 100)}%)`);
    console.log(`비교불가: ${noData}개`);
}

test();
