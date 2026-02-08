import { chromium } from 'playwright';
import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';

/**
 * 노랑풍선 땡처리 항공권 크롤링
 * URL: https://fly.ybtour.co.kr/booking/findDiscountAir.lts?efcTpCode=INV&efcCode=INV
 */

// 모든 지역과 도시 목록
const REGIONS = [
    {
        name: '일본',
        cities: [
            '마츠야마', '나가사키', '오사카(간사이)', '다카마쓰', '후쿠오카',
            '삿포로(치토세)', '나고야', '도쿄(나리타)', '오키나와', '요나고'
        ]
    },
    {
        name: '아시아',
        cities: [
            '대만(타이페이)', '방콕', '세부', '방콕(돈무앙)', '다낭',
            '칼리보(보라카이)', '바탐(인도네시아)', '보홀', '푸꾸옥', '치앙마이',
            '코타키나발루', '하노이', '마닐라', '발리(덴파사)', '나트랑(깜랑)',
            '마나도', '싱가포르', '클락', '푸켓', '마카오'
        ]
    },
    {
        name: '괌/사이판',
        cities: ['사이판', '괌']
    },
    {
        name: '남태평양',
        cities: ['시드니', '브리즈번']
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
                // 지역 탭 클릭 (visible한 것만 + 정확한 텍스트, 공백 허용)
                // 문제: 탭 텍스트에 줄바꿈/공백이 포함되어 있어 ^name$ 정규식에 매칭되지 않음
                // 해결: 앞뒤 공백을 허용하는 정규식 사용 (^\s*name\s*$)
                const regionTab = page.locator('a').filter({
                    hasText: new RegExp(`^\\s*${region.name.replace(/[()]/g, '\\$&')}\\s*$`)
                });

                // 보이는 것 중 첫 번째 클릭
                let clicked = false;
                const count = await regionTab.count();
                for (let i = 0; i < count; i++) {
                    const tab = regionTab.nth(i);
                    if (await tab.isVisible()) {
                        await tab.click({ timeout: 5000 });
                        clicked = true;
                        break;
                    }
                }

                if (!clicked) {
                    console.log(`[SKIP] ${region.name} 탭을 찾을 수 없거나 보이지 않음`);
                    continue;
                }

                await page.waitForTimeout(1000);

                // 각 도시별로 크롤링
                for (const city of region.cities) {
                    console.log(`${city} 검색 중...`);

                    try {
                        // 도시 버튼 클릭 (visible한 것만 + 정확한 컨테이너 지정)
                        // 문제: 상단 메뉴의 숨겨진 링크와 도시 버튼의 텍스트가 같아서 .first()가 오동작함
                        // 해결: #div_citylist 내부의 a 태그 중 onclick이 getFare로 시작하는 것만 찾음

                        // 도시 목록 컨테이너가 확실히 로드될 때까지 대기
                        await page.waitForSelector('#div_citylist', { state: 'visible', timeout: 5000 }).catch(() => { });

                        const cityButton = page.locator('#div_citylist a').filter({
                            hasText: new RegExp(`^${city.replace(/[()]/g, '\\$&')}$`) // 정확한 텍스트 매칭 (특수문자 이스케이프)
                        }).filter({
                            has: page.locator('xpath=self::*[starts-with(@onclick, "getFare")]') // onclick 속성 확인
                        }).first();

                        // 버튼 존재 및 가시성 확인
                        const isVisible = await cityButton.isVisible().catch(() => false);

                        if (!isVisible) {
                            console.log(`[SKIP] ${city} 버튼을 찾을 수 없거나 보이지 않음`);
                            continue;
                        }

                        // 스크롤 후 클릭 (안전장치)
                        await cityButton.scrollIntoViewIfNeeded();
                        await cityButton.click({ timeout: 5000 });

                        // 로딩 대기
                        await page.waitForTimeout(2000);

                        // 테이블이 로드될 때까지 대기
                        await page.waitForSelector('table tbody tr', { timeout: 5000 });

                        // 테이블 데이터 추출

                        // [DEBUG] First row hidden inputs extraction
                        if (totalFlights === 0) {
                            try {
                                const debugInputs = await page.evaluate(() => {
                                    const row = document.querySelector('table tbody tr');
                                    if (!row) return null;
                                    const inputs = Array.from(row.querySelectorAll('input[type="hidden"]'));
                                    return inputs.map(i => ({ name: (i as HTMLInputElement).name, value: (i as HTMLInputElement).value }));
                                });
                                if (debugInputs) {
                                    console.log('[DEBUG] Writing debug inputs to file');
                                    const fs = await import('fs');
                                    fs.writeFileSync('debug_ybtour_inputs.json', JSON.stringify(debugInputs, null, 2));
                                }
                            } catch (e) {
                                console.error('[DEBUG] Failed to save debug inputs:', e);
                            }
                        }

                        const cityFlights = await page.evaluate((cityName) => {
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

                                    // 세부 데이터 추출 (Hidden Input)
                                    // 파라미터 매핑:
                                    // invCode -> efmAffId
                                    // inhId -> efmAffFareGroupId
                                    // inpId -> efmAfsId

                                    const invCodeInput = row.querySelector('input[name="efmAffId"]');
                                    const inhIdInput = row.querySelector('input[name="efmAffFareGroupId"]');
                                    const inpIdInput = row.querySelector('input[name="efmAfsId"]');

                                    const invCode = invCodeInput ? (invCodeInput as HTMLInputElement).value : '';
                                    const inhId = inhIdInput ? (inhIdInput as HTMLInputElement).value : '';
                                    const inpId = inpIdInput ? (inpIdInput as HTMLInputElement).value : '';

                                    // 날짜 포맷 변환 (YYYY-MM-DD -> YYYYMMDD)
                                    const inhDepDate = depDate.replace(/-/g, '');

                                    // 예약 링크 수정 (2025-02-08)
                                    // 딥링크(findRtPaxInfo.lts)가 로그인 리다이렉트 시 파라미터를 유실하거나 에러 페이지를 반환함.
                                    // 따라서 검색 결과 페이지로 이동하여 사용자가 직접 선택하도록 유도하는 Fallback 링크 사용.
                                    // efcCityCode 파라미터를 추가하여 해당 도시 필터링 시도.
                                    // hidden input 'arrCity' 값을 사용 (예: BKK, NRT 등)
                                    const arrCityInput = row.querySelector('input[name="arrCity"]');
                                    const arrCityCode = arrCityInput ? (arrCityInput as HTMLInputElement).value : '';

                                    let link = `https://fly.ybtour.co.kr/booking/findDiscountAir.lts?efcTpCode=INV&efcCode=INV`; // Basic Fallback

                                    if (arrCityCode) {
                                        link += `&efcCityCode=${arrCityCode}`;
                                    }

                                    // Legacy Deep Link Logic (Commented out as it fails)
                                    /*
                                    if (invCode && inhId) {
                                        const paramValue = `invCode=${invCode}|inhId=${inhId}|inpId=${inpId}|inhDepDate=${inhDepDate}|invClass=Y|adt=1|chd=0|inf=0|travelPaxInfo=Y|dscFlag=Y&chdInd=Y&infInd=Y&minpax=1&maxpax=9&rvInd=V`;
                                        link = `https://fly.ybtour.co.kr/booking/findRtPaxInfo.lts?paramValue=${encodeURIComponent(paramValue)}`;
                                    }
                                    */
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
                        }, city);

                        const processedFlights = cityFlights.map((f: any) => ({
                            ...f,
                            region: getRegionByCity(f.arrival.city)
                        }));
                        flights.push(...processedFlights);
                        totalFlights += cityFlights.length;
                        console.log(`${city}: ${cityFlights.length}개 항목 발견 (누적: ${totalFlights}개)`);

                        // 다음 도시 검색 전 잠시 대기
                        await page.waitForTimeout(500);

                    } catch (error) {
                        console.error(`${city} 검색 오류:`, error instanceof Error ? error.message : error);
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

    return flights;
}
