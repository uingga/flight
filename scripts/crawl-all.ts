
import { scrapeYbtour } from '../src/lib/scrapers/ybtour';
import { scrapeHanatour } from '../src/lib/scrapers/hanatour';
import { scrapeModetour } from '../src/lib/scrapers/modetour';
import { scrapeOnlineTour } from '../src/lib/scrapers/onlinetour';
import { scrapeInterparkBenchmark, resolveCityCode } from '../src/lib/scrapers/interpark';
import fs from 'fs';
import path from 'path';

interface CacheData {
    timestamp: string;
    count: number;
    flights: any[];
    sources: {

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

        ybtour: 0,
        hanatour: 0,
        modetour: 0,
        onlinetour: 0,
    };

    try {


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

        // 기존 캐시 로드 (실패 대비)
        const dataDir = path.join(process.cwd(), 'data');
        const cachePath = path.join(dataDir, 'all-flights-cache.json');
        let prevCache: CacheData | null = null;
        try {
            if (fs.existsSync(cachePath)) {
                prevCache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
            }
        } catch { }

        // 소스별 실패 시 이전 데이터 복구
        const sourceNames = ['ybtour', 'hanatour', 'modetour', 'onlinetour'] as const;
        for (const src of sourceNames) {
            if (sources[src] === 0 && prevCache?.flights) {
                const prevFlights = prevCache.flights.filter((f: any) => f.source === src);
                if (prevFlights.length > 0) {
                    console.log(`⚠️ ${src} 실패 → 이전 캐시 ${prevFlights.length}개 유지`);
                    allFlights.push(...prevFlights);
                    sources[src] = prevFlights.length;
                }
            }
        }

        // 노선별 최저가 필터링 (각 업체별 같은 노선에서 최저가만 유지)
        console.log('\n=== 최저가 필터링 ===');
        console.log(`필터 전: ${allFlights.length}개`);

        const routeMinPrices: Record<string, number> = {};
        allFlights.forEach((f: any) => {
            const key = `${f.source}|${f.departure?.city || ''}|${f.arrival?.city || ''}`;
            if (f.price > 0) {
                if (!routeMinPrices[key] || f.price < routeMinPrices[key]) {
                    routeMinPrices[key] = f.price;
                }
            }
        });

        const filteredFlights = allFlights.filter((f: any) => {
            if (f.price <= 0) return false;
            const key = `${f.source}|${f.departure?.city || ''}|${f.arrival?.city || ''}`;
            return f.price === routeMinPrices[key];
        });

        console.log(`필터 후: ${filteredFlights.length}개 (${allFlights.length - filteredFlights.length}개 제거)`);

        // 만료 항공권 제거 (출발일이 오늘 이전)
        console.log('\n=== 만료 항공권 정리 ===');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const beforeExpiry = filteredFlights.length;
        const activeFlights = filteredFlights.filter((f: any) => {
            if (!f.departure?.date) return true; // 날짜 없으면 유지
            const dateStr = f.departure.date.replace(/[^0-9\-\.]/g, '').replace(/\./g, '-').replace(/-+$/, '');
            const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (!match) return true; // 파싱 불가하면 유지
            const depDate = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
            return depDate >= today;
        });
        const expiredCount = beforeExpiry - activeFlights.length;
        if (expiredCount > 0) {
            console.log(`🗑️ 만료 항공권 ${expiredCount}개 제거 (${beforeExpiry} → ${activeFlights.length})`);
        } else {
            console.log('✅ 만료 항공권 없음');
        }

        // 인터파크 벤치마크 기반 필터링
        console.log('\n=== 인터파크 가격 벤치마크 ===');
        let benchmarkedFlights = activeFlights;
        try {
            // 현재 항공편의 도착 도시코드 수집
            const arrCityCodes = new Set<string>();
            activeFlights.forEach((f: any) => {
                const code = resolveCityCode(f.arrival?.city || '');
                if (code) arrCityCodes.add(code);
            });

            const benchmark = await scrapeInterparkBenchmark(Array.from(arrCityCodes));

            // 벤치마크 저장
            const dataDir = path.join(process.cwd(), 'data');
            const benchmarkPath = path.join(dataDir, 'interpark-prices.json');
            fs.writeFileSync(benchmarkPath, JSON.stringify(benchmark, null, 2), 'utf-8');
            console.log(`💾 인터파크 벤치마크 저장: ${benchmarkPath}`);

            // 인터파크 월 평균가보다 비싼 항공편 필터링
            const beforeBenchmark = activeFlights.length;
            benchmarkedFlights = activeFlights.filter((f: any) => {
                // 도착 도시 코드 추출 (resolveCityCode로 모든 형식 지원)
                const cityCode = resolveCityCode(f.arrival?.city || '');
                if (!cityCode) return true; // 코드 없으면 유지

                // 출발월 추출
                const depDate = f.departure?.date || '';
                const dateStr = depDate.replace(/[^0-9\-\.]/g, '').replace(/\./g, '-').replace(/-+$/, '');
                const dateMatch = dateStr.match(/^(\d{4})-(\d{2})/);
                if (!dateMatch) return true; // 날짜 파싱 불가하면 유지

                const yearMonth = `${dateMatch[1]}-${dateMatch[2]}`;

                // 인터파크 월 평균가 조회
                const cityPrices = benchmark.prices[cityCode];
                if (!cityPrices || !cityPrices[yearMonth]) return true; // 비교 데이터 없으면 유지

                const interparkAvg = cityPrices[yearMonth].avg;

                // 인터파크 월 평균가보다 비싸면 제거
                if (f.price > interparkAvg) {
                    console.log(`  ❌ 필터: ${f.arrival?.city} ${yearMonth} ${f.price.toLocaleString()}원 > 인터파크 평균 ${interparkAvg.toLocaleString()}원 (${f.source})`);
                    return false;
                }
                return true;
            });

            const benchmarkFiltered = beforeBenchmark - benchmarkedFlights.length;
            console.log(`📊 인터파크 기준 필터: ${benchmarkFiltered}개 제거 (${beforeBenchmark} → ${benchmarkedFlights.length})`);

        } catch (error) {
            console.error('⚠️ 인터파크 벤치마크 실패 (필터링 건너뜀):', error);
        }

        // 전체 결과가 이전 캐시의 50% 미만이면 이전 캐시 유지
        if (prevCache && prevCache.count > 0 && benchmarkedFlights.length < prevCache.count * 0.5) {
            console.log(`\n⚠️ 결과가 이전 캐시(${prevCache.count}개)의 50% 미만(${benchmarkedFlights.length}개) → 이전 캐시 유지`);
            console.log('크롤링 결과를 저장하지 않습니다.');
        } else {
            // 캐시 데이터 구조 생성
            const cacheData: CacheData = {
                timestamp: new Date().toISOString(),
                count: benchmarkedFlights.length,
                flights: benchmarkedFlights,
                sources: sources,
            };

            // data 디렉토리 확인 및 생성
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            // 통합 캐시 파일 저장
            fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), 'utf-8');

            // 가격 히스토리 기록 (노선별 최저가/평균가)
            const historyPath = path.join(dataDir, 'price-history.json');
            let history: Record<string, Array<{ date: string; minPrice: number; avgPrice: number; count: number }>> = {};
            try {
                if (fs.existsSync(historyPath)) {
                    history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
                }
            } catch (e) {
                console.log('가격 히스토리 파일 초기화');
            }

            // 오늘 날짜
            const todayStr = new Date().toISOString().split('T')[0];

            // 노선별 가격 집계
            const routePrices: Record<string, number[]> = {};
            allFlights.forEach((f: any) => {
                const route = `${f.departure?.city || ''}-${f.arrival?.city || ''}`;
                if (f.price > 0) {
                    if (!routePrices[route]) routePrices[route] = [];
                    routePrices[route].push(f.price);
                }
            });

            // 히스토리에 오늘 데이터 추가 (같은 날이면 덮어쓰기)
            Object.entries(routePrices).forEach(([route, prices]) => {
                if (!history[route]) history[route] = [];
                // 오늘 데이터가 이미 있으면 제거
                history[route] = history[route].filter(h => h.date !== todayStr);
                history[route].push({
                    date: todayStr,
                    minPrice: Math.min(...prices),
                    avgPrice: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
                    count: prices.length,
                });
                // 최근 14일만 유지
                history[route] = history[route].slice(-14);
            });

            fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf-8');
            console.log(`📈 가격 히스토리 기록: ${Object.keys(routePrices).length}개 노선`);

            console.log('\n\n✅ 전체 크롤링 완료!');
            console.log('='.repeat(50));
            console.log(`📊 총 수집된 항공권: ${allFlights.length}개 → 필터 후: ${benchmarkedFlights.length}개`);

            console.log(`   - 노랑풍선: ${sources.ybtour}개`);
            console.log(`   - 하나투어: ${sources.hanatour}개`);
            console.log(`   - 모두투어: ${sources.modetour}개`);
            console.log(`   - 온라인투어: ${sources.onlinetour}개`);
            console.log(`💾 저장 위치: ${cachePath}`);
            console.log(`🕐 타임스탬프: ${cacheData.timestamp}`);
            console.log('='.repeat(50));

        }

    } catch (error) {
        console.error('\n❌ 크롤링 실패:', error);
        process.exit(1);
    }
}

// 스크립트 실행
main();
