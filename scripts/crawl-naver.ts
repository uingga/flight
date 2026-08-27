/**
 * 네이버 항공권 최저가 크롤러
 * 
 * all-flights-cache.json에서 갱신이 필요한 항공권을 우선순위로 추출하고,
 * 각 항공권의 구간+날짜로 네이버 항공권을 검색하여 최저가를 수집합니다.
 * 결과는 data/naver-prices.json에 저장됩니다.
 */

import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import * as fs from 'fs';
import * as path from 'path';
import { recordNaverCrawlHistory } from '../src/lib/utils/naver-crawl-history';
import {
    buildNaverPriceKey,
    buildNaverSearchUrl,
    formatNaverRoute,
    getExactRouteAirports,
} from '../src/lib/naver-route';
import {
    classifyNaverPageState,
    classifyNaverProbeAvailability,
    combineNaverProbeResults,
    naverPageStateLabel,
    shouldAbortNaverCrawlForZeroSuccess,
    type NaverAvailability,
    type NaverCrawlPageState,
    type NaverPageSnapshot,
} from '../src/lib/naver-crawl-page-state';

chromium.use(stealth());

// ─── 설정 ───
const MAX_FLIGHTS = parseInt(process.env.MAX_FLIGHTS || '9999', 10); // 기본: 제한 없음
const MAX_DAYS_AHEAD = parseInt(process.env.MAX_DAYS_AHEAD || '60', 10); // 출발일 N일 이내만
const SOURCE_FILTER_RAW = process.env.SOURCE_FILTER ?? 'myrealtrip';
const SOURCE_FILTER = SOURCE_FILTER_RAW.toLowerCase() === 'all' ? '' : SOURCE_FILTER_RAW; // all이면 전체 소스
const REFRESH_DAYS = parseInt(process.env.REFRESH_DAYS || '2', 10); // 기타 여행사는 KST 날짜 기준 이틀마다 갱신
const MYREALTRIP_REFRESH_DAYS = parseInt(process.env.MYREALTRIP_REFRESH_DAYS || '1', 10); // 마이리얼트립은 KST 날짜 기준 매일 갱신
const MISS_RETRY_HOURS = parseInt(process.env.MISS_RETRY_HOURS || '6', 10); // 검색 실패 노선은 잠시 뒤 재시도
const NO_RESULT_RETRY_HOURS = parseInt(process.env.NO_RESULT_RETRY_HOURS || '24', 10); // 정상 빈 노선은 하루 뒤 재확인
const ABORT_AFTER_MISSES = parseInt(process.env.ABORT_AFTER_MISSES || '3', 10); // 연속 N건 일시 오류면 서비스 상태를 별도 확인
const MIN_ZERO_SUCCESS_GUARD_ATTEMPTS = parseInt(process.env.MIN_ZERO_SUCCESS_GUARD_ATTEMPTS || '10', 10); // 추출기 전면 변경 방어선
const DRY_RUN = process.env.DRY_RUN === '1';                        // 검색 계획만 출력하고 종료
const MIN_VALID_PRICE = parseInt(process.env.MIN_VALID_PRICE || '60000', 10); // 국제선 왕복 최저 방어선 — 미만이면 오염 데이터로 보고 폐기
const HIDE_WINDOW = process.env.HIDE_WINDOW === '1';                // 브라우저 창을 화면 밖에 배치 (로컬 스케줄 실행용)
const NAVER_WAIT_MS = 25000;        // 네이버 검색 결과 로딩 대기 (25초)
const NAVER_EXTRA_WAIT_MS = 20000;  // API/로딩이 끝나지 않은 페이지만 추가 대기
const NAVER_HEALTH_WAIT_MS = 20000; // 대조 노선은 가격이 아닌 API 도달 여부만 확인
const MIN_DELAY = 1000;             // 최소 랜덤 딜레이 (ms)
const MAX_DELAY = 3000;             // 최대 랜덤 딜레이 (ms)
const BATCH_SIZE = 10;              // N건마다 휴식
const BATCH_REST_MIN = 30000;       // 휴식 최소 (30초)
const BATCH_REST_MAX = 60000;       // 휴식 최대 (60초)
const DATA_DIR = path.join(process.cwd(), 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'naver-prices.json');
const ALL_FLIGHTS_FILE = path.join(DATA_DIR, 'all-flights-cache.json');

// ─── 유틸리티 ───
const humanDelay = (min = MIN_DELAY, max = MAX_DELAY) =>
    new Promise<void>(r => setTimeout(r, Math.random() * (max - min) + min));

const normalizeDate = (dateStr: string): string => {
    // 다양한 날짜 포맷을 YYYY-MM-DD로 통일
    const clean = dateStr.replace(/\(.*\)/g, '').replace(/\s/g, '').trim();

    // "2026.03.03" → "2026-03-03"
    if (clean.includes('.')) {
        const parts = clean.split('.');
        if (parts.length >= 3) {
            return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
        }
    }

    // 이미 "2026-03-03" 형태
    return clean.substring(0, 10);
};

interface FlightData {
    departure: { airport: string; city: string; date: string };
    arrival: { airport: string; city: string; date: string };
    price: number;
    airline: string;
    source: string;
    discountRate?: number;
    routeAirports?: {
        outboundDeparture: string;
        outboundArrival: string;
        returnDeparture: string;
        returnArrival: string;
    };
}

interface NaverPriceEntry {
    naverLowest: number;
    crawledAt: string;
    route: string;
    depDate: string;
    retDate: string;
    lastAttemptAt?: string;
    lastAttemptStatus?: 'success' | 'miss' | Exclude<NaverCrawlPageState, 'results'>;
    lastAttemptDetail?: string;
    lastFinalUrl?: string;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const KST_OFFSET_MS = 9 * HOUR_MS;

const kstDayNumber = (timestamp: number): number =>
    Math.floor((timestamp + KST_OFFSET_MS) / DAY_MS);

const elapsedKstDays = (timestamp: number, now: number): number =>
    kstDayNumber(now) - kstDayNumber(timestamp);

const isAttemptFresh = (entry: NaverPriceEntry | undefined, source: string, now = Date.now()): boolean => {
    if (!entry) return false;
    const isMiss = Boolean(entry.lastAttemptStatus && entry.lastAttemptStatus !== 'success');
    const timestamp = isMiss ? entry.lastAttemptAt : entry.crawledAt;
    if (!timestamp) return false;
    const attemptedAt = new Date(timestamp).getTime();
    if (!Number.isFinite(attemptedAt)) return false;

    // 실패 건은 차단이 풀릴 기회를 주기 위해 정확한 시간 간격으로 재시도한다.
    if (isMiss) {
        const retryHours = entry.lastAttemptStatus === 'no_result'
            || entry.lastAttemptStatus === 'route_error'
            || entry.lastAttemptStatus === 'miss'
            ? NO_RESULT_RETRY_HOURS
            : MISS_RETRY_HOURS;
        return now - attemptedAt < retryHours * HOUR_MS;
    }

    // 성공 건은 실행 시각의 몇 분 차이 때문에 하루를 더 건너뛰지 않도록 KST 날짜로 판단한다.
    const refreshDays = source === 'myrealtrip' ? MYREALTRIP_REFRESH_DAYS : REFRESH_DAYS;
    return elapsedKstDays(attemptedAt, now) < refreshDays;
};

const attemptTimestamp = (entry: NaverPriceEntry): number =>
    new Date(entry.lastAttemptAt || entry.crawledAt).getTime();

const freshnessHoursFor = (entry: NaverPriceEntry, _source: string): number => {
    const timestamp = attemptTimestamp(entry);
    if (!Number.isFinite(timestamp)) return 0;
    return Math.max(0, Math.round((Date.now() - timestamp) / HOUR_MS));
};

// ─── 메인 ───
(async () => {
    console.log('🔍 네이버 항공권 최저가 크롤러 시작...\n');

    // 1. all-flights-cache.json에서 마이리얼트립 항공권 추출
    if (!fs.existsSync(ALL_FLIGHTS_FILE)) {
        console.error('❌ all-flights-cache.json 파일이 없습니다.');
        process.exit(1);
    }

    const rawFile = JSON.parse(fs.readFileSync(ALL_FLIGHTS_FILE, 'utf-8'));
    let rawData: FlightData[] = Array.isArray(rawFile) ? rawFile : (rawFile.flights || Object.values(rawFile).flat());

    // 하나투어처럼 airport가 비고 도시명에만 코드가 붙은 표("서울(ICN)")를 보정한다.
    // 보정하지 않으면 아래 우선순위 선별에서 공항 코드가 없다는 이유로 통째로 빠진다.
    let airportFilled = 0;
    for (const f of rawData) {
        for (const place of [f.departure, f.arrival]) {
            if (place && !place.airport) {
                const code = place.city?.match(/\(([A-Z]{3})\)/)?.[1];
                if (code) { place.airport = code; airportFilled++; }
            }
        }
    }
    if (airportFilled > 0) console.log(`🧩 도시명에서 공항 코드 보정: ${airportFilled}건`);

    // 소스 필터링 (기본: myrealtrip)
    if (SOURCE_FILTER) {
        const before = rawData.length;
        rawData = rawData.filter(f => f.source === SOURCE_FILTER);
        console.log(`🎯 소스 필터: ${SOURCE_FILTER} (${rawData.length}/${before}건)`);
    }

    // 이미 지난 항공편과 지나치게 먼 출발일은 제외
    const now = new Date();
    const maxDepartureDate = new Date(now);
    maxDepartureDate.setDate(maxDepartureDate.getDate() + MAX_DAYS_AHEAD);
    const beforeDate = rawData.length;
    rawData = rawData.filter(f => {
        const dep = new Date(normalizeDate(f.departure.date));
        return dep >= now && dep <= maxDepartureDate;
    });
    console.log(`📅 출발일 필터: 미래 ${MAX_DAYS_AHEAD}일 이내 (${rawData.length}/${beforeDate}건)`);

    const unverifiedRouteCount = rawData.filter(f => f.price > 0 && !flightKey(f)).length;
    if (unverifiedRouteCount > 0) {
        console.log(`🧭 실제 왕복 공항 미확인 ${unverifiedRouteCount}건 제외 (잘못된 도시 코드 조회 방지)`);
    }

    // 2. 기존 결과 불러오기 (우선순위 계산에 필요하므로 선별 전에 로드)
    let naverPrices: Record<string, NaverPriceEntry> = {};
    if (fs.existsSync(OUTPUT_FILE)) {
        try {
            naverPrices = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
        } catch { /* 새로 시작 */ }
    }

    // 노선 중복 제거 + 신선한 항목 제외 + 우선순위 정렬
    const { selected: uniqueFlights, pending: neededFlights, skippedFresh } = selectFlightsByPriority(rawData, naverPrices, MAX_FLIGHTS);
    const newRouteCount = neededFlights.filter(f => !naverPrices[flightKey(f)]).length;
    console.log(`⏭️ 갱신 주기 내 이미 시도된 노선 스킵: ${skippedFresh}건 (KST 기준 마이리얼트립 매일 / 기타 ${REFRESH_DAYS}일마다 / 빈 결과 ${NO_RESULT_RETRY_HOURS}시간 · 일시 오류 ${MISS_RETRY_HOURS}시간 후)`);
    console.log(`📋 확인 필요 ${neededFlights.length}건 · 이번 실행 ${uniqueFlights.length}건 · 새 항공권 ${newRouteCount}건 · 다음 회차 ${Math.max(0, neededFlights.length - uniqueFlights.length)}건\n`);

    if (DRY_RUN) {
        console.log('=== DRY RUN: 검색 계획 (상위 20건) ===');
        uniqueFlights.slice(0, 20).forEach((f, i) => {
            const key = flightKey(f);
            const entry = naverPrices[key];
            const reason = !entry
                ? `신규 (할인율 ${f.discountRate ?? 0}%)`
                : `${entry.lastAttemptStatus === 'miss' ? '마지막 실패' : '마지막 검색'} ${Math.round((Date.now() - attemptTimestamp(entry)) / 3600000)}시간 전`;
            console.log(`  ${String(i + 1).padStart(2)}. ${f.departure.city}→${f.arrival.city} ${normalizeDate(f.departure.date)} — ${reason}`);
        });
        process.exit(0);
    }

    // 3. 브라우저 실행
    const browser = await chromium.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            // 로컬 스케줄 실행 시 브라우저 창을 화면 밖으로 (작업 방해 방지)
            ...(HIDE_WINDOW ? ['--window-position=-2400,-100'] : []),
        ],
    });

    const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        locale: 'ko-KR',
        // 설치된 Chromium 버전과 맞지 않는 고정 UA는 client hints와 모순되어
        // 자동화 탐지 신호가 된다. Playwright가 실제 브라우저 UA를 사용하게 둔다.
    });

    const page = await context.newPage();

    let successCount = 0;
    let failCount = 0;
    let attemptedCount = 0;
    let newRoutesAttempted = 0;
    // 가격이 없다는 것만으로 차단이라 하지 않는다. 애매한 실패가 이어질 때
    // 정상 대조 노선까지 실패하는지를 확인한 뒤에만 조기 종료한다.
    let consecutiveAmbiguousMisses = 0;
    let healthCheckCount = 0;
    const failureStateCounts: Record<Exclude<NaverCrawlPageState, 'results'>, number> = {
        no_result: 0,
        route_error: 0,
        blocked: 0,
        transient_error: 0,
    };
    let abortedEarly = false;
    let explicitBlockDetected = false;
    let abortReason: string | undefined;

    for (let i = 0; i < uniqueFlights.length; i++) {
        const flight = uniqueFlights[i];
        const depDate = normalizeDate(flight.departure.date);
        const retDate = normalizeDate(flight.arrival.date);
        const route = getExactRouteAirports(flight);
        const key = flightKey(flight);
        if (!route || !key) continue;
        const routeLabel = `${flight.departure.city}→${flight.arrival.city} (${depDate}~${retDate})`;

        console.log(`[${i + 1}/${uniqueFlights.length}] ${routeLabel} — 현재가: ${flight.price.toLocaleString()}원`);

        // 신선한 데이터가 있으면 스킵 (선별 단계에서 걸러지지만 안전망으로 유지)
        const existingEntry = naverPrices[key];
        if (isAttemptFresh(existingEntry, flight.source)) {
            const freshnessHours = freshnessHoursFor(existingEntry, flight.source);
            const resultLabel = existingEntry.lastAttemptStatus && existingEntry.lastAttemptStatus !== 'success'
                ? `최근 ${existingEntry.lastAttemptStatus === 'miss' ? '검색 결과 없음' : naverPageStateLabel(existingEntry.lastAttemptStatus)}`
                : `${existingEntry.naverLowest.toLocaleString()}원`;
            console.log(`  ⏭️ ${freshnessHours}시간 내 시도됨 (${resultLabel})\n`);
            continue;
        }

        attemptedCount++;
        if (!existingEntry) newRoutesAttempted++;

        let responseHandler: ((response: any) => Promise<void>) | null = null;
        try {
            // 네이버 항공권 왕복 검색 URL (직항+경유 모두 포함)
            const naverUrl = buildNaverSearchUrl(route, depDate, retDate);
            if (!naverUrl) throw new Error('정확한 네이버 검색 URL을 만들 수 없음');

            // GraphQL 응답 캡처를 위한 변수
            let lowestPrice: number | null = null;
            let graphqlResponseCount = 0;
            let graphqlSuccessCount = 0;
            let graphqlErrorCount = 0;
            let graphqlProblemStatus: number | null = null;

            // flight-api 응답 가로채기
            responseHandler = async (response) => {
                const url = response.url();
                if (url.includes('flight-api.naver.com/graphql')) {
                    graphqlResponseCount++;
                    const status = response.status();
                    if (status === 403 || status === 429) graphqlProblemStatus = status;
                    else if (status >= 500 && graphqlProblemStatus !== 403 && graphqlProblemStatus !== 429) graphqlProblemStatus = status;
                    if (status < 200 || status >= 400) graphqlErrorCount++;
                    try {
                        const json = await response.json();
                        if (status >= 200 && status < 400) {
                            const hasErrors = Array.isArray(json?.errors) && json.errors.length > 0;
                            const hasData = json && typeof json === 'object' && json.data !== undefined && json.data !== null;
                            if (hasData && !hasErrors) graphqlSuccessCount++;
                            else graphqlErrorCount++;
                        }
                        // 응답에서 최저가 추출
                        const prices = extractPricesFromGraphQL(json);
                        for (const p of prices) {
                            if (p > 0 && (lowestPrice === null || p < lowestPrice)) {
                                lowestPrice = p;
                            }
                        }
                    } catch {
                        if (status >= 200 && status < 400) graphqlErrorCount++;
                    }
                }
            };
            page.on('response', responseHandler);

            const navigationResponse = await page.goto(naverUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // 네이버 항공권은 여러 GDS/항공사에서 순차적으로 결과를 받으므로,
            // 충분히 기다려야 최저가가 확정됨
            console.log(`  ⏳ 네이버 검색 결과 대기 중 (${NAVER_WAIT_MS / 1000}초)...`);
            await page.waitForTimeout(NAVER_WAIT_MS);

            // DOM에서 가격 읽기 — 2026-07 네이버 개편 후 운임이 GraphQL로 오지 않아
            // 실질적으로 이쪽이 주 소스다 (사용자가 화면에서 보는 가격과 동일)
            let domPrice = await extractPriceFromDOM(page);
            if (domPrice && (lowestPrice === null || domPrice < lowestPrice)) {
                lowestPrice = domPrice;
            }

            let pageSnapshot: NaverPageSnapshot | null = null;
            if (lowestPrice === null) {
                pageSnapshot = await inspectNaverPage(page, navigationResponse?.status(), {
                    graphqlResponseCount,
                    graphqlSuccessCount,
                    graphqlErrorCount,
                    graphqlProblemStatus,
                });

                // 25초가 지났는데 API가 아직 안 왔거나 화면이 로딩 중일 때만 더 기다린다.
                // 이미 정상 GraphQL이 끝난 빈 결과를 무조건 20초 더 기다리지는 않는다.
                if (pageSnapshot.isLoading || graphqlSuccessCount === 0) {
                    console.log(`  ⏳ 검색이 아직 끝나지 않아 최대 ${NAVER_EXTRA_WAIT_MS / 1000}초 더 확인합니다.`);
                    const deadline = Date.now() + NAVER_EXTRA_WAIT_MS;
                    while (Date.now() < deadline && lowestPrice === null) {
                        await page.waitForTimeout(2_000);
                        domPrice = await extractPriceFromDOM(page);
                        if (domPrice && (lowestPrice === null || domPrice < lowestPrice)) {
                            lowestPrice = domPrice;
                            break;
                        }

                        pageSnapshot = await inspectNaverPage(page, navigationResponse?.status(), {
                            graphqlResponseCount,
                            graphqlSuccessCount,
                            graphqlErrorCount,
                            graphqlProblemStatus,
                        });
                        const settledState = classifyNaverPageState(pageSnapshot);
                        if (settledState === 'blocked' || settledState === 'no_result' || settledState === 'route_error') {
                            break;
                        }
                    }
                }
            }

            // 오염 방어선: 국제선 왕복이 이 값보다 쌀 수 없다 (호텔 가격 등 혼입 차단)
            if (lowestPrice !== null && lowestPrice < MIN_VALID_PRICE) {
                console.log(`  🚫 비정상 저가 ${lowestPrice.toLocaleString()}원 (< ${MIN_VALID_PRICE.toLocaleString()}) — 오염 데이터로 보고 폐기`);
                lowestPrice = null;
            }

            if (lowestPrice !== null) {
                naverPrices[key] = {
                    naverLowest: lowestPrice,
                    crawledAt: new Date().toISOString(),
                    route: formatNaverRoute(route),
                    depDate,
                    retDate,
                    lastAttemptAt: new Date().toISOString(),
                    lastAttemptStatus: 'success',
                };

                const diff = flight.price - lowestPrice;
                const emoji = diff <= 0 ? '✅' : '⚠️';
                console.log(`  ${emoji} 네이버 최저가: ${lowestPrice.toLocaleString()}원 (차이: ${diff >= 0 ? '+' : ''}${diff.toLocaleString()}원)`);
                successCount++;
                consecutiveAmbiguousMisses = 0;
            } else {
                pageSnapshot = pageSnapshot || await inspectNaverPage(page, navigationResponse?.status(), {
                    graphqlResponseCount,
                    graphqlSuccessCount,
                    graphqlErrorCount,
                    graphqlProblemStatus,
                });
                const pageState = classifyNaverPageState(pageSnapshot);
                const failureState: Exclude<NaverCrawlPageState, 'results'> = pageState === 'results'
                    ? 'transient_error'
                    : pageState;
                console.log(`  ❓ ${naverPageStateLabel(failureState)} — 가격을 찾지 못함 (GraphQL 정상 ${graphqlSuccessCount}/${graphqlResponseCount}회 · 오류 ${graphqlErrorCount})`);
                const attemptedAt = new Date().toISOString();
                naverPrices[key] = {
                    ...(existingEntry || {}),
                    naverLowest: existingEntry?.naverLowest || 0,
                    crawledAt: existingEntry?.crawledAt || attemptedAt,
                    route: formatNaverRoute(route),
                    depDate,
                    retDate,
                    lastAttemptAt: attemptedAt,
                    lastAttemptStatus: failureState,
                    lastAttemptDetail: `GraphQL 정상 ${graphqlSuccessCount}/${graphqlResponseCount}회 · 오류 ${graphqlErrorCount} · ${pageSnapshot.bodyText?.slice(0, 150) || '본문 없음'}`,
                    lastFinalUrl: pageSnapshot.url,
                };
                failCount++;
                failureStateCounts[failureState]++;
                if (failureState === 'blocked') {
                    explicitBlockDetected = true;
                } else if (failureState === 'transient_error') {
                    consecutiveAmbiguousMisses++;
                } else {
                    // 정상 빈 결과와 잘못됐거나 미지원인 개별 노선은 서비스 차단 증거가 아니다.
                    consecutiveAmbiguousMisses = 0;
                }
            }
        } catch (err: any) {
            console.log(`  ❌ 에러: ${err.message}`);
            const attemptedAt = new Date().toISOString();
            naverPrices[key] = {
                ...(existingEntry || {}),
                naverLowest: existingEntry?.naverLowest || 0,
                crawledAt: existingEntry?.crawledAt || attemptedAt,
                route: formatNaverRoute(route),
                depDate,
                retDate,
                lastAttemptAt: attemptedAt,
                lastAttemptStatus: 'transient_error',
                lastAttemptDetail: String(err?.message || err).slice(0, 180),
                lastFinalUrl: page.url(),
            };
            failCount++;
            failureStateCounts.transient_error++;
            consecutiveAmbiguousMisses++;
        } finally {
            if (responseHandler) page.off('response', responseHandler);
        }

        if (explicitBlockDetected) {
            console.log('\n🛑 네이버 접근 제한 응답이 확인되어 추가 요청 없이 조기 철수합니다.');
            console.log(`   (지금까지 수집한 ${successCount}건은 저장됨)`);
            abortReason = '명시적 접근 제한(403/429/CAPTCHA)';
            abortedEarly = true;
            break;
        }

        // 애매한 실패가 연속돼도 바로 차단이라고 단정하지 않는다. 알려진 정상 노선을
        // 별도 페이지에서 한 번 확인해 서비스 전체가 막혔을 때만 조기 철수한다.
        if (consecutiveAmbiguousMisses >= ABORT_AFTER_MISSES) {
            healthCheckCount++;
            console.log(`\n🩺 애매한 실패 ${consecutiveAmbiguousMisses}건 — 정상 대조 노선으로 접속 상태를 확인합니다.`);
            const availability = await probeNaverAvailability(context);
            if (availability === 'available') {
                console.log('   ✅ 검색 API는 정상입니다. 노선별 실패로 기록하고 다음 항목을 계속 확인합니다.');
                consecutiveAmbiguousMisses = 0;
            } else if (availability === 'unknown') {
                // 가격이 없거나 한 번의 애매한 대조 결과만으로 전체 회차를 멈추지 않는다.
                console.log('   ℹ️ 전체 장애라는 증거가 없어 다음 항목을 계속 확인합니다.');
                consecutiveAmbiguousMisses = 0;
            } else {
                abortReason = availability === 'blocked'
                    ? '대조 노선에서 명시적 접근 제한 확인'
                    : '서로 다른 대조 노선 2개의 전송/API 장애';
                console.log(`   🛑 ${abortReason} — 추가 요청 없이 조기 철수합니다.`);
                console.log(`   (지금까지 수집한 ${successCount}건은 저장됨)`);
                abortedEarly = true;
                break;
            }
        }

        // 랜덤 딜레이 (사람처럼)
        await humanDelay(2000, 4000);
        console.log('');

        // 10건마다 휴식 + 중간 저장
        const completedCount = i + 1;
        if (completedCount > 0 && completedCount % BATCH_SIZE === 0 && completedCount < uniqueFlights.length) {
            // 중간 저장
            fs.writeFileSync(OUTPUT_FILE, JSON.stringify(naverPrices, null, 2), 'utf-8');
            const restSeconds = Math.round((BATCH_REST_MIN + Math.random() * (BATCH_REST_MAX - BATCH_REST_MIN)) / 1000);
            console.log(`☕ ${completedCount}건 완료! ${restSeconds}초 휴식 중...\n`);
            await new Promise<void>(r => setTimeout(r, restSeconds * 1000));
            console.log(`🔄 크롤링 재개!\n`);
        }
    }

    // API가 정상이어도 화면 구조가 바뀌면 모든 노선을 정상 빈 결과로 오판할 수 있다.
    // 충분한 수를 확인했는데 가격을 단 한 건도 읽지 못한 회차는 부분 데이터를
    // 운영에 반영하지 않고 실패로 남긴다.
    if (!abortedEarly && shouldAbortNaverCrawlForZeroSuccess(
        attemptedCount,
        successCount,
        MIN_ZERO_SUCCESS_GUARD_ATTEMPTS,
    )) {
        abortedEarly = true;
        abortReason = `${attemptedCount}건 확인 중 가격 추출 0건(화면 구조 변경 또는 전체 응답 이상 의심)`;
        console.log(`\n🛑 ${abortReason} — 이번 회차의 부분 결과는 운영에 반영하지 않습니다.`);
    }

    await browser.close();

    // 4. 결과 저장
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(naverPrices, null, 2), 'utf-8');

    // 실행 뒤에도 확인이 필요한 항목을 다시 계산해야 조기 철수와 실패 재시도까지
    // 반영된 정확한 이월 수를 남길 수 있다.
    const remaining = selectFlightsByPriority(rawData, naverPrices, Number.MAX_SAFE_INTEGER).pending;
    const deferredNeverChecked = remaining.filter(f => !naverPrices[flightKey(f)]).length;
    const deferredAges = remaining
        .map(f => naverPrices[flightKey(f)])
        .filter((entry): entry is NaverPriceEntry => Boolean(entry))
        .map(entry => Math.max(0, (Date.now() - attemptTimestamp(entry)) / HOUR_MS))
        .filter(Number.isFinite);
    const oldestDeferredHours = deferredAges.length > 0
        ? Math.round(Math.max(...deferredAges) * 10) / 10
        : null;
    const recordedAt = new Date().toISOString();
    recordNaverCrawlHistory({
        id: `${recordedAt}-${process.env.CI ? 'github' : HIDE_WINDOW ? 'local' : 'manual'}-${process.pid}`,
        timestamp: recordedAt,
        runner: process.env.CI ? 'github' : HIDE_WINDOW ? 'local' : 'manual',
        sourceFilter: SOURCE_FILTER || 'all',
        maxFlights: MAX_FLIGHTS,
        needed: neededFlights.length,
        attempted: attemptedCount,
        newRoutes: newRouteCount,
        newRoutesAttempted,
        deferred: remaining.length,
        deferredNeverChecked,
        oldestDeferredHours,
        success: successCount,
        misses: failCount,
        noResult: failureStateCounts.no_result,
        routeErrors: failureStateCounts.route_error,
        transientErrors: failureStateCounts.transient_error,
        blocked: failureStateCounts.blocked,
        healthChecks: healthCheckCount,
        abortedEarly,
        abortReason,
    });

    console.log('─'.repeat(50));
    console.log(`${abortedEarly ? '🛑 조기 철수' : '✅ 완료'}! 성공: ${successCount}건, 실패: ${failCount}건`);
    if (failCount > 0) {
        console.log(`   결과 없음 ${failureStateCounts.no_result} · 노선 오류 ${failureStateCounts.route_error} · 일시 오류 ${failureStateCounts.transient_error} · 접근 제한 ${failureStateCounts.blocked}`);
    }
    if (healthCheckCount > 0) console.log(`🩺 정상 대조 노선 확인: ${healthCheckCount}회`);
    console.log(`📊 확인 필요 ${neededFlights.length}건 → 실제 확인 ${attemptedCount}건 → 다음 회차 ${remaining.length}건`);
    console.log(`🆕 새 항공권 ${newRouteCount}건 중 ${newRoutesAttempted}건 확인`);
    console.log(`⏳ 가장 오래 밀린 항목: ${deferredNeverChecked > 0 ? `아직 한 번도 확인하지 않은 항목 ${deferredNeverChecked}건` : oldestDeferredHours === null ? '없음' : `${oldestDeferredHours}시간`}`);
    console.log(`📁 저장: ${OUTPUT_FILE}`);
    if (abortedEarly) {
        // 부분 회차를 GitHub Actions의 성공으로 가장하지 않는다. 워크플로가 필터와
        // 데이터 커밋을 건너뛰고 실패 원인을 운영자에게 보여주게 한다.
        process.exitCode = 2;
    }
})();

// ─── 검색 키 ───
function flightKey(f: FlightData): string {
    return buildNaverPriceKey(f, f.departure.date, f.arrival.date) || '';
}

/**
 * 노선 중복 제거(같은 노선+날짜는 최저가 1건) 후,
 * KST 날짜 기준 갱신 주기 안의 노선을 제외하고 우선순위로 정렬한다.
 *
 * 우선순위: 신규(할인율 높은 순) 2건과 기존(마지막 검색이 오래된 순) 1건을 섞는다.
 *          같은 노선은 최대 2건까지만 연속시킨다.
 *
 * 차단으로 조기 철수하더라도 가치 있는 노선부터 커버되도록 하기 위함.
 */
function selectFlightsByPriority(
    flights: FlightData[],
    naverPrices: Record<string, NaverPriceEntry>,
    limit: number
): { selected: FlightData[]; pending: FlightData[]; skippedFresh: number } {
    const seen = new Set<string>();
    const unique = flights
        .filter(f => f.price > 0 && Boolean(flightKey(f)))
        .sort((a, b) => a.price - b.price) // 같은 노선+날짜 중복 시 최저가 유지
        .filter(f => {
            const key = flightKey(f);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

    const now = Date.now();
    let skippedFresh = 0;

    const stale = unique.filter(f => {
        const entry = naverPrices[flightKey(f)];
        if (isAttemptFresh(entry, f.source, now)) {
            skippedFresh++;
            return false;
        }
        return true;
    });

    const newFlights = stale
        .filter(f => !naverPrices[flightKey(f)])
        .sort((a, b) => (b.discountRate ?? 0) - (a.discountRate ?? 0));
    const existingFlights = stale
        .filter(f => Boolean(naverPrices[flightKey(f)]))
        .sort((a, b) => (
            attemptTimestamp(naverPrices[flightKey(a)]) - attemptTimestamp(naverPrices[flightKey(b)])
        ));

    // 신규만 앞세우면 새 표가 많은 날 오래된 비교가가 며칠씩 밀린다.
    // 신규 2건마다 가장 오래된 기존 1건을 섞고, 같은 노선은 두 번까지만 연속시킨다.
    const blended: FlightData[] = [];
    while (newFlights.length > 0 || existingFlights.length > 0) {
        for (let count = 0; count < 2 && newFlights.length > 0; count++) blended.push(newFlights.shift()!);
        if (existingFlights.length > 0) blended.push(existingFlights.shift()!);
    }
    const pending = spreadRepeatedRoutes(blended, 2);

    return { selected: pending.slice(0, limit), pending, skippedFresh };
}

function routeIdentity(flight: FlightData): string {
    const route = getExactRouteAirports(flight);
    return route ? formatNaverRoute(route) : '';
}

function spreadRepeatedRoutes(flights: FlightData[], maxConsecutive: number): FlightData[] {
    const remaining = [...flights];
    const result: FlightData[] = [];
    let previousRoute = '';
    let consecutive = 0;

    while (remaining.length > 0) {
        let index = 0;
        if (previousRoute && consecutive >= maxConsecutive) {
            const differentIndex = remaining.findIndex(flight => routeIdentity(flight) !== previousRoute);
            if (differentIndex >= 0) index = differentIndex;
        }

        const [next] = remaining.splice(index, 1);
        const nextRoute = routeIdentity(next);
        if (nextRoute && nextRoute === previousRoute) consecutive++;
        else {
            previousRoute = nextRoute;
            consecutive = 1;
        }
        result.push(next);
    }
    return result;
}

// ─── GraphQL 응답에서 가격 추출 ───
// 2026-07-03경 네이버가 항공권 검색 응답에 "추천 호텔" 섹션을 추가하면서
// 호텔 1박 가격(예: 나고야 5.1만원)이 항공권 최저가로 잘못 수집되는 사고가 있었다.
// 항공권 운임과 무관한 섹션은 서브트리째 제외한다. (진단: 2026-08-11)
const EXCLUDED_SECTIONS = /hotel|priceGraph|banner|flightsCards|airportDetail/i;

function extractPricesFromGraphQL(json: any): number[] {
    const prices: number[] = [];

    const walk = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;

        // 다양한 키 이름으로 가격이 들어올 수 있음
        if (obj.price !== undefined && typeof obj.price === 'number') {
            prices.push(obj.price);
        }
        if (obj.farePrice !== undefined && typeof obj.farePrice === 'number') {
            prices.push(obj.farePrice);
        }
        if (obj.totalPrice !== undefined && typeof obj.totalPrice === 'number') {
            prices.push(obj.totalPrice);
        }
        if (obj.fare !== undefined && typeof obj.fare === 'number') {
            prices.push(obj.fare);
        }
        if (obj.adult !== undefined && typeof obj.adult === 'object' && obj.adult?.fare !== undefined) {
            const totalFare = (obj.adult.fare || 0) + (obj.adult.tax || 0) + (obj.adult.surcharge || 0);
            if (totalFare > 0) prices.push(totalFare);
        }

        // 배열이면 각 요소 순회, 객체면 운임 무관 섹션을 제외하고 순회
        if (Array.isArray(obj)) {
            obj.forEach(walk);
        } else {
            for (const [key, value] of Object.entries(obj)) {
                if (EXCLUDED_SECTIONS.test(key)) continue;
                walk(value);
            }
        }
    };

    walk(json);
    return prices.filter(p => p > 10000); // 1만원 이하는 무시 (노이즈 방지)
}

// ─── DOM에서 가격 추출 (보험) ───
async function extractPriceFromDOM(page: any): Promise<number | null> {
    try {
        const priceText = await page.evaluate(() => {
            // 네이버 항공권의 가격 셀렉터들 (2026년 기준)
            const selectors = [
                '[class*="item_num"]',     // 메인 가격: <I class="item_num__aKbk4">
                '[class*="price"]',
                '[class*="Price"]',
                '[class*="fare"]',
                '[data-testid*="price"]',
            ];

            for (const sel of selectors) {
                const els = document.querySelectorAll(sel);
                const prices: number[] = [];
                els.forEach(el => {
                    const text = (el as HTMLElement).innerText || '';
                    // "373,600" 또는 "373,600원" 형태 처리
                    const match = text.replace(/,/g, '').replace(/원/g, '').match(/(\d{4,})/);
                    if (match) prices.push(parseInt(match[1]));
                });
                const validPrices = prices.filter(p => p > 10000);
                if (validPrices.length > 0) {
                    return Math.min(...validPrices);
                }
            }
            return null;
        });

        return priceText;
    } catch {
        return null;
    }
}

async function inspectNaverPage(
    page: any,
    httpStatus?: number | null,
    network: Pick<NaverPageSnapshot, 'graphqlResponseCount' | 'graphqlSuccessCount' | 'graphqlErrorCount' | 'graphqlProblemStatus'> = {},
): Promise<NaverPageSnapshot> {
    try {
        const snapshot = await page.evaluate((status: number | null) => {
            const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ');
            const visibleBusy = Array.from(document.querySelectorAll('[aria-busy="true"]')).some(element => {
                const rect = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);
                return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            });
            return {
                url: window.location.href,
                bodyText: bodyText.slice(0, 4000),
                // 빈 결과/차단 화면에도 가격용 껍데기 노드가 남을 수 있으므로
                // 실제 숫자 운임이 들어 있는 노드만 결과로 센다.
                priceCount: Array.from(document.querySelectorAll('[class*="item_num"]'))
                    .map(element => Number((element.textContent || '').replace(/[^0-9]/g, '')))
                    .filter(price => Number.isFinite(price) && price >= 60_000).length,
                httpStatus: status,
                isLoading: visibleBusy || /검색 결과를 불러오는 중|항공권을 찾는 중|불러오는 중입니다/.test(bodyText),
                searchPageReached: /flight\.naver\.com\/flights\/international\//.test(window.location.href),
            };
        }, httpStatus ?? null);
        return { ...snapshot, ...network };
    } catch {
        return {
            url: typeof page.url === 'function' ? page.url() : '',
            bodyText: '',
            priceCount: 0,
            httpStatus: httpStatus ?? null,
            searchPageReached: false,
            ...network,
        };
    }
}

function kstDateAfter(days: number): string {
    const date = new Date(Date.now() + KST_OFFSET_MS);
    date.setUTCDate(date.getUTCDate() + days);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

interface NaverProbeRoute {
    outboundDeparture: string;
    outboundArrival: string;
    returnDeparture: string;
    returnArrival: string;
    depAfterDays: number;
    retAfterDays: number;
}

async function probeNaverRoute(context: any, route: NaverProbeRoute): Promise<NaverAvailability> {
    const probePage = await context.newPage();
    let graphqlResponseCount = 0;
    let graphqlSuccessCount = 0;
    let graphqlErrorCount = 0;
    let graphqlProblemStatus: number | null = null;
    const responseHandler = async (response: any) => {
        if (!response.url().includes('flight-api.naver.com/graphql')) return;
        graphqlResponseCount++;
        const status = response.status();
        if (status === 403 || status === 429) graphqlProblemStatus = status;
        else if (status >= 500 && graphqlProblemStatus !== 403 && graphqlProblemStatus !== 429) graphqlProblemStatus = status;
        if (status < 200 || status >= 400) graphqlErrorCount++;
        if (status >= 200 && status < 400) {
            try {
                const json = await response.json();
                const hasErrors = Array.isArray(json?.errors) && json.errors.length > 0;
                const hasData = json && typeof json === 'object' && json.data !== undefined && json.data !== null;
                if (hasData && !hasErrors) graphqlSuccessCount++;
                else graphqlErrorCount++;
            } catch {
                graphqlErrorCount++;
            }
        }
    };
    probePage.on('response', responseHandler);

    try {
        const url = buildNaverSearchUrl(route, kstDateAfter(route.depAfterDays), kstDateAfter(route.retAfterDays));
        if (!url) return 'unknown';

        let response: any = null;
        let navigationFailed = false;
        try {
            response = await probePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (error: any) {
            navigationFailed = true;
            console.log(`   ${route.outboundDeparture}-${route.outboundArrival} 이동 실패: ${String(error?.message || error).slice(0, 120)}`);
        }

        const deadline = Date.now() + NAVER_HEALTH_WAIT_MS;
        while (
            Date.now() < deadline
            && graphqlSuccessCount === 0
            && graphqlProblemStatus !== 403
            && graphqlProblemStatus !== 429
        ) {
            await probePage.waitForTimeout(1_000);
        }

        const snapshot = await inspectNaverPage(probePage, response?.status(), {
            graphqlResponseCount,
            graphqlSuccessCount,
            graphqlErrorCount,
            graphqlProblemStatus,
        });
        const availability = classifyNaverProbeAvailability(snapshot, navigationFailed);
        console.log(
            `   ${route.outboundDeparture}-${route.outboundArrival}: ${availability}`
            + ` (HTTP ${snapshot.httpStatus || '없음'}, GraphQL 정상 ${graphqlSuccessCount}/${graphqlResponseCount})`,
        );
        return availability;
    } catch (error: any) {
        console.log(`   대조 노선 확인 실패: ${String(error?.message || error).slice(0, 160)}`);
        return 'unavailable';
    } finally {
        probePage.off('response', responseHandler);
        await probePage.close().catch(() => undefined);
    }
}

/**
 * 가격이 없는 단일 노선을 서비스 장애 증거로 쓰지 않는다. 서로 다른 두 대조
 * 노선의 HTTP/GraphQL 전송 상태를 확인하고, 둘 다 실제로 닿지 않을 때만 멈춘다.
 */
async function probeNaverAvailability(context: any): Promise<NaverAvailability> {
    const routes: NaverProbeRoute[] = [
        {
            outboundDeparture: 'ICN',
            outboundArrival: 'FUK',
            returnDeparture: 'FUK',
            returnArrival: 'ICN',
            depAfterDays: 14,
            retAfterDays: 17,
        },
        {
            outboundDeparture: 'ICN',
            outboundArrival: 'KIX',
            returnDeparture: 'KIX',
            returnArrival: 'ICN',
            depAfterDays: 21,
            retAfterDays: 24,
        },
    ];
    const results: NaverAvailability[] = [];

    for (const route of routes) {
        const result = await probeNaverRoute(context, route);
        results.push(result);
        if (result === 'available' || result === 'blocked') return result;
    }

    return combineNaverProbeResults(results);
}
