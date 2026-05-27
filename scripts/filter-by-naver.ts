import fs from 'fs';
import path from 'path';

/**
 * 네이버 최저가 기준으로 마이리얼트립 항공권 필터링
 * - naver-prices.json과 all-flights-cache.json을 비교
 * - 마이리얼트립 가격이 네이버보다 비싸면 제거
 * 
 * 사용법: npx tsx scripts/filter-by-naver.ts
 */

const cachePath = path.resolve(process.cwd(), 'data/all-flights-cache.json');
const naverPath = path.resolve(process.cwd(), 'data/naver-prices.json');

if (!fs.existsSync(naverPath)) {
    console.error('❌ naver-prices.json이 없습니다. 먼저 네이버 크롤링을 실행하세요.');
    process.exit(1);
}

const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
const naverPrices = JSON.parse(fs.readFileSync(naverPath, 'utf8'));

console.log(`📡 네이버 가격 데이터: ${Object.keys(naverPrices).length}건`);
console.log(`📋 전체 항공권: ${cache.flights.length}건\n`);

const beforeCount = cache.flights.length;
let filtered = 0;
let cheaper = 0;
let noData = 0;

cache.flights = cache.flights.filter((f: any) => {
    if (f.source !== 'myrealtrip') return true;

    const depAirport = f.departure?.airport;
    const arrAirport = f.arrival?.airport;
    const depDate = f.departure?.date?.substring(0, 10);
    const retDate = f.arrival?.date?.substring(0, 10);
    if (!depAirport || !arrAirport || !depDate || !retDate) return true;

    const naverKey = `${depAirport}-${arrAirport}_${depDate}_${retDate}`;
    const naverData = naverPrices[naverKey];

    if (!naverData || !naverData.naverLowest) {
        noData++;
        return true; // 비교 데이터 없으면 유지
    }

    if (f.price > naverData.naverLowest) {
        console.log(`  ❌ ${f.arrival?.city} ${depDate} 마이리얼트립 ${f.price.toLocaleString()}원 > 네이버 ${naverData.naverLowest.toLocaleString()}원`);
        filtered++;
        return false;
    }

    // 네이버 대비 할인율 저장
    f.naverDiscount = Math.round((1 - f.price / naverData.naverLowest) * 100);
    cheaper++;
    return true;
});

cache.count = cache.flights.length;
cache.lastUpdated = new Date().toISOString();
fs.writeFileSync(cachePath, JSON.stringify(cache));

console.log(`\n=== 필터링 결과 ===`);
console.log(`✅ 마이리얼트립이 더 저렴: ${cheaper}건 (유지)`);
console.log(`❌ 네이버가 더 저렴: ${filtered}건 (제거)`);
console.log(`❓ 비교 데이터 없음: ${noData}건 (유지)`);
console.log(`📊 ${beforeCount}건 → ${cache.flights.length}건`);
