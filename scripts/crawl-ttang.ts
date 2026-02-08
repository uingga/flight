import { scrapeTtang } from '../src/lib/scrapers/ttang';
import fs from 'fs';
import path from 'path';

async function main() {
    try {
        console.log('🚀 땡처리닷컴 크롤링 시작...');
        const flights = await scrapeTtang();

        const dataDir = path.join(process.cwd(), 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        const cacheData = {
            timestamp: new Date().toISOString(),
            flights: flights
        };

        fs.writeFileSync(
            path.join(dataDir, 'ttang-cache.json'),
            JSON.stringify(cacheData, null, 2)
        );

        console.log(`✅ 크롤링 완료!`);
        console.log(`📊 수집된 항공권: ${flights.length}개`);
        console.log(`💾 저장 위치: ${path.join(dataDir, 'ttang-cache.json')}`);

    } catch (error) {
        console.error('❌ 크롤링 중 오류 발생:', error);
        process.exit(1);
    }
}

main();
