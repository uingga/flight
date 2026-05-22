// v5 스크래퍼 3개 노선 테스트
import { scrapeMyrealtrip } from '../src/lib/scrapers/myrealtrip';

async function main() {
    const flights = await scrapeMyrealtrip();
    
    // 난닝, 오사카, 다낭만 출력
    const targets = ['NNG', 'KIX', 'DAD', 'FUK', 'BKK'];
    console.log('\n=== 테스트 결과 ===');
    for (const code of targets) {
        const f = flights.find(x => x.arrival.airport === code);
        if (f) {
            console.log(`${f.arrival.city}: ${f.price.toLocaleString()}원 (${f.airline}) ${f.departure.date}~${f.arrival.date}`);
        } else {
            console.log(`${code}: 없음`);
        }
    }
    console.log(`\n총 ${flights.length}개 수집`);
}

main().catch(console.error);
