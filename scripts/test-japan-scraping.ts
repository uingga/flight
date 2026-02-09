import { chromium } from 'playwright';

async function testJapanScraping() {
    console.log('일본 지역 스크래핑 테스트 시작...');
    const browser = await chromium.launch({ headless: false });

    try {
        const page = await browser.newPage();

        // 일본 지역 페이지 접속
        console.log('일본 지역 페이지 접속...');
        await page.goto('https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList?TabGubun=JA', { timeout: 30000 });

        // 충분한 대기 시간
        await page.waitForTimeout(3000);

        // 도시 목록 대기
        try {
            await page.waitForSelector('input[name="city"]', { timeout: 10000 });
            console.log('도시 목록 로드됨');
        } catch (e) {
            console.log('도시 목록 로드 실패!');
            await page.screenshot({ path: 'debug_japan_cities_fail.png' });
            return;
        }

        // 도시 목록 추출
        const cities = await page.evaluate(() => {
            const params: { code: string, name: string }[] = [];
            document.querySelectorAll('input[name="city"]').forEach(el => {
                const code = el.getAttribute('onclick')?.match(/goSelectedCity\('([^']+)'/)?.[1];
                const name = el.nextElementSibling?.textContent?.trim() ||
                    (el as any).closest('label')?.querySelector('em')?.textContent?.trim();
                if (code && name) {
                    params.push({ code, name });
                }
            });
            return params;
        });

        console.log(`발견된 도시: ${cities.length}개`);
        cities.forEach(c => console.log(`  - ${c.name} (${c.code})`));

        // 도쿄(하네다) 테스트
        console.log('\n--- 도쿄(하네다) HND 테스트 ---');
        await page.goto('https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList?TabGubun=JA&SelectedCityCd=HND', { timeout: 30000 });
        await page.waitForTimeout(5000);

        // 출발 공항 확인
        const departureInfo = await page.evaluate(() => {
            const checkedInput = document.querySelector('input[name="airsect"]:checked') as HTMLInputElement;
            if (checkedInput) {
                const airportCode = checkedInput.value;
                const label = checkedInput.closest('label')?.querySelector('em')?.textContent?.trim() || '';
                return { airport: airportCode, city: label.replace('출발', '').trim() };
            }
            return { airport: 'UNKNOWN', city: 'UNKNOWN' };
        });

        console.log(`출발 공항: ${departureInfo.city} (${departureInfo.airport})`);

        // 항공편 목록 확인
        try {
            await page.waitForSelector('#data_list > li.item', { timeout: 10000 });
            const flightCount = await page.$$eval('#data_list > li.item', items => items.length);
            console.log(`항공편 수: ${flightCount}개`);

            // 첫 번째 항공편 정보 추출
            if (flightCount > 0) {
                const firstFlight = await page.evaluate(() => {
                    const item = document.querySelector('#data_list > li.item');
                    if (!item) return null;

                    const airline = item.querySelector('.cell1 em')?.textContent?.trim() || '';
                    const priceStr = item.querySelector('.cell5 .txt_data strong')?.textContent?.replace(/,/g, '') || '0';
                    const price = parseInt(priceStr);

                    return { airline, price };
                });

                console.log(`첫 번째 항공편: ${firstFlight?.airline}, ${firstFlight?.price}원`);
            }
        } catch (e) {
            console.log('항공편 목록 로드 실패!');
            await page.screenshot({ path: 'debug_hnd_flights_fail.png' });
        }

        // 도쿄(나리타) 테스트
        console.log('\n--- 도쿄(나리타) NRT 테스트 ---');
        await page.goto('https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList?TabGubun=JA&SelectedCityCd=NRT', { timeout: 30000 });
        await page.waitForTimeout(5000);

        const departureInfoNRT = await page.evaluate(() => {
            const checkedInput = document.querySelector('input[name="airsect"]:checked') as HTMLInputElement;
            if (checkedInput) {
                const airportCode = checkedInput.value;
                const label = checkedInput.closest('label')?.querySelector('em')?.textContent?.trim() || '';
                return { airport: airportCode, city: label.replace('출발', '').trim() };
            }
            return { airport: 'UNKNOWN', city: 'UNKNOWN' };
        });

        console.log(`출발 공항: ${departureInfoNRT.city} (${departureInfoNRT.airport})`);

        try {
            await page.waitForSelector('#data_list > li.item', { timeout: 10000 });
            const flightCount = await page.$$eval('#data_list > li.item', items => items.length);
            console.log(`항공편 수: ${flightCount}개`);
        } catch (e) {
            console.log('항공편 목록 로드 실패!');
            await page.screenshot({ path: 'debug_nrt_flights_fail.png' });
        }

    } catch (e) {
        console.error('오류 발생:', e);
    } finally {
        await browser.close();
    }

    console.log('\n테스트 완료!');
}

testJapanScraping();
