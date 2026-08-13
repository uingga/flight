/**
 * 네이버 항공권 최저가 크롤러
 * 
 * all-flights-cache.json에서 가격순 상위 30개 항공권을 추출하고,
 * 각 항공권의 구간+날짜로 네이버 항공권을 검색하여 최저가를 수집합니다.
 * 결과는 data/naver-prices.json에 저장됩니다.
 */

import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import * as fs from 'fs';
import * as path from 'path';

chromium.use(stealth());

// ─── 설정 ───
const MAX_FLIGHTS = parseInt(process.env.MAX_FLIGHTS || '9999', 10); // 기본: 제한 없음
const MAX_DAYS_AHEAD = parseInt(process.env.MAX_DAYS_AHEAD || '60', 10); // 출발일 N일 이내만
const SOURCE_FILTER_RAW = process.env.SOURCE_FILTER ?? 'myrealtrip';
const SOURCE_FILTER = SOURCE_FILTER_RAW.toLowerCase() === 'all' ? '' : SOURCE_FILTER_RAW; // all이면 전체 소스
const FRESH_HOURS = parseInt(process.env.FRESH_HOURS || '48', 10);  // N시간 내 검색한 노선은 스킵
const MISS_RETRY_HOURS = parseInt(process.env.MISS_RETRY_HOURS || '6', 10); // 검색 실패 노선은 잠시 뒤 재시도
const ABORT_AFTER_MISSES = parseInt(process.env.ABORT_AFTER_MISSES || '3', 10); // 연속 N건 결과 없으면 차단으로 보고 조기 철수
const DRY_RUN = process.env.DRY_RUN === '1';                        // 검색 계획만 출력하고 종료
const MIN_VALID_PRICE = parseInt(process.env.MIN_VALID_PRICE || '60000', 10); // 국제선 왕복 최저 방어선 — 미만이면 오염 데이터로 보고 폐기
const HIDE_WINDOW = process.env.HIDE_WINDOW === '1';                // 브라우저 창을 화면 밖에 배치 (로컬 스케줄 실행용)
const NAVER_WAIT_MS = 25000;        // 네이버 검색 결과 로딩 대기 (25초)
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

const formatDate = (dateStr: string): string => {
    // "2026-03-03" → "20260303"
    return dateStr.replace(/-/g, '').replace(/\./g, '').replace(/\(.*\)/, '').trim().substring(0, 8);
};

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
}

interface NaverPriceEntry {
    naverLowest: number;
    crawledAt: string;
    route: string;
    depDate: string;
    retDate: string;
    lastAttemptAt?: string;
    lastAttemptStatus?: 'success' | 'miss';
}

const isAttemptFresh = (entry: NaverPriceEntry | undefined, now = Date.now()): boolean => {
    if (!entry) return false;
    const isMiss = entry.lastAttemptStatus === 'miss';
    const timestamp = isMiss ? entry.lastAttemptAt : entry.crawledAt;
    if (!timestamp) return false;
    const freshnessHours = isMiss ? MISS_RETRY_HOURS : FRESH_HOURS;
    return now - new Date(timestamp).getTime() < freshnessHours * 3600000;
};

const attemptTimestamp = (entry: NaverPriceEntry): number =>
    new Date(entry.lastAttemptAt || entry.crawledAt).getTime();

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

    // 2. 기존 결과 불러오기 (우선순위 계산에 필요하므로 선별 전에 로드)
    let naverPrices: Record<string, NaverPriceEntry> = {};
    if (fs.existsSync(OUTPUT_FILE)) {
        try {
            naverPrices = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
        } catch { /* 새로 시작 */ }
    }

    // 노선 중복 제거 + 신선한 항목 제외 + 우선순위 정렬
    const { selected: uniqueFlights, skippedFresh } = selectFlightsByPriority(rawData, naverPrices, MAX_FLIGHTS);
    console.log(`⏭️ ${FRESH_HOURS}시간 내 검색된 노선 스킵: ${skippedFresh}건`);
    console.log(`📋 검색할 항공권: ${uniqueFlights.length}건 (신규 노선 우선 → 오래된 순)\n`);

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
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    let successCount = 0;
    let failCount = 0;
    let consecutiveMisses = 0; // 연속 실패 (차단 감지용)
    let abortedEarly = false;

    for (let i = 0; i < uniqueFlights.length; i++) {
        const flight = uniqueFlights[i];
        const depCode = flight.departure.airport;
        const arrCode = flight.arrival.airport;
        const depDate = normalizeDate(flight.departure.date);
        const retDate = normalizeDate(flight.arrival.date);
        const depDateCompact = formatDate(depDate);
        const retDateCompact = formatDate(retDate);

        const key = `${depCode}-${arrCode}_${depDate}_${retDate}`;
        const routeLabel = `${flight.departure.city}→${flight.arrival.city} (${depDate}~${retDate})`;

        console.log(`[${i + 1}/${uniqueFlights.length}] ${routeLabel} — 현재가: ${flight.price.toLocaleString()}원`);

        // 신선한 데이터가 있으면 스킵 (선별 단계에서 걸러지지만 안전망으로 유지)
        const existingEntry = naverPrices[key];
        if (isAttemptFresh(existingEntry)) {
            const freshnessHours = existingEntry.lastAttemptStatus === 'miss' ? MISS_RETRY_HOURS : FRESH_HOURS;
            const resultLabel = existingEntry.lastAttemptStatus === 'miss'
                ? '최근 검색 결과 없음'
                : `${existingEntry.naverLowest.toLocaleString()}원`;
            console.log(`  ⏭️ ${freshnessHours}시간 내 시도됨 (${resultLabel})\n`);
            continue;
        }

        try {
            // 네이버 항공권 왕복 검색 URL (직항+경유 모두 포함)
            const naverUrl = `https://flight.naver.com/flights/international/${depCode}-${arrCode}-${depDateCompact}/${arrCode}-${depCode}-${retDateCompact}?adult=1&fareType=Y`;

            // GraphQL 응답 캡처를 위한 변수
            let lowestPrice: number | null = null;

            // flight-api 응답 가로채기
            page.on('response', async (response) => {
                const url = response.url();
                if (url.includes('flight-api.naver.com/graphql')) {
                    try {
                        const json = await response.json();
                        // 응답에서 최저가 추출
                        const prices = extractPricesFromGraphQL(json);
                        for (const p of prices) {
                            if (p > 0 && (lowestPrice === null || p < lowestPrice)) {
                                lowestPrice = p;
                            }
                        }
                    } catch { /* JSON 파싱 실패 무시 */ }
                }
            });

            await page.goto(naverUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // 네이버 항공권은 여러 GDS/항공사에서 순차적으로 결과를 받으므로,
            // 충분히 기다려야 최저가가 확정됨
            console.log(`  ⏳ 네이버 검색 결과 대기 중 (${NAVER_WAIT_MS / 1000}초)...`);
            await page.waitForTimeout(NAVER_WAIT_MS);

            // DOM에서 가격 읽기 — 2026-07 네이버 개편 후 운임이 GraphQL로 오지 않아
            // 실질적으로 이쪽이 주 소스다 (사용자가 화면에서 보는 가격과 동일)
            const domPrice = await extractPriceFromDOM(page);
            if (domPrice && (lowestPrice === null || domPrice < lowestPrice)) {
                lowestPrice = domPrice;
            }

            // 오염 방어선: 국제선 왕복이 이 값보다 쌀 수 없다 (호텔 가격 등 혼입 차단)
            if (lowestPrice !== null && lowestPrice < MIN_VALID_PRICE) {
                console.log(`  🚫 비정상 저가 ${lowestPrice.toLocaleString()}원 (< ${MIN_VALID_PRICE.toLocaleString()}) — 오염 데이터로 보고 폐기`);
                lowestPrice = null;
            }

            // GraphQL 리스너 제거
            page.removeAllListeners('response');

            if (lowestPrice !== null) {
                naverPrices[key] = {
                    naverLowest: lowestPrice,
                    crawledAt: new Date().toISOString(),
                    route: `${depCode}-${arrCode}`,
                    depDate,
                    retDate,
                    lastAttemptAt: new Date().toISOString(),
                    lastAttemptStatus: 'success',
                };

                const diff = flight.price - lowestPrice;
                const emoji = diff <= 0 ? '✅' : '⚠️';
                console.log(`  ${emoji} 네이버 최저가: ${lowestPrice.toLocaleString()}원 (차이: ${diff >= 0 ? '+' : ''}${diff.toLocaleString()}원)`);
                successCount++;
                consecutiveMisses = 0;
            } else {
                console.log(`  ❓ 네이버 최저가를 찾을 수 없음`);
                const attemptedAt = new Date().toISOString();
                naverPrices[key] = {
                    ...(existingEntry || {}),
                    naverLowest: existingEntry?.naverLowest || 0,
                    crawledAt: existingEntry?.crawledAt || attemptedAt,
                    route: `${depCode}-${arrCode}`,
                    depDate,
                    retDate,
                    lastAttemptAt: attemptedAt,
                    lastAttemptStatus: 'miss',
                };
                failCount++;
                consecutiveMisses++;
            }
        } catch (err: any) {
            console.log(`  ❌ 에러: ${err.message}`);
            const attemptedAt = new Date().toISOString();
            naverPrices[key] = {
                ...(existingEntry || {}),
                naverLowest: existingEntry?.naverLowest || 0,
                crawledAt: existingEntry?.crawledAt || attemptedAt,
                route: `${depCode}-${arrCode}`,
                depDate,
                retDate,
                lastAttemptAt: attemptedAt,
                lastAttemptStatus: 'miss',
            };
            failCount++;
            consecutiveMisses++;
            page.removeAllListeners('response');
        }

        // 차단 감지: 연속 N건 결과 없음 → 수집분 저장하고 조기 철수
        // (차단 상태에서 계속 두드리면 빈손 + 차단 연장 위험만 커짐)
        if (consecutiveMisses >= ABORT_AFTER_MISSES) {
            console.log(`\n🛑 연속 ${consecutiveMisses}건 결과 없음 — 차단으로 판단하고 조기 철수합니다.`);
            console.log(`   (지금까지 수집한 ${successCount}건은 저장됨)`);
            abortedEarly = true;
            break;
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

    await browser.close();

    // 4. 결과 저장
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(naverPrices, null, 2), 'utf-8');

    console.log('─'.repeat(50));
    console.log(`${abortedEarly ? '🛑 조기 철수' : '✅ 완료'}! 성공: ${successCount}건, 실패: ${failCount}건`);
    console.log(`📁 저장: ${OUTPUT_FILE}`);
})();

// ─── 검색 키 ───
function flightKey(f: FlightData): string {
    return `${f.departure.airport}-${f.arrival.airport}_${normalizeDate(f.departure.date)}_${normalizeDate(f.arrival.date)}`;
}

/**
 * 노선 중복 제거(같은 노선+날짜는 최저가 1건) 후,
 * 신선한(FRESH_HOURS 이내) 노선을 제외하고 우선순위로 정렬한다.
 *
 * 우선순위: ① 네이버 데이터가 없는 신규 노선 (할인율 높은 순)
 *          ② 데이터가 있는 노선은 마지막 검색이 오래된 순
 *
 * 차단으로 조기 철수하더라도 가치 있는 노선부터 커버되도록 하기 위함.
 */
function selectFlightsByPriority(
    flights: FlightData[],
    naverPrices: Record<string, NaverPriceEntry>,
    limit: number
): { selected: FlightData[]; skippedFresh: number } {
    const seen = new Set<string>();
    const unique = flights
        .filter(f => f.price > 0 && f.departure?.airport && f.arrival?.airport)
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
        if (isAttemptFresh(entry, now)) {
            skippedFresh++;
            return false;
        }
        return true;
    });

    const selected = stale
        .sort((a, b) => {
            const ea = naverPrices[flightKey(a)];
            const eb = naverPrices[flightKey(b)];
            // 신규 노선 먼저
            if (!ea !== !eb) return ea ? 1 : -1;
            // 신규끼리는 할인율 높은 순
            if (!ea && !eb) return (b.discountRate ?? 0) - (a.discountRate ?? 0);
            // 기존 노선끼리는 오래된 순
            return attemptTimestamp(ea!) - attemptTimestamp(eb!);
        })
        .slice(0, limit);

    return { selected, skippedFresh };
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
