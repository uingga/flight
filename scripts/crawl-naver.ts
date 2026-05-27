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
const MAX_FLIGHTS = 30;             // 상위 N개 항공권만 검색
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
}

interface NaverPriceEntry {
    naverLowest: number;
    crawledAt: string;
    route: string;
    depDate: string;
    retDate: string;
}

// ─── 메인 ───
(async () => {
    console.log('🔍 네이버 항공권 최저가 크롤러 시작...\n');

    // 1. all-flights-cache.json에서 상위 30개 추출
    if (!fs.existsSync(ALL_FLIGHTS_FILE)) {
        console.error('❌ all-flights-cache.json 파일이 없습니다.');
        process.exit(1);
    }

    const rawFile = JSON.parse(fs.readFileSync(ALL_FLIGHTS_FILE, 'utf-8'));
    const rawData: FlightData[] = Array.isArray(rawFile) ? rawFile : (rawFile.flights || Object.values(rawFile).flat());
    const uniqueFlights = getUniqueTopFlights(rawData, MAX_FLIGHTS);

    console.log(`📋 검색할 항공권: ${uniqueFlights.length}건\n`);

    // 2. 기존 결과 불러오기
    let naverPrices: Record<string, NaverPriceEntry> = {};
    if (fs.existsSync(OUTPUT_FILE)) {
        try {
            naverPrices = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
        } catch { /* 새로 시작 */ }
    }

    // 3. 브라우저 실행
    const browser = await chromium.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        locale: 'ko-KR',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    let successCount = 0;
    let failCount = 0;

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

        // 이미 오늘 크롤링한 건 스킵
        if (naverPrices[key]?.crawledAt?.startsWith(new Date().toISOString().substring(0, 10))) {
            console.log(`  ⏭️ 오늘 이미 검색함 (${naverPrices[key].naverLowest.toLocaleString()}원)\n`);
            continue;
        }

        try {
            // 네이버 항공권 왕복 검색 URL
            const naverUrl = `https://flight.naver.com/flights/international/${depCode}-${arrCode}-${depDateCompact}/${arrCode}-${depCode}-${retDateCompact}?adult=1&isDirect&fareType=Y`;

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

            // 추가로 DOM에서도 가격을 읽어 보기 (보험)
            const domPrice = await extractPriceFromDOM(page);
            if (domPrice && (lowestPrice === null || domPrice < lowestPrice)) {
                lowestPrice = domPrice;
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
                };

                const diff = flight.price - lowestPrice;
                const emoji = diff <= 0 ? '✅' : '⚠️';
                console.log(`  ${emoji} 네이버 최저가: ${lowestPrice.toLocaleString()}원 (차이: ${diff >= 0 ? '+' : ''}${diff.toLocaleString()}원)`);
                successCount++;
            } else {
                console.log(`  ❓ 네이버 최저가를 찾을 수 없음`);
                failCount++;
            }
        } catch (err: any) {
            console.log(`  ❌ 에러: ${err.message}`);
            failCount++;
            page.removeAllListeners('response');
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
    console.log(`✅ 완료! 성공: ${successCount}건, 실패: ${failCount}건`);
    console.log(`📁 저장: ${OUTPUT_FILE}`);
})();

// ─── 상위 N개 고유 항공권 추출 ───
function getUniqueTopFlights(flights: FlightData[], limit: number): FlightData[] {
    const seen = new Set<string>();

    return flights
        .filter(f => f.price > 0 && f.departure?.airport && f.arrival?.airport)
        .sort((a, b) => a.price - b.price)
        .filter(f => {
            const depDate = normalizeDate(f.departure.date);
            const retDate = normalizeDate(f.arrival.date);
            const key = `${f.departure.airport}-${f.arrival.airport}_${depDate}_${retDate}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, limit);
}

// ─── GraphQL 응답에서 가격 추출 ───
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

        // 배열이면 각 요소 순회
        if (Array.isArray(obj)) {
            obj.forEach(walk);
        } else {
            Object.values(obj).forEach(walk);
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
