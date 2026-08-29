import fs from 'fs';
import path from 'path';
import { buildNaverPriceKey } from '../src/lib/naver-route';
import { getUsableNaverComparison } from '../src/lib/naver-comparison';
import { getEffectivePrice } from '../src/lib/price-quality';

/**
 * 네이버 최저가 기준으로 전체 여행사 항공권 필터링
 * - naver-prices.json과 all-flights-cache.json을 비교
 * - 동일 공항·동일 왕복 날짜를 정확히 비교
 * - 네이버보다 10만원 이상이면서 20% 이상 비싼 항공권만 제거
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
const lifecycleCandidates = [...cache.flights];
const hiddenFlightKeys = new Set<string>();

console.log(`📡 네이버 가격 데이터: ${Object.keys(naverPrices).length}건`);
console.log(`📋 전체 항공권: ${cache.flights.length}건\n`);

const beforeCount = cache.flights.length;
let filtered = 0;
let cheaper = 0;
let noData = 0;

cache.flights = cache.flights.filter((f: any) => {
    const depDate = String(f.departure?.date || '').replace(/\(.*\)/g, '').replace(/\./g, '-').trim().substring(0, 10);
    delete f.naverLowest;
    delete f.naverCheckedAt;
    delete f.naverDiscount;

    // 예약 결과에서 확인한 가는편·오는편 실제 공항 네 개와 날짜가 모두 같을 때만 비교한다.
    const naverKey = buildNaverPriceKey(f, f.departure?.date, f.arrival?.date);
    if (!naverKey) {
        noData++;
        return true;
    }
    const naverEntry = naverPrices[naverKey];
    const comparison = getUsableNaverComparison(naverEntry);
    const bestNaverPrice: number | null = comparison?.price || null;

    if (!bestNaverPrice) {
        noData++;
        return true; // 비교 데이터 없으면 유지
    }

    // 네이버 최저가 저장 (추천순 정렬에서 사용)
    f.naverLowest = bestNaverPrice;
    f.naverCheckedAt = comparison!.checkedAt;

    const effectivePrice = getEffectivePrice(f);
    const diff = effectivePrice - bestNaverPrice;
    const moreExpensiveRatio = diff / bestNaverPrice;
    if (diff >= 100000 && moreExpensiveRatio >= 0.2) {
        console.log(`  ❌ ${f.arrival?.city} ${depDate} ${f.source} ${f.price.toLocaleString()}원 > 네이버 ${bestNaverPrice.toLocaleString()}원 (+${diff.toLocaleString()}원, +${Math.round(moreExpensiveRatio * 100)}%)`);
        filtered++;
        hiddenFlightKeys.add(`${f.source}|${f.id}`);
        return false;
    }

    // 네이버 대비 할인율 저장
    f.naverDiscount = Math.round((1 - effectivePrice / bestNaverPrice) * 100);
    if (diff <= 0) cheaper++;
    return true;
});

cache.count = cache.flights.length;
// 네이버 필터가 항공권을 제거한 뒤에도 여행사별 숫자가 필터 전 값으로 남으면
// 어드민과 실제 사이트 개수가 다시 어긋난다. 화면에 남는 항공권 기준으로 맞춘다.
const visibleSourceCounts: Record<string, number> = Object.fromEntries(
    Object.keys(cache.sources || {}).map(source => [source, 0]),
);
for (const flight of cache.flights) {
    const source = String(flight?.source || '');
    if (!source) continue;
    visibleSourceCounts[source] = (visibleSourceCounts[source] || 0) + 1;
}
cache.sources = visibleSourceCounts;
cache.lastUpdated = new Date().toISOString();
fs.writeFileSync(cachePath, JSON.stringify(cache));

const lifecycleObservationPath = process.env.LIFECYCLE_OBSERVATION_PATH;
if (lifecycleObservationPath) {
    const sources = Object.fromEntries(
        Array.from(new Set(lifecycleCandidates.map((flight: any) => flight.source))).map(source => [source, {
            status: 'warning',
            // 비교 가격을 확인하는 회차이지 여행사 재고 전체를 다시 긁는 회차가 아니다.
            allowMissing: false,
        }]),
    );
    fs.writeFileSync(lifecycleObservationPath, JSON.stringify({
        observedAt: cache.lastUpdated,
        mode: 'comparison',
        cachePreserved: false,
        alerts: [],
        sources,
        observations: lifecycleCandidates.map((flight: any) => ({
            flight,
            visible: !hiddenFlightKeys.has(`${flight.source}|${flight.id}`),
        })),
    }), 'utf8');
    console.log(`🧭 비교가 생애 기록 입력 준비: ${lifecycleCandidates.length}개 후보`);
}

console.log(`\n=== 필터링 결과 ===`);
console.log(`✅ 여행사 가격이 네이버 이하: ${cheaper}건 (유지)`);
console.log(`❌ 네이버보다 10만원·20% 이상 비쌈: ${filtered}건 (제거)`);
console.log(`❓ 비교 데이터 없음: ${noData}건 (유지)`);
console.log(`📊 ${beforeCount}건 → ${cache.flights.length}건`);
