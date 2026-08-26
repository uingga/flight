import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';
import { ScrapeCompleteness } from './scrape-errors';
import {
    describeSourceError,
    fetchSourceText,
    OnlineTourCitySeed,
    parseOnlineTourCities,
    parseOnlineTourJsonp,
    SourceResponseError,
} from './source-response';

const LIST_PAGE_URL = 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList';
const LIST_API_URL = 'https://api.onlinetour.co.kr/v2/flight/international/dcair/list';
const PAGE_SIZE = 200;
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

function mapOnlineTourFlight(item: Record<string, unknown>, city: OnlineTourCitySeed): Flight | null {
    const eventCode = textField(item, 'event_code');
    const departureDate = formatDate(item.dep_start_date);
    const returnDate = formatDate(item.arr_start_date, departureDate);
    const price = numberField(item, 'adult_price') - numberField(item, 'adult_fee_price');
    const departureAirport = textField(item, 'start_city_code');
    const actualOutboundArrival = textField(item, 'start_city_code2');
    const actualOutboundArrivalCity = textField(item, 'start_city_code_name2');
    const actualReturnDeparture = textField(item, 'end_city_code');
    const actualReturnArrival = textField(item, 'end_city_code2');

    if (!eventCode || !departureDate || !returnDate || !departureAirport || price <= 0) return null;
    if (departureDate === returnDate) return null;

    const seats = numberField(item, 'res_cnt');
    const depCodeForSearch = departureAirport === 'GMP' || departureAirport === 'ICN'
        ? 'SEL'
        : departureAirport;
    const startDt = departureDate.replace(/-/g, '');
    const endDt = returnDate.replace(/-/g, '');
    const arrivalCity = actualOutboundArrivalCity && actualOutboundArrivalCity !== textField(item, 'start_city_code_name')
        ? actualOutboundArrivalCity
        : city.name;
    const searchLink = `https://www.onlinetour.co.kr/flight/w/international/booking/flightInterFareSearch?trip=RT&sCity1=${depCodeForSearch}&eCity1=${city.code}&sCity2=${city.code}&eCity2=${depCodeForSearch}&startDt=${startDt}&endDt=${endDt}&adt=1`;

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
            airport: city.code,
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

async function fetchRegionCities(region: RegionDefinition): Promise<OnlineTourCitySeed[]> {
    const url = new URL(LIST_PAGE_URL);
    url.searchParams.set('TabGubun', region.code);
    const response = await fetchSourceText(
        `온라인투어 ${region.name} 지역`,
        url,
        { headers: REQUEST_HEADERS },
        20_000,
    );
    if (!response.contentType.toLowerCase().includes('text/html')) {
        throw new SourceResponseError(
            'unexpected-content',
            `온라인투어 ${region.name} 지역 응답 형식이 HTML이 아닙니다: ${response.contentType || '없음'}`,
            response.status,
            response.contentType,
        );
    }
    return parseOnlineTourCities(response.text);
}

async function fetchCityRows(region: RegionDefinition, city: OnlineTourCitySeed): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    const eventStartMonth = city.firstDepartureDate.slice(0, 6);

    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
        const callback = `tikitikitDcair${region.code}${city.code}${pageNo}`;
        const url = new URL(LIST_API_URL);
        const params: Record<string, string> = {
            apiKey: '',
            transportStartCity: '',
            transportEndCity: city.code,
            eventStartMonth,
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

        const response = await fetchSourceText(
            `온라인투어 ${city.name} 목록 ${pageNo}페이지`,
            url,
            { headers: REQUEST_HEADERS },
            20_000,
        );
        if (!/javascript|json|text\/plain/i.test(response.contentType)) {
            throw new SourceResponseError(
                'unexpected-content',
                `온라인투어 ${city.name} 목록 응답 형식이 JSONP가 아닙니다: ${response.contentType || '없음'}`,
                response.status,
                response.contentType,
            );
        }

        const payload = parseOnlineTourJsonp(response.text, callback);
        rows.push(...payload.data.list);

        const lastPage = Number(payload.data.paging?.totalLastPage || 1);
        if (lastPage > MAX_PAGES) {
            throw new SourceResponseError(
                'schema-mismatch',
                `온라인투어 ${city.name} 페이지 수 ${lastPage}가 안전 한도 ${MAX_PAGES}를 넘었습니다.`,
            );
        }
        if (pageNo >= lastPage || payload.data.list.length === 0) return rows;
    }

    throw new SourceResponseError('schema-mismatch', `온라인투어 ${city.name} 페이지 순회가 끝나지 않았습니다.`);
}

export async function scrapeOnlineTour(prevFlights: any[] = []): Promise<Flight[]> {
    console.log('온라인투어 크롤링 시작...');
    const flights: Flight[] = [];
    const processedIds = new Set<string>();
    const completeness = new ScrapeCompleteness('온라인투어', 'onlinetour', prevFlights);

    for (const region of REGIONS) {
        console.log(`\n=== ${region.name} (${region.code}) 직접 수집 ===`);

        let cities: OnlineTourCitySeed[];
        try {
            cities = await fetchRegionCities(region);
        } catch (error) {
            console.error(`  ${region.name} 지역 실패: ${describeSourceError(error)}`);
            completeness.recordFailure(
                `${region.name} 지역 도시 목록`,
                flight => belongsToRegion(flight, region),
            );
            continue;
        }

        console.log(`발견된 도시: ${cities.length}개 - ${cities.map(city => city.name).join(', ')}`);
        if (cities.length === 0) {
            completeness.recordFailure(
                `${region.name} 지역 도시 목록 0건`,
                flight => belongsToRegion(flight, region),
            );
            continue;
        }

        for (const city of cities) {
            try {
                const rows = await fetchCityRows(region, city);
                let cityCount = 0;
                let invalidRows = 0;

                for (const row of rows) {
                    const flight = mapOnlineTourFlight(row, city);
                    if (!flight) {
                        invalidRows++;
                        continue;
                    }
                    if (processedIds.has(flight.id)) continue;
                    processedIds.add(flight.id);
                    flights.push(flight);
                    cityCount++;
                }

                if (rows.length > 0 && cityCount === 0) {
                    throw new SourceResponseError(
                        'schema-mismatch',
                        `온라인투어 ${city.name} 응답 ${rows.length}건을 항공권으로 변환하지 못했습니다.`,
                    );
                }
                if (invalidRows > 0) console.warn(`    ${city.name}: 필수값이 없는 ${invalidRows}건 제외`);
                console.log(`    ${city.name}: ${cityCount}건 수집 (원본 ${rows.length}건)`);
            } catch (error) {
                console.error(`    ${city.name}(${city.code}) 실패: ${describeSourceError(error)}`);
                completeness.recordFailure(
                    `${city.name}(${city.code}) 목록`,
                    flight => flight.arrival?.airport === city.code,
                );
            }
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
