import { chromium } from 'playwright';
import { Flight } from '@/types/flight';
import { ScrapeCompleteness } from './scrape-errors';
import { getRegionByCity } from '@/lib/utils/region-mapper';
import { buildStableFlightId } from '@/lib/utils/flight-helpers';
import { assertNoSourceAccessBlockText, SourceResponseError } from './source-response';
import { classifySourceAccessRestriction } from '../source-circuit';
// logCrawlResults moved to crawl-all.ts

const randomDelay = (min: number, max: number) =>
    new Promise(r => setTimeout(r, (Math.random() * (max - min) + min) * 1000));

/**
 * 하나투어 땡처리 항공권 크롤링
 * URL: https://www.hanatour.com/trp/air/CHPC0AIR0233M200
 */

// 출발 도시 탭 목록
// 탭이 실패했을 때 '원래 이 탭에 항공권이 있었는가'를 판정하려면 출발 공항으로 봐야 한다.
// 예전에는 탭 이름을 도시 표기에 대조했는데, 캐시의 출발 도시는 '서울(ICN)'이라
// '인천'과 겹치지 않았다. 가장 큰 인천/김포 탭이 통째로 빠져도 늘 '정상'으로 넘어갔다.
const DEPARTURE_TABS = [
    { name: '인천/김포', index: 0, airports: ['ICN', 'GMP'] },
    { name: '청주', index: 1, airports: ['CJJ'] },
    { name: '부산', index: 2, airports: ['PUS'] },
    { name: '대구/제주', index: 3, airports: ['TAE', 'CJU'] },
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
 * 하나투어 땡처리 항공권 크롤링 (일반 페이지)
 */
export async function scrapeHanatour(prevFlights: any[] = []): Promise<Flight[]> {
    console.log('하나투어 크롤링 시작...');

    const browser = await chromium.launch({
        headless: !!process.env.CI,
    });

    let allFlights: Flight[] = [];

    try {
        // 일반 땡처리 페이지 크롤링
        const regularFlights = await scrapeHanatourRegular(browser, prevFlights);
        allFlights.push(...regularFlights);

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

        // logCrawlResults moved to crawl-all.ts

        return uniqueFlights;

    } catch (error) {
        console.error('하나투어 크롤링 실패:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

/**
 * 하나투어 일반 땡처리 페이지 크롤링
 * URL: https://www.hanatour.com/trp/air/CHPC0AIR0233M200
 */
async function scrapeHanatourRegular(browser: any, prevFlights: any[] = []): Promise<Flight[]> {
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
        const landingResponse = await page.goto('https://www.hanatour.com/trp/air/CHPC0AIR0233M200', {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
        });
        if (landingResponse && !landingResponse.ok()) {
            throw new SourceResponseError(
                'http-status',
                `하나투어 일반 페이지 HTTP ${landingResponse.status()}`,
                landingResponse.status(),
                landingResponse.headers()['content-type'] || '',
                undefined,
                landingResponse.url(),
            );
        }

        await page.waitForTimeout(3000);
        const landingText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
        assertNoSourceAccessBlockText('하나투어 일반 페이지', landingText, page.url());
        console.log('일반 페이지 로드 완료');

        // 출발 탭 하나가 안 열리면 그 출발지 항공권이 통째로 빠진 채 정상 종료한다
        const completeness = new ScrapeCompleteness('하나투어', 'hanatour', prevFlights);

        // 각 출발 도시 탭별로 크롤링
        for (const tab of DEPARTURE_TABS) {
            console.log(`\n=== ${tab.name} 출발 크롤링 ===`);

            try {
                const tabElement = page.locator(`.js_tabs.v-tabs.type1.special > ul.tabs > li > a:has-text("${tab.name}")`).first();
                if (await tabElement.isVisible()) {
                    await tabElement.click();
                } else {
                    completeness.recordFailure(
                        `${tab.name} 출발 탭`,
                        f => tab.airports.includes(f.departure?.airport || ''),
                    );
                    continue;
                }

                await randomDelay(3, 5);

                try {
                    await page.waitForSelector('.flight_list.special > ul > li', { timeout: 5000 });
                } catch (e) {
                    // '진짜 0건'과 '로딩 실패'를 한 문구로 묶어 두면 사람 눈으로도 구분되지 않는다.
                    // 직전 크롤에 이 탭 항공권이 있었다면 고장으로 본다.
                    console.log(`${tab.name}: 목록이 뜨지 않았습니다 (5초 대기 초과)`);
                    completeness.recordFailure(
                        `${tab.name} 출발 목록`,
                        f => tab.airports.includes(f.departure?.airport || ''),
                    );
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

                    // farLst와 화면 카드를 순번으로 짝지어 왔는데, 두 목록이 같은 순서라는
                    // 보장이 없다. 목록에 구분용 항목이 하나만 섞여도 전체가 한 칸씩 밀려서,
                    // 카드에 적힌 가격과 예약 버튼이 여는 상품이 달라진다. 사용자가 눌러 보고서야
                    // 아는 종류의 오류라 가장 비싸다. 길이가 어긋나면 짝짓기를 포기하고
                    // 검색 페이지로 보낸다 — 한 번 더 고르게 하는 편이 틀린 상품을 여는 것보다 낫다.
                    const fareAligned = fareLst.length === cards.length;
                    if (fareLst.length > 0 && !fareAligned) {
                        console.log(`[하나투어] fareId 정렬 불일치 (카드 ${cards.length}개 vs 운임 ${fareLst.length}개) — 예약 링크를 검색 페이지로 보냅니다`);
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
                            if (fareAligned && fareLst[index] && fareLst[index].fareId) {
                                const fareId = encodeURIComponent(fareLst[index].fareId);
                                const psngrCntLst = encodeURIComponent(JSON.stringify([{ ageDvCd: 'A', psngrCnt: 1 }]));
                                const selectedCard = encodeURIComponent('{}');
                                fullLink = `https://www.hanatour.com/com/pmt/CHPC0PMT0011M200?fareId=${fareId}&psngrCntLst=${psngrCntLst}&selectedCard=${selectedCard}`;
                            }

                            if (price > 0 && arrivalCity && departureDate && returnDate) {
                                // fareId에서 availCnt 추출
                                let availCnt = 0;
                                if (fareAligned && fareLst[index] && fareLst[index].availCnt) {
                                    availCnt = parseInt(fareLst[index].availCnt) || 0;
                                }

                                results.push({
                                    // ID는 page.evaluate 밖(Node.js)에서 만든다. tsx가 브라우저에 없는
                                    // __name 보조 함수를 삽입할 수 있어 여기서는 계산하지 않는다.
                                    id: '',
                                    source: 'hanatour',
                                    airline: airline,
                                    departure: {
                                        city: departureCity,
                                        // 도시명에 붙은 IATA 코드를 그대로 쓴다 ("서울(ICN)" → ICN).
                                        // 비워두면 네이버 최저가 매칭 키를 만들지 못한다.
                                        airport: (departureCity.match(/\(([A-Z]{3})\)/) || [])[1] || '',
                                        date: departureDate,
                                        time: depTime,
                                    },
                                    arrival: {
                                        city: arrivalCity,
                                        airport: (arrivalCity.match(/\(([A-Z]{3})\)/) || [])[1] || '',
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
                        id: buildStableFlightId('hanatour', [
                            f.airline,
                            f.departure.city,
                            f.arrival.city,
                            f.departure.date,
                            f.arrival.date,
                            f.price,
                            f.departure.time,
                        ]),
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
                if (classifySourceAccessRestriction(error)) throw error;
                console.error(`${tab.name} 탭 오류:`, error instanceof Error ? error.message : error);
            }
        }

        console.log(`일반 페이지 크롤링 완료: ${flights.length}개 항공권`);
        completeness.assertComplete(flights.length);

    } catch (error) {
        console.error('일반 페이지 크롤링 실패:', error);
        // 불완전 수집은 호출부가 알아야 이전 캐시를 지킬 수 있으므로 삼키지 않는다
        throw error;
    }

    return flights;
}
