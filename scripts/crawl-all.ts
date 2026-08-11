
import { scrapeYbtour } from '../src/lib/scrapers/ybtour';
import { scrapeHanatour } from '../src/lib/scrapers/hanatour';
import { scrapeModetour } from '../src/lib/scrapers/modetour';
import { scrapeOnlineTour } from '../src/lib/scrapers/onlinetour';
import { scrapeTtang } from '../src/lib/scrapers/ttang';
import { scrapeMyrealtrip } from '../src/lib/scrapers/myrealtrip';
import { scrapeInterparkBenchmark, resolveCityCode } from '../src/lib/scrapers/interpark';
import { logCrawlResults } from '../src/lib/utils/crawl-logger';
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
        ttang: number;
        myrealtrip: number;
    };
    priceHistory?: Record<string, Array<{ date: string; minPrice: number; avgPrice: number; count: number }>>;
}

async function main() {
    console.log('🚀 전체 사이트 크롤링 시작...\n');

    const allFlights: any[] = [];
    const sources = {

        ybtour: 0,
        hanatour: 0,
        modetour: 0,
        onlinetour: 0,
        ttang: 0,
        myrealtrip: 0,
    };

    // 이전 캐시 로드 (시간 데이터 이어받기 위해)
    const dataDir = path.join(process.cwd(), 'data');
    const cachePath = path.join(dataDir, 'all-flights-cache.json');
    let prevCache: CacheData | null = null;
    try {
        if (fs.existsSync(cachePath)) {
            prevCache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        }
    } catch { }
    const prevFlights = prevCache?.flights || [];

    try {
        // 전체 사이트 병렬 크롤링
        console.log('🔄 6개 사이트 병렬 크롤링 시작...\n');

        const scraperTasks = [
            { name: '노랑풍선', key: 'ybtour' as const, fn: () => scrapeYbtour(prevFlights) },
            { name: '하나투어', key: 'hanatour' as const, fn: () => scrapeHanatour() },
            { name: '모두투어', key: 'modetour' as const, fn: () => scrapeModetour() },
            { name: '온라인투어', key: 'onlinetour' as const, fn: () => scrapeOnlineTour() },
            { name: '땡처리닷컴', key: 'ttang' as const, fn: () => scrapeTtang(prevFlights) },
            // 마이리얼트립은 별도 Playwright 워크플로우(myrealtrip-scrape.yml)에서 처리
            // Bulk API는 시간/가격 정보가 부정확하므로 여기서 실행하지 않음
        ];

        const results = await Promise.allSettled(scraperTasks.map(t => t.fn()));

        results.forEach((result, i) => {
            const task = scraperTasks[i];
            if (result.status === 'fulfilled') {
                allFlights.push(...result.value);
                sources[task.key] = result.value.length;
                console.log(`✅ ${task.name}: ${result.value.length}개`);
            } else {
                console.error(`❌ ${task.name} 실패:`, result.reason);
            }
        });


        // 소스별 실패 시 이전 데이터 복구
        const sourceNames = ['ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang', 'myrealtrip'] as const;
        for (const src of sourceNames) {
            if (sources[src] === 0 && prevCache?.flights) {
                const srcPrevFlights = prevCache.flights.filter((f: any) => f.source === src);
                if (srcPrevFlights.length > 0) {
                    console.log(`⚠️ ${src} 실패 → 이전 캐시 ${srcPrevFlights.length}개 유지`);
                    allFlights.push(...srcPrevFlights);
                    sources[src] = srcPrevFlights.length;
                }
            }
        }

        // 통합 크롤링 로그 기록 (병렬 실행 후 한 번에)
        for (const src of sourceNames) {
            if (sources[src] > 0) {
                const srcFlights = allFlights.filter((f: any) => f.source === src);
                const cityStats: { [city: string]: number } = {};
                srcFlights.forEach((f: any) => {
                    const city = f.arrival?.city || '기타';
                    cityStats[city] = (cityStats[city] || 0) + 1;
                });
                logCrawlResults(src, sources[src], undefined, cityStats);
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
            // 마이리얼트립은 별도 워크플로우에서 자체 필터링하므로 여기서 제외
            if (f.source === 'myrealtrip') return true;
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

        // 편도 항공권 제거 (귀국일 없는 항공편)
        console.log('\n=== 편도 항공권 제거 ===');
        const beforeOneWay = activeFlights.length;
        const roundTripFlights = activeFlights.filter((f: any) => {
            return f.arrival?.date && f.arrival.date.trim() !== '';
        });
        const oneWayCount = beforeOneWay - roundTripFlights.length;
        if (oneWayCount > 0) {
            console.log(`✈️ 편도 항공권 ${oneWayCount}개 제거 (${beforeOneWay} → ${roundTripFlights.length})`);
        } else {
            console.log('✅ 편도 항공권 없음');
        }

        // 출발지 = 도착지인 깨진 항공권 제거 (스크래퍼 파싱 오류 방어)
        console.log('\n=== 출발지/도착지 검증 ===');
        const beforeSameCity = roundTripFlights.length;
        const validRouteFlights = roundTripFlights.filter((f: any) => {
            const dep = (f.departure?.city || '').trim();
            const arr = (f.arrival?.city || '').trim();
            if (!arr) return false;
            return dep !== arr;
        });
        const sameCityCount = beforeSameCity - validRouteFlights.length;
        if (sameCityCount > 0) {
            console.warn(`⚠️ 출발지=도착지 항공권 ${sameCityCount}개 제거 (${beforeSameCity} → ${validRouteFlights.length}) — 스크래퍼 파싱 점검 필요`);
        } else {
            console.log('✅ 출발지/도착지 이상 없음');
        }

        // 인터파크 벤치마크 기반 필터링
        console.log('\n=== 인터파크 가격 벤치마크 ===');
        let benchmarkedFlights = validRouteFlights;
        try {
            const dataDir = path.join(process.cwd(), 'data');
            const benchmarkPath = path.join(dataDir, 'interpark-prices.json');

            // 기존 벤치마크가 24시간 이내면 재사용 (API 호출 최소화)
            let benchmark: any = null;
            try {
                if (fs.existsSync(benchmarkPath)) {
                    const cached = JSON.parse(fs.readFileSync(benchmarkPath, 'utf-8'));
                    const cacheAge = Date.now() - new Date(cached.timestamp).getTime();
                    const maxAge = 24 * 60 * 60 * 1000; // 24시간
                    if (cacheAge < maxAge && Object.keys(cached.prices || {}).length > 0) {
                        benchmark = cached;
                        console.log(`♻️ 인터파크 캐시 재사용 (${Math.round(cacheAge / 3600000)}시간 전 수집)`);
                    }
                }
            } catch { }

            // 캐시가 없거나 오래되었으면 새로 수집
            if (!benchmark) {
                const arrCityCodes = new Set<string>();
                validRouteFlights.forEach((f: any) => {
                    const code = resolveCityCode(f.arrival?.city || '', f.arrival?.airport);
                    if (code) arrCityCodes.add(code);
                });

                benchmark = await scrapeInterparkBenchmark(Array.from(arrCityCodes));
                fs.writeFileSync(benchmarkPath, JSON.stringify(benchmark, null, 2), 'utf-8');
                console.log(`💾 인터파크 벤치마크 저장: ${benchmarkPath}`);
            }

            // 인터파크 월 평균가보다 비싼 항공편 필터링
            const beforeBenchmark = validRouteFlights.length;
            benchmarkedFlights = validRouteFlights.filter((f: any) => {
                // 도착 도시 코드 추출 (resolveCityCode로 모든 형식 지원)
                const cityCode = resolveCityCode(f.arrival?.city || '', f.arrival?.airport);
                if (!cityCode) {
                    f.discountRate = 0;
                    return true; // 코드 없으면 유지
                }

                // 출발월 추출
                const depDate = f.departure?.date || '';
                const dateStr = depDate.replace(/[^0-9\-\.]/g, '').replace(/\./g, '-').replace(/-+$/, '');
                const dateMatch = dateStr.match(/^(\d{4})-(\d{2})/);
                if (!dateMatch) {
                    f.discountRate = 0;
                    return true; // 날짜 파싱 불가하면 유지
                }

                const yearMonth = `${dateMatch[1]}-${dateMatch[2]}`;

                // 인터파크 월 평균가 조회
                const cityPrices = benchmark.prices[cityCode];
                if (!cityPrices || !cityPrices[yearMonth]) {
                    f.discountRate = 0;
                    return true; // 비교 데이터 없으면 유지
                }

                const interparkAvg = cityPrices[yearMonth].avg;

                // 인터파크 월 평균가보다 비싸면 제거
                if (f.price > interparkAvg) {
                    console.log(`  ❌ 필터: ${f.arrival?.city} ${yearMonth} ${f.price.toLocaleString()}원 > 인터파크 평균 ${interparkAvg.toLocaleString()}원 (${f.source})`);
                    return false;
                }

                // 인터파크 최저가 대비 할인율 계산
                const interparkLowest = cityPrices[yearMonth].lowest;
                f.discountRate = interparkLowest > 0
                    ? Math.round((1 - f.price / interparkLowest) * 100)
                    : 0;

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
            // firstSeen 필드 추가: 이전 캐시와 비교하여 새 항공편 감지
            const prevFlightMap = new Map<string, string>();
            if (prevCache?.flights) {
                prevCache.flights.forEach((f: any) => {
                    if (f.id && f.firstSeen) {
                        prevFlightMap.set(f.id, f.firstSeen);
                    }
                });
            }
            const todayDate = new Date().toISOString().split('T')[0];
            let newFlightCount = 0;
            benchmarkedFlights.forEach((f: any) => {
                const prevFirstSeen = prevFlightMap.get(f.id);
                if (prevFirstSeen) {
                    f.firstSeen = prevFirstSeen; // 기존 항공편: firstSeen 이어받기
                } else {
                    f.firstSeen = todayDate; // 새 항공편
                    newFlightCount++;
                }
            });
            console.log(`🆕 오늘 새로 추가된 항공편: ${newFlightCount}개 / 전체 ${benchmarkedFlights.length}개`);

            // 캐시 데이터 구조 생성 (가격 히스토리 포함)
            // 먼저 기존 히스토리를 로드하여 cacheData에 포함
            const historyPath = path.join(dataDir, 'price-history.json');
            let history: Record<string, Array<{ date: string; minPrice: number; avgPrice: number; count: number }>> = {};
            try {
                if (fs.existsSync(historyPath)) {
                    history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
                }
            } catch (e) {
                console.log('가격 히스토리 파일 초기화');
            }

            const cacheData: CacheData = {
                timestamp: new Date().toISOString(),
                count: benchmarkedFlights.length,
                flights: benchmarkedFlights,
                sources: sources,
                priceHistory: history,
            };

            // data 디렉토리 확인 및 생성
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            // 가격 히스토리에 오늘 데이터 추가 (history는 위에서 이미 로드됨)
            const todayStr = new Date().toISOString().split('T')[0];
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

            // cacheData에 최신 히스토리 반영
            cacheData.priceHistory = history;

            // 통합 캐시 파일 저장
            fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), 'utf-8');

            // 히스토리 별도 파일도 저장
            fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf-8');
            console.log(`📈 가격 히스토리 기록: ${Object.keys(routePrices).length}개 노선`);

            console.log('\n\n✅ 전체 크롤링 완료!');
            console.log('='.repeat(50));
            console.log(`📊 총 수집된 항공권: ${allFlights.length}개 → 필터 후: ${benchmarkedFlights.length}개`);

            console.log(`   - 노랑풍선: ${sources.ybtour}개`);
            console.log(`   - 하나투어: ${sources.hanatour}개`);
            console.log(`   - 모두투어: ${sources.modetour}개`);
            console.log(`   - 온라인투어: ${sources.onlinetour}개`);
            console.log(`   - 마이리얼트립: ${sources.myrealtrip}개`);
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
