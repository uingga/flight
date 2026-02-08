import { chromium } from 'playwright';
import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';

/**
 * 하나투어 땡처리 항공권 크롤링
 * URL: https://www.hanatour.com/trp/air/CHPC0AIR0233M200
 */

// 출발 도시 탭 목록
const DEPARTURE_TABS = [
    { name: '인천/김포', index: 0 },
    { name: '청주', index: 1 },
    { name: '부산', index: 2 },
    { name: '대구/제주', index: 3 },
];

export async function scrapeHanatour(): Promise<Flight[]> {
    console.log('하나투어 크롤링 시작...');

    const browser = await chromium.launch({
        headless: false,
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    // 브라우저 콘솔 로그를 터미널에 출력
    page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));

    const flights: Flight[] = [];
    let totalFlights = 0;

    try {
        // 메인 페이지 접속
        await page.goto('https://www.hanatour.com/trp/air/CHPC0AIR0233M200', {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
        });

        // 페이지 로드 후 추가 대기 (동적 콘텐츠 로딩)
        await page.waitForTimeout(3000);

        console.log('하나투어 페이지 로드 완료');

        // 각 출발 도시 탭별로 크롤링
        for (const tab of DEPARTURE_TABS) {
            console.log(`\n=== ${tab.name} 출발 크롤링 ===`);

            try {
                // 탭 클릭 (정확한 CSS 선택자 사용)
                // 탭 순서가 바뀔 수 있으므로 텍스트로 찾는 것이 더 안전함
                let tabSelector = `.js_tabs.v-tabs.type1.special > ul.tabs > li:nth-child(${tab.index + 1}) > a`;

                // 탭 이름으로 찾기 시도 (더 정확함)
                const tabElement = page.locator(`.js_tabs.v-tabs.type1.special > ul.tabs > li > a:has-text("${tab.name}")`).first();
                if (await tabElement.isVisible()) {
                    await tabElement.click();
                } else if (await page.isVisible(tabSelector)) {
                    await page.click(tabSelector);
                } else {
                    console.log(`[SKIP] ${tab.name} 탭을 찾을 수 없습니다.`);
                    continue;
                }

                // 탭 전환 및 데이터 로딩 대기 (충분한 시간)
                await page.waitForTimeout(3000);

                // 로딩 인디케이터나 스피너가 사라질 때까지 대기 (필요시 추가)

                // 리스트 컨테이너 확인
                try {
                    await page.waitForSelector('.flight_list.special > ul', { state: 'visible', timeout: 5000 });
                } catch (e) {
                    console.log(`[WARN] ${tab.name}: 항공권 리스트 컨테이너 로드 실패`);
                }


                // 항공권 리스트 컨테이너 대기
                try {
                    await page.waitForSelector('.flight_list.special > ul > li', { timeout: 5000 });
                } catch (e) {
                    console.log(`${tab.name}: 항공권이 없거나 로딩 시간 초과`);
                    continue;
                }

                // 항공권 데이터 추출

                // [DEBUG] Click the first card (LI element) to find the target URL
                if (totalFlights === 0) {
                    try {
                        console.log('[DEBUG] Attempting to click the first card (LI)...');
                        const initialUrl = page.url();
                        console.log(`[DEBUG] Initial URL: ${initialUrl}`);

                        // Click the LI element
                        await page.evaluate(() => {
                            const card = document.querySelector('.flight_list.special > ul > li');
                            if (card) (card as HTMLElement).click();
                        });

                        await page.waitForTimeout(5000); // Wait for potential reaction

                        const newUrl = page.url();
                        console.log(`[DEBUG] URL after click: ${newUrl}`);

                        if (initialUrl !== newUrl) {
                            console.log('[DEBUG] Navigation detected!');
                        } else {
                            console.log('[DEBUG] No navigation detected. Taking screenshot...');
                            await page.screenshot({ path: 'debug_hanatour_click.png' });
                        }
                    } catch (e) {
                        console.error('[DEBUG] Click failed:', e);
                    }
                }

                // 항공권 데이터 추출
                const tabFlights = await page.evaluate((tabName) => {
                    const cards = document.querySelectorAll('.flight_list.special > ul > li');
                    const results: any[] = [];

                    cards.forEach((card, index) => {
                        try {
                            // 행(row) 요소들 선택 (가는편, 오는편)
                            const rows = card.querySelectorAll('.fl .row');
                            if (rows.length < 2) return;

                            const outboundRow = rows[0]; // 가는편
                            const inboundRow = rows[1];  // 오는편

                            // 항공사
                            const airline = outboundRow.querySelector('.air_name')?.textContent?.trim() || '';

                            // 출발/도착 도시 (가는편 기준)
                            const cities = outboundRow.querySelectorAll('.city');
                            const departureCity = cities[0]?.textContent?.trim() || '';
                            const arrivalCity = cities[1]?.textContent?.trim() || '';

                            // 날짜 (가는편 날짜, 오는편 날짜)
                            const departureDate = outboundRow.querySelector('.cell.date')?.textContent?.trim() || '';
                            const returnDate = inboundRow.querySelector('.cell.date')?.textContent?.trim() || '';

                            // 가격 (.price 클래스 사용)
                            const priceElement = card.querySelector('.price');
                            const priceText = priceElement?.textContent?.trim() || '';
                            const price = parseInt(priceText.replace(/[^0-9]/g, '')) || 0;

                            // 시간 정보 추출 (.time 클래스)
                            // [0]: 가는편 출발, [1]: 가는편 도착, [2]: 오는편 출발, [3]: 오는편 도착
                            const timeElements = card.querySelectorAll('.time');
                            let depTime = '';
                            let arrTime = '';

                            if (timeElements.length >= 2) {
                                // 정규식으로 HH:MM 추출
                                const depTimeMatch = timeElements[0].textContent?.match(/(\d{2}:\d{2})/);
                                const arrTimeMatch = timeElements[1].textContent?.match(/(\d{2}:\d{2})/);

                                depTime = depTimeMatch ? depTimeMatch[1] : '';
                                arrTime = arrTimeMatch ? arrTimeMatch[1] : '';
                            }


                            // 링크 추출 (카드 내의 첫 번째 a 태그)
                            const linkElement = card.querySelector('a.link_detail') || card.querySelector('a'); // 더 구체적인 선택자 시도
                            const href = linkElement?.getAttribute('href') || '';
                            const onclick = linkElement?.getAttribute('onclick') || '';

                            // 디버깅: 첫 번째 항목의 링크 정보 출력
                            if (index === 0) {
                                console.log(`[DEBUG] First item link info: href="${href}", onclick="${onclick}"`);
                                console.log(`[DEBUG] Link element HTML:`, linkElement?.outerHTML);
                            }

                            let fullLink = '';

                            if (href && href !== '#none' && href !== '#') {
                                fullLink = href.startsWith('http') ? href : `https://www.hanatour.com${href}`;
                            } else {
                                // Fallback to the main page if deep link is not available
                                fullLink = 'https://www.hanatour.com/trp/air/CHPC0AIR0233M200';
                            }

                            // 디버깅: 첫 번째 카드의 HTML 출력
                            if (index === 0) {
                                console.log('[DEBUG] First card HTML:', card.outerHTML);
                            }

                            if (price > 0 && arrivalCity) {
                                results.push({
                                    id: `hanatour-${tabName}-${index}`,
                                    source: 'hanatour',
                                    airline: airline,
                                    departure: {
                                        city: departureCity,
                                        airport: '',
                                        date: departureDate,
                                        time: depTime,
                                    },
                                    arrival: {
                                        city: arrivalCity,
                                        airport: '',
                                        date: returnDate, // note: arrival date logic might need adjustment if overnight
                                        time: arrTime,
                                    }, price: price,
                                    currency: 'KRW',
                                    link: fullLink,
                                });
                            }
                        } catch (error) {
                            console.error(`카드 ${index} 파싱 오류:`, error);
                        }
                    });

                    return results;
                }, tab.name);

                const processedFlights = tabFlights.map((f: any) => ({
                    ...f,
                    region: getRegionByCity(f.arrival.city)
                }));
                flights.push(...processedFlights);
                totalFlights += tabFlights.length;
                console.log(`${tab.name}: ${tabFlights.length}개 항목 발견 (누적: ${totalFlights}개)`);

                // 다음 탭 전 잠시 대기
                await page.waitForTimeout(500);

            } catch (error) {
                console.error(`${tab.name} 탭 오류:`, error instanceof Error ? error.message : error);
            }
        }

        console.log(`\n하나투어 크롤링 완료: 총 ${flights.length}개 항공권`);

    } catch (error) {
        console.error('하나투어 크롤링 실패:', error);
    } finally {
        await browser.close();
    }

    return flights;
}
