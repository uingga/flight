
import { chromium } from 'playwright';
import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';
import { ScrapeCompleteness } from './scrape-errors';
// logCrawlResults moved to crawl-all.ts

const randomDelay = (min: number, max: number) =>
    new Promise(r => setTimeout(r, (Math.random() * (max - min) + min) * 1000));

const REGIONS = [
    { code: 'AS', name: '아시아' },
    { code: 'JA', name: '일본' },
    { code: 'CH', name: '중국' },
    { code: 'EU', name: '유럽' },
    { code: 'HN', name: '남태평양' },
    { code: 'US', name: '미주' },
    { code: 'GS', name: '괌/사이판' },
];

export async function scrapeOnlineTour(prevFlights: any[] = []): Promise<Flight[]> {
    console.log('온라인투어 크롤링 시작...');
    const browser = await chromium.launch({ headless: true });
    const flights: Flight[] = [];
    // 지역 페이지·도시 목록이 조용히 실패하면 결과가 반쪽이 된다
    // (2026-08-20 오후: 81건→13건, 13개 도시→6개). 실패 구간을 모아 끝에서 판정한다.
    const completeness = new ScrapeCompleteness('온라인투어', 'onlinetour', prevFlights);

    try {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            extraHTTPHeaders: {
                'Referer': 'https://www.google.com/',
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
            },
        });
        const page = await context.newPage();
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));

        // 1. Visit Main List Page to get initialized
        await page.goto('https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList', { timeout: 30000 });

        // 2. Iterate Regions
        for (const region of REGIONS) {
            console.log(`\n=== ${region.name} (${region.code}) 크롤링 ===`);

            try {
                // Navigate to Region
                // airSect 파라미터 제거 - 페이지가 도시별로 적절한 출발 공항을 자동 선택하도록 함
                await page.goto(`https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList?TabGubun=${region.code}`, { timeout: 30000 });

                // 도시 목록이 로드될 때까지 대기
                await randomDelay(2, 4);
                try {
                    await page.waitForSelector('input[name="city"]', { timeout: 5000 });
                } catch (e) {
                    completeness.recordFailure(
                        `${region.name} 지역 도시 목록`,
                        f => f.region === region.name || getRegionByCity(f.arrival?.city || '') === region.name,
                    );
                    continue;
                }

                // Get Cities in this Region
                const cities = await page.evaluate(() => {
                    const params: { code: string, name: string }[] = [];
                    // 더 유연한 셀렉터 사용
                    document.querySelectorAll('input[name="city"]').forEach(el => {
                        const code = el.getAttribute('onclick')?.match(/goSelectedCity\('([^']+)'/)?.[1];
                        const name = el.nextElementSibling?.textContent?.trim() ||
                            el.closest('label')?.querySelector('em')?.textContent?.trim();
                        if (code && name) {
                            params.push({ code, name });
                        }
                    });
                    return params;
                });

                console.log(`발견된 도시: ${cities.length}개 - ${cities.map(c => c.name).join(', ')}`);

                // 3. Iterate Cities
                for (const city of cities) {
                    console.log(`  - ${city.name} (${city.code}) 검색 중...`);

                    try {
                        // airSect 파라미터 제거 - 하네다 등 김포출발 전용 노선도 수집 가능
                        const cityUrl = `https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList?TabGubun=${region.code}&SelectedCityCd=${city.code}`;
                        await page.goto(cityUrl, { timeout: 30000 });

                        // Explicit wait for data loading (AJAX) - 증가된 대기 시간
                        await randomDelay(3, 5);

                        // Wait for list with retry logic
                        let listLoaded = false;
                        for (let retry = 0; retry < 3; retry++) {
                            try {
                                // Check #data_list first
                                await page.waitForSelector('#data_list', { timeout: 5000 });

                                // Check content
                                const listHtml = await page.$eval('#data_list', el => el.innerHTML);
                                if (listHtml.trim().length < 10) {
                                    console.log(`    ${city.name}: #data_list 비어있음, 재시도 ${retry + 1}/3`);
                                    await page.waitForTimeout(2000);
                                    continue;
                                }

                                await page.waitForSelector('#data_list > li.item', { timeout: 5000 });
                                listLoaded = true;
                                break;
                            } catch (e) {
                                console.log(`    ${city.name}: 목록 로드 시도 ${retry + 1}/3 실패`);
                                await page.waitForTimeout(2000);
                            }
                        }

                        if (!listLoaded) {
                            await page.screenshot({ path: `debug_onlinetour_fail_${city.code}.png` }).catch(() => { });
                            completeness.recordFailure(
                                `${city.name}(${city.code}) 목록`,
                                f => f.arrival?.airport === city.code,
                            );
                            continue;
                        }

                        // Load more if button exists (optional, limit for speed)
                        /*
                        try {
                            const moreBtn = await page.$('#btn_more');
                            if (moreBtn && await moreBtn.isVisible()) {
                                await moreBtn.click();
                                await randomDelay(1, 3);
                            }
                        } catch(e) {} 
                        */

                        // 현재 페이지의 출발 공항 확인 (인천출발/김포출발/부산출발)
                        const departureAirportInfo = await page.evaluate(() => {
                            // 방법 1: 선택된 라디오 버튼의 value 확인 (가장 정확함)
                            const checkedInput = document.querySelector('input[name="airsect"]:checked') as HTMLInputElement;
                            if (checkedInput) {
                                const airportCode = checkedInput.value; // GMP, ICN, PUS
                                const label = checkedInput.closest('label')?.querySelector('em')?.textContent?.trim() || '';
                                const cityName = label.replace('출발', '').trim(); // "김포출발" -> "김포"
                                return { airport: airportCode, city: cityName || (airportCode === 'GMP' ? '김포' : airportCode === 'PUS' ? '부산' : '인천') };
                            }

                            // 방법 2: 활성화된 버튼 텍스트로 추론 (fallback)
                            const activeLabel = document.querySelector('label.choice_type3 input:checked + em, .btn_sect.on');
                            const labelText = activeLabel?.textContent?.trim() || '';

                            if (labelText.includes('김포')) return { airport: 'GMP', city: '김포' };
                            if (labelText.includes('부산')) return { airport: 'PUS', city: '부산' };
                            return { airport: 'ICN', city: '인천' };
                        });

                        console.log(`    출발공항: ${departureAirportInfo.city} (${departureAirportInfo.airport})`);

                        // Extract Data
                        const items = await page.evaluate((args) => {
                            const { regionName, cityName, cityCode, depAirport, depCity, crawlYear, crawlMonth } = args as { regionName: string, cityName: string, cityCode: string, depAirport: string, depCity: string, crawlYear: number, crawlMonth: number };

                            // 페이지가 MM-DD만 주기 때문에 연도를 우리가 붙여야 한다.
                            // 예전에는 '2026'이 문자열로 박혀 있었다. 온라인투어는 한 달 앞까지
                            // 노출하므로 12월 크롤에서 1월 출발편을 만나면 한 해 전으로 기록되고,
                            // 그 표들은 만료 필터에 전부 걸려 조용히 사라진다.
                            const withYear = (mmdd: string | undefined): string => {
                                if (!mmdd) return '';
                                const month = Number(mmdd.slice(0, 2));
                                if (!month) return '';
                                // 지금보다 이른 달이면 해가 넘어간 것이다 (12월에 보는 1월 출발편)
                                const year = month < crawlMonth ? crawlYear + 1 : crawlYear;
                                return `${year}-${mmdd}`;
                            };
                            const results: any[] = [];
                            const listItems = document.querySelectorAll('#data_list > li.item');

                            if (listItems.length > 0) {
                            }

                            listItems.forEach((item, idx) => {
                                try {
                                    const airline = item.querySelector('.cell1 em')?.textContent?.trim() || '';

                                    // Path: ICN -> ARR -> ICN (Round Trip)
                                    // Row 1: Outbound, Row 2: Inbound
                                    const rows = item.querySelectorAll('.cell2 dl.path dd');
                                    if (rows.length < 2) {
                                        return;
                                    }

                                    const outboundRow = rows[0];
                                    const inboundRow = rows[1];

                                    // 페이지에서 추출한 도시명 (참고용)
                                    // :first-child/:last-child는 .city 뒤에 다른 요소가 붙는 레이아웃에서
                                    // 출발지를 도착지로 잘못 집어내므로 인덱스로 직접 고른다.
                                    const outboundCities = outboundRow.querySelectorAll('.city');
                                    const pageDepCity = outboundCities[0]?.querySelector('em')?.textContent?.trim() || depCity;
                                    const pageArrCity = outboundCities.length > 1
                                        ? outboundCities[outboundCities.length - 1]?.querySelector('em')?.textContent?.trim()
                                        : '';
                                    // 도착지가 출발지와 같거나 비어 있으면 탭에서 선택한 도시명을 신뢰한다.
                                    const arrCity = (pageArrCity && pageArrCity !== pageDepCity) ? pageArrCity : cityName;

                                    // Inline all datetimes to avoid ReferenceError with helpers
                                    const t1 = outboundRow.querySelectorAll('.city')[0]?.querySelector('time')?.textContent || '';
                                    const d1 = {
                                        d: withYear(t1.match(/(\d{2}-\d{2})/)?.[1]),
                                        t: t1.match(/(\d{2}:\d{2})/)?.[1] || ''
                                    };

                                    const t2 = outboundRow.querySelectorAll('.city')[1]?.querySelector('time')?.textContent || '';
                                    const d2 = {
                                        d: withYear(t2.match(/(\d{2}-\d{2})/)?.[1]),
                                        t: t2.match(/(\d{2}:\d{2})/)?.[1] || ''
                                    };

                                    const outDep = { date: d1.d, time: d1.t };
                                    const outArr = { date: d2.d, time: d2.t };

                                    const t3 = inboundRow.querySelectorAll('.city')[0]?.querySelector('time')?.textContent || '';
                                    const d3 = {
                                        d: withYear(t3.match(/(\d{2}-\d{2})/)?.[1]),
                                        t: t3.match(/(\d{2}:\d{2})/)?.[1] || ''
                                    };

                                    const t4 = inboundRow.querySelectorAll('.city')[1]?.querySelector('time')?.textContent || '';
                                    const d4 = {
                                        d: withYear(t4.match(/(\d{2}-\d{2})/)?.[1]),
                                        t: t4.match(/(\d{2}:\d{2})/)?.[1] || ''
                                    };

                                    const inDep = { date: d3.d, time: d3.t };
                                    const inArr = { date: d4.d, time: d4.t };

                                    const priceStr = item.querySelector('.cell5 .txt_data strong')?.textContent?.replace(/,/g, '') || '0';
                                    const price = parseInt(priceStr);

                                    const seats = item.querySelector('.cell6 b')?.textContent?.trim() || '';

                                    // Link
                                    const reserveBtn = item.querySelector('a.btn_type5.popupLogin');
                                    const onclick = reserveBtn?.getAttribute('onclick') || '';
                                    const eventCode = onclick.match(/go_reserve\('([^']+)'\)/)?.[1];

                                    let link = '';
                                    if (eventCode) {
                                        link = `https://www.onlinetour.co.kr/flight/w/international/dcair/dcairReservation?eventCode=${eventCode}`;
                                    } else {
                                        link = 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList';
                                    }

                                    if (price > 0 && eventCode && outDep.date && inDep.date) {
                                        results.push({
                                            id: `online-${eventCode}`,
                                            source: 'onlinetour',
                                            airline,
                                            departure: {
                                                city: depCity,
                                                airport: depAirport,
                                                date: outDep.date,
                                                time: outDep.time,
                                                arrivalTime: outArr.time
                                            },
                                            arrival: {
                                                city: arrCity,
                                                airport: cityCode || '',
                                                date: inDep.date,
                                                time: inDep.time,
                                                arrivalTime: inArr.time
                                            },
                                            price,
                                            currency: 'KRW',
                                            link,
                                            seats
                                        });
                                    } else {
                                        // console.log(`[SKIP] Price: ${price}, EventCode: ${eventCode}`);
                                    }
                                } catch (e) {
                                    // console.log(`[ERROR] Item ${idx}: ${e}`);
                                }
                            });
                            return results;
                        }, {
                            regionName: region.name, cityName: city.name, cityCode: city.code,
                            depAirport: departureAirportInfo.airport, depCity: departureAirportInfo.city,
                            crawlYear: new Date().getFullYear(), crawlMonth: new Date().getMonth() + 1,
                        });

                        console.log(`    ${city.name}: ${Array.isArray(items) ? items.length : 0}건 수집`);
                        if (Array.isArray(items)) {
                            const processed = items.map((f: any) => {
                                // 검색 링크 생성 (eventCode 만료 시 폴백용)
                                const depCode = (departureAirportInfo.airport === 'GMP' || departureAirportInfo.airport === 'ICN') ? 'SEL' : departureAirportInfo.airport;
                                const arrCode = city.code;
                                const startDt = (f.departure?.date || '').replace(/[-\.]/g, '').slice(0, 8);
                                const endDt = (f.arrival?.date || '').replace(/[-\.]/g, '').slice(0, 8);
                                let searchLink = 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList';
                                if (startDt.length === 8 && endDt.length === 8 && arrCode) {
                                    searchLink = `https://www.onlinetour.co.kr/flight/w/international/booking/flightInterFareSearch?trip=RT&sCity1=${depCode}&eCity1=${arrCode}&sCity2=${arrCode}&eCity2=${depCode}&startDt=${startDt}&endDt=${endDt}&adt=1`;
                                }
                                return {
                                    ...f,
                                    searchLink,
                                    region: getRegionByCity(city.name)
                                };
                            });
                            flights.push(...processed);
                        }

                        // [DEBUG] Break after one successful city for testing
                        /*
                        if (items.length > 0) {
                            console.log('    [DEBUG] 첫 도시 성공, 테스트 종료');
                            // return flights; // Uncomment to stop early
                        }
                        */

                    } catch (e) {
                        console.error(`    ${city.name} 오류:`, e);
                    }
                }

            } catch (e) {
                console.error(`  ${region.name} 탭 오류:`, e);
            }
        }

    } catch (e) {
        console.error('온라인투어 오류:', e);
    } finally {
        await browser.close();
    }

    console.log(`온라인투어 완료: 총 ${flights.length}건`);
    completeness.assertComplete(flights.length);

    // 지역별 수집 결과 검증
    const regionCounts: Record<string, number> = {};
    flights.forEach(f => {
        const region = f.region || '기타';
        regionCounts[region] = (regionCounts[region] || 0) + 1;
    });

    // 주요 지역 (0건이면 경고)
    const criticalRegions = ['동남아', '일본'];
    // 그 외 지역 (0건이면 정보 로그)
    const optionalRegions = ['중국', '유럽', '남태평양', '미주', '괌/사이판', '기타'];

    console.log('\n📊 지역별 수집 결과:');
    criticalRegions.forEach(region => {
        const count = regionCounts[region] || 0;
        if (count === 0) {
            console.warn(`  ⚠️ 경고: ${region} - 0건 (스크래퍼 점검 필요)`);
        } else {
            console.log(`  ✅ ${region}: ${count}건`);
        }
    });

    optionalRegions.forEach(region => {
        const count = regionCounts[region] || 0;
        if (count === 0) {
            console.log(`  ℹ️ ${region}: 0건 (특가 없음 또는 미지원)`);
        } else {
            console.log(`  ✅ ${region}: ${count}건`);
        }
    });

    // 김포출발(GMP) 항공편 확인
    const gmpFlights = flights.filter(f => f.departure.airport === 'GMP').length;
    if (gmpFlights === 0) {
        console.warn('  ⚠️ 경고: 김포출발(GMP) 항공편 0건 - 하네다 노선 확인 필요');
    } else {
        console.log(`  ✅ 김포출발(GMP): ${gmpFlights}건`);
    }

    const cityStats: { [city: string]: number } = {};
    flights.forEach(f => { cityStats[f.arrival.city] = (cityStats[f.arrival.city] || 0) + 1; });
    // logCrawlResults moved to crawl-all.ts

    return flights;
}
