
import { chromium } from 'playwright';
import { Flight } from '@/types/flight';
import { getRegionByCity } from '@/lib/utils/region-mapper';

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
                await page.goto(`https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList?TabGubun=${region.code}&airSect=ICN`, { timeout: 30000 });
                await page.waitForTimeout(1000);

                // Get Cities in this Region
                const cities = await page.evaluate(() => {
                    const params: { code: string, name: string }[] = [];
                    document.querySelectorAll('.choice_type3.t1 input[name="city"]').forEach(el => {
                        const code = el.getAttribute('onclick')?.match(/goSelectedCity\('([^']+)'/)?.[1];
                        const name = el.nextElementSibling?.textContent?.trim();
                        if (code && name) {
                            params.push({ code, name });
                        }
                    });
                    return params;
                });

                console.log(`발견된 도시: ${cities.length}개`);

                // 3. Iterate Cities
                for (const city of cities) {
                    console.log(`  - ${city.name} (${city.code}) 검색 중...`);

                    try {
                        const cityUrl = `https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList?TabGubun=${region.code}&SelectedCityCd=${city.code}&airSect=ICN`;
                        await page.goto(cityUrl, { timeout: 30000 });

                        // Explicit wait for data loading (AJAX)
                        await page.waitForTimeout(5000);

                        // Wait for list
                        try {
                            // Check #data_list first
                            await page.waitForSelector('#data_list', { timeout: 5000 });

                            // Check content
                            const listHtml = await page.$eval('#data_list', el => el.innerHTML);
                            if (listHtml.trim().length < 10) {
                                console.log(`    ${city.name}: #data_list 비어있음 (HTML 길이: ${listHtml.length})`);
                            }

                            await page.waitForSelector('#data_list > li.item', { timeout: 5000 });
                        } catch (e) {
                            console.log(`    ${city.name}: 목록 로드 실패. 스크린샷 저장.`);
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

                        // Extract Data
                        const items = await page.evaluate((args) => {
                            const { regionName, cityName } = args as { regionName: string, cityName: string };
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

                                    const depCity = outboundRow.querySelector('.city:first-child em')?.textContent?.trim() || '인천';
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
                                                airport: 'ICN',
                                                date: outDep.date,
                                                time: outDep.time
                                            },
                                            arrival: {
                                                city: arrCity,
                                                airport: '',
                                                date: inArr.date || outArr.date,
                                                time: inArr.time || outArr.time
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
                        }, { regionName: region.name, cityName: city.name });

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
    return flights;
}
