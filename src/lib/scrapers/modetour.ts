import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';
import { IncompleteScrapeError, ScrapeCompleteness } from './scrape-errors';
import {
    assertNoSourceAccessBlockText,
    describeSourceError,
    fetchSourceText,
    retrySourceOperation,
    SourceResponseError,
} from './source-response';
import { classifySourceAccessRestriction } from '../source-circuit';
// logCrawlResults moved to crawl-all.ts

const randomDelay = (min: number, max: number) =>
    new Promise(resolve => setTimeout(resolve, (Math.random() * (max - min) + min) * 1000));

/**
 * 도착 공항코드 → 모두투어 대륙코드 매핑
 * 모두투어 API가 잘못된 대륙 카테고리에서 항공편을 반환할 수 있으므로,
 * 공항코드 기반으로 정확한 대륙코드를 결정
 */
const getContinentByArrivalCode = (code: string): string | null => {
    const JPN_CODES = [
        'NRT', 'HND', 'KIX', 'FUK', 'CTS', 'NGO', 'OKA', 'NGS', 'KOJ', 'KMJ',
        'MYJ', 'TAK', 'FSZ', 'HSG', 'YGJ', 'HIJ', 'OIT', 'UKB', 'KKJ', 'SHI', 'AOJ', 'HKD',
    ];
    const CHI_CODES = [
        'PEK', 'PVG', 'SHA', 'CAN', 'HKG', 'MFM', 'TPE', 'TSA', 'RMQ', 'KHH',
        'TAO', 'YNT', 'WEH', 'TNA', 'SYX', 'KWL', 'DLC', 'HRB', 'SHE', 'HGH',
        'CGQ', 'XMN', 'YNJ', 'CTU', 'CKG',
    ];
    const SOPA_CODES = ['GUM', 'SPN', 'SYD', 'BNE', 'AKL'];
    const EUR_CODES = ['CDG', 'LHR', 'FCO', 'FRA', 'BCN', 'IST', 'TZX'];
    const AMCA_CODES = ['JFK', 'LAX', 'SEA', 'YVR', 'YYZ', 'HNL'];

    if (JPN_CODES.includes(code)) return 'JPN';
    if (CHI_CODES.includes(code)) return 'CHI';
    if (SOPA_CODES.includes(code)) return 'SOPA';
    if (EUR_CODES.includes(code)) return 'EUR';
    if (AMCA_CODES.includes(code)) return 'AMCA';
    return null; // fallback: 루프의 continentCode 사용
};

/**
 * 모두투어 스크래퍼
 * URL: https://b2c-api.modetour.com/DiscountFlight/GetList
 * 인증: ModeEcommerceContext 쿠키에서 ApiKey 추출 → modewebapireqheader 헤더로 전달
 */
/** 모두투어 대륙 코드 → 우리 지역 표기 (수집 실패 판정에 쓴다) */
const CONTINENT_REGIONS: Record<string, string[]> = {
    ASIA: ['동남아', '기타'],
    JPN: ['일본'],
    CHI: ['중국'],
    EUR: ['유럽'],
    AMCA: ['미주'],
    SOPA: ['남태평양'],
};

async function fetchModetourLanding(): Promise<{ html: string; setCookies: string[] }> {
    return retrySourceOperation('모두투어 초기 페이지', async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20_000);
        try {
            const response = await fetch('https://www.modetour.com/flights/discount-flight', {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                },
                redirect: 'follow',
                signal: controller.signal,
            });
            const html = await response.text();
            if (!response.ok) {
                throw new SourceResponseError(
                    'http-status',
                    `모두투어 초기 페이지 HTTP ${response.status}`,
                    response.status,
                    response.headers.get('content-type') || '',
                    undefined,
                    response.url,
                );
            }
            assertNoSourceAccessBlockText('모두투어 초기 페이지', html, response.url);
            return { html, setCookies: response.headers.getSetCookie?.() || [] };
        } catch (error) {
            if (error instanceof SourceResponseError) throw error;
            throw new SourceResponseError(
                'network',
                `모두투어 초기 페이지 요청 실패: ${error instanceof Error ? error.message : String(error)}`,
            );
        } finally {
            clearTimeout(timeout);
        }
    }, { maxAttempts: 2, delaysMs: [2_000] });
}

export function parseModetourRegionPayload(text: string, label = '모두투어 API'): any[] {
    let data: any;
    try {
        data = JSON.parse(text);
    } catch {
        throw new SourceResponseError('malformed-json', `${label} JSON을 해석하지 못했습니다.`);
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.result)) {
        throw new SourceResponseError('schema-mismatch', `${label} 응답에 result 배열이 없습니다.`);
    }
    return data.result;
}

async function fetchModetourRegionRows(
    continentCode: string,
    url: URL,
    reqHeader: string,
): Promise<any[]> {
    const label = `모두투어 ${continentCode} API`;
    return retrySourceOperation(label, async () => {
        const response = await fetchSourceText(label, url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Origin': 'https://www.modetour.com',
                'Referer': 'https://www.modetour.com/',
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'modewebapireqheader': reqHeader,
                'x-platform': 'ModeEcommerce',
                'x-salespartner': '2',
                'x-userdepartment': 'ModeEcommerce',
            },
        }, 20_000);
        assertNoSourceAccessBlockText(label, response.text, response.finalUrl);
        if (!/json/i.test(response.contentType)) {
            throw new SourceResponseError(
                'unexpected-content',
                `${label} 응답 형식이 JSON이 아닙니다: ${response.contentType || '없음'}`,
                response.status,
                response.contentType,
                undefined,
                response.finalUrl,
            );
        }

        return parseModetourRegionPayload(response.text, label);
    }, {
        maxAttempts: 2,
        delaysMs: [2_000],
        onRetry: (error) => console.warn(`${label} 일시 오류 재시도: ${error.message}`),
    });
}
export async function scrapeModetour(prevFlights: any[] = []): Promise<Flight[]> {
    try {
        // 1단계: 모두투어 웹사이트에서 ApiKey 획득
        console.log('모두투어 ApiKey 획득 중...');
        let apiKey = '';
        const landing = await fetchModetourLanding();
        // Set-Cookie 헤더에서 ModeEcommerceContext 추출
        for (const cookie of landing.setCookies) {
            if (cookie.includes('ModeEcommerceContext')) {
                // 쿠키 값에서 apiKey 추출
                const match = cookie.match(/ModeEcommerceContext=([^;]+)/);
                if (match) {
                    try {
                        const decoded = decodeURIComponent(match[1]);
                        const parsed = JSON.parse(decoded);
                        apiKey = parsed.apiKey || parsed.ApiKey || '';
                    } catch {
                        // URL 인코딩이 아닌 경우 직접 파싱 시도
                        const keyMatch = match[1].match(/[Aa]pi[Kk]ey["\s:]+["']?([^"',}]+)/);
                        if (keyMatch) apiKey = keyMatch[1];
                    }
                }
            }
        }

        if (!apiKey) {
            const keyMatch = landing.html.match(/[Aa]pi[Kk]ey["\s:]+["']([^"']+)/);
            if (keyMatch) apiKey = keyMatch[1];
        }
        if (!apiKey) {
            throw new SourceResponseError('schema-mismatch', '모두투어 ApiKey를 찾을 수 없습니다.');
        } else {
            console.log(`모두투어 ApiKey 획득 완료: ${apiKey.substring(0, 8)}...`);
        }

        // modewebapireqheader 값 생성
        const reqHeader = JSON.stringify({
            WebSiteNo: 2,
            CompanyNo: 81202,
            DeviceType: 'DVTPC',
            ApiKey: apiKey,
        });

        // 현재 날짜와 한 달 후 날짜 계산
        const today = new Date();
        const oneMonthLater = new Date(today);
        oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);

        const formatDate = (date: Date) => {
            return date.toISOString().split('T')[0];
        };

        // 지역별 최대 가격 설정 (초특가 기준)
        const getMaxPriceForDestination = (destination: string): number => {
            const dest = destination.toUpperCase();

            // 일본 (도쿄, 오사카, 후쿠오카 등)
            if (dest.includes('도쿄') || dest.includes('오사카') || dest.includes('후쿠오카') ||
                dest.includes('나고야') || dest.includes('삿포로') || dest.includes('TOKYO') ||
                dest.includes('OSAKA') || dest.includes('NRT') || dest.includes('KIX') ||
                dest.includes('FUK') || dest.includes('NGO')) {
                return 450000; // 45만원
            }

            // 동남아 (태국, 베트남, 필리핀, 싱가포르 등)
            if (dest.includes('방콕') || dest.includes('푸켓') || dest.includes('다낭') ||
                dest.includes('호치민') || dest.includes('세부') || dest.includes('마닐라') ||
                dest.includes('싱가포르') || dest.includes('BANGKOK') || dest.includes('DANANG') ||
                dest.includes('CEBU') || dest.includes('SINGAPORE')) {
                return 500000; // 50만원
            }

            // 중국
            if (dest.includes('베이징') || dest.includes('상하이') || dest.includes('광저우') ||
                dest.includes('BEIJING') || dest.includes('SHANGHAI') || dest.includes('PEK') ||
                dest.includes('PVG')) {
                return 500000; // 50만원
            }

            // 남태평양 (괌, 사이판, 하와이 등)
            if (dest.includes('괌') || dest.includes('사이판') || dest.includes('하와이') ||
                dest.includes('GUAM') || dest.includes('SAIPAN') || dest.includes('HAWAII') ||
                dest.includes('GUM') || dest.includes('HNL')) {
                return 800000; // 80만원
            }

            // 유럽
            if (dest.includes('파리') || dest.includes('런던') || dest.includes('로마') ||
                dest.includes('프랑크푸르트') || dest.includes('PARIS') || dest.includes('LONDON') ||
                dest.includes('ROME') || dest.includes('CDG') || dest.includes('LHR') ||
                dest.includes('FCO')) {
                return 1000000; // 100만원
            }

            // 미주 (미국, 캐나다)
            if (dest.includes('뉴욕') || dest.includes('LA') || dest.includes('시애틀') ||
                dest.includes('밴쿠버') || dest.includes('토론토') || dest.includes('NEW YORK') ||
                dest.includes('LOS ANGELES') || dest.includes('JFK') || dest.includes('LAX') ||
                dest.includes('YVR')) {
                return 1000000; // 100만원
            }

            // 기타 아시아 지역
            return 1000000; // 100만원
        };

        // 모든 대륙 코드 (모드투어 API에서 사용하는 실제 코드들)
        const continentCodes = ['ASIA', 'JPN', 'CHI', 'EUR', 'AMCA', 'SOPA'];
        // 대륙 API 하나가 실패해도 나머지가 채워져 정상처럼 보인다 — 실패 구간을 모아 끝에서 판정한다
        const completeness = new ScrapeCompleteness('모두투어', 'modetour', prevFlights);
        const allFlights: Flight[] = [];

        // 각 대륙별로 데이터 가져오기
        for (const continentCode of continentCodes) {
            console.log(`모두투어 ${continentCode} 지역 크롤링 중...`);

            const url = new URL('https://b2c-api.modetour.com/DiscountFlight/GetList');
            url.searchParams.append('Page', '1');
            url.searchParams.append('ItemCount', '500');
            url.searchParams.append('DepartureCity', '');
            url.searchParams.append('ContinentCode', continentCode);
            url.searchParams.append('ArrivalCity', '');
            url.searchParams.append('DepartureDate', formatDate(today));
            url.searchParams.append('ArrivalDate', formatDate(oneMonthLater));

            let rows: any[];
            try {
                rows = await fetchModetourRegionRows(continentCode, url, reqHeader);
            } catch (error) {
                if (classifySourceAccessRestriction(error)) throw error;
                const regions = CONTINENT_REGIONS[continentCode] || [];
                completeness.recordFailure(
                    `${continentCode} (${describeSourceError(error)})`,
                    f => regions.includes(f.region || getRegionByCity(f.arrival?.city || '')),
                );
                await randomDelay(2, 4);
                continue;
            }

            rows.forEach((item: any, index: number) => {
                    // 세금 포함 최종 가격 계산
                    const basePrice = parseInt(item.adult?.value || '0');
                    const tax1 = parseInt(item.adult?.tax || '0');
                    const tax2 = parseInt(item.adult?.tax2 || '0');
                    const price = basePrice + tax1 + tax2; // 최종 가격 = 항공료 + 세금

                    if (!item.sDate?.value || !item.eDate?.value) return;

                    // 편도 항공권 필터링 (출발일 = 귀국일이면 편도)
                    if (item.sDate.value === item.eDate.value) return;

                    const destination = item.arrival?.value || '';
                    const maxPrice = getMaxPriceForDestination(destination);

                    // 해당 지역의 초특가 기준보다 비싸면 스킵
                    if (price > maxPrice) {
                        return;
                    }

                    allFlights.push({
                        id: `modetour-${continentCode}-${item.stockPackageNo || index}`,
                        source: 'modetour',
                        airline: item.air?.value || '항공사 미정',
                        departure: {
                            city: item.departure?.value || '',
                            airport: item.departure?.code || '',
                            date: item.sDate?.value || '',
                            time: item.sDate?.sTime || '',
                        },
                        arrival: {
                            city: item.arrival?.value || '',
                            airport: item.arrival?.code || '',
                            date: item.eDate?.value || '',
                            time: item.eDate?.sTime || '',
                        },
                        price: price,
                        currency: 'KRW',
                        link: (() => {
                            // 모두투어 SPA는 query 파라미터(JSON)로 필터를 전달할 수 있음
                            const depCode = item.departure?.code || '';
                            const arrCode = item.arrival?.code || '';
                            // 공항코드 → 도시코드 매핑 (모두투어 query는 도시코드 사용)
                            const airportToCityCode: Record<string, string> = {
                                'ICN': 'ICN', 'GMP': 'GMP', 'PUS': 'PUS', 'CJU': 'CJU',
                                'CJJ': 'CJJ', 'TAE': 'TAE', 'KWJ': 'KWJ', 'MWX': 'MWX',
                            };
                            const depCityCode = airportToCityCode[depCode] || depCode;
                            // 대륙 코드 결정
                            const resolvedContinent = getContinentByArrivalCode(arrCode) || continentCode;
                            const depDateStr = item.sDate?.value || '';
                            // arrivalDate를 출발일 다음날로 설정 (검색 범위 최소화)
                            let nextDay = depDateStr;
                            try {
                                const d = new Date(depDateStr);
                                d.setDate(d.getDate() + 1);
                                nextDay = d.toISOString().split('T')[0];
                            } catch {}
                            const query = JSON.stringify({
                                departureCity: depCityCode,
                                continentCode: resolvedContinent,
                                arrivalCity: arrCode,
                                departureDate: depDateStr,
                                arrivalDate: nextDay,
                                page: 1,
                                itemCount: 200,
                                sort: 'Lowest',
                            });
                            return `https://www.modetour.com/flights/discount-flight?query=${encodeURIComponent(query)}`;
                        })(),
                        availableSeats: item.rSeat?.value,
                        flightNumber: `${item.air?.dfln || ''} / ${item.air?.afln || ''}`.trim(),
                        region: getRegionByCity(destination),
                        modetourDetail: {
                            flyingTime: item.start?.flyingTime || item.start?.eft || undefined,
                            returnFlyingTime: item.eDate?.flyingTime || item.eDate?.eft || undefined,
                            isDirect: item.start?.via === 'N',
                            isReturnDirect: item.eDate?.via === 'N' || item.start?.via === 'N', // fallback
                            departureArrivalTime: item.sDate?.eTime || undefined,
                            returnDepartureTime: item.eDate?.sTime || undefined,
                            returnArrivalTime: item.eDate?.eTime || undefined,
                            normalPrice: item.adult?.normal || undefined,
                            sourceDiscountRate: item.adult?.discountRate || undefined,
                            baseFare: item.adult?.value || undefined,
                            tax: item.adult?.tax || undefined,
                            tax2: item.adult?.tax2 || undefined,
                            childBaseFare: item.child?.value || undefined,
                            childTax: item.child?.tax || undefined,
                            childTax2: item.child?.tax2 || undefined,
                            infantFare: item.infant?.value || undefined,
                            departureFlightNo: item.air?.dfln || undefined,
                            returnFlightNo: item.air?.afln || undefined,
                            returnDepartureAirport: item.localDeparture?.code || item.arrival?.code || undefined,
                            returnArrivalAirport: item.koreanArrival?.code || item.departure?.code || undefined,
                        },
                    });
            });

            console.log(`모두투어 ${continentCode}: ${rows.length}개 항목 중 필터링 후 추가됨`);
            await randomDelay(1.5, 3);
        }

        console.log(`모두투어에서 총 ${allFlights.length}개의 항공권을 가져왔습니다.`);
        completeness.assertComplete(allFlights.length);

        const cityStats: { [city: string]: number } = {};
        allFlights.forEach(f => { cityStats[f.arrival.city] = (cityStats[f.arrival.city] || 0) + 1; });
        // logCrawlResults moved to crawl-all.ts

        return allFlights;
    } catch (error) {
        console.error('모두투어 스크래핑 오류:', error);
        // 불완전 수집은 호출부가 알아야 이전 캐시를 지킬 수 있으므로 삼키지 않는다
        if (error instanceof IncompleteScrapeError || error instanceof SourceResponseError) throw error;
        return [];
    }
}
