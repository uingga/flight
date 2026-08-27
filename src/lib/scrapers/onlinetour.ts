import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';
import { ScrapeCompleteness } from './scrape-errors';
import {
    describeSourceError,
    fetchSourceText,
    parseOnlineTourJsonp,
    retrySourceOperation,
    SourceResponseError,
} from './source-response';

const LIST_PAGE_URL = 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList';
const LIST_API_URL = 'https://api.onlinetour.co.kr/v2/flight/international/dcair/list';
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    Referer: LIST_PAGE_URL,
};

interface RegionDefinition {
    code: string;
    name: string;
    regions: string[];
    excludeAirports?: string[];
    airports?: string[];
}

// 탭 이름과 우리가 항공권에 붙이는 지역 이름이 다르므로 지역 이름과 공항 코드를 함께 본다.
const REGIONS: RegionDefinition[] = [
    { code: 'AS', name: '아시아', regions: ['동남아', '기타'] },
    { code: 'JA', name: '일본', regions: ['일본'] },
    { code: 'CH', name: '중국', regions: ['중국'] },
    { code: 'EU', name: '유럽', regions: ['유럽'] },
    { code: 'HN', name: '남태평양', regions: ['남태평양'], excludeAirports: ['GUM', 'SPN'] },
    { code: 'US', name: '미주', regions: ['미주'] },
    { code: 'GS', name: '괌/사이판', regions: [], airports: ['GUM', 'SPN'] },
];

function belongsToRegion(flight: any, region: RegionDefinition): boolean {
    const airport = flight?.arrival?.airport || '';
    if (region.airports) return region.airports.includes(airport);
    if (region.excludeAirports?.includes(airport)) return false;
    const named = flight?.region || getRegionByCity(flight?.arrival?.city || '');
    return region.regions.includes(named);
}

function formatDate(raw: unknown, referenceDate?: string): string {
    const value = String(raw || '').trim();
    const compact = value.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;

    const monthDay = value.match(/^(\d{2})-(\d{2})/);
    const reference = referenceDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!monthDay || !reference) return '';

    const month = Number(monthDay[1]);
    const referenceMonth = Number(reference[2]);
    const year = Number(reference[1]) + (month < referenceMonth ? 1 : 0);
    return `${year}-${monthDay[1]}-${monthDay[2]}`;
}

function formatTime(raw: unknown): string {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length < 3) return '';
    const padded = digits.padStart(4, '0').slice(0, 4);
    return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`;
}

function textField(item: Record<string, unknown>, key: string): string {
    return String(item[key] || '').trim();
}

function numberField(item: Record<string, unknown>, key: string): number {
    const value = Number(item[key]);
    return Number.isFinite(value) ? value : 0;
}

function destinationSearchCode(item: Record<string, unknown>): string {
    // arr_city_code는 BOR·SIA처럼 온라인투어 검색창이 쓰는 여행지 코드다.
    // 일부 푸꾸옥 상품은 이 값만 비어 있으므로 실제 도착 공항으로 같은 목적지에 묶는다.
    return textField(item, 'arr_city_code') || textField(item, 'start_city_code2');
}

function departureMonth(item: Record<string, unknown>): string {
    const match = textField(item, 'dep_start_date').match(/^(\d{6})\d{2}$/);
    return match?.[1] || '';
}

/**
 * 기존 도시별 수집은 지역 HTML이 알려준 각 도시의 첫 출발월만 API에 요청했다.
 * 지역 API를 한 번에 읽더라도 같은 기간 범위를 유지해, 먼 훗날의 더 싼 일정이
 * 현재 달의 항공권을 노선 최저가 목록에서 밀어내지 않게 한다.
 */
export function keepEarliestDepartureMonthByDestination(
    rows: Record<string, unknown>[],
): Record<string, unknown>[] {
    const earliestMonth = new Map<string, string>();

    for (const row of rows) {
        const destination = destinationSearchCode(row);
        const month = departureMonth(row);
        if (!destination || !month) continue;

        const current = earliestMonth.get(destination);
        if (!current || month < current) earliestMonth.set(destination, month);
    }

    return rows.filter(row => {
        const destination = destinationSearchCode(row);
        const month = departureMonth(row);
        // 필수값이 깨진 행은 여기서 숨기지 않고 변환 단계의 누락 검사에 맡긴다.
        if (!destination || !month) return true;
        return month === earliestMonth.get(destination);
    });
}

export function mapOnlineTourFlight(item: Record<string, unknown>): Flight | null {
    const eventCode = textField(item, 'event_code');
    const departureDate = formatDate(item.dep_start_date);
    const returnDate = formatDate(item.arr_start_date, departureDate);
    const price = numberField(item, 'adult_price') - numberField(item, 'adult_fee_price');
    const departureAirport = textField(item, 'start_city_code');
    const actualOutboundArrival = textField(item, 'start_city_code2');
    const actualOutboundArrivalCity = textField(item, 'start_city_code_name2');
    const actualReturnDeparture = textField(item, 'end_city_code');
    const actualReturnArrival = textField(item, 'end_city_code2');
    // arr_city_code는 보라카이(BOR) 같은 여행지 검색 코드다. 일부 정상 상품은
    // 이 값이 비어 있으므로 실제 도착 공항을 반드시 보조값으로 사용한다.
    const destinationCode = textField(item, 'arr_city_code') || actualOutboundArrival;
    const destinationName = textField(item, 'arr_city_code_name') || actualOutboundArrivalCity;

    if (!eventCode || !departureDate || !returnDate || !departureAirport || !destinationCode || price <= 0) return null;
    if (departureDate === returnDate) return null;

    const seats = numberField(item, 'res_cnt');
    const depCodeForSearch = departureAirport === 'GMP' || departureAirport === 'ICN'
        ? 'SEL'
        : departureAirport;
    const startDt = departureDate.replace(/-/g, '');
    const endDt = returnDate.replace(/-/g, '');
    const arrivalCity = actualOutboundArrivalCity && actualOutboundArrivalCity !== textField(item, 'start_city_code_name')
        ? actualOutboundArrivalCity
        : destinationName;
    const searchLink = `https://www.onlinetour.co.kr/flight/w/international/booking/flightInterFareSearch?trip=RT&sCity1=${depCodeForSearch}&eCity1=${destinationCode}&sCity2=${destinationCode}&eCity2=${depCodeForSearch}&startDt=${startDt}&endDt=${endDt}&adt=1`;

    return {
        id: `online-${eventCode}`,
        source: 'onlinetour',
        airline: textField(item, 'transport_detail_name') || textField(item, 'dep_pyun_name') || '알 수 없음',
        departure: {
            city: textField(item, 'start_city_code_name') || (departureAirport === 'PUS' ? '부산' : departureAirport === 'GMP' ? '김포' : '인천'),
            airport: departureAirport,
            date: departureDate,
            time: formatTime(item.dep_start_time),
            arrivalTime: formatTime(item.dep_end_time),
        },
        arrival: {
            city: arrivalCity,
            // 기존 필터·노선 키와의 호환을 위해 여행지 코드를 유지하고 실제 공항은 routeAirports에 보관한다.
            airport: destinationCode,
            date: returnDate,
            time: formatTime(item.arr_start_time),
            arrivalTime: formatTime(item.arr_end_time),
        },
        price,
        currency: 'KRW',
        link: `https://www.onlinetour.co.kr/flight/w/international/dcair/dcairReservation?eventCode=${eventCode}`,
        searchLink,
        region: getRegionByCity(arrivalCity),
        ...(seats > 0 ? { availableSeats: seats, seats: `${seats}석` } : {}),
        ...(actualOutboundArrival && actualReturnDeparture && actualReturnArrival ? {
            routeAirports: {
                outboundDeparture: departureAirport,
                outboundArrival: actualOutboundArrival,
                returnDeparture: actualReturnDeparture,
                returnArrival: actualReturnArrival,
            },
        } : {}),
    };
}

async function fetchRegionRows(region: RegionDefinition): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    let expectedLastPage: number | null = null;
    let expectedTotalCount: number | null = null;

    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
        const callback = `tikitikitDcair${region.code}${pageNo}`;
        const url = new URL(LIST_API_URL);
        const params: Record<string, string> = {
            apiKey: '',
            transportStartCity: '',
            transportEndCity: '',
            eventStartMonth: '',
            eventStartDate: '',
            areaCode: region.code,
            order: 'LP',
            pageNo: String(pageNo),
            pageSize: String(PAGE_SIZE),
            pageYn: 'Y',
            depPyunStr: '',
            statusStr: '',
            callback,
        };
        Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

        const label = `온라인투어 ${region.name} 목록 ${pageNo}페이지`;
        const payload = await retrySourceOperation(label, async () => {
            const response = await fetchSourceText(label, url, { headers: REQUEST_HEADERS }, 20_000);
            if (!/javascript|json|text\/plain/i.test(response.contentType)) {
                throw new SourceResponseError(
                    'unexpected-content',
                    `${label} 응답 형식이 JSONP가 아닙니다: ${response.contentType || '없음'}`,
                    response.status,
                    response.contentType,
                    undefined,
                    response.finalUrl,
                );
            }
            return parseOnlineTourJsonp(response.text, callback);
        }, {
            maxAttempts: 3,
            delaysMs: [500, 1_500],
            onRetry: (error, nextAttempt) => {
                console.warn(`    ${region.name} ${pageNo}페이지 일시 오류 — ${nextAttempt}/3 재시도 (${describeSourceError(error)})`);
            },
        });

        const currentPage = Number(payload.data.paging?.curPage ?? pageNo);
        const lastPage = Number(payload.data.paging?.totalLastPage ?? 1);
        const totalCount = Number(payload.data.paging?.totalCount ?? payload.data.count);
        if (!Number.isInteger(currentPage) || currentPage !== pageNo) {
            throw new SourceResponseError(
                'schema-mismatch',
                `온라인투어 ${region.name} 현재 페이지가 요청과 다릅니다: 요청 ${pageNo}, 응답 ${currentPage}`,
            );
        }
        if (!Number.isInteger(lastPage) || lastPage < 1 || lastPage > MAX_PAGES) {
            throw new SourceResponseError(
                'schema-mismatch',
                `온라인투어 ${region.name} 페이지 수 ${lastPage}가 허용 범위 1~${MAX_PAGES}를 벗어났습니다.`,
            );
        }
        if (!Number.isInteger(totalCount) || totalCount < 0) {
            throw new SourceResponseError(
                'schema-mismatch',
                `온라인투어 ${region.name} 전체 항공권 수가 올바르지 않습니다: ${totalCount}`,
            );
        }

        if (expectedLastPage === null) expectedLastPage = lastPage;
        if (expectedTotalCount === null) expectedTotalCount = totalCount;
        if (lastPage !== expectedLastPage || totalCount !== expectedTotalCount) {
            throw new SourceResponseError(
                'snapshot-changed',
                `온라인투어 ${region.name} 페이지를 읽는 동안 전체 건수가 바뀌었습니다.`,
            );
        }

        rows.push(...payload.data.list);
        if (pageNo < lastPage && payload.data.list.length === 0) {
            throw new SourceResponseError(
                'schema-mismatch',
                `온라인투어 ${region.name} ${pageNo}페이지가 마지막 페이지 전에 비었습니다.`,
            );
        }
        if (pageNo >= lastPage) {
            if (rows.length !== totalCount) {
                throw new SourceResponseError(
                    'snapshot-changed',
                    `온라인투어 ${region.name} 일부 페이지만 수집됐습니다: ${rows.length}/${totalCount}건`,
                );
            }
            const eventCodes = rows.map(row => textField(row, 'event_code'));
            if (eventCodes.some(code => !code)) {
                throw new SourceResponseError(
                    'schema-mismatch',
                    `온라인투어 ${region.name} 목록에 event_code가 없는 항목이 있습니다.`,
                );
            }
            if (new Set(eventCodes).size !== totalCount) {
                throw new SourceResponseError(
                    'snapshot-changed',
                    `온라인투어 ${region.name} 페이지 경계에서 항공권이 중복되거나 누락됐습니다.`,
                );
            }
            return rows;
        }
    }

    throw new SourceResponseError('schema-mismatch', `온라인투어 ${region.name} 페이지 순회가 끝나지 않았습니다.`);
}

async function fetchStableRegionRows(region: RegionDefinition): Promise<Record<string, unknown>[]> {
    try {
        return await fetchRegionRows(region);
    } catch (error) {
        if (!(error instanceof SourceResponseError) || error.kind !== 'snapshot-changed') throw error;
        // 판매 중인 목록은 페이지를 읽는 몇 초 사이에도 한 건이 추가·삭제될 수 있다.
        // 서로 다른 시점의 페이지를 섞지 않고 첫 결과를 버린 뒤 새 스냅샷으로 한 번만 다시 읽는다.
        console.warn(`    ${region.name} 목록이 수집 중 바뀌어 지역 전체를 처음부터 한 번 다시 읽습니다.`);
        return fetchRegionRows(region);
    }
}

export async function scrapeOnlineTour(prevFlights: any[] = []): Promise<Flight[]> {
    console.log('온라인투어 크롤링 시작...');
    const flights: Flight[] = [];
    const processedIds = new Set<string>();
    const completeness = new ScrapeCompleteness('온라인투어', 'onlinetour', prevFlights);

    for (const region of REGIONS) {
        console.log(`\n=== ${region.name} (${region.code}) 직접 수집 ===`);

        try {
            const rows = await fetchStableRegionRows(region);
            if (rows.length === 0) {
                completeness.recordFailure(
                    `${region.name} 지역 목록 0건`,
                    flight => belongsToRegion(flight, region),
                );
                continue;
            }

            const currentRows = keepEarliestDepartureMonthByDestination(rows);

            let regionCount = 0;
            let invalidRows = 0;
            for (const row of currentRows) {
                const flight = mapOnlineTourFlight(row);
                if (!flight) {
                    invalidRows++;
                    continue;
                }
                if (processedIds.has(flight.id)) continue;
                processedIds.add(flight.id);
                flights.push(flight);
                regionCount++;
            }

            if (regionCount === 0) {
                throw new SourceResponseError(
                    'schema-mismatch',
                    `온라인투어 ${region.name} 첫 출발월 응답 ${currentRows.length}건을 항공권으로 변환하지 못했습니다.`,
                );
            }
            if (invalidRows > 0) console.warn(`    ${region.name}: 필수값이 없는 ${invalidRows}건 제외`);
            console.log(`    ${region.name}: ${regionCount}건 수집 (첫 출발월 ${currentRows.length}건 / 지역 원본 ${rows.length}건)`);
        } catch (error) {
            const detail = describeSourceError(error);
            console.error(`  ${region.name} 지역 실패: ${detail}`);
            completeness.recordFailure(
                `${region.name} 지역 목록 — ${detail}`,
                flight => belongsToRegion(flight, region),
            );
        }
    }

    console.log(`온라인투어 완료: 총 ${flights.length}건`);
    completeness.assertComplete(flights.length);

    const regionCounts: Record<string, number> = {};
    flights.forEach(flight => {
        const region = flight.region || '기타';
        regionCounts[region] = (regionCounts[region] || 0) + 1;
    });

    console.log('\n📊 지역별 수집 결과:');
    for (const region of ['동남아', '일본']) {
        const count = regionCounts[region] || 0;
        if (count === 0) console.warn(`  ⚠️ 경고: ${region} - 0건 (스크래퍼 점검 필요)`);
        else console.log(`  ✅ ${region}: ${count}건`);
    }
    for (const region of ['중국', '유럽', '남태평양', '미주', '괌/사이판', '기타']) {
        const count = regionCounts[region] || 0;
        if (count === 0) console.log(`  ℹ️ ${region}: 0건 (특가 없음 또는 미지원)`);
        else console.log(`  ✅ ${region}: ${count}건`);
    }

    const gmpFlights = flights.filter(flight => flight.departure.airport === 'GMP').length;
    if (gmpFlights === 0) console.warn('  ⚠️ 경고: 김포출발(GMP) 항공편 0건 - 하네다 노선 확인 필요');
    else console.log(`  ✅ 김포출발(GMP): ${gmpFlights}건`);

    return flights;
}
