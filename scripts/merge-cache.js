const fs = require('fs');
const path = require('path');

console.log('🔄 캐시 파일 병합 시작...\n');

const dataDir = path.join(__dirname, '../data');
const sources = ['ttang', 'ybtour', 'hanatour', 'modetour', 'onlinetour'];

const allFlights = [];
const sourceCounts = {
    ttang: 0,
    ybtour: 0,
    hanatour: 0,
    modetour: 0,
    onlinetour: 0,
};

// 각 소스별 캐시 파일 읽기
sources.forEach(source => {
    const cacheFile = path.join(dataDir, `${source}-cache.json`);

    if (fs.existsSync(cacheFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            const flights = data.flights || [];
            allFlights.push(...flights);
            sourceCounts[source] = flights.length;
            console.log(`✅ ${source}: ${flights.length}개`);
        } catch (error) {
            console.error(`❌ ${source} 읽기 실패:`, error.message);
        }
    } else {
        console.log(`⚠️  ${source}: 캐시 파일 없음`);
    }
});

// 통합 캐시 데이터 생성
const cacheData = {
    timestamp: new Date().toISOString(),
    count: allFlights.length,
    flights: allFlights,
    sources: sourceCounts,
};

// 통합 캐시 파일 저장
const cachePath = path.join(dataDir, 'all-flights-cache.json');
fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), 'utf-8');

console.log('\n✅ 캐시 병합 완료!');
console.log('='.repeat(50));
console.log(`📊 총 항공권: ${allFlights.length}개`);
console.log(`   - 땡처리닷컴: ${sourceCounts.ttang}개`);
console.log(`   - 노랑풍선: ${sourceCounts.ybtour}개`);
console.log(`   - 하나투어: ${sourceCounts.hanatour}개`);
console.log(`   - 모두투어: ${sourceCounts.modetour}개`);
console.log(`   - 온라인투어: ${sourceCounts.onlinetour}개`);
console.log(`💾 저장 위치: ${cachePath}`);
console.log(`🕐 타임스탬프: ${cacheData.timestamp}`);
console.log('='.repeat(50));
