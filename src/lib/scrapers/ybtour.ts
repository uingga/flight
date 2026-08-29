import { chromium } from 'playwright';
import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';
// logCrawlResults moved to crawl-all.ts
import { fetchYbtourSchedules, scheduleKeyOf, ScheduleFetchStats, ScheduleKey } from './ybtour-schedule';
import { ScrapeCompleteness } from './scrape-errors';
import { survivingRouteMinPrice } from '@/lib/utils/route-min-price';
import { buildStableFlightId, normalizeAirline } from '@/lib/utils/flight-helpers';
import { assertNoSourceAccessBlockText, SourceResponseError } from './source-response';
import { classifySourceAccessRestriction } from '../source-circuit';

const randomDelay = (min: number, max: number) =>
    new Promise(r => setTimeout(r, (Math.random() * (max - min) + min) * 1000));

let lastScheduleStats: ScheduleFetchStats | null = null;

/** 통합 크롤러가 시간 정보 수집 이상을 별도 경고로 남길 때 사용한다. */
export function getLastYbtourScheduleStats(): ScheduleFetchStats | null {
    return lastScheduleStats;
}

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

// 지역 탭 진입 시도 횟수 (첫 시도 + 재시도). 탭 하나가 실패하면 그 지역 전체가 누락된다.
const TAB_ATTEMPTS = 3;

// 지역 및 도시 코드 매핑 (ID 기반)
const REGIONS = [
    {
        name: '일본',
        tabId: 'bannerCode_J1',
        cities: [
            { name: '도야마', code: 'TOY' },
            { name: '다카마쓰', code: 'TAK' },
            { name: '후쿠오카', code: 'FUK' },
            { name: '마츠야마', code: 'MYJ' },
            { name: '삿포로(치토세)', code: 'CTS' },
            { name: '오사카(간사이)', code: 'KIX' },
            { name: '나고야', code: 'NGO' },
            { name: '도쿄(나리타)', code: 'NRT' },
            { name: '오키나와', code: 'OKA' },
            { name: '시모지시마', code: 'SHI' },
            { name: '시즈오카', code: 'FSZ' },
            { name: '요나고', code: 'YGJ' },
        ]
    },
    {
        name: '아시아',
        tabId: 'bannerCode_A0/A3',
        cities: [
            { name: '나트랑(깜랑)', code: 'CXR' },
            { name: '세부', code: 'CEB' },
            { name: '방콕', code: 'BKK' },
            { name: '방콕(돈무앙)', code: 'DMK' },
            { name: '다낭', code: 'DAD' },
            { name: '칼리보(보라카이)', code: 'KLO' },
            { name: '바탐(인도네시아)', code: 'BTH' },
            { name: '대만(타이페이)', code: 'TPE' },
            { name: '치앙마이', code: 'CNX' },
            { name: '보홀', code: 'TAG' },
            { name: '가오슝', code: 'KHH' },
            { name: '코타키나발루', code: 'BKI' },
            { name: '클락', code: 'CRK' },
            { name: '푸꾸옥', code: 'PQC' },
            { name: '마닐라', code: 'MNL' },
            { name: '마나도', code: 'MDC' },
            { name: '타이중', code: 'RMQ' },
            { name: '싱가포르', code: 'SIN' },
            { name: '푸켓', code: 'HKT' },
            { name: '발리(덴파사)', code: 'DPS' },
            { name: '하노이', code: 'HAN' },
            { name: '쿠알라룸푸르', code: 'KUL' },
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
    },
    {
        name: '유럽',
        tabId: 'bannerCode_E0/B1/F0',
        cities: [
            { name: '바르셀로나', code: 'BCN' },
        ]
    }
];

export async function scrapeYbtour(prevFlights: any[] = []): Promise<Flight[]> {
    console.log('노랑풍선 크롤링 시작...');
    lastScheduleStats = null;

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
    const scheduleKeys: ScheduleKey[] = [];
    let totalFlights = 0;

    try {
        // 메인 페이지 접속
        const landingResponse = await page.goto('https://fly.ybtour.co.kr/booking/findDiscountAir.lts?efcTpCode=INV&efcCode=INV', {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
        });
        if (landingResponse && !landingResponse.ok()) {
            throw new SourceResponseError(
                'http-status',
                `노랑풍선 메인 페이지 HTTP ${landingResponse.status()}`,
                landingResponse.status(),
                landingResponse.headers()['content-type'] || '',
                undefined,
                landingResponse.url(),
            );
        }
        const landingText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
        assertNoSourceAccessBlockText('노랑풍선 메인 페이지', landingText, page.url());

        // 페이지 로드 후 테이블 대기
        await page.waitForSelector('table tbody', { timeout: 10000 }).catch(() => { });
        await randomDelay(2, 4);

        console.log('노랑풍선 페이지 로드 완료');

        // 각 지역별로 크롤링
        const completeness = new ScrapeCompleteness('노랑풍선', 'ybtour', prevFlights);
        // 탭 클릭이 먹지 않으면 화면에 직전 지역의 도시 목록이 그대로 남는다.
        // 목록이 비어 있지 않다는 이유로 성공 처리하면 그 지역이 통째로 빠지므로
        // 직전에 본 목록과 같은지까지 확인한다. (2026-08-20 아시아 탭 실패의 원인)
        let lastDetectedKey = '';
        for (const region of REGIONS) {
            console.log(`\n=== ${region.name} 지역 크롤링 ===`);

            try {
                // ID 기반 지역 탭 클릭
                const tabSelector = region.tabId.includes('/')
                    ? `a[id="${region.tabId}"]`
                    : `#${region.tabId}`;

                // 탭 하나가 안 열리면 그 지역이 통째로 빠진 채 크롤이 "성공"으로 끝난다.
                // 아시아 탭이 전체의 3분의 2를 차지해 이 침묵이 특히 비쌌으므로,
                // 탭 노출·도시 목록까지 확인하고 안 되면 페이지를 다시 띄워 재시도한다.
                let dynamicCities: { code: string; name: string }[] = [];
                for (let attempt = 1; attempt <= TAB_ATTEMPTS; attempt++) {
                    const regionTab = page.locator(tabSelector);
                    const tabVisible = await regionTab.isVisible().catch(() => false);

                    if (tabVisible) {
                        await regionTab.click({ timeout: 5000 }).catch(() => { });
                        await page.waitForSelector('ul.ctab_list', { state: 'visible', timeout: 5000 }).catch(() => { });
                        await randomDelay(1, 3);

                        // 페이지에서 도시 버튼을 동적으로 감지 (하드코딩 불필요)
                        dynamicCities = await page.$$eval('ul.ctab_list li[id^="cityCode_"]', (items) =>
                            items.map(li => ({
                                code: li.id.replace('cityCode_', ''),
                                name: (li.querySelector('a')?.textContent?.trim() || li.id.replace('cityCode_', '')),
                            })).filter(c => c.code)
                        ).catch(() => [] as { code: string; name: string }[]);

                        if (dynamicCities.length > 0) {
                            const detectedKey = dynamicCities.map(c => c.code).sort().join(',');
                            const regionCityCodes = new Set(region.cities.map(c => c.code));
                            const belongsHere = dynamicCities.some(c => regionCityCodes.has(c.code));

                            // 이 지역의 알려진 도시가 하나라도 있으면 제대로 열린 것이다.
                            // 없더라도 직전과 다른 목록이면 받아들인다 — 여행사가 취항지를
                            // 바꿔 우리 목록이 낡았을 뿐일 수 있어 섣불리 실패로 몰지 않는다.
                            if (belongsHere || detectedKey !== lastDetectedKey) {
                                lastDetectedKey = detectedKey;
                                break;
                            }

                            console.log(`[STALE] ${region.name} 탭을 눌렀지만 직전 지역의 도시 목록이 그대로입니다 (${dynamicCities.slice(0, 4).map(c => c.code).join(', ')} …)`);
                            dynamicCities = [];
                        }
                    }

                    if (attempt < TAB_ATTEMPTS) {
                        console.log(`[RETRY ${attempt}/${TAB_ATTEMPTS - 1}] ${region.name} 탭 진입 실패 — 페이지 새로 열고 재시도`);
                        const retryResponse = await page.goto('https://fly.ybtour.co.kr/booking/findDiscountAir.lts?efcTpCode=INV&efcCode=INV', {
                            waitUntil: 'domcontentloaded',
                            timeout: 30000,
                        });
                        if (retryResponse && !retryResponse.ok()) {
                            throw new SourceResponseError(
                                'http-status',
                                `노랑풍선 탭 복구 페이지 HTTP ${retryResponse.status()}`,
                                retryResponse.status(),
                                retryResponse.headers()['content-type'] || '',
                                undefined,
                                retryResponse.url(),
                            );
                        }
                        const retryText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
                        assertNoSourceAccessBlockText('노랑풍선 탭 복구 페이지', retryText, page.url());
                        await page.waitForSelector('table tbody', { timeout: 10000 }).catch(() => { });
                        await randomDelay(2, 4);
                    }
                }

                if (dynamicCities.length === 0) {
                    const regionCityCodes = new Set(region.cities.map(c => c.code));
                    completeness.recordFailure(
                        `${region.name} 지역 (${TAB_ATTEMPTS}회 시도)`,
                        f => regionCityCodes.has(f.arrival?.airport),
                    );
                    continue;
                }

                console.log(`${region.name}: ${dynamicCities.length}개 도시 감지 (${dynamicCities.map(c => c.code).join(', ')})`);

                // 각 도시별로 크롤링
                for (const city of dynamicCities) {
                    console.log(`${city.name}(${city.code}) 검색 중...`);

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
                                            // 아래 셋은 노랑풍선 자체 스케줄 조회에 필요한 값이다.
                                            // 예전에는 시각을 땡처리에서 빌려오느라 읽지 않았다.
                                            const seqIdInput = link.querySelector('input[id*="_inmSeqId_"]') as HTMLInputElement | null;
                                            const inpIdInput = link.querySelector('input[id*="_inpId_"]') as HTMLInputElement | null;
                                            const clsInput = link.querySelector('input[id*="_bookingCls_"]') as HTMLInputElement | null;

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
                                                // ID는 page.evaluate 밖(Node.js)에서 만든다. tsx가 브라우저에 없는
                                                // __name 보조 함수를 삽입할 수 있어 여기서는 계산하지 않는다.
                                                id: '',
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
                                                availableSeats: seats ? parseInt(seats) || undefined : undefined,
                                                // 캐시에 남기지 않는다. 아래에서 뽑아 쓴 뒤 지운다.
                                                _sk: {
                                                    inhId,
                                                    inmSeqId: seqIdInput?.value || '',
                                                    inpId: inpIdInput?.value || '',
                                                    depDate: depDateRaw,
                                                    bookingCls: clsInput?.value || '',
                                                    remainingSeat: seats,
                                                },
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
                                        if (f.price <= 0 || !f.arrival.date) return false;
                                        const key = f.airline + '|' + f.departure.date + '|' + f.arrival.date + '|' + f.price;
                                        if (processedKeys.has(key)) return false;
                                        processedKeys.add(key);
                                        return true;
                                    })
                                    .map((f: any) => ({
                                        ...f,
                                        id: buildStableFlightId('ybtour', [
                                            f.airline,
                                            f.departure.city,
                                            f.arrival.city,
                                            f.departure.date.replace(/-/g, ''),
                                            f.arrival.date.replace(/-/g, ''),
                                            f.price,
                                            f.departure.airport,
                                            f.arrival.airport,
                                        ]),
                                        region: getRegionByCity(f.arrival.city),
                                    }));

                                // 최저가만 필터링 (땡처리 목적에 맞게 가장 싼 항공편만 수집)
                                const minPrice = validFlights.length > 0
                                    ? Math.min(...validFlights.map((f: any) => f.price))
                                    : 0;
                                const cheapestFlights = validFlights.filter((f: any) => f.price === minPrice);

                                // 조회 키는 따로 모으고 항공권 객체에서는 지운다 (캐시에 남기지 않는다)
                                for (const cf of cheapestFlights) {
                                    scheduleKeys.push(cf._sk as ScheduleKey);
                                    delete cf._sk;
                                }
                                flights.push(...cheapestFlights);
                                totalFlights += cheapestFlights.length;

                                if (cheapestFlights.length > 0) {
                                    console.log(`  → ${mainInfo.airline} ${mainInfo.arrival}: ${cheapestFlights.length}건 (최저가 ${minPrice.toLocaleString()}원, 전체 ${validFlights.length}건 중)`);
                                }
                            } catch (e) {
                                if (classifySourceAccessRestriction(e)) throw e;
                                console.error(`  [ERROR] 행 처리 실패:`, e instanceof Error ? e.message : e);
                            }
                        }

                        console.log(`${city.name}: ${totalFlights}건 수집`);

                        await randomDelay(1, 3);

                    } catch (error) {
                        if (classifySourceAccessRestriction(error)) throw error;
                        console.error(`${city.name} 검색 오류:`, error instanceof Error ? error.message : error);
                    }
                }

            } catch (error) {
                if (classifySourceAccessRestriction(error)) throw error;
                console.error(`${region.name} 지역 오류:`, error);
            }
        }

        console.log(`\n노랑풍선 Phase 1 완료: 총 ${flights.length}개 항공권`);

        // 지역이 통째로 빠진 결과는 "적게 수집된 것"이 아니라 "믿을 수 없는 것"이다.
        completeness.assertComplete(flights.length);

        // ===== Phase 2: 이전 캐시에서 시각 복사 + 신규만 노랑풍선 자체 조회 =====
        if (flights.length > 0) {
            // 복사 키에 항공사를 넣는다. 같은 노선·같은 날짜에 항공사가 둘이면
            // 엉뚱한 항공사의 시각이 붙는다.
            const timeKeyOf = (f: any) => [
                normalizeAirline(f.airline || ''),
                f.departure?.airport || '',
                f.arrival?.airport || '',
                f.departure?.date || '',
                f.arrival?.date || '',
            ].join('|');

            // 편명이 있는 항목만 물려받는다.
            //
            // 편명은 노랑풍선 자체 조회에서만 채워진다. 그 전까지는 시각을 땡처리에서
            // 빌려왔고, 그 값이 실제와 어긋난 사례를 확인했다(진에어 귀국편 11:00 대 10:55).
            // 편명 없는 항목을 걸러내면 옛 값이 저절로 씻겨 나가고, 한 번 제대로 채운 뒤에는
            // 평소처럼 복사로 넘어간다.
            const prevTimeMap = new Map<string, any>();
            prevFlights
                .filter((f: any) => f.source === 'ybtour' && f.departure?.time && f.flightNumber)
                .forEach((f: any) => {
                    prevTimeMap.set(timeKeyOf(f), f);
                });

            let carriedOver = 0;
            const pendingKeys: ScheduleKey[] = [];
            const pendingIndices: number[] = [];

            // 최저가 필터에서 살아남을 표만 조회한다 (버려질 표까지 물으면 크롤이 늘어진다)
            const survivors = survivingRouteMinPrice(flights);

            for (let i = 0; i < flights.length; i++) {
                const f = flights[i];
                const prev = prevTimeMap.get(timeKeyOf(f));

                if (prev?.departure?.time) {
                    f.departure.time = prev.departure.time;
                    if (prev.departure.arrivalTime) (f.departure as any).arrivalTime = prev.departure.arrivalTime;
                    if (prev.arrival?.time) f.arrival.time = prev.arrival.time;
                    if (prev.arrival?.arrivalTime) (f.arrival as any).arrivalTime = prev.arrival.arrivalTime;
                    if (prev.flightNumber) f.flightNumber = prev.flightNumber;
                    if (prev.minPax) f.minPax = prev.minPax;
                    carriedOver++;
                } else if (scheduleKeys[i] && survivors.has(f)) {
                    pendingKeys.push(scheduleKeys[i]);
                    pendingIndices.push(i);
                }
            }

            console.log(`[노랑풍선] 이전 시각 복사: ${carriedOver}/${flights.length}개, 신규 조회 대상: ${pendingKeys.length}개 (최저가 생존 ${survivors.size}건 중)`);

            if (pendingKeys.length > 0) {
                // 노랑풍선 세션을 이미 쥐고 있는 페이지를 그대로 쓴다.
                // 새 창도, 다른 여행사 사이트도 필요하지 않다.
                const scheduleResult = await fetchYbtourSchedules(page, pendingKeys);
                const schedules = scheduleResult.schedules;
                lastScheduleStats = scheduleResult.stats;

                let applied = 0;
                for (let j = 0; j < pendingIndices.length; j++) {
                    const data = schedules.get(scheduleKeyOf(pendingKeys[j]));
                    if (!data) continue;
                    const f = flights[pendingIndices[j]];
                    f.departure.time = data.depTime;
                    (f.departure as any).arrivalTime = data.arrTime;
                    f.arrival.time = data.retDepTime;
                    (f.arrival as any).arrivalTime = data.retArrTime;
                    if (data.flightNumber) f.flightNumber = data.flightNumber;
                    if (data.minPax > 1) f.minPax = data.minPax;
                    applied++;
                }
                console.log(`[노랑풍선] 신규 시각 반영: ${applied}/${pendingKeys.length}개`);
            }
        }

        console.log(`\n노랑풍선 크롤링 완료: 총 ${flights.length}개 항공권`);

    } catch (error) {
        console.error('노랑풍선 크롤링 실패:', error);
        // 불완전 수집은 호출부가 알아야 이전 캐시를 지킬 수 있으므로 삼키지 않는다
        // (브라우저는 아래 finally가 닫는다)
        throw error;
    } finally {
        await browser.close();
    }

    const cityStats: { [city: string]: number } = {};
    flights.forEach(f => { cityStats[f.arrival.city] = (cityStats[f.arrival.city] || 0) + 1; });
    // logCrawlResults moved to crawl-all.ts

    return flights;
}
