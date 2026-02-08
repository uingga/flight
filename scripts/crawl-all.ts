import { scrapeTtang } from '../src/lib/scrapers/ttang';
import { scrapeYbtour } from '../src/lib/scrapers/ybtour';
import { scrapeHanatour } from '../src/lib/scrapers/hanatour';
import { scrapeModetour } from '../src/lib/scrapers/modetour';
import { scrapeOnlineTour } from '../src/lib/scrapers/onlinetour';
import fs from 'fs';
import path from 'path';

interface CacheData {
    timestamp: string;
    count: number;
    flights: any[];
    sources: {
        ttang: number;
        ybtour: number;
        hanatour: number;
        modetour: number;
        onlinetour: number;
    };
}

async function main() {
    console.log('🚀 전체 사이트 크롤링 시작...\n');

    const allFlights: any[] = [];
    const sources = {
        ttang: 0,
        ybtour: 0,
        hanatour: 0,
        modetour: 0,
        onlinetour: 0,
    };

    try {
        // 1. 땡처리닷컴
        console.log('\n=== 땡처리닷컴 크롤링 ===');
        try {
            const ttangFlights = await scrapeTtang();
            allFlights.push(...ttangFlights);
            sources.ttang = ttangFlights.length;
            console.log(`✅ 땡처리닷컴: ${ttangFlights.length}개`);
        } catch (error) {
            console.error('❌ 땡처리닷컴 실패:', error);
        }

        // 2. 노랑풍선
        console.log('\n=== 노랑풍선 크롤링 ===');
        try {
            const ybtourFlights = await scrapeYbtour();
            allFlights.push(...ybtourFlights);
            sources.ybtour = ybtourFlights.length;
            console.log(`✅ 노랑풍선: ${ybtourFlights.length}개`);
        } catch (error) {
            console.error('❌ 노랑풍선 실패:', error);
        }

        // 3. 하나투어
        console.log('\n=== 하나투어 크롤링 ===');
        try {
            const hanatourFlights = await scrapeHanatour();
            allFlights.push(...hanatourFlights);
            sources.hanatour = hanatourFlights.length;
            console.log(`✅ 하나투어: ${hanatourFlights.length}개`);
        } catch (error) {
            console.error('❌ 하나투어 실패:', error);
        }

        // 4. 모두투어
        console.log('\n=== 모두투어 크롤링 ===');
        try {
            const modetourFlights = await scrapeModetour();
            allFlights.push(...modetourFlights);
            sources.modetour = modetourFlights.length;
            console.log(`✅ 모두투어: ${modetourFlights.length}개`);
        } catch (error) {
            console.error('❌ 모두투어 실패:', error);
        }

        // 5. 온라인투어
        console.log('\n=== 온라인투어 크롤링 ===');
        try {
            const onlinetourFlights = await scrapeOnlineTour();
            allFlights.push(...onlinetourFlights);
            sources.onlinetour = onlinetourFlights.length;
            console.log(`✅ 온라인투어: ${onlinetourFlights.length}개`);
        } catch (error) {
            console.error('❌ 온라인투어 실패:', error);
        }

        // 캐시 데이터 구조 생성
        const cacheData: CacheData = {
            timestamp: new Date().toISOString(),
            count: allFlights.length,
            flights: allFlights,
            sources: sources,
        };

        // data 디렉토리 확인 및 생성
        const dataDir = path.join(process.cwd(), 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // 통합 캐시 파일 저장
        const cachePath = path.join(dataDir, 'all-flights-cache.json');
        fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), 'utf-8');

        console.log('\n\n✅ 전체 크롤링 완료!');
        console.log('='.repeat(50));
        console.log(`📊 총 수집된 항공권: ${allFlights.length}개`);
        console.log(`   - 땡처리닷컴: ${sources.ttang}개`);
        console.log(`   - 노랑풍선: ${sources.ybtour}개`);
        console.log(`   - 하나투어: ${sources.hanatour}개`);
        console.log(`   - 모두투어: ${sources.modetour}개`);
        console.log(`   - 온라인투어: ${sources.onlinetour}개`);
        console.log(`💾 저장 위치: ${cachePath}`);
        console.log(`🕐 타임스탬프: ${cacheData.timestamp}`);
        console.log('='.repeat(50));

    } catch (error) {
        console.error('\n❌ 크롤링 실패:', error);
        process.exit(1);
    }
}

// 스크립트 실행
main();
