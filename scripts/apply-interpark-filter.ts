import fs from 'fs';
import path from 'path';
import {
    clearUnsupportedInterparkDiscount,
    evaluateInterparkBenchmark,
} from '../src/lib/interpark-benchmark';

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
    const evaluation = evaluateInterparkBenchmark(f, benchmark);
    f.discountRate = evaluation.discountRate;
    if (!evaluation.keep) {
        console.log(`  ❌ ${f.arrival?.city} ${evaluation.yearMonth} ${f.price.toLocaleString()}원 > 평균 ${evaluation.average?.toLocaleString()}원`);
        removed++;
        return false;
    }
    return true;
});

cache.flights.forEach((flight: any) => clearUnsupportedInterparkDiscount(flight, benchmark));

const mrtAfter = cache.flights.filter((f: any) => f.source === 'myrealtrip').length;
console.log(`\n제거: ${removed}건`);
console.log(`마이리얼트립 필터 후: ${mrtAfter}건`);

cache.count = cache.flights.length;
fs.writeFileSync(cachePath, JSON.stringify(cache));
console.log('저장 완료!');
