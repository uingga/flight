import { Flight } from '@/types/flight';
import { chromium } from 'playwright';
import { getRegionByCity } from '@/lib/utils/region-mapper';

/**
 * 땡처리닷컴 스크래퍼 (Playwright 기반)
 * 동적 로딩 페이지를 브라우저 자동화로 크롤링
 */

// 주요 도시 코드 목록
// 주요 도시 코드 목록
const CITY_CODES = [
    { code: 'NRT', name: '도쿄(나리타)' },
    { code: 'KIX', name: '오사카' },
    { code: 'FUK', name: '후쿠오카' },
    { code: 'BKK', name: '방콕' },
    { code: 'SIN', name: '싱가포르' },
    { code: 'CEB', name: '세부' },
    { code: 'DAD', name: '다낭' },
    { code: 'HAN', name: '하노이' },
    { code: 'GUM', name: '괌' },
    { code: 'HKG', name: '홍콩' },
    { code: 'TPE', name: '대만(타이페이)' },
    { code: 'OKA', name: '오키나와' },
    { code: 'CTS', name: '삿포로' },
];

// 랜덤 대기 함수 (봇 감지 회피)
function randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay * 1000));
}

/**
 * "오늘 오픈 땡처리" 탭 크롤링
 */
async function scrapeTodayOpen(): Promise<Flight[]> {
    const browser = await chromium.launch({
        headless: false,
    });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    const flights: Flight[] = [];

    try {
        console.log('오늘 오픈 땡처리 페이지 접속 중...');
        await page.goto('https://mm.ttang.com/ttangair/search/discount/today.do?trip=RT&gubun=T', {
            waitUntil: 'networkidle',
        });

        // 페이지 로딩 대기 (5~7초 랜덤)
        await randomDelay(5, 7);

        // 항공권 리스트가 로딩될 때까지 대기
        await page.waitForSelector('li.exair1', { timeout: 10000 }).catch(() => {
            console.log('오늘 오픈 땡처리: 항공권 데이터 없음');
        });

        // 항공권 정보 추출
        const items = await page.$$('li.exair1');
        console.log(`오늘 오픈 땡처리: ${items.length}개 항목 발견`);

        for (let i = 0; i < items.length; i++) {
            try {
                const item = items[i];
                const productNo = await item.getAttribute('data-productno') || `ttang-today-${i}`;
                const tktCarDesc = await item.getAttribute('data-tktcardesc') || '항공사 미정';
                const depCityDesc = await item.getAttribute('data-depcitydesc') || '';
                const arrCityDesc = await item.getAttribute('data-arrcitydesc') || '';
                const depDate = await item.getAttribute('data-fromsupplydate') || '';
                const arrDate = await item.getAttribute('data-tosupplydate') || '';
                const depTime = await item.getAttribute('data-deptime') || '';
                const arrTime = await item.getAttribute('data-arrtime') || '';
                const fare = await item.getAttribute('data-fare') || '0';
                const remainSeat = await item.getAttribute('data-remainseat');

                const price = parseInt(fare.replace(/,/g, '')) || 0;

                if (depCityDesc && arrCityDesc && price > 0) {
                    // Link to "Today Open" discount page instead of product detail
                    const link = 'https://mm.ttang.com/ttangair/search/discount/today.do?trip=RT&gubun=T';

                    flights.push({
                        id: `ttang-today-${productNo}`,
                        source: 'ttang',
                        airline: tktCarDesc,
                        departure: {
                            city: depCityDesc,
                            airport: '',
                            date: depDate,
                            time: depTime,
                        },
                        arrival: {
                            city: arrCityDesc,
                            airport: '',
                            date: arrDate,
                            time: arrTime,
                        },
                        price: price,
                        currency: 'KRW',
                        link: link,
                        availableSeats: remainSeat ? parseInt(remainSeat) : undefined,
                        region: getRegionByCity(arrCityDesc),
                    });
                }
            } catch (itemError) {
                console.error(`오늘 오픈 땡처리 항목 ${i} 파싱 오류:`, itemError);
            }
        }
    } catch (error) {
        console.error('오늘 오픈 땡처리 크롤링 오류:', error);
    } finally {
        await browser.close();
    }

    console.log(`오늘 오픈 땡처리: ${flights.length}개 항공권 수집 완료`);
    return flights;
}

/**
 * "전세계 땡처리" 탭 크롤링
 */
async function scrapeWorldwide(): Promise<Flight[]> {
    const browser = await chromium.launch({
        headless: false,
    });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    const flights: Flight[] = [];

    try {
        console.log('전세계 땡처리 페이지 접속 중...');
        await page.goto('https://mm.ttang.com/ttangair/search/discount/today.do?trip=RT&gubun=A', {
            waitUntil: 'networkidle',
        });

        await randomDelay(5, 7);

        await page.waitForSelector('li.exair1', { timeout: 10000 }).catch(() => {
            console.log('전세계 땡처리: 항공권 데이터 없음');
        });

        const items = await page.$$('li.exair1');
        console.log(`전세계 땡처리: ${items.length}개 항목 발견`);

        for (let i = 0; i < items.length; i++) {
            try {
                const item = items[i];
                const productNo = await item.getAttribute('data-productno') || `ttang-world-${i}`;
                const tktCarDesc = await item.getAttribute('data-tktcardesc') || '항공사 미정';
                const depCityDesc = await item.getAttribute('data-depcitydesc') || '';
                const arrCityDesc = await item.getAttribute('data-arrcitydesc') || '';
                const depDate = await item.getAttribute('data-fromsupplydate') || '';
                const arrDate = await item.getAttribute('data-tosupplydate') || '';
                const depTime = await item.getAttribute('data-deptime') || '';
                const arrTime = await item.getAttribute('data-arrtime') || '';
                const fare = await item.getAttribute('data-fare') || '0';
                const remainSeat = await item.getAttribute('data-remainseat');

                const price = parseInt(fare.replace(/,/g, '')) || 0;

                if (depCityDesc && arrCityDesc && price > 0) {
                    // Link to "Worldwide" discount page instead of product detail
                    const link = 'https://mm.ttang.com/ttangair/search/discount/today.do?trip=RT&gubun=A';

                    flights.push({
                        id: `ttang-world-${productNo}`,
                        source: 'ttang',
                        airline: tktCarDesc,
                        departure: {
                            city: depCityDesc,
                            airport: '',
                            date: depDate,
                            time: depTime,
                        },
                        arrival: {
                            city: arrCityDesc,
                            airport: '',
                            date: arrDate,
                            time: arrTime,
                        },
                        price: price,
                        currency: 'KRW',
                        link: link,
                        availableSeats: remainSeat ? parseInt(remainSeat) : undefined,
                        region: getRegionByCity(arrCityDesc),
                    });
                }
            } catch (itemError) {
                console.error(`전세계 땡처리 항목 ${i} 파싱 오류:`, itemError);
            }
        }
    } catch (error) {
        console.error('전세계 땡처리 크롤링 오류:', error);
    } finally {
        await browser.close();
    }

    console.log(`전세계 땡처리: ${flights.length}개 항공권 수집 완료`);
    return flights;
}

/**
 * 주요 도시별 검색 크롤링
 */
async function scrapeCitySearch(): Promise<Flight[]> {
    const browser = await chromium.launch({
        headless: false,
    });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    const flights: Flight[] = [];

    try {
        for (const city of CITY_CODES) {
            try {
                console.log(`${city.name} (${city.code}) 검색 중...`);
                const url = `https://mm.ttang.com/ttangair/search/city/list.do?trip=RT&dep0=ICN&arr0=${city.code}&adt=1&chd=0&inf=0&comp=Y&viaType=2&fareType=A`;


                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForTimeout(2000); // Add small buffer for JS
                await randomDelay(5, 10); // 도시 간 5~10초 랜덤 대기

                await page.waitForSelector('li.exair1', { timeout: 10000 }).catch(() => {
                    console.log(`${city.name}: 항공권 데이터 없음`);
                });

                const items = await page.$$('li.exair1');
                console.log(`${city.name}: ${items.length}개 항목 발견`);

                for (let i = 0; i < items.length; i++) {
                    try {
                        const item = items[i];
                        const productNo = await item.getAttribute('data-productno') || `ttang-${city.code}-${i}`;
                        const tktCarDesc = await item.getAttribute('data-tktcardesc') || '항공사 미정';
                        const depCityDesc = await item.getAttribute('data-depcitydesc') || '';
                        const arrCityDesc = await item.getAttribute('data-arrcitydesc') || '';
                        const depDate = await item.getAttribute('data-fromsupplydate') || '';
                        const arrDate = await item.getAttribute('data-tosupplydate') || '';
                        const depTime = await item.getAttribute('data-deptime') || '';
                        const arrTime = await item.getAttribute('data-arrtime') || '';

                        // data-fare 대신 HTML 텍스트에서 가격 추출
                        let fare = await item.getAttribute('data-fare') || '0';

                        // data-fare가 0이면 HTML에서 가격 찾기
                        if (fare === '0' || !fare) {
                            const priceElement = await item.$('.price, .fare, .won, [class*="price"], [class*="fare"]');
                            if (priceElement) {
                                const priceText = await priceElement.textContent();
                                // 숫자만 추출 (예: "300,000원" -> "300000")
                                fare = (priceText || '').replace(/[^0-9]/g, '');
                            }
                        }

                        const remainSeat = await item.getAttribute('data-remainseat');


                        // Extract more data attributes for link construction
                        const masterId = await item.getAttribute('data-masterid');
                        const gubun = await item.getAttribute('data-gubun');
                        const tripType = await item.getAttribute('data-triptype') || 'RT';
                        // Use consistent param names based on verification
                        const depCityParam = await item.getAttribute('data-depcitycode') || 'ICN';
                        const arrCityParam = await item.getAttribute('data-arrcitycode') || city.code;

                        // Construct Link: Use search list page instead of detail page
                        // Detail pages often show "no results" error, so we link to the search list
                        // where users can see all available flights for the destination
                        const params = new URLSearchParams();
                        params.append('trip', tripType);
                        params.append('dep0', depCityParam);
                        params.append('arr0', arrCityParam);
                        params.append('adt', '1');
                        params.append('chd', '0');
                        params.append('inf', '0');
                        params.append('comp', 'Y');
                        params.append('viaType', '2');
                        params.append('fareType', 'A');

                        // Link to search list page for the destination city
                        const linkUrl = `https://mm.ttang.com/ttangair/search/city/list.do?${params.toString()}`;

                        // 디버깅: 첫 번째 항목의 데이터 출력
                        if (i === 0) {
                            const htmlSnippet = await item.innerHTML();
                            console.log(`[DEBUG] ${city.name} 첫 항목:`, {
                                productNo,
                                masterId,
                                tktCarDesc,
                                depCityDesc,
                                arrCityDesc,
                                fare,
                                linkUrl,
                                htmlLength: htmlSnippet.length
                            });
                        }

                        const price = parseInt(fare.replace(/,/g, '')) || 0;

                        // 조건 완화: 가격이 0이어도 일단 수집 (디버깅용)
                        if (depCityDesc && arrCityDesc) {
                            flights.push({
                                id: `ttang-${city.code}-${productNo}`,
                                source: 'ttang',
                                airline: tktCarDesc,
                                departure: {
                                    city: depCityDesc,
                                    airport: '',
                                    date: depDate,
                                    time: depTime,
                                },
                                arrival: {
                                    city: arrCityDesc,
                                    airport: '',
                                    date: arrDate,
                                    time: arrTime,
                                },
                                price: price || 1, // 가격이 0이면 1로 설정 (임시)
                                currency: 'KRW',
                                link: linkUrl,
                                availableSeats: remainSeat ? parseInt(remainSeat) : undefined,
                                region: getRegionByCity(arrCityDesc),
                            });
                        }
                    } catch (itemError) {
                        console.error(`${city.name} 항목 ${i} 파싱 오류:`, itemError);
                    }
                }
            } catch (cityError) {
                console.error(`${city.name} 검색 오류:`, cityError);
                // 에러 발생 시 다음 도시로 계속 진행
                continue;
            }
        }
    } catch (error) {
        console.error('도시별 검색 크롤링 오류:', error);
    } finally {
        await browser.close();
    }

    console.log(`도시별 검색: 총 ${flights.length}개 항공권 수집 완료`);
    return flights;
}

/**
 * 메인 스크래퍼 함수 - 모든 탭 크롤링
 */
export async function scrapeTtang(): Promise<Flight[]> {
    console.log('땡처리닷컴 크롤링 시작...');

    try {
        // 일단 도시별 검색만 활성화 (오늘오픈/전세계땡처리는 타임아웃 문제로 비활성화)
        const cityFlights = await scrapeCitySearch();

        console.log(`땡처리닷컴 크롤링 완료: 총 ${cityFlights.length}개 항공권`);
        return cityFlights;
    } catch (error) {
        console.error('땡처리닷컴 크롤링 실패:', error);
        return [];
    }
}
