import { chromium } from 'playwright';
import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';
import { logCrawlResults } from '@/lib/utils/crawl-logger';

const randomDelay = (min: number, max: number) =>
    new Promise(r => setTimeout(r, (Math.random() * (max - min) + min) * 1000));

/**
 * 노랑풍선 땡처리 항공권 크롤링
 * URL: https://fly.ybtour.co.kr/booking/findDiscountAir.lts?efcTpCode=INV&efcCode=INV
 * 
 * 2026-02-09 업데이트: ID 기반 선택자로 변경
 * - 지역 탭: #bannerCode_{코드}
 * - 도시 버튼: #cityCode_{공항코드} a
 * 
 * 2026-02-12 업데이트: 스케줄 개별 날짜 파싱
 * - 조회 버튼 클릭 후 td.link 내 hidden input에서 정확한 출발/귀국일 추출
 * - 기존: 출발기간 범위(26/03/03~26/03/24)를 출발/도착일로 오인
 * - 수정: 개별 스케줄 행의 inv_depDate, inv_inmRetDate에서 정확한 날짜 추출
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
        headless: !!process.env.CI,
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 8000 },
        extraHTTPHeaders: {
            'Referer': 'https://www.google.com/',
            'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        },
    });

    const page = await context.newPage();
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // 브라우저 콘솔 로그 비활성화 (HTML dump가 출력을 가림)
    // page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));

    const flights: Flight[] = [];
    let totalFlights = 0;

    try {
        // 메인 페이지 접속
        await page.goto('https://fly.ybtour.co.kr/booking/findDiscountAir.lts?efcTpCode=INV&efcCode=INV', {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
        });

        // 페이지 로드 후 테이블 대기
        await page.waitForSelector('table tbody', { timeout: 10000 }).catch(() => { });
        await randomDelay(2, 4);

        console.log('노랑풍선 페이지 로드 완료');

        // 각 지역별로 크롤링
        for (const region of REGIONS) {
            console.log(`\n=== ${region.name} 지역 크롤링 ===`);

            try {
                // ID 기반 지역 탭 클릭
                const tabSelector = region.tabId.includes('/')
                    ? `a[id="${region.tabId}"]`
                    : `#${region.tabId}`;
                const regionTab = page.locator(tabSelector);

                const tabVisible = await regionTab.isVisible().catch(() => false);

                if (!tabVisible) {
                    console.log(`[SKIP] ${region.name} 탭을 찾을 수 없음 (${tabSelector})`);
                    continue;
                }

                await regionTab.click({ timeout: 5000 });
                console.log(`${region.name} 탭 클릭 완료`);

                await page.waitForSelector('ul.ctab_list', { state: 'visible', timeout: 5000 }).catch(() => { });
                await randomDelay(1, 3);

                // 각 도시별로 크롤링
                for (const city of region.cities) {
                    console.log(`${city.name} 검색 중...`);

                    try {
                        const citySelector = `#cityCode_${city.code} a`;
                        const cityButton = page.locator(citySelector);

                        const isVisible = await cityButton.isVisible().catch(() => false);

                        if (!isVisible) {
                            console.log(`[SKIP] ${city.name} 버튼을 찾을 수 없음 (${citySelector})`);
                            continue;
                        }

                        await cityButton.scrollIntoViewIfNeeded();
                        await cityButton.click({ timeout: 5000 });
                        await page.waitForSelector('table tbody tr', { timeout: 5000 });
                        await page.waitForTimeout(1500);

                        const bannerCode = region.tabId.replace('bannerCode_', '');

                        // 메인 행에서 항공사/출발/도착 추출 (5개 이상 td를 가진 행만)
                        const mainRows = await page.$$('table tbody tr');
                        const mainRowIndices: number[] = [];

                        for (let i = 0; i < mainRows.length; i++) {
                            const isMainRow = await mainRows[i].evaluate((row) => {
                                const cells = row.querySelectorAll('td');
                                return cells.length >= 5;
                            });
                            if (isMainRow) mainRowIndices.push(i);
                        }

                        // 각 메인 행에 대해 조회 클릭 → 스케줄 hidden input 파싱
                        // 출발지별 첫 번째 행(최저가)만 처리 (같은 출발지에서 여러 항공사가 있으면 최저가만)
                        const processedKeys = new Set<string>();
                        const seenDepartures = new Set<string>();
                        const rowsToProcess: number[] = [];
                        for (const idx of mainRowIndices) {
                            const dep = await mainRows[idx].evaluate((row) => {
                                const cells = row.querySelectorAll('td');
                                return cells[1]?.textContent?.trim() || '';
                            });
                            if (!seenDepartures.has(dep)) {
                                seenDepartures.add(dep);
                                rowsToProcess.push(idx);
                            }
                        }
                        for (const rowIdx of rowsToProcess) {
                            try {
                                // 메인 행 정보 추출
                                const mainInfo = await mainRows[rowIdx].evaluate((row) => {
                                    const cells = row.querySelectorAll('td');
                                    return {
                                        airline: cells[0]?.textContent?.trim() || '',
                                        departure: cells[1]?.textContent?.trim() || '',
                                        arrival: cells[2]?.textContent?.trim() || '',
                                    };
                                });

                                if (!mainInfo.airline) continue;

                                // 조회 버튼 클릭
                                const searchBtn = await mainRows[rowIdx].$('a[onclick*="listActive"]');
                                if (!searchBtn) continue;

                                await searchBtn.click({ timeout: 5000 });

                                // DOM 업데이트 대기
                                await randomDelay(2, 4);

                                // td.link 안의 hidden input에서 개별 스케줄 데이터 추출 (전체 스캔, 중복은 processedKeys로 제거)
                                const scheduleData = await page.evaluate(
                                    (args) => {
                                        const results: any[] = [];
                                        const links = document.querySelectorAll('td.link a[onclick*="selectFareINV"]');

                                        for (var idx = 0; idx < links.length; idx++) {
                                            const link = links[idx];

                                            // hidden input에서 값 추출 (인라인)
                                            const depDateInput = link.querySelector('input[id*="_depDate_"]') as HTMLInputElement | null;
                                            const retDateInput = link.querySelector('input[id*="_inmRetDate_"]') as HTMLInputElement | null;
                                            const inhIdInput = link.querySelector('input[id*="_inhId_"]') as HTMLInputElement | null;
                                            const arrApInput = link.querySelector('input[id*="_inpArrApCode_"]') as HTMLInputElement | null;
                                            const depApInput = link.querySelector('input[id*="_inpDepApCode_"]') as HTMLInputElement | null;
                                            const seatsInput = link.querySelector('input[id*="_remainingSeat_"]') as HTMLInputElement | null;

                                            const depDateRaw = depDateInput?.value || '';
                                            const retDateRaw = retDateInput?.value || '';
                                            const inhId = inhIdInput?.value || '';
                                            const arrApCode = arrApInput?.value || '';
                                            const depApCode = depApInput?.value || '';
                                            const seats = seatsInput?.value || '';

                                            if (!depDateRaw || depDateRaw.length !== 8) continue;

                                            // YYYYMMDD → YYYY-MM-DD (인라인)
                                            const depDate = depDateRaw.slice(0, 4) + '-' + depDateRaw.slice(4, 6) + '-' + depDateRaw.slice(6, 8);
                                            const retDate = (retDateRaw && retDateRaw.length === 8)
                                                ? retDateRaw.slice(0, 4) + '-' + retDateRaw.slice(4, 6) + '-' + retDateRaw.slice(6, 8)
                                                : '';

                                            // 가격 추출 (인라인)
                                            let price = 0;
                                            const priceCell = link.querySelector('table.city_in td.red, table.city_in td.text_r');
                                            if (priceCell) {
                                                const m = (priceCell.textContent || '').match(/([\d,]+)\s*원/);
                                                if (m) price = parseInt(m[1].replace(/,/g, ''));
                                            }

                                            // 링크 생성
                                            let flightLink = 'https://fly.ybtour.co.kr/booking/findDiscountAir.lts?efcTpCode=INV&efcCode=INV&efcBannerCode=' + encodeURIComponent(args.bannerCode);
                                            if (inhId) flightLink += '&inhId=' + encodeURIComponent(inhId) + '&depDate=' + depDateRaw;
                                            if (arrApCode) flightLink += '&efcCityCode=' + arrApCode;

                                            results.push({
                                                id: 'ybtour-' + args.cityName + '-' + depDateRaw + '-' + idx,
                                                source: 'ybtour',
                                                airline: args.airline,
                                                departure: {
                                                    city: args.departure,
                                                    airport: depApCode,
                                                    date: depDate,
                                                    time: '',
                                                },
                                                arrival: {
                                                    city: args.arrival,
                                                    airport: arrApCode,
                                                    date: retDate,
                                                    time: '',
                                                },
                                                price: price,
                                                currency: 'KRW',
                                                link: flightLink,
                                                seats: seats ? seats + '석' : '',
                                            });
                                        }

                                        return results;
                                    },
                                    {
                                        airline: mainInfo.airline,
                                        departure: mainInfo.departure,
                                        arrival: mainInfo.arrival,
                                        bannerCode,
                                        cityName: city.name,
                                    }
                                );

                                const validFlights = scheduleData
                                    .filter((f: any) => {
                                        if (f.price <= 0) return false;
                                        const key = f.airline + '|' + f.departure.date + '|' + f.arrival.date + '|' + f.price;
                                        if (processedKeys.has(key)) return false;
                                        processedKeys.add(key);
                                        return true;
                                    })
                                    .map((f: any) => ({
                                        ...f,
                                        region: getRegionByCity(f.arrival.city),
                                    }));

                                // 최저가만 필터링 (땡처리 목적에 맞게 가장 싼 항공편만 수집)
                                const minPrice = validFlights.length > 0
                                    ? Math.min(...validFlights.map((f: any) => f.price))
                                    : 0;
                                const cheapestFlights = validFlights.filter((f: any) => f.price === minPrice);

                                flights.push(...cheapestFlights);
                                totalFlights += cheapestFlights.length;

                                if (cheapestFlights.length > 0) {
                                    console.log(`  → ${mainInfo.airline} ${mainInfo.arrival}: ${cheapestFlights.length}건 (최저가 ${minPrice.toLocaleString()}원, 전체 ${validFlights.length}건 중)`);
                                }
                            } catch (e) {
                                console.error(`  [ERROR] 행 처리 실패:`, e instanceof Error ? e.message : e);
                            }
                        }

                        console.log(`${city.name}: ${totalFlights}건 수집`);

                        await randomDelay(1, 3);

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
