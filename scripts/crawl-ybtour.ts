import { scrapeYbtour } from '../src/lib/scrapers/ybtour';
import { enrichVisibleYbtourFlights } from '../src/lib/ybtour-time-enrichment';
import fs from 'fs';
import path from 'path';

async function main() {
    try {
        console.log('🚀 노랑풍선 크롤링 시작...');
        const dataDir = path.join(process.cwd(), 'data');
        const cachePath = path.join(dataDir, 'ybtour-cache.json');
        let previous: any = null;
        try {
            if (fs.existsSync(cachePath)) previous = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        } catch { }

        const flights = await scrapeYbtour(previous?.flights || []);
        const timeResult = await enrichVisibleYbtourFlights(flights, previous?.ybtourTimeEnrichment);

        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        const cacheData = {
            timestamp: new Date().toISOString(),
            flights: flights,
            ybtourTimeEnrichment: timeResult.state,
        };

        fs.writeFileSync(
            cachePath,
            JSON.stringify(cacheData, null, 2)
        );

        console.log(`✅ 크롤링 완료!`);
        console.log(`📊 수집된 항공권: ${flights.length}개`);
        console.log(`💾 저장 위치: ${cachePath}`);

    } catch (error) {
        console.error('❌ 크롤링 중 오류 발생:', error);
        process.exit(1);
    }
}

main();
