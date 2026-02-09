import { Flight } from '@/types/flight';
import { chromium } from 'playwright';
import { getRegionByCity } from '@/lib/utils/region-mapper';
import { logCrawlResults } from '@/lib/utils/crawl-logger';

/**
 * 땡처리닷컴 스크래퍼 (www.ttang.com 기반)
 * 9개 지역 카테고리별 전체 항공권 수집
 * 페이지네이션: 숫자 클릭(2~6) → 화살표 → 숫자 클릭(7~12) → 화살표 → 반복
 */

// 지역 코드 목록
const REGIONS = [
    { code: 'A2ALL', name: '동남아', region: '동남아' },
    { code: 'A7ALL', name: '일본', region: '일본' },
    { code: 'A8ALL', name: '중국', region: '중국' },
    { code: 'A1ALL', name: '남태평양', region: '남태평양' },
    { code: 'A5ALL', name: '호주/뉴질랜드', region: '남태평양' },
    { code: 'A3ALL', name: '미주/중남미', region: '미주' },
    { code: 'A6ALL', name: '유럽/러시아', region: '유럽' },
    { code: 'B1ALL', name: '아프리카/중동', region: '기타' },
    { code: 'A4ALL', name: '서남(중앙)아시아', region: '동남아' },
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
    regionCode: string,
    pageNum: number,
    defaultRegion: string,
    url: string
): Promise<Flight[]> {
    const flights: Flight[] = [];
    const rows = await page.$$('table.tblListB tbody tr');

    for (let i = 0; i < rows.length; i++) {
        try {
            const row = rows[i];
            const airline = await row.$eval('td.airlogo p', (el: Element) => el.textContent?.trim() || '').catch(() => '');
            const departure = await row.$eval('td:nth-child(1) p.shortCut', (el: Element) => el.textContent?.trim() || '').catch(() => '인천');
            const arrival = await row.$eval('td:nth-child(2) p.shortCut', (el: Element) => el.textContent?.trim() || '').catch(() => '');
            const priceText = await row.$eval('td.price a.js_tooltip_btn', (el: Element) => el.textContent?.trim() || '0').catch(() => '0');
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
            let productLink = url;
            if (bookBtn) {
                const masterId = await bookBtn.getAttribute('data-masterid') || '';
                const gubun = await bookBtn.getAttribute('data-gubun') || 'VM';
                const minimumCnt = await bookBtn.getAttribute('data-minimumcnt') || '1';
                if (masterId) {
                    productLink = `https://www.ttang.com/ttangair/search/ttang/fare_detail.do?masterId=${encodeURIComponent(masterId)}&gubun=${gubun}&adt=1&chd=0&inf=0&exAirAvailStartDate=${startDateParam}`;
                }
            }

            if (arrival && price > 0) {
                flights.push({
                    id: `ttang-${regionCode}-p${pageNum}-${i}`,
                    source: 'ttang',
                    airline: airline || '항공사 미정',
                    departure: { city: departure || '인천', airport: '', date: depDate, time: '' },
                    arrival: { city: arrival, airport: '', date: '', time: '' },
                    price: price,
                    currency: 'KRW',
                    link: productLink,
                    region: getRegionByCity(arrival) || defaultRegion,
                });
            }
        } catch { }
    }

    return flights;
}

/**
 * 단일 지역의 항공권 수집
 */
async function scrapeRegion(
    page: any,
    regionCode: string,
    regionName: string,
    defaultRegion: string
): Promise<Flight[]> {
    const flights: Flight[] = [];

    try {
        const url = `https://www.ttang.com/ttangair/search/ttang/list.do?arr0=${regionCode}`;
        console.log(`📍 ${regionName} 수집 중... (${url})`);

        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await randomDelay(2, 3);

        await page.waitForSelector('table.tblListB tbody tr', { timeout: 15000 }).catch(() => {
            console.log(`  ⚠️ ${regionName}: 테이블 로딩 실패`);
        });

        // 첫 페이지 수집
        const firstPageFlights = await scrapeCurrentPage(page, regionCode, 1, defaultRegion, url);
        flights.push(...firstPageFlights);
        console.log(`  🔍 ${regionName} 페이지 1: ${firstPageFlights.length}개 수집`);

        // 페이지네이션: 숫자 클릭 → 화살표 → 반복
        let currentPage = 1;
        const maxPages = 50;
        let consecutiveEmptyPages = 0;

        while (currentPage < maxPages && consecutiveEmptyPages < 3) {
            try {
                const nextPageNum = currentPage + 1;

                // 다음 페이지 번호(currentPage + 1)가 표시되어 있는지 확인
                const pageLinks = await page.$$('.pageSty1 a.num');
                let nextPageElement = null;

                for (const link of pageLinks) {
                    const text = await link.textContent();
                    const num = parseInt(text?.trim());
                    if (num === nextPageNum) {
                        nextPageElement = link;
                        break;
                    }
                }

                if (nextPageElement) {
                    // 다음 페이지 번호가 있으면 클릭
                    await nextPageElement.click();
                    await randomDelay(1, 2);

                    currentPage = nextPageNum;
                    const pageFlights = await scrapeCurrentPage(page, regionCode, currentPage, defaultRegion, url);
                    flights.push(...pageFlights);
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
                        console.log(`    → 다음 그룹으로 이동`);
                        await nextBtn.click();
                        await randomDelay(1, 2);
                        // 화살표 클릭 후 다시 루프 시작 (새 페이지 번호들이 표시됨)
                    } else {
                        // 다음 버튼도 없으면 종료
                        console.log(`    마지막 페이지 도달`);
                        break;
                    }
                }
            } catch (pageError) {
                console.log(`    페이지 ${currentPage + 1} 오류, 종료`);
                break;
            }
        }

        console.log(`  ✅ ${regionName}: ${flights.length}개 항공권 수집 완료`);
    } catch (error) {
        console.error(`  ❌ ${regionName} 수집 오류:`, error);
    }

    return flights;
}

/**
 * 메인 스크래퍼 함수
 */
export async function scrapeTtang(): Promise<Flight[]> {
    console.log('🚀 땡처리닷컴 크롤링 시작 (www.ttang.com)...');
    console.log(`📋 수집 대상: ${REGIONS.length}개 지역`);

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    const allFlights: Flight[] = [];

    try {
        for (const region of REGIONS) {
            const regionFlights = await scrapeRegion(page, region.code, region.name, region.region);
            allFlights.push(...regionFlights);
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
