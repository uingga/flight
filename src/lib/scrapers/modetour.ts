import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';

/**
 * 모두투어 스크래퍼
 * URL: https://b2c-api.modetour.com/CheapTicket/GetList
 */
export async function scrapeModetour(): Promise<Flight[]> {
    try {
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
        const allFlights: Flight[] = [];

        // 각 대륙별로 데이터 가져오기
        for (const continentCode of continentCodes) {
            console.log(`모두투어 ${continentCode} 지역 크롤링 중...`);

            const url = new URL('https://b2c-api.modetour.com/CheapTicket/GetList');
            url.searchParams.append('Page', '1');
            url.searchParams.append('ItemCount', '500');
            url.searchParams.append('DepartureCity', '');
            url.searchParams.append('ContinentCode', continentCode);
            url.searchParams.append('ArrivalCity', '');
            url.searchParams.append('DepartureDate', formatDate(today));
            url.searchParams.append('ArrivalDate', formatDate(oneMonthLater));

            const response = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'Origin': 'https://www.modetour.com',
                    'Referer': 'https://www.modetour.com/flights/discount-flight',
                },
            });

            if (!response.ok) {
                console.error(`모두투어 ${continentCode} API 호출 실패:`, response.status);
                continue; // 다음 대륙으로 계속
            }

            const data = await response.json();

            if (data.result && Array.isArray(data.result)) {
                data.result.forEach((item: any, index: number) => {
                    // 세금 포함 최종 가격 계산
                    const basePrice = parseInt(item.adult?.value || '0');
                    const tax1 = parseInt(item.adult?.tax || '0');
                    const tax2 = parseInt(item.adult?.tax2 || '0');
                    const price = basePrice + tax1 + tax2; // 최종 가격 = 항공료 + 세금

                    const destination = item.arrival?.value || '';
                    const maxPrice = getMaxPriceForDestination(destination);

                    // 해당 지역의 초특가 기준보다 비싸면 스킵
                    if (price > maxPrice) {
                        return;
                    }

                    allFlights.push({
                        id: `modetour-${continentCode}-${item.id || index}`,
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
                        link: `https://www.modetour.com/flights/discount-flight/reservation-page?id=${item.id}&adult=1&child=0&infant=0&step=1`,
                        availableSeats: item.rSeat?.value,
                        flightNumber: `${item.air?.dfln || ''} / ${item.air?.afln || ''}`.trim(),
                        region: getRegionByCity(destination),
                    });
                });
            }

            console.log(`모두투어 ${continentCode}: ${data.result?.length || 0}개 항목 중 필터링 후 추가됨`);
        }

        console.log(`모두투어에서 총 ${allFlights.length}개의 항공권을 가져왔습니다.`);
        return allFlights;
    } catch (error) {
        console.error('모두투어 스크래핑 오류:', error);
        return [];
    }
}
