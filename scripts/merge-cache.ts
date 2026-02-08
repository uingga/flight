import fs from 'fs';
import path from 'path';

const dataDir = path.join(process.cwd(), 'data');
const sources = ['ttang', 'ybtour', 'hanatour', 'modetour', 'onlinetour'];
let allFlights: any[] = [];

console.log('🔄 캐시 파일 병합 시작...');

sources.forEach(source => {
    const file = path.join(dataDir, `${source}-cache.json`);
    if (fs.existsSync(file)) {
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
            if (data.flights && Array.isArray(data.flights)) {
                console.log(`✅ ${source}: ${data.flights.length}개 로드됨`);
                allFlights = allFlights.concat(data.flights);
            }
        } catch (error) {
            console.error(`❌ ${source} 로드 실패:`, error);
        }
    } else {
        console.log(`⚠️ ${source}: 파일 없음 (${file})`);
    }
});

const outputFile = path.join(dataDir, 'all-flights-cache.json');
const outputData = {
    timestamp: new Date().toISOString(),
    count: allFlights.length,
    flights: allFlights
};

fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2));

console.log(`\n🎉 병합 완료! 총 ${allFlights.length}개 항공권`);
console.log(`💾 저장됨: ${outputFile}`);
