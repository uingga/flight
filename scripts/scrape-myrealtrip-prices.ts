import { chromium, Browser } from 'playwright';
import fs from 'fs';
import path from 'path';
import { scrapeMyrealtrip } from '../src/lib/scrapers/myrealtrip';
import { getMyrealtripSearchPrice, type FlightResult } from './lib/myrealtrip-search-page';

/**
 * 마이리얼트립 실제 가격 스크래핑 (Playwright)
 *
 * 1단계: Calendar API로 항공편 목록 갱신 (새 항공편 추가 + 없어진 항공편 제거)
 * 2단계: 마이리얼트립 검색 결과 카드에서 실제 최저가를 추출
 * - 선택 버튼의 "항공권 000원 선택" 값을 사용해 결제 가격을 정확히 읽음
 * - 단일 워커 직렬 실행, 노선 사이 랜덤 휴식
 * - 자동 스케줄은 오전·오후 각 1회
 *
 * 사용법: npx tsx scripts/scrape-myrealtrip-prices.ts
 */

interface CachedFlight {
    id: string;
    source: string;
    price: number;
    airline: string;
    arrival: { airport: string; city: string; date: string };
    departure: { airport: string; city: string; date: string };
    link: string;
    [key: string]: any;
}

// ── 유틸리티 ──────────────────────────────────────────

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const randomDelay = () => delay(4000 + Math.random() * 4000); // 4~8초 랜덤
function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ── GID 맵 로드 ──────────────────────────────────────────

function loadGidMap(): Record<string, number> {
    try {
        const raw = fs.readFileSync(path.resolve(process.cwd(), 'data/gid-map.json'), 'utf8');
        const parsed = JSON.parse(raw);
        const map: Record<string, number> = {};
        for (const [code, val] of Object.entries(parsed)) {
            if (typeof val === 'number') map[code] = val;
            else if (typeof val === 'object' && val && 'gid' in val) map[code] = (val as any).gid;
        }
        return map;
    } catch {
        return {};
    }
}

// ── 가격 추출 (직항만, 항공사+시간 포함) ──────────────────

const INVALID_AIRLINE_LABELS = new Set([
    '더 저렴한 항공권',
    '항공사 제공요금',
    '항공사 미정',
    '공동운항',
]);

function cleanAirlineName(value: string | undefined): string {
    const name = (value || '').trim();
    if (!name || INVALID_AIRLINE_LABELS.has(name) || name.includes('항공권') || name.includes('제공요금') || name.length > 60) return '';
    return name;
}

// ── 병렬 워커 ──────────────────────────────────────────

async function worker(
    browser: Browser,
    tasks: { flight: CachedFlight; gid: number }[],
    results: Map<string, FlightResult>,
    workerId: number
) {
    const page = await browser.newPage();

    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8' });

    for (let i = 0; i < tasks.length; i++) {
        const { flight, gid } = tasks[i];
        const depDate = flight.departure.date;
        const arrDate = flight.arrival.date;

        if (!depDate || !arrDate) continue;

        const result = await getMyrealtripSearchPrice(page, gid, depDate, arrDate);
        if (result) {
            results.set(flight.id, result);
        }

        // 진행률 (워커별)
        if ((i + 1) % 20 === 0) {
            console.log(`  [워커${workerId}] ${i + 1}/${tasks.length} 완료`);
        }

        // 랜덤 딜레이
        await randomDelay();
    }

    await page.close();
}

// ── 메인 ──────────────────────────────────────────

async function main() {
    const startTime = Date.now();
    console.log('=== 마이리얼트립 크롤링 시작 ===');
    console.log(`시작: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n`);

    // ── 1단계: Calendar API로 항공편 목록 갱신 ──────────────────
    console.log('📡 1단계: Calendar API로 최신 항공편 목록 수집...\n');
    const freshFlights = await scrapeMyrealtrip();
    console.log(`\n📡 Calendar API 결과: ${freshFlights.length}개 항공편 수집`);

    // 캐시 로드 & MRT 데이터 교체
    const cachePath = path.resolve(process.cwd(), 'data/all-flights-cache.json');
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));

    const prevMrtCount = cache.flights.filter((f: any) => f.source === 'myrealtrip').length;

    // 안전장치: Calendar API 결과가 기존 대비 50% 미만이면 교체하지 않음
    if (freshFlights.length > 0 && (prevMrtCount === 0 || freshFlights.length >= prevMrtCount * 0.5)) {
        cache.flights = cache.flights.filter((f: any) => f.source !== 'myrealtrip');
        cache.flights.push(...freshFlights);
        console.log(`♻️ MRT 캐시 교체: ${prevMrtCount}개 → ${freshFlights.length}개`);
    } else {
        console.log(`⚠️ Calendar API 결과(${freshFlights.length}개)가 기존(${prevMrtCount}개)의 50% 미만 → 교체 건너뜀, 기존 데이터 유지`);
    }

    // 출발일 60일 초과 마이리얼트립 항공편 제거 (티키티킷에 표시하지 않음)
    const MAX_DAYS = parseInt(process.env.MAX_DAYS_AHEAD || '60', 10);
    const nowDate = new Date();
    const cutoff = new Date(nowDate.getTime() + MAX_DAYS * 24 * 60 * 60 * 1000);
    const beforeCutoff = cache.flights.length;
    cache.flights = cache.flights.filter((f: any) => {
        if (f.source !== 'myrealtrip') return true;
        const dep = new Date(f.departure?.date);
        return dep >= nowDate && dep <= cutoff;
    });
    const removedByDate = beforeCutoff - cache.flights.length;
    if (removedByDate > 0) {
        console.log(`📅 출발 ${MAX_DAYS}일 초과 항공편 제거: ${removedByDate}개 (${beforeCutoff} → ${cache.flights.length})`);
    }

    // Playwright 단계가 비정상 종료되면 기존 운영 캐시를 그대로 보존하기 위해
    // 모든 검증이 끝날 때까지 파일에는 쓰지 않는다.
    console.log('💾 Calendar API 결과를 메모리에 보관 (검증 후 최종 저장)\n');

    // ── 2단계: Playwright로 실제 가격 보정 ──────────────────
    console.log('🎭 2단계: Playwright로 실제 가격 보정 시작...\n');

    const mrtFlights: CachedFlight[] = cache.flights.filter((f: any) => f.source === 'myrealtrip');
    const gidMap = loadGidMap();

    // gid 있는 노선만 (링크가 정확한 노선)
    const now = new Date();

    const tasks = mrtFlights
        .filter(f => {
            if (!gidMap[f.arrival.airport] || !f.departure.date || !f.arrival.date) return false;
            const depDate = new Date(f.departure.date);
            if (depDate < now) return false;       // 이미 지난 항공편 제외
            return true;
        })
        .map(f => ({ flight: f, gid: gidMap[f.arrival.airport] }));

    console.log(`대상: ${tasks.length}개 노선 (gid 있는 마이리얼트립 항공편)`);
    if (mrtFlights.length === 0) {
        throw new Error('마이리얼트립 항공편이 0건이므로 기존 캐시를 보존하고 작업을 중단합니다.');
    }
    if (tasks.length === 0) {
        throw new Error(`마이리얼트립 ${mrtFlights.length}건에 조회 가능한 gid/날짜 조합이 없어 작업을 중단합니다.`);
    }
    // 셔플 (매 회차 같은 노선이 항상 먼저 요청되지 않게 순서만 분산)
    const shuffled = shuffle(tasks);

    // 한 회선에서 동시 요청을 만들지 않는다.
    const WORKERS = 1;
    const chunks: typeof tasks[] = Array.from({ length: WORKERS }, () => []);
    shuffled.forEach((task, i) => chunks[i % WORKERS].push(task));

    console.log(`직렬: ${WORKERS}개 워커 (${chunks[0].length}개)\n`);

    // 브라우저 실행
    const browser = await chromium.launch({ headless: true });

    const results = new Map<string, FlightResult>();

    // 1차 실행
    try {
        await Promise.all(
            chunks.map((chunk, i) => worker(browser, chunk, results, i + 1))
        );
    } finally {
        await browser.close();
    }

    // 2차 재시도: 실패한 노선만
    const failedTasks = tasks.filter(t => !results.has(t.flight.id));
    const MAX_ISOLATED_RETRIES = 10;
    const isolatedRetryLimit = Math.min(MAX_ISOLATED_RETRIES, Math.ceil(tasks.length * 0.1));
    if (failedTasks.length > 0 && failedTasks.length <= isolatedRetryLimit) {
        console.log(`\n🔄 ${failedTasks.length}개 실패 노선 재시도 중...\n`);
        const retryBrowser = await chromium.launch({ headless: true });
        const retryChunks: typeof tasks[] = Array.from({ length: WORKERS }, () => []);
        shuffle(failedTasks).forEach((task, i) => retryChunks[i % WORKERS].push(task));
        try {
            await Promise.all(
                retryChunks.map((chunk, i) => worker(retryBrowser, chunk, results, i + 10))
            );
        } finally {
            await retryBrowser.close();
        }
        const recovered = failedTasks.length - tasks.filter(t => !results.has(t.flight.id)).length;
        console.log(`✅ 재시도 결과: ${recovered}개 복구 성공`);
    } else if (failedTasks.length > isolatedRetryLimit) {
        console.log(`\n⏸️ 실패 ${failedTasks.length}개는 대량 재시도하지 않습니다 (단일 회차 재시도 한도 ${isolatedRetryLimit}개).`);
    }

    // 사이트 구조 변경·차단·브라우저 장애처럼 전 노선에 영향을 주는 실패를
    // 개별 항공권 매진으로 오판하지 않는다. 이 경우 파일을 쓰지 않고 실패로 종료한다.
    const successRatio = results.size / tasks.length;
    const minSuccessRatio = Number(process.env.MIN_SUCCESS_RATIO || '0.5');
    if (successRatio < minSuccessRatio) {
        throw new Error(
            `마이리얼트립 대량 조회 실패: ${results.size}/${tasks.length}건 성공 ` +
            `(${(successRatio * 100).toFixed(1)}%, 최소 ${(minSuccessRatio * 100).toFixed(0)}%). 기존 캐시를 보존합니다.`
        );
    }

    // 캐시 업데이트
    let updated = 0;
    let priceUp = 0;
    let priceDown = 0;
    let seatsUpdated = 0;
    // 전체 장애가 아닌 개별 조회 실패는 오래된 Calendar API 가격으로 노출하지 않는다.
    // 대량 실패 안전장치를 통과한 뒤에만 실제 화면에서 확인된 항공권만 남긴다.
    const verifiedIds = new Set(results.keys());
    const beforeVerifiedOnly = cache.flights.length;
    cache.flights = cache.flights.filter((flight: any) =>
        flight.source !== 'myrealtrip' || verifiedIds.has(flight.id)
    );
    const unverifiedRemoved = beforeVerifiedOnly - cache.flights.length;
    if (unverifiedRemoved > 0) {
        console.log(`\n🧹 실제 가격 미확인 ${unverifiedRemoved}개 → 표시 대상에서 제외`);
    }

    for (const [flightId, result] of results) {
        const idx = cache.flights.findIndex((f: any) => f.id === flightId);
        if (idx >= 0) {
            const oldPrice = cache.flights[idx].price;
            cache.flights[idx].price = result.price;
            cache.flights[idx].airline = cleanAirlineName(result.airline)
                || cleanAirlineName(cache.flights[idx].airline)
                || '항공사 미정';
            // 표기 규약: departure.time=가는편 출발, departure.arrivalTime=가는편 도착,
            // arrival.time=오는편 출발, arrival.arrivalTime=오는편 도착 (다른 소스와 동일)
            // 이전에는 arrival.time에 가는편 도착시간이 들어가 귀국편 출발시간처럼 표시되는 버그가 있었다.
            cache.flights[idx].departure.time = result.depTime;
            cache.flights[idx].departure.arrivalTime = result.arrTime;
            cache.flights[idx].duration = result.duration;
            cache.flights[idx].arrival.time = result.retDepTime;
            cache.flights[idx].arrival.arrivalTime = result.retArrTime;
            cache.flights[idx].returnDuration = result.retDuration;
            if (result.routeAirports) {
                cache.flights[idx].routeAirports = result.routeAirports;
            } else {
                // 도시 검색 코드(SHA 등)를 실제 공항으로 오인하지 않도록 확인되지 않은 값은 남기지 않는다.
                delete cache.flights[idx].routeAirports;
            }
            if (result.availableSeats !== undefined) {
                cache.flights[idx].availableSeats = result.availableSeats;
                cache.flights[idx].seats = `${result.availableSeats}석 남음`;
                seatsUpdated++;
            } else {
                // 잔여 좌석은 실시간 정보라 이번 화면에서 확인하지 못한 이전 값을 재사용하지 않는다.
                delete cache.flights[idx].availableSeats;
                delete cache.flights[idx].seats;
            }

            const diff = Math.abs(result.price - oldPrice);
            if (diff > 5000) {
                if (result.price > oldPrice) priceUp++;
                else priceDown++;
            }
            updated++;
        }
    }

    // 벤치마크 필터 때문에 화면에서 제외되더라도 여행사 예약 화면에서 이번에 정상
    // 확인한 상품의 가격·좌석 생애는 이어서 기록한다.
    const lifecycleFlights = cache.flights
        .filter((flight: any) => flight.source === 'myrealtrip')
        .map((flight: any) => JSON.parse(JSON.stringify(flight)));

    // ── 인터파크 벤치마크 필터링 ──────────────────────────────
    console.log(`\n=== 인터파크 가격 벤치마크 ===`);
    const benchmarkPath = path.resolve(process.cwd(), 'data/interpark-prices.json');
    let benchmarkFiltered = 0;
    try {
        if (fs.existsSync(benchmarkPath)) {
            const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'));
            const cacheAge = Date.now() - new Date(benchmark.timestamp).getTime();
            console.log(`♻️ 인터파크 캐시 사용 (${Math.round(cacheAge / 3600000)}시간 전)`);

            // CITY_TO_AIRPORT 간단 매핑 (resolveCityCode 대용)
            const { resolveCityCode } = await import('../src/lib/scrapers/interpark');

            const beforeFilter = cache.flights.length;
            cache.flights = cache.flights.filter((f: any) => {
                if (f.source !== 'myrealtrip') return true; // 다른 소스는 건드리지 않음

                const cityCode = resolveCityCode(f.arrival?.city || '', f.arrival?.airport);
                if (!cityCode) return true;

                const depDate = f.departure?.date || '';
                const dateStr = depDate.replace(/[^0-9\-\.]/g, '').replace(/\./g, '-').replace(/-+$/, '');
                const dateMatch = dateStr.match(/^(\d{4})-(\d{2})/);
                if (!dateMatch) return true;

                const yearMonth = `${dateMatch[1]}-${dateMatch[2]}`;
                const cityPrices = benchmark.prices?.[cityCode];
                if (!cityPrices || !cityPrices[yearMonth]) return true;

                const interparkAvg = cityPrices[yearMonth].avg;
                if (f.price > interparkAvg) {
                    console.log(`  ❌ 필터: ${f.arrival?.city} ${yearMonth} ${f.price.toLocaleString()}원 > 인터파크 평균 ${interparkAvg.toLocaleString()}원`);
                    return false;
                }

                // 할인율 계산
                const interparkLowest = cityPrices[yearMonth].lowest;
                f.discountRate = interparkLowest > 0
                    ? Math.round((1 - f.price / interparkLowest) * 100)
                    : 0;

                return true;
            });
            benchmarkFiltered = beforeFilter - cache.flights.length;
            console.log(`📊 인터파크 기준 필터: ${benchmarkFiltered}개 제거 (${beforeFilter} → ${cache.flights.length})`);
        } else {
            console.log('⚠️ interpark-prices.json 없음 → 필터링 건너뜀');
        }
    } catch (e) {
        console.error('⚠️ 인터파크 벤치마크 실패:', e);
    }

    // ── 네이버 최저가 비교 필터링 (비활성화) ──────────────────────────────
    // console.log(`\n=== 네이버 최저가 비교 ===`);
    // 네이버 필터 일시 중단

    const finalMrtCount = cache.flights.filter((flight: any) => flight.source === 'myrealtrip').length;
    if (finalMrtCount === 0) {
        throw new Error('가격 검증과 필터 적용 후 마이리얼트립 항공편이 0건이므로 기존 캐시를 보존합니다.');
    }

    // 저장
    cache.count = cache.flights.length;
    if (cache.sources && typeof cache.sources === 'object') {
        cache.sources.myrealtrip = finalMrtCount;
    }
    cache.lastUpdated = new Date().toISOString();
    cache.sourceUpdatedAt = {
        ...(cache.sourceUpdatedAt || {}),
        myrealtrip: cache.lastUpdated,
    };
    fs.writeFileSync(cachePath, JSON.stringify(cache));

    const lifecycleObservationPath = process.env.LIFECYCLE_OBSERVATION_PATH;
    if (lifecycleObservationPath) {
        const visibleIds = new Set(
            cache.flights
                .filter((flight: any) => flight.source === 'myrealtrip')
                .map((flight: any) => String(flight.id)),
        );
        fs.writeFileSync(lifecycleObservationPath, JSON.stringify({
            observedAt: cache.lastUpdated,
            cachePreserved: false,
            alerts: [],
            sources: {
                myrealtrip: {
                    status: results.size === tasks.length ? 'success' : 'warning',
                    scraped: results.size,
                    allowMissing: results.size === tasks.length,
                },
            },
            observations: lifecycleFlights.map((flight: any) => ({
                flight,
                visible: visibleIds.has(String(flight.id)),
            })),
        }), 'utf8');
        console.log(`생애 기록 입력 준비: ${lifecycleFlights.length}개 후보`);
    }

    const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
    console.log(`\n=== 스크래핑 완료 ===`);
    console.log(`소요: ${elapsed}분`);
    console.log(`검증: ${results.size}/${tasks.length}개 성공`);
    console.log(`보정: ${updated}개 (↑${priceUp} ↓${priceDown})`);
    console.log(`잔여 좌석: ${seatsUpdated}/${updated}개 확인`);
    console.log(`표시 제외: ${unverifiedRemoved}개`);
    if (benchmarkFiltered > 0) console.log(`인터파크 필터: ${benchmarkFiltered}개 제거`);
}

main().catch((error) => {
    console.error('\n❌ 마이리얼트립 스크래핑 중단:', error);
    process.exitCode = 1;
});
