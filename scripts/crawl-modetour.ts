import { scrapeModetour } from '../src/lib/scrapers/modetour';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    console.log('🚀 모두투어 크롤링 시작...\n');

    try {
        const flights = await scrapeModetour();
        console.log(`✅ 모두투어: ${flights.length}개 항공권 수집 완료`);

        // 캐시 파일 저장
        const dataDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        const cacheFile = path.join(dataDir, 'modetour-cache.json');
        const cacheData = {
            lastUpdated: new Date().toISOString(),
            count: flights.length,
            flights: flights
        };

        fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
        console.log(`💾 캐시 파일 저장: ${cacheFile}`);

        // 지역별 통계 출력
        const byDestination = flights.reduce((acc, flight) => {
            const dest = flight.arrival.city;
            acc[dest] = (acc[dest] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        console.log('\n📊 지역별 항공권 수:');
        Object.entries(byDestination)
            .sort((a, b) => b[1] - a[1])
            .forEach(([dest, count]) => {
                console.log(`   ${dest}: ${count}개`);
            });

    } catch (error) {
        console.error('❌ 크롤링 실패:', error);
        process.exit(1);
    }
}

main();
