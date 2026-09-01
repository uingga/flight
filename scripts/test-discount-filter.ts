import { scrapeTtangDiscount } from '../src/lib/scrapers/ttang';
import { evaluateInterparkBenchmark } from '../src/lib/interpark-benchmark';
import fs from 'fs';

async function test() {
    const flights = await scrapeTtangDiscount();
    console.log('크롤링:', flights.length, '건');

    const benchPath = './data/interpark-prices.json';
    const benchmark = JSON.parse(fs.readFileSync(benchPath, 'utf-8'));

    let passed = 0, filtered = 0, noData = 0;
    for (const f of flights) {
        const evaluation = evaluateInterparkBenchmark(f, benchmark);
        if (!evaluation.applicable || !evaluation.average) noData++;
        if (evaluation.keep) passed++;
        else filtered++;
    }
    console.log('통과:', passed, '건');
    console.log('필터(인터파크 평균보다 비쌈):', filtered, '건');
    console.log('비교데이터 없음(통과):', noData, '건');
}
test();
