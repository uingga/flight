import fs from 'fs';
import path from 'path';
import { resolveCityCode } from '../src/lib/scrapers/interpark';

const cachePath = path.resolve(process.cwd(), 'data/all-flights-cache.json');
const benchmarkPath = path.resolve(process.cwd(), 'data/interpark-prices.json');

const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'));

const cacheAge = Math.round((Date.now() - new Date(benchmark.timestamp).getTime()) / 3600000);
console.log(`인터파크 캐시: ${cacheAge}시간 전`);

const mrtBefore = cache.flights.filter((f: any) => f.source === 'myrealtrip').length;
console.log(`마이리얼트립 필터 전: ${mrtBefore}건`);

let removed = 0;
cache.flights = cache.flights.filter((f: any) => {
    if (f.source !== 'myrealtrip') return true;

    const cityCode = resolveCityCode(f.arrival?.city || '', f.arrival?.airport);
    if (!cityCode) return true;

    const depDate = f.departure?.date || '';
    const dateStr = depDate.replace(/[^0-9\-\.]/g, '').replace(/\./g, '-').replace(/-+$/, '');
    const dateMatch = dateStr.match(/^(\d{4})-(\d{2})/);
    if (!dateMatch) return true;

    const yearMonth = `${dateMatch[1]}-${dateMatch[2]}`;
    const cityPrices = benchmark.prices?.[cityCode];
    if (!cityPrices || !cityPrices[yearMonth]) return true;

    const interparkAvg = cityPrices[yearMonth].avg;
    if (f.price > interparkAvg) {
        console.log(`  ❌ ${f.arrival?.city} ${yearMonth} ${f.price.toLocaleString()}원 > 평균 ${interparkAvg.toLocaleString()}원`);
        removed++;
        return false;
    }

    // 할인율 계산
    const interparkLowest = cityPrices[yearMonth].lowest;
    f.discountRate = interparkLowest > 0
        ? Math.round((1 - f.price / interparkLowest) * 100)
        : 0;

    return true;
});

const mrtAfter = cache.flights.filter((f: any) => f.source === 'myrealtrip').length;
console.log(`\n제거: ${removed}건`);
console.log(`마이리얼트립 필터 후: ${mrtAfter}건`);

cache.count = cache.flights.length;
fs.writeFileSync(cachePath, JSON.stringify(cache));
console.log('저장 완료!');
