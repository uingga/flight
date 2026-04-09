import { chromium } from 'playwright';
import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';
import { logCrawlResults } from '@/lib/utils/crawl-logger';
import { enrichWithRealtimeData, applyEnrichData, toHyphenDate, RouteKey } from '@/lib/utils/realtime-enrich';

const randomDelay = (min: number, max: number) =>
    new Promise(r => setTimeout(r, (Math.random() * (max - min) + min) * 1000));

/**
 * 땡처리닷컴 크롤링 (2단계)
 *
 * Phase 1: 프로모션 API (allTtangListAct.do) → 기본 노선/가격 수집
 * Phase 2: realtime_V2 페이지 로드 → 시간/좌석 데이터 보강
 *
 * skdset1Info: "20260415||0905||20260415||1050||PUS||FSZ||..." → 출발시간/도착시간
 * skdset1Detail: "BX||에어부산||1645||PUS||FSZ||...||G||4||..." → 좌석수
 */

const DEP_CITY_MAP: Record<string, { city: string; airport: string }> = {
    'ICN': { city: '서울', airport: 'ICN' },
    'GMP': { city: '서울(김포)', airport: 'GMP' },
    'PUS': { city: '부산', airport: 'PUS' },
    'CJJ': { city: '청주', airport: 'CJJ' },
    'CJU': { city: '제주', airport: 'CJU' },
    'TAE': { city: '대구', airport: 'TAE' },
    'MWX': { city: '무안', airport: 'MWX' },
};

function formatDateParam(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}

/** YYYYMMDD → YYYY-MM-DD */
function formatDate(raw: string): string {
    if (!raw || raw.length < 8) return raw;
    const clean = raw.replace(/\D/g, '').slice(0, 8);
    return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
}



export async function scrapeTtang(): Promise<Flight[]> {
    console.log('\n=== 땡처리닷컴 크롤링 시작 ===');

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1200, height: 800 },
        extraHTTPHeaders: {
            'Referer': 'https://mm.ttang.com/',
            'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        },
    });

    const page = await context.newPage();
    const allFlights: Flight[] = [];
    const processedKeys = new Set<string>();
    const routeKeys: RouteKey[] = [];

    try {
        // ===== Phase 1: 프로모션 API로 기본 데이터 수집 =====
        console.log('[땡처리] Phase 1: 프로모션 API 수집');

        const today = new Date();
        const endDate = new Date(today);
        endDate.setMonth(endDate.getMonth() + 1);

        // 세션 확보
        const firstDate = formatDateParam(today);
        await page.goto(`https://mm.ttang.com/ttangair/search/promotion/ttangIndex.do?trip=RT&depdate0=${firstDate}&adt=1&chd=0&inf=0&page=1&scale=5`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
        });
        await page.waitForTimeout(2000);

        const currentDate = new Date(today);
        let totalDays = 0;

        while (currentDate <= endDate) {
            const dateParam = formatDateParam(currentDate);
            totalDays++;

            try {
                const apiData = await page.evaluate(async (dp: string) => {
                    const body = new URLSearchParams({
                        trip: 'RT', depdate0: dp, adt: '1', chd: '0', inf: '0',
                        page: '1', scale: '200', totalCnt: '0',
                        dep0: '', arr0: '', dep1: '', arr1: '', dep2: '', arr2: '',
                        dep0Name: '', arr0Name: '', dep1Name: '', arr1Name: '', dep2Name: '', arr2Name: '',
                        depdate1: '', depdate2: '', comp: '', car: '', groupId: '',
                        gubun: '', seq: '', requestData: '',
                        skdset1: '', skdset2: '', skdset3: '',
                    });
                    const r = await fetch('/ttangair/search/promotion/allTtangListAct.do', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: body.toString(),
                    });
                    const text = await r.text();
                    const match = text.match(/\{[\s\S]*\}/);
                    if (match) {
                        try { return JSON.parse(match[0]); } catch { return null; }
                    }
                    return null;
                }, dateParam);

                if (!apiData?.response || !Array.isArray(apiData.response)) {
                    currentDate.setDate(currentDate.getDate() + 1);
                    continue;
                }

                let dayCount = 0;
                for (const item of apiData.response) {
                    const depDate = formatDate(item.departureDate || '');
                    const arrDate = formatDate(item.arrivalDate || '');
                    const price = item.totalPrice || 0;

                    if (!depDate || !arrDate || price <= 0) continue;
                    if (depDate === arrDate) continue;

                    const key = `${item.tktCarDesc}|${depDate}|${arrDate}|${price}|${item.depCityDesc}|${item.arrCityDesc}`;
                    if (processedKeys.has(key)) continue;
                    processedKeys.add(key);

                    const depInfo = DEP_CITY_MAP[item.depCityCode] || { city: item.depCityDesc || '서울', airport: item.depCityCode || 'ICN' };
                    const depDateRaw = (item.departureDate || '').replace(/-/g, '');
                    const arrDateRaw = (item.arrivalDate || '').replace(/-/g, '');
                    const depDateHyphen = toHyphenDate(depDateRaw);
                    const arrDateHyphen = toHyphenDate(arrDateRaw);

                    // realtime_V2 링크 (시간/좌석 데이터가 있는 페이지)
                    const link = `https://mm.ttang.com/ttangair/search/realtime_V2/list.do?trip=RT&dep0=${item.depCityCode}&arr0=${item.arrCityCode}&depdate0=${depDateHyphen}&dep1=${item.arrCityCode}&arr1=${item.depCityCode}&depdate1=${arrDateHyphen}&adt=1&chd=0&inf=0&comp=Y`;
                    const searchLink = link;

                    const flight: Flight = {
                        id: `ttang-${item.masterId}-${depDate}`,
                        source: 'ttang',
                        airline: item.tktCarDesc || '알 수 없음',
                        departure: {
                            city: depInfo.city,
                            airport: item.depCityCode || depInfo.airport,
                            date: depDate,
                            time: '', // Phase 2에서 보강
                        },
                        arrival: {
                            city: item.arrCityDesc || '',
                            airport: item.arrCityCode || '',
                            date: arrDate,
                            time: '', // Phase 2에서 보강
                        },
                        price,
                        currency: 'KRW',
                        link,
                        searchLink,
                        region: getRegionByCity(item.arrCityDesc || '') || '',
                    };

                    allFlights.push(flight);
                    routeKeys.push({
                        depCode: item.depCityCode,
                        arrCode: item.arrCityCode,
                        depDate: depDateRaw,
                        arrDate: arrDateRaw,
                    });
                    dayCount++;
                }

                if (dayCount > 0) {
                    console.log(`[땡처리] ${dateParam}: ${dayCount}개 항공편`);
                }
            } catch (error) {
                console.error(`[땡처리] ${dateParam} 실패:`, error instanceof Error ? error.message : error);
            }

            currentDate.setDate(currentDate.getDate() + 1);
            if (totalDays % 5 === 0) await randomDelay(0.3, 0.8);
        }

        console.log(`[땡처리] Phase 1 완료: ${totalDays}일 순회, ${allFlights.length}개 수집`);

        // ===== Phase 2: realtime_V2로 시간/좌석 보강 =====
        if (allFlights.length > 0) {
            const enrichMap = await enrichWithRealtimeData(page, routeKeys, '땡처리');
            const enrichedCount = applyEnrichData(allFlights, routeKeys, enrichMap);
            console.log(`[땡처리] 시간/좌석 보강: ${enrichedCount}/${allFlights.length}개`);
        }

        logCrawlResults('ttang', allFlights.length);

    } catch (error) {
        console.error('[땡처리] 크롤링 오류:', error);
    } finally {
        await browser.close();
    }

    return allFlights;
}
