import { scrapeTtangDiscount } from '../src/lib/scrapers/ttang';
import { resolveCityCode } from '../src/lib/scrapers/interpark';
import fs from 'fs';

async function test() {
    const flights = await scrapeTtangDiscount();
    console.log('크롤링:', flights.length, '건');

    const benchPath = './data/interpark-prices.json';
    const benchmark = JSON.parse(fs.readFileSync(benchPath, 'utf-8'));

    let passed = 0, filtered = 0, noData = 0;
    for (const f of flights) {
        const cityCode = resolveCityCode(f.arrival?.city || '', f.arrival?.airport);
        if (!cityCode) { noData++; passed++; continue; }
        const dateMatch = f.departure.date.match(/^(\d{4})-(\d{2})/);
        if (!dateMatch) { noData++; passed++; continue; }
        const ym = `${dateMatch[1]}-${dateMatch[2]}`;
        const cp = benchmark.prices[cityCode];
        if (!cp || !cp[ym]) { noData++; passed++; continue; }
        if (f.price > cp[ym].avg) { filtered++; }
        else { passed++; }
    }
    console.log('통과:', passed, '건');
    console.log('필터(인터파크 평균보다 비쌈):', filtered, '건');
    console.log('비교데이터 없음(통과):', noData, '건');
}
test();
