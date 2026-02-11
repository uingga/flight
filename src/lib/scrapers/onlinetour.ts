
import { chromium } from 'playwright';
import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';
import { logCrawlResults } from '@/lib/utils/crawl-logger';

const REGIONS = [
    { code: 'AS', name: '아시아' },
    { code: 'JA', name: '일본' },
    { code: 'CH', name: '중국' },
    { code: 'EU', name: '유럽' },
    { code: 'HN', name: '남태평양' },
    { code: 'US', name: '미주' },
    { code: 'GS', name: '괌/사이판' },
];

export async function scrapeOnlineTour(): Promise<Flight[]> {
    console.log('온라인투어 크롤링 시작...');
    const browser = await chromium.launch({ headless: false });
    const flights: Flight[] = [];

    try {
        const page = await browser.newPage();

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
                await page.waitForTimeout(2000);
                try {
                    await page.waitForSelector('input[name="city"]', { timeout: 5000 });
                } catch (e) {
                    console.log(`  ${region.name}: 도시 목록 로드 실패`);
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
                        await page.waitForTimeout(3000);

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
                            console.log(`    ${city.name}: 목록 로드 최종 실패. 스크린샷 저장.`);
                            await page.screenshot({ path: `debug_onlinetour_fail_${city.code}.png` });
                            continue;
                        }

                        // Load more if button exists (optional, limit for speed)
                        /*
                        try {
                            const moreBtn = await page.$('#btn_more');
                            if (moreBtn && await moreBtn.isVisible()) {
                                await moreBtn.click();
                                await page.waitForTimeout(1000);
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
                            const { regionName, cityName, depAirport, depCity } = args as { regionName: string, cityName: string, depAirport: string, depCity: string };
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
                                    const pageDepCity = outboundRow.querySelector('.city:first-child em')?.textContent?.trim() || depCity;
                                    const arrCity = outboundRow.querySelector('.city:last-child em')?.textContent?.trim() || cityName;

                                    // Inline all datetimes to avoid ReferenceError with helpers
                                    const t1 = outboundRow.querySelectorAll('.city')[0]?.querySelector('time')?.textContent || '';
                                    const d1 = {
                                        d: t1.match(/(\d{2}-\d{2})/)?.[1] ? `2026-${t1.match(/(\d{2}-\d{2})/)?.[1]}` : '',
                                        t: t1.match(/(\d{2}:\d{2})/)?.[1] || ''
                                    };

                                    const t2 = outboundRow.querySelectorAll('.city')[1]?.querySelector('time')?.textContent || '';
                                    const d2 = {
                                        d: t2.match(/(\d{2}-\d{2})/)?.[1] ? `2026-${t2.match(/(\d{2}-\d{2})/)?.[1]}` : '',
                                        t: t2.match(/(\d{2}:\d{2})/)?.[1] || ''
                                    };

                                    const outDep = { date: d1.d, time: d1.t };
                                    const outArr = { date: d2.d, time: d2.t };

                                    const t3 = inboundRow.querySelectorAll('.city')[0]?.querySelector('time')?.textContent || '';
                                    const d3 = {
                                        d: t3.match(/(\d{2}-\d{2})/)?.[1] ? `2026-${t3.match(/(\d{2}-\d{2})/)?.[1]}` : '',
                                        t: t3.match(/(\d{2}:\d{2})/)?.[1] || ''
                                    };

                                    const t4 = inboundRow.querySelectorAll('.city')[1]?.querySelector('time')?.textContent || '';
                                    const d4 = {
                                        d: t4.match(/(\d{2}-\d{2})/)?.[1] ? `2026-${t4.match(/(\d{2}-\d{2})/)?.[1]}` : '',
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

                                    if (price > 0 && eventCode) {
                                        results.push({
                                            id: `online-${eventCode}`,
                                            source: 'onlinetour',
                                            airline,
                                            departure: {
                                                city: depCity,
                                                airport: depAirport,
                                                date: outDep.date,
                                                time: outDep.time
                                            },
                                            arrival: {
                                                city: arrCity,
                                                airport: '',
                                                date: outArr.date,
                                                time: outArr.time
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
                        }, { regionName: region.name, cityName: city.name, depAirport: departureAirportInfo.airport, depCity: departureAirportInfo.city });

                        console.log(`    ${city.name}: ${Array.isArray(items) ? items.length : 0}건 수집`);
                        if (Array.isArray(items)) {
                            const processed = items.map((f: any) => ({
                                ...f,
                                region: getRegionByCity(city.name)
                            }));
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
    logCrawlResults('onlinetour', flights.length, undefined, cityStats);

    return flights;
}
