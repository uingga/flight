import { chromium } from 'playwright';

async function debugDepartureAirport() {
    console.log('출발 공항 감지 디버그 테스트...');
    const browser = await chromium.launch({ headless: false });

    try {
        const page = await browser.newPage();

        // 하네다 페이지 (김포 출발이어야 함)
        console.log('\n=== 도쿄(하네다) HND 테스트 ===');
        await page.goto('https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList?TabGubun=JA&SelectedCityCd=HND', { timeout: 30000 });
        await page.waitForTimeout(5000);

        const departureInfoHND = await page.evaluate(() => {
            const checkedInput = document.querySelector('input[name="airsect"]:checked') as HTMLInputElement;
            if (checkedInput) {
                const airportCode = checkedInput.value;
                const label = checkedInput.closest('label')?.querySelector('em')?.textContent?.trim() || '';
                const cityName = label.replace('출발', '').trim();
                return {
                    airport: airportCode,
                    city: cityName || (airportCode === 'GMP' ? '김포' : airportCode === 'PUS' ? '부산' : '인천'),
                    method: 'checked input',
                    rawLabel: label
                };
            }

            // Fallback debug
            const allAirsects = Array.from(document.querySelectorAll('input[name="airsect"]'));
            return {
                airport: 'FALLBACK',
                city: 'FALLBACK',
                method: 'fallback',
                allAirsects: allAirsects.map(el => ({
                    value: (el as HTMLInputElement).value,
                    checked: (el as HTMLInputElement).checked
                }))
            };
        });

        console.log('하네다 출발공항 감지 결과:', JSON.stringify(departureInfoHND, null, 2));

        // 나리타 페이지 (인천 출발이어야 함)
        console.log('\n=== 도쿄(나리타) NRT 테스트 ===');
        await page.goto('https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList?TabGubun=JA&SelectedCityCd=NRT', { timeout: 30000 });
        await page.waitForTimeout(5000);

        const departureInfoNRT = await page.evaluate(() => {
            const checkedInput = document.querySelector('input[name="airsect"]:checked') as HTMLInputElement;
            if (checkedInput) {
                const airportCode = checkedInput.value;
                const label = checkedInput.closest('label')?.querySelector('em')?.textContent?.trim() || '';
                const cityName = label.replace('출발', '').trim();
                return {
                    airport: airportCode,
                    city: cityName || (airportCode === 'GMP' ? '김포' : airportCode === 'PUS' ? '부산' : '인천'),
                    method: 'checked input',
                    rawLabel: label
                };
            }

            const allAirsects = Array.from(document.querySelectorAll('input[name="airsect"]'));
            return {
                airport: 'FALLBACK',
                city: 'FALLBACK',
                method: 'fallback',
                allAirsects: allAirsects.map(el => ({
                    value: (el as HTMLInputElement).value,
                    checked: (el as HTMLInputElement).checked
                }))
            };
        });

        console.log('나리타 출발공항 감지 결과:', JSON.stringify(departureInfoNRT, null, 2));

    } catch (e) {
        console.error('오류 발생:', e);
    } finally {
        await browser.close();
    }

    console.log('\n테스트 완료!');
}

debugDepartureAirport();
