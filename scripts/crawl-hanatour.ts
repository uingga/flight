import { scrapeHanatour } from '../src/lib/scrapers/hanatour';
import fs from 'fs';
import path from 'path';

interface CacheData {
    timestamp: string;
    count: number;
    flights: any[];
    sources: {
        hanatour: number;
    };
}

async function main() {
    console.log('🚀 하나투어 크롤링 시작...\n');

    try {
        // 크롤링 실행
        const flights = await scrapeHanatour();

        // 캐시 데이터 구조 생성
        const cacheData: CacheData = {
            timestamp: new Date().toISOString(),
            count: flights.length,
            flights: flights,
            sources: {
                hanatour: flights.length
            }
        };

        // data 디렉토리 확인 및 생성
        const dataDir = path.join(process.cwd(), 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // 캐시 파일 저장
        const cachePath = path.join(dataDir, 'hanatour-cache.json');
        fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), 'utf-8');

        console.log('\n✅ 크롤링 완료!');
        console.log(`📊 수집된 항공권: ${flights.length}개`);
        console.log(`💾 저장 위치: ${cachePath}`);
        console.log(`🕐 타임스탬프: ${cacheData.timestamp}`);

    } catch (error) {
        console.error('\n❌ 크롤링 실패:', error);
        process.exit(1);
    }
}

// 스크립트 실행
main();
