import { Flight } from '@/types/flight';
import { chromium } from 'playwright';
import { getRegionByCity } from '@/lib/utils/region-mapper';
import { logCrawlResults } from '@/lib/utils/crawl-logger';

/**
 * 땡처리닷컴 스크래퍼 (www.ttang.com 할인항공권 페이지)
 * 2개 페이지에서 항공권 수집:
 * 1. 오늘오픈 땡처리 항공권: /discount/index.do
 * 2. 3일이내 출발 한정특가: /discount/limit.do
 */

const DISCOUNT_PAGES = [
    { url: 'https://www.ttang.com/ttangair/search/discount/index.do', name: '오늘오픈 땡처리 항공권' },
    { url: 'https://www.ttang.com/ttangair/search/discount/limit.do?trip=RT&gubun=L', name: '3일이내 출발 한정특가' },
];

function randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay * 1000));
}

/**
 * 현재 페이지의 모든 항공권 수집
 */
async function scrapeCurrentPage(
    page: any,
    pageNum: number,
    pageUrl: string
): Promise<Flight[]> {
    const flights: Flight[] = [];
    const rows = await page.$$('table.tblListB tbody tr');

    for (let i = 0; i < rows.length; i++) {
        try {
            const row = rows[i];
            const airline = await row.$eval('td.airlogo p', (el: Element) => el.textContent?.trim() || '').catch(() => '');
            const departure = await row.$eval('td:nth-child(1) p.shortCut', (el: Element) => el.textContent?.trim() || '').catch(() => '인천');
            const arrival = await row.$eval('td:nth-child(2) p.shortCut', (el: Element) => el.textContent?.trim() || '').catch(() => '');
            const priceText = await row.$eval('td.price', (el: Element) => el.textContent?.trim() || '0').catch(() => '0');
            const price = parseInt(priceText.replace(/[^0-9]/g, '')) || 0;

            const dateText = await row.$eval('td:nth-child(5)', (el: Element) => el.textContent?.trim() || '').catch(() => '');
            let depDate = '';
            let startDateParam = '';
            if (dateText) {
                const dateMatch = dateText.match(/(\d{4})\.(\d{2})\.(\d{2})/);
                if (dateMatch) {
                    depDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
                    startDateParam = `${dateMatch[1]}${dateMatch[2]}${dateMatch[3]}`;
                }
            }

            // 예약 버튼에서 data 속성 추출하여 개별 링크 생성
            const bookBtn = await row.$('.btnSty1.cRed, a[data-masterid]');
            let productLink = pageUrl;
            if (bookBtn) {
                const masterId = await bookBtn.getAttribute('data-masterid') || '';
                const gubun = await bookBtn.getAttribute('data-gubun') || 'VM';
                if (masterId) {
                    productLink = `https://www.ttang.com/ttangair/search/ttang/fare_detail.do?masterId=${encodeURIComponent(masterId)}&gubun=${gubun}&adt=1&chd=0&inf=0&exAirAvailStartDate=${startDateParam}`;
                }
            }

            if (arrival && price > 0) {
                flights.push({
                    id: `ttang-discount-p${pageNum}-${i}`,
                    source: 'ttang',
                    airline: airline || '항공사 미정',
                    departure: { city: departure || '인천', airport: '', date: depDate, time: '' },
                    arrival: { city: arrival, airport: '', date: '', time: '' },
                    price: price,
                    currency: 'KRW',
                    link: productLink,
                    region: getRegionByCity(arrival) || '기타',
                });
            }
        } catch { }
    }

    return flights;
}

/**
 * 메인 스크래퍼 함수
 */
export async function scrapeTtang(): Promise<Flight[]> {
    console.log('🚀 땡처리닷컴 크롤링 시작 (할인항공권 페이지)...');
    console.log(`📋 수집 대상: ${DISCOUNT_PAGES.length}개 페이지`);

    const browser = await chromium.launch({ headless: !!process.env.CI });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    const allFlights: Flight[] = [];

    try {
        for (const discountPage of DISCOUNT_PAGES) {
            console.log(`\n📍 ${discountPage.name} 수집 중... (${discountPage.url})`);

            await page.goto(discountPage.url, { waitUntil: 'networkidle', timeout: 30000 });
            await randomDelay(2, 3);

            await page.waitForSelector('table.tblListB tbody tr', { timeout: 15000 }).catch(() => {
                console.log(`  ⚠️ ${discountPage.name}: 테이블 로딩 실패`);
            });

            // 첫 페이지 수집
            const firstPageFlights = await scrapeCurrentPage(page, 1, discountPage.url);
            allFlights.push(...firstPageFlights);
            console.log(`  🔍 페이지 1: ${firstPageFlights.length}개 수집`);

            // 페이지네이션 처리
            let currentPage = 1;
            const maxPages = 20;
            let consecutiveEmptyPages = 0;

            while (currentPage < maxPages && consecutiveEmptyPages < 3) {
                try {
                    const nextPageNum = currentPage + 1;

                    // 다음 페이지 번호가 표시되어 있는지 확인
                    const pageLinks = await page.$$('.pageSty1 a.num');
                    let nextPageElement = null;

                    for (const link of pageLinks) {
                        const pageAttr = await link.getAttribute('page');
                        const text = await link.textContent();
                        const num = parseInt(pageAttr || text?.trim() || '');
                        if (num === nextPageNum) {
                            nextPageElement = link;
                            break;
                        }
                    }

                    if (nextPageElement) {
                        await nextPageElement.click();
                        await randomDelay(1, 2);

                        // 페이지가 로드될 때까지 대기
                        await page.waitForSelector('table.tblListB tbody tr', { timeout: 10000 }).catch(() => { });

                        currentPage = nextPageNum;
                        const pageFlights = await scrapeCurrentPage(page, currentPage, discountPage.url);
                        allFlights.push(...pageFlights);
                        console.log(`    페이지 ${currentPage}: ${pageFlights.length}개 수집`);

                        if (pageFlights.length === 0) {
                            consecutiveEmptyPages++;
                        } else {
                            consecutiveEmptyPages = 0;
                        }
                    } else {
                        // 현재 그룹에 더 이상 페이지가 없으면 "다음" 화살표 클릭
                        const nextBtn = await page.$('.pageSty1 a.btn_next');
                        if (nextBtn) {
                            console.log('    → 다음 그룹으로 이동');
                            await nextBtn.click();
                            await randomDelay(1, 2);
                        } else {
                            console.log(`  ✅ ${discountPage.name}: 마지막 페이지 도달`);
                            break;
                        }
                    }
                } catch (pageError) {
                    console.log(`    페이지 ${currentPage + 1} 오류, 종료`);
                    break;
                }
            }

            await randomDelay(2, 4);
        }
    } catch (error) {
        console.error('땡처리닷컴 크롤링 오류:', error);
    } finally {
        await browser.close();
    }

    // 중복 제거
    const uniqueFlights = allFlights.filter((flight, index, self) =>
        index === self.findIndex(f =>
            f.airline === flight.airline &&
            f.departure.city === flight.departure.city &&
            f.arrival.city === flight.arrival.city &&
            f.price === flight.price
        )
    );

    console.log(`\n🎉 땡처리닷컴 크롤링 완료!`);
    console.log(`   총 수집: ${allFlights.length}개`);
    console.log(`   중복 제거 후: ${uniqueFlights.length}개`);

    const cityStats: { [city: string]: number } = {};
    uniqueFlights.forEach(f => { cityStats[f.arrival.city] = (cityStats[f.arrival.city] || 0) + 1; });
    logCrawlResults('ttang', uniqueFlights.length, undefined, cityStats);

    return uniqueFlights;
}
