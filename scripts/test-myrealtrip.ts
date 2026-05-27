/**
 * 마이리얼트립 스크래퍼 테스트
 * 공개 Bulk API를 통한 최저가 수집 + 파트너 광고 링크 생성 테스트
 *
 * 실행: npx tsx scripts/test-myrealtrip.ts
 */

import { scrapeMyrealtrip } from '../src/lib/scrapers/myrealtrip';

async function main() {
    console.log('=== 마이리얼트립 스크래퍼 테스트 시작 ===\n');

    const startTime = Date.now();
    const flights = await scrapeMyrealtrip();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n=== 결과 요약 ===`);
    console.log(`총 수집: ${flights.length}개 항공편`);
    console.log(`소요 시간: ${elapsed}초`);

    if (flights.length > 0) {
        // 가격순 상위 20개 출력
        const sorted = [...flights].sort((a, b) => a.price - b.price);
        console.log(`\n--- 최저가 TOP 20 ---`);
        sorted.slice(0, 20).forEach((f, i) => {
            console.log(
                `${(i + 1).toString().padStart(2)}. ` +
                `${f.departure.city} → ${f.arrival.city} | ` +
                `${f.price.toLocaleString()}원 | ` +
                `${f.departure.date} ~ ${f.arrival.date} | ` +
                `${f.region || '지역없음'}`
            );
        });

        // 파트너 링크 샘플
        console.log(`\n--- 파트너 링크 샘플 (첫 번째 항공편) ---`);
        console.log(`링크: ${sorted[0].link}`);
        console.log(`\n--- 지역별 통계 ---`);
        const regionStats: Record<string, { count: number; minPrice: number }> = {};
        flights.forEach(f => {
            const region = f.region || '기타';
            if (!regionStats[region]) regionStats[region] = { count: 0, minPrice: Infinity };
            regionStats[region].count++;
            regionStats[region].minPrice = Math.min(regionStats[region].minPrice, f.price);
        });
        Object.entries(regionStats)
            .sort((a, b) => b[1].count - a[1].count)
            .forEach(([region, stats]) => {
                console.log(`  ${region}: ${stats.count}개 (최저 ${stats.minPrice.toLocaleString()}원)`);
            });
    }
}

main().catch(console.error);
