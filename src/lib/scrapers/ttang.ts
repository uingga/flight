import { chromium } from 'playwright';
import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';
import { logCrawlResults } from '@/lib/utils/crawl-logger';

const randomDelay = (min: number, max: number) =>
    new Promise(r => setTimeout(r, (Math.random() * (max - min) + min) * 1000));

/**
 * 땡처리닷컴 프로모션 페이지 크롤링
 * URL: https://mm.ttang.com/ttangair/search/promotion/ttangIndex.do?depdate0={YYYYMMDD}
 *
 * 2026-02-15: promotion/ttangIndex.do 페이지에서 날짜별 순회
 * - li.exair1 data 속성으로 항공편 정보 직접 추출
 * - 오늘부터 1개월간 크롤링
 */

// 출발 도시 코드 매핑
const DEP_CITY_MAP: Record<string, { city: string; airport: string }> = {
    'ICN': { city: '서울', airport: 'ICN' },
    'GMP': { city: '서울(김포)', airport: 'GMP' },
    'PUS': { city: '부산', airport: 'PUS' },
    'CJJ': { city: '청주', airport: 'CJJ' },
    'CJU': { city: '제주', airport: 'CJU' },
    'TAE': { city: '대구', airport: 'TAE' },
    'MWX': { city: '무안', airport: 'MWX' },
};

/** YYYYMMDD 형식 문자열 생성 */
function formatDateParam(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}

/** 프로모션 페이지 URL 생성 (필수 파라미터만) */
function buildPromotionUrl(depdate: string): string {
    return `https://mm.ttang.com/ttangair/search/promotion/ttangIndex.do?trip=RT&depdate0=${depdate}&adt=1&chd=0&inf=0&page=1&scale=20`;
}

export async function scrapeTtang(): Promise<Flight[]> {
    console.log('\n=== 땡처리닷컴 프로모션 크롤링 시작 ===');

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        viewport: { width: 390, height: 844 },
    });

    const page = await context.newPage();
    const allFlights: Flight[] = [];
    const processedKeys = new Set<string>();

    try {
        // 오늘부터 1개월간 크롤링
        const today = new Date();
        const endDate = new Date(today);
        endDate.setMonth(endDate.getMonth() + 1);
        console.log(`[땡처리] 크롤링 범위: ${formatDateParam(today)} ~ ${formatDateParam(endDate)}`);

        // 날짜별 순회
        const currentDate = new Date(today);
        let totalDays = 0;

        while (currentDate <= endDate) {
            const dateParam = formatDateParam(currentDate);
            totalDays++;

            try {
                const url = buildPromotionUrl(dateParam);
                await page.goto(url, {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000,
                });
                // li.exair1 요소가 렌더링될 때까지 대기 (최대 8초)
                await page.waitForSelector('li.exair1', { timeout: 8000 }).catch(() => { });
                await randomDelay(0.3, 0.8);

                // 더보기 버튼 반복 클릭
                let moreClicks = 0;
                while (moreClicks < 10) {
                    const moreBtn = await page.$('#allttang_more_data_001_btn');
                    if (!moreBtn) break;

                    const isVisible = await moreBtn.isVisible();
                    if (!isVisible) break;

                    await moreBtn.click();
                    await randomDelay(0.8, 1.5);
                    moreClicks++;
                }

                // li.exair1 에서 데이터 추출
                const flights = await page.evaluate(() => {
                    const items = document.querySelectorAll('li.exair1');
                    return Array.from(items).map(li => {
                        const el = li as HTMLElement;
                        return {
                            airline: el.dataset.tktcardesc || '',
                            depCity: el.dataset.depcitydesc || '',
                            depAirport: el.dataset.depcitycode || '',
                            arrCity: el.dataset.arrcitydesc || '',
                            arrAirport: el.dataset.arrcitycode || '',
                            depDate: el.dataset.fromsupplydate || '',
                            arrDate: el.dataset.tosupplydate || '',
                            price: parseInt(el.dataset.totalprice || '0') || 0,
                            masterId: el.dataset.masterid || '',
                            gubun: el.dataset.gubun || '',
                        };
                    });
                });

                let dayCount = 0;
                for (const f of flights) {
                    if (!f.depDate || !f.arrDate || f.price <= 0) continue;

                    const key = `${f.airline}|${f.depDate}|${f.arrDate}|${f.price}|${f.depCity}|${f.arrCity}`;
                    if (processedKeys.has(key)) continue;
                    processedKeys.add(key);

                    const depInfo = DEP_CITY_MAP[f.depAirport] || { city: f.depCity || '서울', airport: f.depAirport || 'ICN' };
                    const depDateParam = f.depDate ? f.depDate.replace(/-/g, '') : '';
                    const textFragment = f.arrCity
                        ? `#:~:text=${encodeURIComponent(f.arrCity)}`
                        : '';
                    const link = `https://mm.ttang.com/ttangair/search/promotion/ttangIndex.do?trip=RT&depdate0=${depDateParam}&adt=1&chd=0&inf=0&page=1&scale=200${textFragment}`;
                    const searchLink = `https://mm.ttang.com/ttangair/search/promotion/ttangIndex.do?trip=RT&depdate0=${depDateParam}&adt=1&chd=0&inf=0&page=1&scale=200`;

                    const flight: Flight = {
                        id: `ttang-${f.masterId}-${f.depDate}`,
                        source: 'ttang',
                        airline: f.airline || '알 수 없음',
                        departure: {
                            city: depInfo.city,
                            airport: f.depAirport || depInfo.airport,
                            date: f.depDate,
                            time: '',
                        },
                        arrival: {
                            city: f.arrCity,
                            airport: f.arrAirport || '',
                            date: f.arrDate,
                            time: '',
                        },
                        price: f.price,
                        currency: 'KRW',
                        link,
                        searchLink,
                        region: getRegionByCity(f.arrCity) || '',
                    };

                    allFlights.push(flight);
                    dayCount++;
                }

                if (dayCount > 0) {
                    console.log(`[땡처리] ${dateParam}: ${dayCount}개 항공편${moreClicks > 0 ? ` (더보기 ${moreClicks}회)` : ''}`);
                }

            } catch (error) {
                console.error(`[땡처리] ${dateParam} 실패:`, error instanceof Error ? error.message : error);
            }

            // 다음 날짜
            currentDate.setDate(currentDate.getDate() + 1);
        }

        console.log(`\n[땡처리] ${totalDays}일 순회, 총 ${allFlights.length}개 항공편 수집 완료`);
        logCrawlResults('ttang', allFlights.length);

    } catch (error) {
        console.error('[땡처리] 크롤링 오류:', error);
    } finally {
        await browser.close();
    }

    return allFlights;
}

/**
 * 땡처리닷컴 할인(discount) 페이지 크롤링
 * URL: https://www.ttang.com/ttangair/search/discount/index.do?page=1&scale=200
 *
 * - PC 전용 페이지, 단일 페이지 로드로 전체 상품 수집
 * - 날짜 범위를 개별 출발일로 분리
 */
export async function scrapeTtangDiscount(): Promise<Flight[]> {
    console.log('\n=== 땡처리닷컴 할인 페이지 크롤링 시작 ===');

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();
    const allFlights: Flight[] = [];
    const processedKeys = new Set<string>();

    try {
        const url = 'https://www.ttang.com/ttangair/search/discount/index.do?page=1&scale=200';
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('table tbody tr', { timeout: 10000 }).catch(() => { });
        await randomDelay(1, 2);

        // 테이블 행에서 데이터 추출
        const items = await page.evaluate(() => {
            const rows = document.querySelectorAll('table tbody tr');
            return Array.from(rows).map(row => {
                const tds = row.querySelectorAll('td');
                if (tds.length < 7) return null;

                // 출발지, 도착지: td > p.shortCut 텍스트
                const depCity = tds[0]?.querySelector('p.shortCut')?.textContent?.trim()
                    || tds[0]?.textContent?.trim() || '';
                const arrCity = tds[1]?.querySelector('p.shortCut')?.textContent?.trim()
                    || tds[1]?.textContent?.trim() || '';

                // 항공사: td.airlogo 텍스트
                const airline = tds[2]?.textContent?.trim() || '';

                // 직항/경유
                const via = tds[3]?.textContent?.trim() || '';

                // 날짜 범위: "2026.03.02~2026.03.19" 형태
                const dateText = tds[5]?.textContent?.trim() || '';

                // 가격: "151,500원~" 형태
                const priceText = tds[6]?.textContent?.trim() || '';
                const price = parseInt(priceText.replace(/[^0-9]/g, '')) || 0;

                // 예약 버튼의 data 속성
                const btn = row.querySelector('a[data-masterid]') as HTMLAnchorElement | null;
                const masterid = btn?.dataset.masterid || '';
                const depcity = btn?.dataset.depcity || '';
                const fromDt = btn?.dataset.fromsupplydt || '';
                const toDt = btn?.dataset.tosupplydt || '';
                const minimumcnt = btn?.dataset.minimumcnt || '';

                return {
                    depCity, arrCity, airline, via,
                    dateText, price, masterid,
                    depCityCode: depcity,
                    fromDt, toDt, minimumcnt,
                };
            }).filter(Boolean);
        });

        console.log(`[땡처리 할인] ${items.length}개 상품 발견`);

        for (const item of items) {
            if (!item || item.price <= 0 || !item.fromDt || !item.toDt) continue;
            // 2인 이상만 예약 가능한 상품 건너뛰기
            if (item.minimumcnt && parseInt(item.minimumcnt) > 1) continue;

            const depInfo = DEP_CITY_MAP[item.depCityCode] || { city: item.depCity || '서울', airport: item.depCityCode || 'ICN' };

            // 날짜 범위를 개별 출발일로 분리 (YYYYMMDD → Date)
            const fromDate = parseYYYYMMDD(item.fromDt);
            const toDate = parseYYYYMMDD(item.toDt);
            if (!fromDate || !toDate) continue;

            // 오늘 이전 날짜는 건너뛰기
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const currentDate = new Date(fromDate);
            while (currentDate <= toDate) {
                if (currentDate >= today) {
                    const depDateStr = formatDate(currentDate);
                    const key = `${item.airline}|${depDateStr}|${item.price}|${item.depCity}|${item.arrCity}|disc`;
                    if (!processedKeys.has(key)) {
                        processedKeys.add(key);

                        // 링크: 할인 페이지로 연결 + 도시명 하이라이트
                        const textFragment = item.arrCity
                            ? `#:~:text=${encodeURIComponent(item.arrCity)}`
                            : '';
                        const link = `https://www.ttang.com/ttangair/search/discount/index.do?page=1&scale=200${textFragment}`;

                        const flight: Flight = {
                            id: `ttang-disc-${item.masterid}-${depDateStr}`,
                            source: 'ttang',
                            airline: item.airline || '알 수 없음',
                            departure: {
                                city: depInfo.city,
                                airport: item.depCityCode || depInfo.airport,
                                date: depDateStr,
                                time: '',
                            },
                            arrival: {
                                city: item.arrCity,
                                airport: '',
                                date: depDateStr, // 도착일은 개별 상세에서만 알 수 있으므로 출발일과 동일하게 설정
                                time: '',
                            },
                            price: item.price,
                            currency: 'KRW',
                            link,
                            searchLink: 'https://www.ttang.com/ttangair/search/discount/index.do?page=1&scale=200',
                            region: getRegionByCity(item.arrCity) || '',
                        };

                        allFlights.push(flight);
                    }
                }
                currentDate.setDate(currentDate.getDate() + 1);
            }
        }

        console.log(`[땡처리 할인] 총 ${allFlights.length}개 항공편 (개별 날짜 분리 후)`);
        logCrawlResults('ttang-discount', allFlights.length);

    } catch (error) {
        console.error('[땡처리 할인] 크롤링 오류:', error);
    } finally {
        await browser.close();
    }

    return allFlights;
}

/** YYYYMMDD → Date */
function parseYYYYMMDD(s: string): Date | null {
    if (!s || s.length !== 8) return null;
    const y = parseInt(s.substring(0, 4));
    const m = parseInt(s.substring(4, 6)) - 1;
    const d = parseInt(s.substring(6, 8));
    return new Date(y, m, d);
}

/** Date → YYYY-MM-DD */
function formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
