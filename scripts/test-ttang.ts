import { scrapeTtang } from '../src/lib/scrapers/ttang';

async function test() {
    const flights = await scrapeTtang();
    console.log('\n=== 결과 요약 ===');
    console.log('총:', flights.length, '개');

    // 지역별
    const byRegion: Record<string, number> = {};
    flights.forEach(f => {
        const r = f.region || '기타';
        byRegion[r] = (byRegion[r] || 0) + 1;
    });
    console.log('지역별:', byRegion);

    // 샘플
    if (flights.length > 0) {
        console.log('\n--- 샘플 항공편 ---');
        flights.slice(0, 5).forEach(f => {
            console.log(`${f.airline} ${f.arrival.city} ${f.price.toLocaleString()}원`);
            console.log(`  링크: ${f.link}`);
        });
    }
}

test();
