import { Browser, Page, chromium } from 'playwright';
import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';
// logCrawlResults moved to crawl-all.ts
import { enrichWithRealtimeData, applyEnrichData, RouteKey } from '@/lib/utils/realtime-enrich';
import { IncompleteScrapeError, ScrapeCompleteness } from './scrape-errors';
import { survivingRouteMinPrice } from '@/lib/utils/route-min-price';
import { normalizeAirline } from '@/lib/utils/flight-helpers';
import {
    assertNoSourceAccessBlockText,
    assertNoSourceResponseCollapse,
    describeSourceError,
    parseTtangPromotionXml,
    retrySourceOperation,
    SourceResponseError,
    TtangPromotionPayload,
} from './source-response';
import { classifySourceAccessRestriction } from '../source-circuit';

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

const TTANG_PROMOTION_API = 'https://mm.ttang.com/ttangair/search/promotion/allTtangListAct.do';
const TTANG_PROMOTION_PAGE = 'https://mm.ttang.com/ttangair/search/promotion/ttangIndex.do';

/** 브라우저 쿠키와 네트워크 스택을 사용해 같은 출처에서 프로모션 API를 호출한다. */
export async function fetchTtangPromotionInBrowser(
    page: Pick<Page, 'evaluate'>,
    dateParam: string,
): Promise<TtangPromotionPayload> {
    const body = new URLSearchParams({
        trip: 'RT', depdate0: dateParam, adt: '1', chd: '0', inf: '0',
        page: '1', scale: '200', totalCnt: '0',
        dep0: '', arr0: '', dep1: '', arr1: '', dep2: '', arr2: '',
        dep0Name: '', arr0Name: '', dep1Name: '', arr1Name: '', dep2Name: '', arr2Name: '',
        depdate1: '', depdate2: '', comp: '', car: '', groupId: '',
        gubun: '', seq: '', requestData: '',
        skdset1: '', skdset2: '', skdset3: '',
    }).toString();

    const response = await page.evaluate(async ({ apiUrl, requestBody }) => {
        const result = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/xml,text/xml,*/*',
            },
            body: requestBody,
            credentials: 'include',
        });
        return {
            ok: result.ok,
            status: result.status,
            contentType: result.headers.get('content-type') || '',
            finalUrl: result.url,
            text: await result.text(),
        };
    }, { apiUrl: TTANG_PROMOTION_API, requestBody: body });

    if (!response.ok) {
        throw new SourceResponseError(
            'http-status',
            `땡처리닷컴 ${dateParam} 브라우저 프로모션 API HTTP ${response.status} (content-type: ${response.contentType || '없음'})`,
            response.status,
            response.contentType,
            undefined,
            response.finalUrl,
        );
    }

    return parseTtangPromotionXml(response.text);
}



export async function scrapeTtang(prevFlights: any[] = []): Promise<Flight[]> {
    console.log('\n=== 땡처리닷컴 크롤링 시작 ===');
    const browserState: { browser: Browser | null; page: Page | null } = {
        browser: null,
        page: null,
    };
    const allFlights: Flight[] = [];
    const processedKeys = new Set<string>();
    const routeKeys: RouteKey[] = [];

    try {
        // ===== Phase 1: 프로모션 API로 기본 데이터 수집 =====
        console.log('[땡처리] Phase 1: 프로모션 API 수집');

        // 날짜 하나가 실패하면 그날 특가가 통째로 빠진 채 정상 종료한다.
        // 직전 크롤에 그 출발일 항공권이 있었다면 고장으로 본다.
        const completeness = new ScrapeCompleteness('땡처리닷컴', 'ttang', prevFlights);

        const ensureBrowserPage = async (dateParam: string): Promise<Page> => {
            if (browserState.page) return browserState.page;

            browserState.browser = await chromium.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            });
            const context = await browserState.browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                viewport: { width: 1200, height: 800 },
                locale: 'ko-KR',
                extraHTTPHeaders: {
                    Referer: 'https://mm.ttang.com/',
                    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                },
            });
            browserState.page = await context.newPage();
            const landingResponse = await browserState.page.goto(
                `${TTANG_PROMOTION_PAGE}?trip=RT&depdate0=${dateParam}&adt=1&chd=0&inf=0&page=1&scale=5`,
                { waitUntil: 'domcontentloaded', timeout: 30_000 },
            );
            if (landingResponse && !landingResponse.ok()) {
                throw new SourceResponseError(
                    'http-status',
                    `땡처리닷컴 브라우저 세션 페이지 HTTP ${landingResponse.status()}`,
                    landingResponse.status(),
                    landingResponse.headers()['content-type'] || '',
                    undefined,
                    landingResponse.url(),
                );
            }
            await browserState.page.waitForTimeout(1_500);
            const landingText = await browserState.page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
            assertNoSourceAccessBlockText('땡처리닷컴 브라우저 세션 페이지', landingText, browserState.page.url());
            return browserState.page;
        };

        const loadInBrowser = async (dateParam: string) => {
            const page = await ensureBrowserPage(dateParam);
            return retrySourceOperation(
                `땡처리닷컴 ${dateParam} 브라우저 요청`,
                () => fetchTtangPromotionInBrowser(page, dateParam),
                { maxAttempts: 2, delaysMs: [3_000] },
            );
        };

        const today = new Date();
        const endDate = new Date(today);
        endDate.setMonth(endDate.getMonth() + 1);

        // GitHub 실행 환경에서 일반 Node.js 요청이 403으로 차단된 이력이 있어
        // 처음부터 실제 브라우저 세션을 확보한다. 차단 확인용 직접 요청은 보내지 않는다.
        await ensureBrowserPage(formatDateParam(today));

        const currentDate = new Date(today);
        let totalDays = 0;
        let daysWithFlights = 0;
        let consecutiveEmptyDays = 0;

        while (currentDate <= endDate) {
            const dateParam = formatDateParam(currentDate);
            totalDays++;

            try {
                const apiData = await loadInBrowser(dateParam);

                let dayCount = 0;
                for (const rawItem of apiData.response) {
                    const item = rawItem as any;
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
                    // 예약 링크는 해당 출발일의 "땡처리 특가" 목록으로 보낸다.
                    // 이 가격은 특가 API에서 온 것이라 일반 실시간 검색(realtime_V2)에는 없다 —
                    // 실시간 검색으로 보내면 광고한 가격이 페이지에 존재하지 않는다. (시간 보강은 routeKeys로 별도 수행)
                    const link = `https://mm.ttang.com/ttangair/search/promotion/ttangIndex.do?trip=RT&depdate0=${depDateRaw}&adt=1&chd=0&inf=0&page=1&scale=200`;
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
                        airline: flight.airline,
                    });
                    dayCount++;
                }

                if (dayCount > 0) {
                    daysWithFlights++;
                    consecutiveEmptyDays = 0;
                    console.log(`[땡처리] ${dateParam}: ${dayCount}개 항공편`);
                } else {
                    consecutiveEmptyDays++;
                }
                assertNoSourceResponseCollapse('땡처리닷컴 날짜별 프로모션 API', {
                    processed: totalDays,
                    succeeded: daysWithFlights,
                    consecutiveFailures: consecutiveEmptyDays,
                }, {
                    maxConsecutiveFailures: 8,
                    minSamples: 12,
                    minSuccessRatio: 0.2,
                });
            } catch (error) {
                console.error(`[땡처리] ${dateParam} 실패: ${describeSourceError(error)}`);
                if (classifySourceAccessRestriction(error)) throw error;
                throw new IncompleteScrapeError(
                    `땡처리닷컴 브라우저 수집이 실패했습니다: ${dateParam} (${describeSourceError(error)})`,
                    [`${dateParam} 이후 전체 출발일`],
                );
            }

            currentDate.setDate(currentDate.getDate() + 1);
            // 한 달치 날짜 API를 연속 발사하지 않는다. 매 요청 사이에 쉬고, 5일마다
            // 사람의 탐색처럼 조금 더 긴 간격을 둔다.
            if (currentDate <= endDate) {
                await randomDelay(1.2, 2.4);
                if (totalDays % 5 === 0) await randomDelay(3, 6);
            }
        }

        console.log(`[땡처리] Phase 1 완료: ${totalDays}일 순회, ${allFlights.length}개 수집`);
        completeness.assertComplete(allFlights.length);

        // ===== Phase 2: 이전 캐시에서 시간 복사 + 신규만 realtime_V2 보강 =====
        if (allFlights.length > 0) {
            // 이전 캐시에서 시간 데이터 복사
            // 이전 캐시에서 시각을 옮겨올 때 쓰는 키.
            //
            // 예전에는 노선과 날짜만 봤다. 같은 노선·같은 날짜에 항공사가 둘이면 엉뚱한
            // 항공사의 출발 시각이 붙는다. 실시간 보강 쪽은 이미 항공사까지 대조하는데
            // (enrichKeyOf) 복사 쪽만 빠져 있었다. 가격과 노선은 맞고 시각만 틀리므로
            // 아무도 알아채지 못한 채 남는다.
            const timeKeyOf = (f: any) => [
                normalizeAirline(f.airline || ''),
                f.departure?.airport || '',
                f.arrival?.airport || '',
                f.departure?.date || '',
                f.arrival?.date || '',
            ].join('|');

            const prevTimeMap = new Map<string, any>();
            prevFlights.filter((f: any) => f.source === 'ttang' && f.departure?.time).forEach((f: any) => {
                prevTimeMap.set(timeKeyOf(f), f);
            });

            let carriedOver = 0;
            const newRouteKeys: RouteKey[] = [];
            const newRouteIndices: number[] = [];

            // 최저가 필터에서 살아남을 표만 보강한다 — 나머지는 crawl-all이 어차피 버리는데
            // 노선당 실시간 페이지를 여는 비용이 커서 크롤 전체가 몇 시간씩 늘어졌다.
            const survivors = survivingRouteMinPrice(allFlights);

            for (let i = 0; i < allFlights.length; i++) {
                const f = allFlights[i];
                const prev = prevTimeMap.get(timeKeyOf(f));

                if (prev?.departure?.time) {
                    f.departure.time = prev.departure.time;
                    if ((prev.departure as any).arrivalTime) (f.departure as any).arrivalTime = (prev.departure as any).arrivalTime;
                    if (prev.arrival?.time) f.arrival.time = prev.arrival.time;
                    if ((prev.arrival as any)?.arrivalTime) (f.arrival as any).arrivalTime = (prev.arrival as any).arrivalTime;
                    if (prev.availableSeats && !f.availableSeats) {
                        f.availableSeats = prev.availableSeats;
                        f.seats = prev.seats;
                    }
                    carriedOver++;
                } else if (routeKeys[i] && survivors.has(f)) {
                    newRouteKeys.push(routeKeys[i]);
                    newRouteIndices.push(i);
                }
            }

            console.log(`[땅처리] 이전 시간 복사: ${carriedOver}/${allFlights.length}개, 신규 enrich 대상: ${newRouteKeys.length}개 (최저가 생존 ${survivors.size}건 중)`);

            // 신규 노선만 realtime_V2로 보강
            if (newRouteKeys.length > 0) {
                const page = await ensureBrowserPage(formatDateParam(today));
                const enrichMap = await enrichWithRealtimeData(page, newRouteKeys, '땅처리');
                const newFlights = newRouteIndices.map(i => allFlights[i]);
                const enrichedCount = applyEnrichData(newFlights, newRouteKeys, enrichMap);
                console.log(`[땅처리] 신규 시간 보강: ${enrichedCount}/${newRouteKeys.length}개`);
            }
        }

        // logCrawlResults moved to crawl-all.ts

    } catch (error) {
        console.error('[땡처리] 크롤링 오류:', error);
        if (classifySourceAccessRestriction(error)) throw error;
        // 불완전 수집은 호출부가 알아야 이전 캐시를 지킬 수 있으므로 삼키지 않는다
        if (error instanceof IncompleteScrapeError) throw error;
        throw new IncompleteScrapeError(
            `땡처리닷컴 브라우저 수집을 시작하거나 완료하지 못했습니다: ${describeSourceError(error)}`,
            ['전체 출발일'],
        );
    } finally {
        await browserState.browser?.close();
    }

    return allFlights;
}
