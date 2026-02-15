import { chromium } from 'playwright';
import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';
import { logCrawlResults } from '@/lib/utils/crawl-logger';

const randomDelay = (min: number, max: number) =>
    new Promise(r => setTimeout(r, (Math.random() * (max - min) + min) * 1000));

/**
 * 땡처리닷컴 땡처리항공권 크롤링
 * URL: https://www.ttang.com/ttangair/search/ttang/list.do?arr0={지역코드}&page={N}&scale=20
 *
 * - 지역별로 모든 페이지를 순회하며 항공편 수집
 * - 각 항공편의 data-masterid를 추출하여 fare_detail.do 딥링크 생성
 * - cells[0]=출발도시, cells[1]=도착도시, cells[2]=항공사, cells[4]=날짜, cells[6]=가격
 */

// 지역 코드 매핑
const REGIONS = [
    { name: '일본', code: 'A7ALL' },
    { name: '동남아', code: 'A2ALL' },
    { name: '중국', code: 'A8ALL' },
    { name: '남태평양/괌/사이판', code: 'A1ALL' },
];

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

export async function scrapeTtang(): Promise<Flight[]> {
    console.log('\n=== 땡처리닷컴 크롤링 시작 ===');

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();
    const allFlights: Flight[] = [];

    try {
        for (const region of REGIONS) {
            console.log(`\n[땡처리] ${region.name} 크롤링...`);
            let regionTotal = 0;

            // 페이지네이션: 결과가 없을 때까지 순회
            for (let pageNum = 1; pageNum <= 20; pageNum++) {
                try {
                    const url = `https://www.ttang.com/ttangair/search/ttang/list.do?arr0=${region.code}&page=${pageNum}&scale=20`;
                    await page.goto(url, {
                        waitUntil: 'domcontentloaded',
                        timeout: 30000,
                    });
                    await randomDelay(1.5, 3);

                    // 항공편 데이터 추출 (고정 셀 인덱스 사용)
                    const flights = await page.evaluate(() => {
                        const results: any[] = [];
                        const buttons = document.querySelectorAll('a[id^="ttang_list_"]');

                        buttons.forEach((btn) => {
                            const el = btn as HTMLElement;
                            const masterId = el.getAttribute('data-masterid') || '';
                            const gubun = el.getAttribute('data-gubun') || 'VV';
                            const depCityCode = el.getAttribute('data-depcity') || '';
                            const arrCityCode = el.getAttribute('data-arrcity') || '';
                            const airlineCode = el.getAttribute('data-airlinecode') || '';

                            if (!masterId) return;

                            const row = el.closest('tr');
                            if (!row) return;

                            const cells = row.querySelectorAll('td');
                            if (cells.length < 7) return;

                            // 고정 셀 인덱스로 추출
                            const depCityName = cells[0]?.textContent?.trim() || '';  // 출발도시 (인천, 부산, 청주)
                            const arrCityName = cells[1]?.textContent?.trim() || '';  // 도착도시 (후쿠오카, 오사카(간사이))
                            const airlineName = cells[2]?.textContent?.trim() || '';  // 항공사 (진에어, 에어부산)
                            const dateRange = cells[4]?.textContent?.trim() || '';    // 날짜 (2026.03.03~2026.03.24)
                            const priceText = cells[6]?.textContent?.trim() || '';    // 가격 (185,000원~)

                            // 직항/경유
                            const flightType = cells[3]?.textContent?.trim() || '';

                            // 가격 파싱
                            const priceMatch = priceText.match(/([\d,]+)원/);
                            const price = priceMatch
                                ? parseInt(priceMatch[1].replace(/,/g, ''))
                                : 0;

                            // 날짜 파싱 (시작일)
                            const dateMatch = dateRange.match(/(\d{4})\.(\d{2})\.(\d{2})/);
                            const depDate = dateMatch
                                ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
                                : '';

                            results.push({
                                masterId,
                                gubun,
                                depCityCode,
                                arrCityCode,
                                airlineCode,
                                depCityName,
                                arrCityName,
                                airlineName,
                                price,
                                depDate,
                                dateRange,
                                flightType,
                            });
                        });

                        return results;
                    });

                    // 결과 없으면 다음 지역으로
                    if (flights.length === 0) {
                        console.log(`[땡처리] ${region.name} 페이지 ${pageNum}: 결과 없음 → 다음 지역`);
                        break;
                    }

                    console.log(`[땡처리] ${region.name} 페이지 ${pageNum}: ${flights.length}개`);

                    // Flight 객체로 변환
                    for (const f of flights) {
                        if (f.price <= 0) continue;

                        // 출발 도시
                        const depInfo = DEP_CITY_MAP[f.depCityCode] || { city: f.depCityName || '서울', airport: f.depCityCode || 'ICN' };

                        // 도착 도시 (한글 도시명 그대로 사용)
                        const arrCity = f.arrCityName || f.arrCityCode;

                        // 딥링크 생성
                        const link = `https://www.ttang.com/ttangair/search/ttang/fare_detail.do?masterId=${encodeURIComponent(f.masterId)}&gubun=${f.gubun}&adt=1&chd=0&inf=0`;

                        // 리스트 페이지 링크 (폴백용)
                        const searchLink = `https://www.ttang.com/ttangair/search/ttang/list.do?arr0=${region.code}`;

                        const flight: Flight = {
                            id: `ttang-${f.masterId}`,
                            source: 'ttang',
                            airline: f.airlineName || f.airlineCode || '알 수 없음',
                            departure: {
                                city: depInfo.city,
                                airport: depInfo.airport,
                                date: f.depDate || '',
                                time: '',
                            },
                            arrival: {
                                city: arrCity,
                                airport: f.arrCityCode || '',
                                date: '',
                                time: '',
                            },
                            price: f.price,
                            currency: 'KRW',
                            link,
                            searchLink,
                            region: getRegionByCity(arrCity) || region.name,
                        };

                        allFlights.push(flight);
                    }

                    regionTotal += flights.length;

                    // 20개 미만이면 마지막 페이지
                    if (flights.length < 20) {
                        break;
                    }

                } catch (error) {
                    console.error(`[땡처리] ${region.name} 페이지 ${pageNum} 실패:`, error);
                    break;
                }
            }

            console.log(`[땡처리] ${region.name}: 총 ${regionTotal}개 수집`);
        }

        console.log(`\n[땡처리] 총 ${allFlights.length}개 항공편 수집 완료`);
        logCrawlResults('ttang', allFlights.length);

    } catch (error) {
        console.error('[땡처리] 크롤링 오류:', error);
    } finally {
        await browser.close();
    }

    return allFlights;
}
