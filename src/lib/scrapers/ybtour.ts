import { chromium } from 'playwright';
import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';
import { logCrawlResults } from '@/lib/utils/crawl-logger';

/**
 * 노랑풍선 땡처리 항공권 크롤링
 * URL: https://fly.ybtour.co.kr/booking/findDiscountAir.lts?efcTpCode=INV&efcCode=INV
 * 
 * 2026-02-09 업데이트: ID 기반 선택자로 변경
 * - 지역 탭: #bannerCode_{코드}
 * - 도시 버튼: #cityCode_{공항코드} a
 */

// 지역 및 도시 코드 매핑 (ID 기반)
const REGIONS = [
    {
        name: '일본',
        tabId: 'bannerCode_J1',
        cities: [
            { name: '마츠야마', code: 'MYJ' },
            { name: '나가사키', code: 'NGS' },
            { name: '오사카(간사이)', code: 'KIX' },
            { name: '다카마쓰', code: 'TAK' },
            { name: '후쿠오카', code: 'FUK' },
            { name: '삿포로(치토세)', code: 'CTS' },
            { name: '나고야', code: 'NGO' },
            { name: '도쿄(나리타)', code: 'NRT' },
            { name: '오키나와', code: 'OKA' },
            { name: '시즈오카', code: 'FSZ' },
        ]
    },
    {
        name: '아시아',
        tabId: 'bannerCode_A0/A3',
        cities: [
            { name: '대만(타이페이)', code: 'TPE' },
            { name: '방콕', code: 'BKK' },
            { name: '세부', code: 'CEB' },
            { name: '방콕(돈무앙)', code: 'DMK' },
            { name: '다낭', code: 'DAD' },
            { name: '칼리보(보라카이)', code: 'KLO' },
            { name: '바탐(인도네시아)', code: 'BTH' },
            { name: '보홀', code: 'TAG' },
            { name: '푸꾸옥', code: 'PQC' },
            { name: '치앙마이', code: 'CNX' },
            { name: '코타키나발루', code: 'BKI' },
            { name: '하노이', code: 'HAN' },
            { name: '마닐라', code: 'MNL' },
            { name: '발리(덴파사)', code: 'DPS' },
            { name: '나트랑(깜랑)', code: 'CXR' },
            { name: '마나도', code: 'MDC' },
            { name: '싱가포르', code: 'SIN' },
            { name: '클락', code: 'CRK' },
            { name: '푸켓', code: 'HKT' },
            { name: '마카오', code: 'MFM' },
        ]
    },
    {
        name: '괌/사이판',
        tabId: 'bannerCode_P1',
        cities: [
            { name: '사이판', code: 'SPN' },
            { name: '괌', code: 'GUM' },
        ]
    },
    {
        name: '남태평양',
        tabId: 'bannerCode_P0',
        cities: [
            { name: '시드니', code: 'SYD' },
            { name: '브리즈번', code: 'BNE' },
        ]
    }
];

export async function scrapeYbtour(): Promise<Flight[]> {
    console.log('노랑풍선 크롤링 시작...');

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
        await page.goto('https://fly.ybtour.co.kr/booking/findDiscountAir.lts?efcTpCode=INV&efcCode=INV', {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
        });

        // 페이지 로드 후 추가 대기
        await page.waitForTimeout(3000);

        console.log('노랑풍선 페이지 로드 완료');

        // 각 지역별로 크롤링
        for (const region of REGIONS) {
            console.log(`\n=== ${region.name} 지역 크롤링 ===`);

            try {
                // ID 기반 지역 탭 클릭
                // Note: 슬래시가 포함된 ID는 속성 선택자로 처리
                const tabSelector = region.tabId.includes('/')
                    ? `a[id="${region.tabId}"]`
                    : `#${region.tabId}`;
                const regionTab = page.locator(tabSelector);

                // 탭 존재 및 가시성 확인
                const tabVisible = await regionTab.isVisible().catch(() => false);

                if (!tabVisible) {
                    console.log(`[SKIP] ${region.name} 탭을 찾을 수 없음 (${tabSelector})`);
                    continue;
                }

                await regionTab.click({ timeout: 5000 });
                console.log(`${region.name} 탭 클릭 완료`);

                // 로딩 대기
                await page.waitForTimeout(1500);

                // 도시 목록 로드 대기
                await page.waitForSelector('ul.ctab_list', { state: 'visible', timeout: 5000 }).catch(() => { });

                // 각 도시별로 크롤링
                for (const city of region.cities) {
                    console.log(`${city.name} 검색 중...`);

                    try {
                        // ID 기반 도시 버튼 클릭
                        const citySelector = `#cityCode_${city.code} a`;
                        const cityButton = page.locator(citySelector);

                        // 버튼 존재 및 가시성 확인
                        const isVisible = await cityButton.isVisible().catch(() => false);

                        if (!isVisible) {
                            console.log(`[SKIP] ${city.name} 버튼을 찾을 수 없음 (${citySelector})`);
                            continue;
                        }

                        // 스크롤 후 클릭
                        await cityButton.scrollIntoViewIfNeeded();
                        await cityButton.click({ timeout: 5000 });

                        // 로딩 대기
                        await page.waitForTimeout(2000);

                        // 테이블이 로드될 때까지 대기
                        await page.waitForSelector('table tbody tr', { timeout: 5000 });

                        // 테이블 데이터 추출 (지역 탭 코드도 함께 전달)
                        const bannerCode = region.tabId.replace('bannerCode_', '');
                        const cityFlights = await page.evaluate(({ cityName, bannerCode }) => {
                            const rows = document.querySelectorAll('table tbody tr');
                            const results: any[] = [];

                            rows.forEach((row, index) => {
                                const cells = row.querySelectorAll('td');

                                if (cells.length >= 5) {
                                    const airline = cells[0]?.textContent?.trim() || '';
                                    const departure = cells[1]?.textContent?.trim() || '';
                                    const arrival = cells[2]?.textContent?.trim() || '';
                                    const priceText = cells[3]?.textContent?.trim() || '';
                                    const datesText = cells[4]?.textContent?.trim() || '';

                                    // 가격 추출 (숫자만)
                                    const priceMatch = priceText.match(/[\d,]+/);
                                    const price = priceMatch ? parseInt(priceMatch[0].replace(/,/g, '')) : 0;

                                    // 날짜 추출 및 포맷팅 (YY/MM/DD -> YYYY-MM-DD)
                                    const dateMatch = datesText.match(/(\d{2})\/(\d{2})\/(\d{2})\s*~\s*(\d{2})\/(\d{2})\/(\d{2})/);
                                    let depDate = '';
                                    let arrDate = '';

                                    if (dateMatch) {
                                        // 20xx년으로 가정
                                        depDate = `20${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
                                        arrDate = `20${dateMatch[4]}-${dateMatch[5]}-${dateMatch[6]}`;
                                    }

                                    // 도시 코드 추출 (링크 생성용)
                                    const arrCityInput = row.querySelector('input[name="arrCity"]');
                                    const arrCityCode = arrCityInput ? (arrCityInput as HTMLInputElement).value : '';

                                    // 조회 버튼에서 invCode, inhId 추출
                                    const searchBtn = row.querySelector('a[onclick*="listActive"]');
                                    let link = `https://fly.ybtour.co.kr/booking/findDiscountAir.lts?efcTpCode=INV&efcCode=INV&efcBannerCode=${encodeURIComponent(bannerCode)}`;

                                    if (searchBtn) {
                                        const onclickAttr = searchBtn.getAttribute('onclick') || '';
                                        // listActive(1, "7C1701ICNMYJ-T3", "209000") 형식에서 추출
                                        const inhIdMatch = onclickAttr.match(/listActive\s*\(\s*\d+\s*,\s*["']([^"']+)["']/);

                                        if (inhIdMatch) {
                                            const inhId = inhIdMatch[1];
                                            // 날짜를 YYYYMMDD 형식으로 변환
                                            const dateParam = depDate.replace(/-/g, '');
                                            // 스케줄 조회 페이지로 링크 (개별 예약 URL은 스케줄 선택 후에만 가능)
                                            link = `https://fly.ybtour.co.kr/booking/findDiscountAir.lts?efcTpCode=INV&efcCode=INV&efcBannerCode=${encodeURIComponent(bannerCode)}&inhId=${encodeURIComponent(inhId)}&depDate=${dateParam}`;
                                        }
                                    }

                                    if (!link.includes('findRtPaxInfo') && arrCityCode) {
                                        link += `&efcCityCode=${arrCityCode}`;
                                    }

                                    if (airline && price > 0) {
                                        results.push({
                                            id: `ybtour-${cityName}-${index}`,
                                            source: 'ybtour',
                                            airline: airline,
                                            departure: {
                                                city: departure,
                                                airport: '',
                                                date: depDate,
                                                time: '',
                                            },
                                            arrival: {
                                                city: arrival,
                                                airport: '',
                                                date: arrDate,
                                                time: '',
                                            },
                                            price: price,
                                            currency: 'KRW',
                                            link: link,
                                        });
                                    }

                                }
                            });

                            return results;
                        }, { cityName: city.name, bannerCode });

                        const processedFlights = cityFlights.map((f: any) => ({
                            ...f,
                            region: getRegionByCity(f.arrival.city)
                        }));
                        flights.push(...processedFlights);
                        totalFlights += cityFlights.length;
                        console.log(`${city.name}: ${cityFlights.length}개 항목 발견 (누적: ${totalFlights}개)`);

                        // 다음 도시 검색 전 잠시 대기
                        await page.waitForTimeout(500);

                    } catch (error) {
                        console.error(`${city.name} 검색 오류:`, error instanceof Error ? error.message : error);
                    }
                }

            } catch (error) {
                console.error(`${region.name} 지역 오류:`, error);
            }
        }

        console.log(`\n노랑풍선 크롤링 완료: 총 ${flights.length}개 항공권`);

    } catch (error) {
        console.error('노랑풍선 크롤링 실패:', error);
    } finally {
        await browser.close();
    }

    const cityStats: { [city: string]: number } = {};
    flights.forEach(f => { cityStats[f.arrival.city] = (cityStats[f.arrival.city] || 0) + 1; });
    logCrawlResults('ybtour', flights.length, undefined, cityStats);

    return flights;
}
