import { chromium, Browser } from 'playwright';
import fs from 'fs';
import path from 'path';
import {
    isMyrealtripQuickDepartureSeed,
    matchesMyrealtripQuickDepartureRoute,
    assertMyrealtripSeedReplacementSafe,
    scrapeMyrealtripWithDiagnostics,
    selectInterparkMyrealtripDateCandidates,
} from '../src/lib/scrapers/myrealtrip';
import { getMyrealtripSearchPrice, type FlightResult } from './lib/myrealtrip-search-page';
import {
    assertNoSourceResponseCollapse,
    SourceResponseError,
} from '../src/lib/scrapers/source-response';
import {
    classifySourceAccessRestriction,
    isSourceCircuitOpen,
    openSourceCircuit,
    SOURCE_ADAPTER_VERSIONS,
    sourceCircuitLabel,
} from '../src/lib/source-circuit';
import { logCrawlResults, recordCrawlAlerts } from '../src/lib/utils/crawl-logger';
import {
    clearUnsupportedInterparkDiscount,
    evaluateInterparkBenchmark,
} from '../src/lib/interpark-benchmark';
import { fetchInterparkPopularLowestRoutes } from '../src/lib/scrapers/interpark';

/**
 * 마이리얼트립 실제 가격 스크래핑 (Playwright)
 *
 * 1단계: Calendar API로 항공편 목록 갱신 (새 항공편 추가 + 없어진 항공편 제거)
 * 2단계: 마이리얼트립 검색 결과 카드에서 실제 최저가를 추출
 * - 선택 버튼의 "항공권 000원 선택" 값을 사용해 결제 가격을 정확히 읽음
 * - 단일 워커 직렬 실행, 노선 사이 랜덤 휴식
 * - 자동 스케줄은 오전 1회·오후 1회 (07:05·16:03 KST)
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
const CACHE_PATH = path.resolve(process.cwd(), 'data/all-flights-cache.json');
const INTERPARK_BENCHMARK_PATH = path.resolve(process.cwd(), 'data/interpark-prices.json');
const BATCH_SIZE = 10;
const batchRest = () => delay(30_000 + Math.random() * 30_000);
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

function flightIdentity(flight: CachedFlight): string {
    return [
        flight.airline,
        flight.departure?.airport || flight.departure?.city,
        flight.arrival?.airport || flight.arrival?.city,
        flight.departure?.date,
        flight.arrival?.date,
    ].join('|');
}

function countCities(flights: CachedFlight[]): Record<string, number> {
    return flights.reduce<Record<string, number>>((counts, flight) => {
        const city = flight.arrival?.city || '기타';
        counts[city] = (counts[city] || 0) + 1;
        return counts;
    }, {});
}

// ── 병렬 워커 ──────────────────────────────────────────

async function worker(
    browser: Browser,
    tasks: { flight: CachedFlight; gid: number; optionalQuickSeed: boolean }[],
    results: Map<string, FlightResult>,
    workerId: number,
    enforceCollapse = true,
) {
    const page = await browser.newPage();

    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8' });
    let succeeded = 0;
    let consecutiveEmpty = 0;
    let requiredProcessed = 0;

    try {
        for (let i = 0; i < tasks.length; i++) {
            const { flight, gid, optionalQuickSeed } = tasks[i];
            const depDate = flight.departure.date;
            const arrDate = flight.arrival.date;

            if (!depDate || !arrDate) continue;

            let result = await getMyrealtripSearchPrice(page, gid, depDate, arrDate);
            if (result && optionalQuickSeed && !matchesMyrealtripQuickDepartureRoute(flight, result)) {
                console.warn(
                    `[마이리얼트립] 빠른 출발 후보 경로 불일치 또는 직항 미확인 — `
                    + `${flight.departure.airport}→${flight.arrival.airport} ${depDate}~${arrDate}`,
                );
                result = null;
            }
            if (result) {
                results.set(flight.id, result);
            }

            // 빠른 출발 후보는 없어도 정상인 보조 탐색이다. 후보 실패를 사이트 전체
            // 응답 붕괴로 계산하면 정상 정규 수집까지 폐기될 수 있으므로 분리한다.
            if (!optionalQuickSeed) {
                requiredProcessed++;
                if (result) {
                    succeeded++;
                    consecutiveEmpty = 0;
                } else {
                    consecutiveEmpty++;
                }
            }

            if (enforceCollapse && !optionalQuickSeed) {
                assertNoSourceResponseCollapse('마이리얼트립 실제 운임 화면', {
                    processed: requiredProcessed,
                    succeeded,
                    consecutiveFailures: consecutiveEmpty,
                }, {
                    maxConsecutiveFailures: 8,
                    minSamples: 20,
                    minSuccessRatio: 0.2,
                });
            }

            // 진행률 (워커별)
            if ((i + 1) % 20 === 0) {
                console.log(`  [워커${workerId}] ${i + 1}/${tasks.length} 완료`);
            }

            await randomDelay();
            if ((i + 1) % BATCH_SIZE === 0 && i + 1 < tasks.length) {
                console.log(`  [워커${workerId}] ${BATCH_SIZE}건 처리 후 30~60초 휴식`);
                await batchRest();
            }
        }
    } finally {
        await page.close().catch(() => undefined);
    }
}

// ── 메인 ──────────────────────────────────────────

async function main() {
    const startTime = Date.now();
    console.log('=== 마이리얼트립 크롤링 시작 ===');
    console.log(`시작: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n`);

    const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    const existingCircuit = cache.sourceCircuits?.myrealtrip;
    if (isSourceCircuitOpen(existingCircuit, SOURCE_ADAPTER_VERSIONS.myrealtrip)) {
        console.log(
            `⏸️ 마이리얼트립 ${sourceCircuitLabel(existingCircuit)} 뒤 휴식 중 — `
            + `${existingCircuit.nextProbeAt} 이후 한 번만 재탐색합니다.`,
        );
        return;
    }

    const MAX_DAYS = parseInt(process.env.MAX_DAYS_AHEAD || '60', 10);
    let interparkBenchmark: any = null;
    try {
        if (fs.existsSync(INTERPARK_BENCHMARK_PATH)) {
            interparkBenchmark = JSON.parse(fs.readFileSync(INTERPARK_BENCHMARK_PATH, 'utf8'));
        }
    } catch (error) {
        console.warn(
            '⚠️ 인터파크 월별 기준가 파일을 읽지 못했습니다. 이번 회차의 월별 기준가 필터를 건너뜁니다:',
            error instanceof Error ? error.message : String(error),
        );
    }

    // 빠른 출발 목록은 월별 기준가 캐시를 재사용하지 않는다. 오전·오후 마이리얼트립
    // 정규 회차가 시작될 때마다 바로 새로 읽고, 실패하면 이번 회차의 추가 후보만 생략한다.
    let quickDepartureSnapshot: {
        popularUpdatedAt: string;
        popularLowestRoutes: Awaited<ReturnType<typeof fetchInterparkPopularLowestRoutes>>;
    } | null = null;
    try {
        console.log('🧭 인터파크 빠르게 떠나는 최저가 수집...');
        const popularLowestRoutes = await fetchInterparkPopularLowestRoutes();
        quickDepartureSnapshot = {
            popularUpdatedAt: new Date().toISOString(),
            popularLowestRoutes,
        };
        console.log(`🧭 인터파크 빠른 출발 목록 ${popularLowestRoutes.length}개 수집 완료`);
    } catch (error) {
        console.warn(
            '⚠️ 인터파크 빠른 출발 목록을 받지 못해 이번 회차의 추가 후보만 건너뜁니다:',
            error instanceof Error ? error.message : String(error),
        );
    }

    const quickDepartureCandidates = selectInterparkMyrealtripDateCandidates(quickDepartureSnapshot, {
        maxCandidates: Number(process.env.MRT_QUICK_DEPARTURE_MAX_CANDIDATES || '8'),
        maxDaysAhead: MAX_DAYS,
    });
    console.log(
        quickDepartureCandidates.length > 0
            ? `🧭 인터파크 빠른 출발 일정 ${quickDepartureCandidates.length}개를 추가 검증 후보로 사용`
            : '🧭 사용할 수 있는 최신 빠른 출발 일정 없음',
    );

    // ── 1단계: Calendar API로 항공편 목록 갱신 ──────────────────
    console.log('📡 1단계: Calendar API로 최신 항공편 목록 수집...\n');
    const seedResult = await scrapeMyrealtripWithDiagnostics({
        dateCandidates: quickDepartureCandidates,
    });
    const freshFlights = seedResult.flights;
    console.log(`\n📡 Calendar API 결과: ${freshFlights.length}개 항공편 수집`);

    // 캐시 로드 & MRT 데이터 교체
    const previousMrtFlights = cache.flights.filter((f: any) => f.source === 'myrealtrip');
    const prevMrtCount = previousMrtFlights.length;

    // 원래 0건인 출발지는 허용하되, 기존에 있던 출발지의 소실이나 전체 급감은
    // Playwright를 열기 전에 중단해 이전 운영 캐시를 그대로 지킨다.
    assertMyrealtripSeedReplacementSafe(
        freshFlights,
        previousMrtFlights,
        seedResult.bulkCoverage,
    );
    cache.flights = cache.flights.filter((f: any) => f.source !== 'myrealtrip');
    cache.flights.push(...freshFlights);
    console.log(`♻️ MRT 캐시 교체: ${prevMrtCount}개 → ${freshFlights.length}개`);

    // 출발일 60일 초과 마이리얼트립 항공편 제거 (티키티킷에 표시하지 않음)
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
        .map(f => ({
            flight: f,
            gid: gidMap[f.arrival.airport],
            optionalQuickSeed: isMyrealtripQuickDepartureSeed(f),
        }));

    console.log(`대상: ${tasks.length}개 노선 (gid 있는 마이리얼트립 항공편)`);
    if (mrtFlights.length === 0) {
        throw new Error('마이리얼트립 항공편이 0건이므로 기존 캐시를 보존하고 작업을 중단합니다.');
    }
    if (tasks.length === 0) {
        throw new Error(`마이리얼트립 ${mrtFlights.length}건에 조회 가능한 gid/날짜 조합이 없어 작업을 중단합니다.`);
    }
    // 정규 항공권을 먼저 안전하게 확인하고, 없어도 정상인 빠른 출발 후보는 뒤에서
    // 별도로 검증한다. 각 묶음 안의 순서만 분산한다.
    const regularTasks = tasks.filter(task => !task.optionalQuickSeed);
    const quickSeedTasks = tasks.filter(task => task.optionalQuickSeed);
    const shuffled = [...shuffle(regularTasks), ...shuffle(quickSeedTasks)];
    console.log(`  정규 ${regularTasks.length}개 / 빠른 출발 추가 후보 ${quickSeedTasks.length}개`);

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
            chunks.map((chunk, i) => worker(browser, chunk, results, i + 1, true))
        );
    } finally {
        await browser.close();
    }

    // 2차 재시도: 실패한 노선만
    const failedTasks = regularTasks.filter(t => !results.has(t.flight.id));
    const MAX_ISOLATED_RETRIES = 10;
    const isolatedRetryLimit = Math.min(MAX_ISOLATED_RETRIES, Math.ceil(tasks.length * 0.1));
    if (failedTasks.length > 0 && failedTasks.length <= isolatedRetryLimit) {
        console.log(`\n🔄 ${failedTasks.length}개 실패 노선 재시도 중...\n`);
        const retryBrowser = await chromium.launch({ headless: true });
        const retryChunks: typeof tasks[] = Array.from({ length: WORKERS }, () => []);
        shuffle(failedTasks).forEach((task, i) => retryChunks[i % WORKERS].push(task));
        try {
            await Promise.all(
                retryChunks.map((chunk, i) => worker(retryBrowser, chunk, results, i + 10, false))
            );
        } finally {
            await retryBrowser.close();
        }
        const recovered = failedTasks.length - regularTasks.filter(t => !results.has(t.flight.id)).length;
        console.log(`✅ 재시도 결과: ${recovered}개 복구 성공`);
    } else if (failedTasks.length > isolatedRetryLimit) {
        console.log(`\n⏸️ 실패 ${failedTasks.length}개는 대량 재시도하지 않습니다 (단일 회차 재시도 한도 ${isolatedRetryLimit}개).`);
    }

    // 사이트 구조 변경·차단·브라우저 장애처럼 전 노선에 영향을 주는 실패를
    // 개별 항공권 매진으로 오판하지 않는다. 이 경우 파일을 쓰지 않고 실패로 종료한다.
    const regularSuccessCount = regularTasks.filter(task => results.has(task.flight.id)).length;
    const successRatio = regularSuccessCount / regularTasks.length;
    const minSuccessRatio = Number(process.env.MIN_SUCCESS_RATIO || '0.5');
    if (successRatio < minSuccessRatio) {
        throw new SourceResponseError(
            'soft-block',
            `마이리얼트립 대량 조회 실패: ${regularSuccessCount}/${regularTasks.length}건 성공 ` +
            `(${(successRatio * 100).toFixed(1)}%, 최소 ${(minSuccessRatio * 100).toFixed(0)}%). 기존 캐시를 보존합니다.`,
            200,
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
            if (isMyrealtripQuickDepartureSeed(cache.flights[idx])) {
                const difference = result.price - oldPrice;
                console.log(
                    `  🧭 빠른 출발 후보 확인: ${cache.flights[idx].arrival?.city} `
                    + `${cache.flights[idx].departure?.date}~${cache.flights[idx].arrival?.date} `
                    + `참고 ${oldPrice.toLocaleString()}원 → 마이리얼트립 ${result.price.toLocaleString()}원 `
                    + `(${difference >= 0 ? '+' : ''}${difference.toLocaleString()}원)`,
                );
            }
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
    let benchmarkFiltered = 0;
    try {
        if (interparkBenchmark) {
            const benchmark = interparkBenchmark;
            const cacheAge = Date.now() - new Date(benchmark.timestamp).getTime();
            console.log(`♻️ 인터파크 캐시 사용 (${Math.round(cacheAge / 3600000)}시간 전)`);

            const beforeFilter = cache.flights.length;
            cache.flights = cache.flights.filter((f: any) => {
                if (f.source !== 'myrealtrip') return true; // 다른 소스는 건드리지 않음
                const evaluation = evaluateInterparkBenchmark(f, benchmark);
                f.discountRate = evaluation.discountRate;
                if (!evaluation.keep) {
                    console.log(`  ❌ 필터: ${f.arrival?.city} ${evaluation.yearMonth} ${f.price.toLocaleString()}원 > 인터파크 평균 ${evaluation.average?.toLocaleString()}원`);
                    return false;
                }
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
    // 벤치마크 파일이 없거나 읽기에 실패해도 과거 캐시에 저장된 지방 출발 할인율은 제거한다.
    cache.flights.forEach((flight: CachedFlight) => clearUnsupportedInterparkDiscount(
        flight,
        interparkBenchmark,
    ));

    // ── 네이버 최저가 비교 필터링 (비활성화) ──────────────────────────────
    // console.log(`\n=== 네이버 최저가 비교 ===`);
    // 네이버 필터 일시 중단

    const finalMrtFlights = cache.flights.filter((flight: any) => flight.source === 'myrealtrip') as CachedFlight[];
    const finalMrtCount = finalMrtFlights.length;
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
    cache.sourceCircuits = { ...(cache.sourceCircuits || {}) };
    delete cache.sourceCircuits.myrealtrip;
    cache.staleStreak = { ...(cache.staleStreak || {}), myrealtrip: 0 };
    cache.integrityAlerts = (cache.integrityAlerts || []).filter(
        (alert: unknown) => !/myrealtrip|마이리얼트립/i.test(String(alert)),
    );
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));

    const previousFlightByKey = new Map(previousMrtFlights.map((flight: CachedFlight) => [flightIdentity(flight), flight]));
    const finalFlightByKey = new Map(finalMrtFlights.map((flight: CachedFlight) => [flightIdentity(flight), flight]));
    const previousKeys = new Set(previousFlightByKey.keys());
    const finalKeys = new Set(finalFlightByKey.keys());
    const added = [...finalKeys].filter(key => !previousKeys.has(key)).length;
    const removed = [...previousKeys].filter(key => !finalKeys.has(key)).length;
    const summarizeTurnoverFlight = (flight: CachedFlight) => ({
        id: String(flight.id || flightIdentity(flight)),
        airline: String(flight.airline || '항공사 미상'),
        route: `${flight.departure?.city || flight.departure?.airport || '출발지'} → ${flight.arrival?.city || flight.arrival?.airport || '도착지'}`,
        departureDate: String(flight.departure?.date || ''),
        returnDate: String(flight.arrival?.date || ''),
        price: Number(flight.price) || 0,
    });
    const addedFlights = [...finalKeys]
        .filter(key => !previousKeys.has(key))
        .slice(0, 100)
        .map(key => summarizeTurnoverFlight(finalFlightByKey.get(key)!));
    const removedFlights = [...previousKeys]
        .filter(key => !finalKeys.has(key))
        .slice(0, 100)
        .map(key => summarizeTurnoverFlight(previousFlightByKey.get(key)!));
    logCrawlResults('myrealtrip', finalMrtCount, undefined, countCities(finalMrtFlights), {
        scraped: results.size,
        added,
        removed,
        addedFlights,
        removedFlights,
        separateSession: true,
    });

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
    const verifiedQuickSeeds = quickSeedTasks.filter(task => results.has(task.flight.id)).length;
    console.log(`검증: 정규 ${regularSuccessCount}/${regularTasks.length}개 성공`);
    console.log(`빠른 출발 추가: ${verifiedQuickSeeds}/${quickSeedTasks.length}개 실제 예약 화면 확인`);
    console.log(`보정: ${updated}개 (↑${priceUp} ↓${priceDown})`);
    console.log(`잔여 좌석: ${seatsUpdated}/${updated}개 확인`);
    console.log(`표시 제외: ${unverifiedRemoved}개`);
    if (benchmarkFiltered > 0) console.log(`인터파크 필터: ${benchmarkFiltered}개 제거`);
}

main().catch((error) => {
    console.error('\n❌ 마이리얼트립 스크래핑 중단:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
        const preservedCache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
        const preservedFlights = preservedCache.flights
            .filter((flight: CachedFlight) => flight.source === 'myrealtrip') as CachedFlight[];
        logCrawlResults('myrealtrip', preservedFlights.length, undefined, countCities(preservedFlights), {
            preserved: true,
            added: 0,
            removed: 0,
            separateSession: true,
        });
        recordCrawlAlerts([`🚨 마이리얼트립 수집 실패 — 이전 데이터 유지: ${errorMessage}`]);
    } catch (logError) {
        console.error('마이리얼트립 실패 기록 저장 실패:', logError);
    }
    const restriction = classifySourceAccessRestriction(error);
    if (restriction) {
        try {
            const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
            const circuit = openSourceCircuit(restriction, SOURCE_ADAPTER_VERSIONS.myrealtrip);
            cache.sourceCircuits = { ...(cache.sourceCircuits || {}), myrealtrip: circuit };
            cache.staleStreak = {
                ...(cache.staleStreak || {}),
                myrealtrip: (cache.staleStreak?.myrealtrip || 0) + 1,
            };
            cache.integrityAlerts = Array.from(new Set([
                ...(cache.integrityAlerts || []),
                `⛔ myrealtrip ${sourceCircuitLabel(circuit)} 감지 — ${circuit.nextProbeAt}까지 자동 요청 중단`,
            ]));
            fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
            console.error(`⏸️ 마이리얼트립 차단 회로 저장: ${circuit.nextProbeAt}까지 요청 중단`);
        } catch (persistError) {
            console.error('마이리얼트립 차단 회로 저장 실패:', persistError);
        }
    }
    process.exitCode = 1;
});
