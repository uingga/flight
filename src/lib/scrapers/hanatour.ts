import { chromium } from 'playwright';
import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';
import { logCrawlResults } from '@/lib/utils/crawl-logger';

const randomDelay = (min: number, max: number) =>
    new Promise(r => setTimeout(r, (Math.random() * (max - min) + min) * 1000));

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

// 도시명 -> 하나투어 도시코드 매핑 (공항코드가 아닌 도시코드 사용: SEL, TYO 등)
const CITY_TO_HANATOUR: Record<string, string> = {
    // 한국 출발지
    '서울': 'SEL', '인천': 'SEL', '김포': 'SEL',
    '부산': 'PUS', '김해': 'PUS',
    '대구': 'TAE', '청주': 'CJJ', '제주': 'CJU', '제주시': 'CJU', '무안': 'MWX',
    // 일본
    '도쿄': 'TYO', '오사카': 'OSA', '후쿠오카': 'FUK', '삿포로': 'CTS', '나고야': 'NGO',
    '오키나와': 'OKA', '고베': 'UKB', '나가사키': 'NGS', '가고시마': 'KOJ',
    '구마모토': 'KMJ', '오이타': 'OIT', '마츠야마': 'MYJ', '히로시마': 'HIJ',
    '요나고': 'YGJ', '다카마쓰': 'TAK',
    // 동남아
    '방콕': 'BKK', '치앙마이': 'CNX', '푸켓': 'HKT', '푸껫': 'HKT',
    '다낭': 'DAD', '나트랑': 'NHA', '하노이': 'HAN', '호치민': 'SGN', '푸꾸옥': 'PQC',
    '마닐라': 'MNL', '세부': 'CEB', '보라카이': 'KLO', '보홀': 'TAG',
    '싱가포르': 'SIN', '쿠알라룸푸르': 'KUL', '코타키나발루': 'BKI',
    '발리': 'DPS', '자카르타': 'CGK',
    // 대만/중화권
    '타이베이': 'TPE', '타이중': 'RMQ', '가오슝': 'KHH', '홍콩': 'HKG', '마카오': 'MFM',
    // 중국
    '상하이': 'SHA', '베이징': 'BJS', '칭다오': 'TAO', '하얼빈': 'HRB', '싼야': 'SYX',
    // 태평양/미주
    '괌': 'GUM', '사이판': 'SPN', '하와이': 'HNL', '호놀룰루': 'HNL', '밴쿠버': 'YVR',
    // 호주
    '시드니': 'SYD', '멜버른': 'MEL',
    // 유럽
    '파리': 'PAR', '런던': 'LON', '로마': 'ROM', '바르셀로나': 'BCN',
};

// 날짜 포맷 변환 (YYYY.MM.DD(요일) 또는 YYYY-MM-DD -> YYYYMMDD)
function formatDateForUrl(dateStr: string): string {
    if (!dateStr) return '';
    // 먼저 괄호 안 요일 제거: "2026.02.11(수)" -> "2026.02.11"
    const cleaned = dateStr.replace(/\([^)]*\)/g, '').trim();
    // YYYY.MM.DD 또는 YYYY-MM-DD 형식
    const longMatch = cleaned.match(/^(\d{4})[.-](\d{2})[.-](\d{2})/);
    if (longMatch) {
        return `${longMatch[1]}${longMatch[2]}${longMatch[3]}`;
    }
    // YY.MM.DD 형식
    const shortMatch = cleaned.match(/^(\d{2})\.(\d{2})\.(\d{2})/);
    if (shortMatch) {
        return `20${shortMatch[1]}${shortMatch[2]}${shortMatch[3]}`;
    }
    // 그 외: 숫자만 추출
    return cleaned.replace(/\D/g, '').slice(0, 8);
}

// 하나투어 예약 URL 생성 (도시코드 + depPlcDvCd='C' 사용)
function generateHanatourBookingUrl(flight: { departureCity: string; arrivalCity: string; departureDate: string; arrivalDate?: string }): string {
    // 도시명에서 공항코드 제거: "서울(ICN)" -> "서울", 공항코드 추출: "ICN"
    const extractCity = (cityStr: string) => {
        const match = cityStr.match(/^(.+?)\(([A-Z]{3})\)$/);
        if (match) return { name: match[1], code: match[2] };
        return { name: cityStr, code: '' };
    };

    const dep = extractCity(flight.departureCity);
    const arr = extractCity(flight.arrivalCity);

    // 도시명 매핑 우선, 없으면 공항코드를 그대로 사용
    const depCode = CITY_TO_HANATOUR[dep.name] || dep.code || 'SEL';
    const arrCode = CITY_TO_HANATOUR[arr.name] || arr.code || '';
    const depDate = formatDateForUrl(flight.departureDate);
    const retDate = flight.arrivalDate ? formatDateForUrl(flight.arrivalDate) : '';

    if (!arrCode || !depDate) {
        // 도시 코드를 찾지 못하면 프로모션 페이지로 폴백
        return 'https://hope.hanatour.com/promotion/plan/PM006698DD56';
    }

    // 왕복 (RT) 또는 편도 (OW) 결정
    const isRoundTrip = !!retDate && retDate !== depDate;

    // 하나투어 URL: 도시코드(C) 사용 필수 — 공항코드(A)는 0건 반환
    const searchCond: any = {
        itnrLst: [
            {
                depPlcDvCd: 'C',
                depPlcCd: depCode,
                arrPlcDvCd: 'C',
                arrPlcCd: arrCode,
                depDt: depDate
            }
        ],
        psngrCntLst: [{ ageDvCd: 'A', psngrCnt: 1 }],
        itnrTypeCd: isRoundTrip ? 'RT' : 'OW'
    };

    // 왕복이면 복귀 구간 추가
    if (isRoundTrip) {
        searchCond.itnrLst.push({
            depPlcDvCd: 'C',
            depPlcCd: arrCode,
            arrPlcDvCd: 'C',
            arrPlcCd: depCode,
            depDt: retDate
        });
    }

    return `https://hope.hanatour.com/trp/air/CHPC0AIR0200M200?searchCond=${encodeURIComponent(JSON.stringify(searchCond))}`;
}


/**
 * 하나투어 프로모션 페이지 크롤링 (PM0000113828)
 * PM006698DD56과 동일한 DOM 구조 (지역 탭 → 도시 탭 → card-wrap)
 */
async function scrapeHanatourPromotion(browser: any): Promise<Flight[]> {
    return scrapeHanatourPromoPage(browser, 'https://hope.hanatour.com/promotion/plan/PM0000113828', 'PROMO1');
}

/**
 * 하나투어 땡처리 항공 프로모션 페이지 크롤링 (PM006698DD56)
 */
async function scrapeHanatourLastMinutePromo(browser: any): Promise<Flight[]> {
    return scrapeHanatourPromoPage(browser, 'https://hope.hanatour.com/promotion/plan/PM006698DD56', 'PROMO2');
}

/**
 * 하나투어 프로모션 페이지 공통 크롤링 함수
 * 지역 탭(동남아, 일본 등) → 도시 탭(오사카, 후쿠오카 등) → card-wrap 개별 항공편 추출
 */
async function scrapeHanatourPromoPage(browser: any, url: string, label: string): Promise<Flight[]> {
    console.log(`\n하나투어 프로모션 [${label}] 크롤링 시작... (${url})`);

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        extraHTTPHeaders: {
            'Referer': 'https://www.google.com/',
            'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        },
    });

    const page = await context.newPage();
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    page.on('console', (msg: any) => console.log(`[${label}] ${msg.text()}`));

    const allFlights: Flight[] = [];
    const seenFlightKeys = new Set<string>();

    try {
        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
        });

        await page.waitForTimeout(3000);
        console.log(`[${label}] 프로모션 페이지 로드 완료`);

        // 땡처리 항공 섹션으로 스크롤
        await page.evaluate(() => {
            const promoMenu = document.querySelectorAll('.promo_menu');
            if (promoMenu[3]) {
                (promoMenu[3] as HTMLElement).click();
            }
        });
        await randomDelay(1, 3);

        // "더보기" 버튼 클릭하여 모든 도시 표시
        try {
            await page.click('.btn_fold_unfold');
            await page.waitForTimeout(500);
            console.log('더보기 버튼 클릭 완료');
        } catch (e) {
            console.log('더보기 버튼을 찾지 못했거나 이미 펼쳐져 있음');
        }

        // 지역 탭 목록 가져오기 (동남아, 일본, 미주/캐나다, 남태평양)
        const regionTabs = await page.$$('.promo_tabmenu_base.slide_type_swipe button');
        console.log(`지역 탭 수: ${regionTabs.length}`);

        // 각 지역 탭 순회
        for (let regionIdx = 0; regionIdx < regionTabs.length; regionIdx++) {
            try {
                // 지역 탭 클릭
                const regionButtons = await page.$$('.promo_tabmenu_base.slide_type_swipe button');
                if (regionButtons[regionIdx]) {
                    await regionButtons[regionIdx].click();
                    await randomDelay(1, 3);

                    const regionName = await regionButtons[regionIdx].innerText();
                    console.log(`\n${regionName} 지역 크롤링 중...`);

                    // "더보기" 버튼 다시 클릭 (지역 변경 후 접혀있을 수 있음)
                    try {
                        const foldBtn = await page.$('.btn_fold_unfold');
                        if (foldBtn) {
                            const btnText = await foldBtn.innerText();
                            if (btnText.includes('더보기')) {
                                await foldBtn.click();
                                await page.waitForTimeout(300);
                            }
                        }
                    } catch (e) { }

                    // 해당 지역의 도시 탭 목록 가져오기
                    const cityTabs = await page.$$('.tabmenu_list_wrap button, .swiper-slide button');
                    console.log(`도시 탭 수: ${cityTabs.length}`);

                    // 각 도시 탭 순회
                    for (let cityIdx = 0; cityIdx < cityTabs.length; cityIdx++) {
                        try {
                            // 도시 탭 클릭
                            const currentCityTabs = await page.$$('.tabmenu_list_wrap button, .swiper-slide button');
                            if (currentCityTabs[cityIdx]) {
                                await currentCityTabs[cityIdx].click();
                                await page.waitForTimeout(600);

                                const cityName = await currentCityTabs[cityIdx].innerText();

                                // "더보기" 버튼 반복 클릭하여 모든 항공권 로드
                                for (let loadMoreAttempt = 0; loadMoreAttempt < 5; loadMoreAttempt++) {
                                    try {
                                        // 먼저 스크롤해서 더보기 버튼이 보이게 함
                                        for (let scroll = 0; scroll < 3; scroll++) {
                                            await page.mouse.wheel(0, 800);
                                            await page.waitForTimeout(150);
                                        }

                                        // 더보기 버튼 찾기 및 클릭
                                        const moreButton = await page.$('.btn_fold_unfold');
                                        if (moreButton) {
                                            const btnText = await moreButton.innerText();
                                            if (btnText && btnText.includes('더보기')) {
                                                await moreButton.click();
                                                await page.waitForTimeout(500);
                                                console.log(`    ${cityName}: 더보기 클릭 (${loadMoreAttempt + 1}회)`);
                                            } else {
                                                break; // 더보기가 아니면 중단
                                            }
                                        } else {
                                            break; // 버튼이 없으면 중단
                                        }
                                    } catch (e) {
                                        break; // 에러 발생시 중단
                                    }
                                }

                                // 마지막으로 페이지 끝까지 스크롤
                                for (let scroll = 0; scroll < 10; scroll++) {
                                    await page.mouse.wheel(0, 500);
                                    await page.waitForTimeout(150);
                                }

                                // 해당 도시의 항공권 추출
                                const cityFlights = await page.evaluate((cityNameParam: string) => {
                                    const results: any[] = [];
                                    const items = document.querySelectorAll('.card-wrap');

                                    items.forEach((item, idx) => {
                                        try {
                                            // 항공사 추출
                                            const logoImg = item.querySelector('.logo img');
                                            let airline = '';
                                            if (logoImg) {
                                                airline = (logoImg as HTMLImageElement).alt || '';
                                            }
                                            // 텍스트에서도 항공사 찾기
                                            const text = item.textContent || '';
                                            if (!airline) {
                                                const airlineMatch = text.match(/(이스타항공|제주항공|진에어|티웨이항공|에어부산|대한항공|아시아나항공|피치항공|에어서울|에어로케이)/);
                                                airline = airlineMatch ? airlineMatch[1] : '';
                                            }

                                            // 날짜 추출 - .date 클래스 또는 텍스트 패턴
                                            const dateElements = item.querySelectorAll('.date');
                                            let departureDate = '';
                                            let arrivalDate = '';

                                            if (dateElements.length >= 2) {
                                                departureDate = dateElements[0].textContent?.trim() || '';
                                                arrivalDate = dateElements[1].textContent?.trim() || '';
                                            } else {
                                                // 텍스트에서 날짜 패턴 찾기
                                                const dateMatches = text.match(/(\d{4}\.\d{2}\.\d{2})\([^)]+\)/g);
                                                if (dateMatches && dateMatches.length >= 2) {
                                                    departureDate = dateMatches[0];
                                                    arrivalDate = dateMatches[1];
                                                }
                                            }

                                            // 가격 추출 - .price strong 또는 텍스트 패턴
                                            const priceElement = item.querySelector('.price strong');
                                            let price = 0;
                                            if (priceElement) {
                                                const priceText = priceElement.textContent?.replace(/[^0-9]/g, '') || '0';
                                                price = parseInt(priceText);
                                            } else {
                                                const priceMatch = text.match(/([\d,]+)원/);
                                                price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : 0;
                                            }

                                            // 출발지 추출 (서울, 부산, 대구 등)
                                            // 항공사명 제거 후 출발지 찾기 (제주항공의 '제주'가 출발지로 잡히는 버그 방지)
                                            let departureCity = '서울';
                                            const textWithoutAirline = text.replace(/(이스타항공|제주항공|진에어|티웨이항공|에어부산|대한항공|아시아나항공|피치항공|에어서울|에어로케이)/g, '');
                                            const deptMatch = textWithoutAirline.match(/(서울|인천|부산|대구|청주|청주시|제주)/);
                                            if (deptMatch) {
                                                departureCity = deptMatch[1] === '청주시' ? '청주' : deptMatch[1];
                                            }

                                            // 도착지는 파라미터로 전달된 도시명 사용
                                            const arrivalCity = cityNameParam.replace(/\([^)]+\)/, '').trim();

                                            if (price > 0 && departureDate) {
                                                results.push({
                                                    airline,
                                                    departureCity,
                                                    arrivalCity,
                                                    departureDate,
                                                    arrivalDate,
                                                    price,
                                                    idx
                                                });
                                            }
                                        } catch (e) { }
                                    });

                                    return results;
                                }, cityName);

                                // 중복 제거하면서 flights 배열에 추가
                                for (const f of cityFlights) {
                                    const flightKey = `${f.departureCity}-${f.arrivalCity}-${f.departureDate}-${f.price}`;
                                    if (!seenFlightKeys.has(flightKey)) {
                                        seenFlightKeys.add(flightKey);
                                        allFlights.push({
                                            id: `hanatour-promo-${regionIdx}-${cityIdx}-${f.idx}`,
                                            source: 'hanatour',
                                            airline: f.airline,
                                            departure: {
                                                city: f.departureCity,
                                                airport: '',
                                                date: f.departureDate,
                                                time: '',
                                            },
                                            arrival: {
                                                city: f.arrivalCity,
                                                airport: '',
                                                date: f.arrivalDate,
                                                time: '',
                                            },
                                            price: f.price,
                                            currency: 'KRW',
                                            link: generateHanatourBookingUrl({ departureCity: f.departureCity, arrivalCity: f.arrivalCity, departureDate: f.departureDate, arrivalDate: f.arrivalDate }),
                                            region: getRegionByCity(f.arrivalCity),
                                        });
                                    }
                                }

                                console.log(`  ${cityName}: ${cityFlights.length}개 발견 (현재 총 ${allFlights.length}개)`);
                            }
                        } catch (cityError) {
                            console.log(`  도시 탭 ${cityIdx} 크롤링 오류:`, cityError);
                        }
                    }
                }
            } catch (regionError) {
                console.log(`지역 탭 ${regionIdx} 크롤링 오류:`, regionError);
            }
        }

        console.log(`\n[${label}] 프로모션 페이지 총: ${allFlights.length}개 항공권 발견`);

    } catch (error) {
        console.error(`[${label}] 프로모션 페이지 크롤링 실패:`, error);
    }

    await context.close();
    return allFlights;
}

/**
 * 하나투어 땡처리 항공권 크롤링 (일반 페이지 + 프로모션 페이지)
 */
export async function scrapeHanatour(): Promise<Flight[]> {
    console.log('하나투어 크롤링 시작...');

    const browser = await chromium.launch({
        headless: !!process.env.CI,
    });

    let allFlights: Flight[] = [];

    try {
        // 1. 일반 땡처리 페이지 크롤링
        const regularFlights = await scrapeHanatourRegular(browser);
        allFlights.push(...regularFlights);

        // 2. 프로모션 페이지 (PM0000113828) - 비활성화
        // const promoFlights1 = await scrapeHanatourPromotion(browser);
        // allFlights.push(...promoFlights1);

        // 3. 땡처리 프로모션 페이지 (PM006698DD56) - 비활성화
        // const promoFlights2 = await scrapeHanatourLastMinutePromo(browser);
        // allFlights.push(...promoFlights2);

        // 중복 제거 (같은 출발지-도착지-날짜-가격 조합)
        const uniqueFlights = allFlights.filter((flight, index, self) =>
            index === self.findIndex((f) => (
                f.departure.city === flight.departure.city &&
                f.arrival.city === flight.arrival.city &&
                f.departure.date === flight.departure.date &&
                f.price === flight.price
            ))
        );



        console.log(`\n하나투어 전체 크롤링 완료: 총 ${uniqueFlights.length}개 항공권 (중복 제거 전: ${allFlights.length}개)`);

        // 도시별 통계 생성 및 로깅
        const cityStats: { [city: string]: number } = {};
        uniqueFlights.forEach(flight => {
            const city = flight.arrival.city;
            cityStats[city] = (cityStats[city] || 0) + 1;
        });

        logCrawlResults('hanatour', uniqueFlights.length, undefined, cityStats);

        return uniqueFlights;

    } catch (error) {
        console.error('하나투어 크롤링 실패:', error);
        return allFlights;
    } finally {
        await browser.close();
    }
}

/**
 * 하나투어 일반 땡처리 페이지 크롤링
 * URL: https://www.hanatour.com/trp/air/CHPC0AIR0233M200
 */
async function scrapeHanatourRegular(browser: any): Promise<Flight[]> {
    console.log('\n하나투어 일반 페이지 크롤링 시작...');

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        extraHTTPHeaders: {
            'Referer': 'https://www.google.com/',
            'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        },
    });

    const page = await context.newPage();
    page.on('console', (msg: any) => console.log(`[REGULAR] ${msg.text()}`));
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    const flights: Flight[] = [];
    let totalFlights = 0;

    try {
        await page.goto('https://www.hanatour.com/trp/air/CHPC0AIR0233M200', {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
        });

        await page.waitForTimeout(3000);
        console.log('일반 페이지 로드 완료');

        // 각 출발 도시 탭별로 크롤링
        for (const tab of DEPARTURE_TABS) {
            console.log(`\n=== ${tab.name} 출발 크롤링 ===`);

            try {
                const tabElement = page.locator(`.js_tabs.v-tabs.type1.special > ul.tabs > li > a:has-text("${tab.name}")`).first();
                if (await tabElement.isVisible()) {
                    await tabElement.click();
                } else {
                    console.log(`[SKIP] ${tab.name} 탭을 찾을 수 없습니다.`);
                    continue;
                }

                await randomDelay(3, 5);

                try {
                    await page.waitForSelector('.flight_list.special > ul > li', { timeout: 5000 });
                } catch (e) {
                    console.log(`${tab.name}: 항공권이 없거나 로딩 시간 초과`);
                    continue;
                }

                const tabFlights = await page.evaluate((tabName: string) => {
                    const cards = document.querySelectorAll('.flight_list.special > ul > li');
                    const results: any[] = [];

                    // Vue.js farLst에서 fareId 추출 시도
                    let fareLst: any[] = [];
                    try {
                        const allElements = Array.from(document.querySelectorAll('*'));
                        for (const el of allElements) {
                            const vue = (el as any).__vue__;
                            if (vue && vue.$data && Array.isArray(vue.$data.farLst) && vue.$data.farLst.length > 0) {
                                fareLst = vue.$data.farLst;
                                break;
                            }
                        }
                    } catch (e) {
                        console.log('fareId 추출 실패:', e);
                    }

                    cards.forEach((card, index) => {
                        try {
                            const rows = card.querySelectorAll('.fl .row');
                            if (rows.length < 2) return;

                            const outboundRow = rows[0];
                            const inboundRow = rows[1];

                            const airline = outboundRow.querySelector('.air_name')?.textContent?.trim() || '';
                            const cities = outboundRow.querySelectorAll('.city');
                            const departureCity = cities[0]?.textContent?.trim() || '';
                            const arrivalCity = cities[1]?.textContent?.trim() || '';
                            const departureDate = outboundRow.querySelector('.cell.date')?.textContent?.trim() || '';
                            const returnDate = inboundRow.querySelector('.cell.date')?.textContent?.trim() || '';

                            const priceElement = card.querySelector('.price');
                            const priceText = priceElement?.textContent?.trim() || '';
                            const price = parseInt(priceText.replace(/[^0-9]/g, '')) || 0;

                            const timeElements = card.querySelectorAll('.time');
                            let depTime = '';
                            let arrTime = '';

                            if (timeElements.length >= 2) {
                                const depTimeMatch = timeElements[0].textContent?.match(/(\d{2}:\d{2})/);
                                const arrTimeMatch = timeElements[1].textContent?.match(/(\d{2}:\d{2})/);
                                depTime = depTimeMatch ? depTimeMatch[1] : '';
                                arrTime = arrTimeMatch ? arrTimeMatch[1] : '';
                            }

                            // fareId로 다이렉트 예약 링크 생성
                            let fullLink = 'https://www.hanatour.com/trp/air/CHPC0AIR0233M200';
                            if (fareLst[index] && fareLst[index].fareId) {
                                const fareId = encodeURIComponent(fareLst[index].fareId);
                                const psngrCntLst = encodeURIComponent(JSON.stringify([{ ageDvCd: 'A', psngrCnt: 1 }]));
                                const selectedCard = encodeURIComponent('{}');
                                fullLink = `https://www.hanatour.com/com/pmt/CHPC0PMT0011M200?fareId=${fareId}&psngrCntLst=${psngrCntLst}&selectedCard=${selectedCard}`;
                            }

                            if (price > 0 && arrivalCity) {
                                // fareId에서 availCnt 추출
                                let availCnt = 0;
                                if (fareLst[index] && fareLst[index].availCnt) {
                                    availCnt = parseInt(fareLst[index].availCnt) || 0;
                                }

                                results.push({
                                    id: `hanatour-regular-${tabName}-${index}`,
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
                                        date: returnDate,
                                        time: arrTime,
                                    },
                                    price: price,
                                    currency: 'KRW',
                                    link: fullLink,
                                    availableSeats: availCnt || undefined,
                                });
                            }
                        } catch (error) {
                            console.error(`카드 ${index} 파싱 오류:`, error);
                        }
                    });

                    return results;
                }, tab.name);

                const processedFlights = tabFlights.map((f: any) => {
                    // 도시명에서 공항코드 추출 (예: "서울(ICN)" -> "서울")
                    const cleanCity = (city: string) => city.replace(/\([^)]+\)/, '').trim();
                    const depCity = cleanCity(f.departure.city);
                    const arrCity = cleanCity(f.arrival.city);

                    // 링크는 page.evaluate에서 fareId 기반으로 생성됨
                    const link = f.link;

                    // fareId 만료 시 대비 검색 URL 생성 (searchLink)
                    const searchLink = generateHanatourBookingUrl({
                        departureCity: f.departure.city,
                        arrivalCity: f.arrival.city,
                        departureDate: f.departure.date,
                        arrivalDate: f.arrival.date,
                    });

                    return {
                        ...f,
                        link: link,
                        searchLink: searchLink,
                        region: getRegionByCity(arrCity)
                    };
                });
                flights.push(...processedFlights);
                totalFlights += tabFlights.length;
                console.log(`${tab.name}: ${tabFlights.length}개 항목 발견 (누적: ${totalFlights}개)`);

                await page.waitForTimeout(500);

            } catch (error) {
                console.error(`${tab.name} 탭 오류:`, error instanceof Error ? error.message : error);
            }
        }

        console.log(`일반 페이지 크롤링 완료: ${flights.length}개 항공권`);

    } catch (error) {
        console.error('일반 페이지 크롤링 실패:', error);
    }

    return flights;
}
