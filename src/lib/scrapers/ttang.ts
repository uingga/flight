import { Browser, chromium } from 'playwright';
import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';
// logCrawlResults moved to crawl-all.ts
import { enrichWithRealtimeData, applyEnrichData, RouteKey } from '@/lib/utils/realtime-enrich';
import { IncompleteScrapeError, ScrapeCompleteness } from './scrape-errors';
import { survivingRouteMinPrice } from '@/lib/utils/route-min-price';
import { normalizeAirline } from '@/lib/utils/flight-helpers';
import {
    describeSourceError,
    fetchSourceText,
    parseTtangPromotionXml,
    SourceResponseError,
    TtangPromotionPayload,
} from './source-response';

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

export async function fetchTtangPromotion(dateParam: string): Promise<TtangPromotionPayload> {
    const body = new URLSearchParams({
        trip: 'RT', depdate0: dateParam, adt: '1', chd: '0', inf: '0',
        page: '1', scale: '200', totalCnt: '0',
        dep0: '', arr0: '', dep1: '', arr1: '', dep2: '', arr2: '',
        dep0Name: '', arr0Name: '', dep1Name: '', arr1Name: '', dep2Name: '', arr2Name: '',
        depdate1: '', depdate2: '', comp: '', car: '', groupId: '',
        gubun: '', seq: '', requestData: '',
        skdset1: '', skdset2: '', skdset3: '',
    });
    const response = await fetchSourceText(
        `땡처리닷컴 ${dateParam} 프로모션 API`,
        TTANG_PROMOTION_API,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/xml,text/xml,*/*',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Referer: 'https://mm.ttang.com/ttangair/search/promotion/ttangIndex.do',
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
            },
            body,
        },
        20_000,
    );

    if (!/xml|text\/plain/i.test(response.contentType)) {
        if (/<!doctype\s+html|<html\b/i.test(response.text)) {
            return parseTtangPromotionXml(response.text);
        }
        throw new SourceResponseError(
            'unexpected-content',
            `땡처리닷컴 ${dateParam} 응답 형식이 XML이 아닙니다: ${response.contentType || '없음'}`,
            response.status,
            response.contentType,
        );
    }

    return parseTtangPromotionXml(response.text);
}



export async function scrapeTtang(prevFlights: any[] = []): Promise<Flight[]> {
    console.log('\n=== 땡처리닷컴 크롤링 시작 ===');
    let browser: Browser | null = null;
    const allFlights: Flight[] = [];
    const processedKeys = new Set<string>();
    const routeKeys: RouteKey[] = [];

    try {
        // ===== Phase 1: 프로모션 API로 기본 데이터 수집 =====
        console.log('[땡처리] Phase 1: 프로모션 API 수집');

        // 날짜 하나가 실패하면 그날 특가가 통째로 빠진 채 정상 종료한다.
        // 직전 크롤에 그 출발일 항공권이 있었다면 고장으로 본다.
        const completeness = new ScrapeCompleteness('땡처리닷컴', 'ttang', prevFlights);

        const today = new Date();
        const endDate = new Date(today);
        endDate.setMonth(endDate.getMonth() + 1);

        const currentDate = new Date(today);
        let totalDays = 0;

        while (currentDate <= endDate) {
            const dateParam = formatDateParam(currentDate);
            totalDays++;

            try {
                const apiData = await fetchTtangPromotion(dateParam);

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
                    console.log(`[땡처리] ${dateParam}: ${dayCount}개 항공편`);
                }
            } catch (error) {
                console.error(`[땡처리] ${dateParam} 실패: ${describeSourceError(error)}`);
                completeness.recordFailure(
                    `${dateParam} 출발`,
                    f => (f.departure?.date || '').replace(/-/g, '') === dateParam,
                );
            }

            currentDate.setDate(currentDate.getDate() + 1);
            if (totalDays % 5 === 0) await randomDelay(0.3, 0.8);
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
                browser = await chromium.launch({
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox'],
                });
                const context = await browser.newContext({
                    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    viewport: { width: 1200, height: 800 },
                    extraHTTPHeaders: {
                        Referer: 'https://mm.ttang.com/',
                        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                    },
                });
                const page = await context.newPage();
                const enrichMap = await enrichWithRealtimeData(page, newRouteKeys, '땅처리');
                const newFlights = newRouteIndices.map(i => allFlights[i]);
                const enrichedCount = applyEnrichData(newFlights, newRouteKeys, enrichMap);
                console.log(`[땅처리] 신규 시간 보강: ${enrichedCount}/${newRouteKeys.length}개`);
            }
        }

        // logCrawlResults moved to crawl-all.ts

    } catch (error) {
        console.error('[땡처리] 크롤링 오류:', error);
        // 불완전 수집은 호출부가 알아야 이전 캐시를 지킬 수 있으므로 삼키지 않는다
        if (error instanceof IncompleteScrapeError) throw error;
    } finally {
        await browser?.close();
    }

    return allFlights;
}
