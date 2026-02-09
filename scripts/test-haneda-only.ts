import { chromium } from 'playwright';

async function testHanedaScraping() {
    console.log('하네다 항공편 수집 테스트...');
    const browser = await chromium.launch({ headless: false });

    try {
        const page = await browser.newPage();

        // 하네다 페이지
        await page.goto('https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList?TabGubun=JA&SelectedCityCd=HND', { timeout: 30000 });
        await page.waitForTimeout(5000);

        // 출발 공항 감지
        const departureAirportInfo = await page.evaluate(() => {
            const checkedInput = document.querySelector('input[name="airsect"]:checked') as HTMLInputElement;
            if (checkedInput) {
                const airportCode = checkedInput.value;
                const label = checkedInput.closest('label')?.querySelector('em')?.textContent?.trim() || '';
                const cityName = label.replace('출발', '').trim();
                return { airport: airportCode, city: cityName || (airportCode === 'GMP' ? '김포' : airportCode === 'PUS' ? '부산' : '인천') };
            }
            return { airport: 'ICN', city: '인천' };
        });

        console.log('감지된 출발공항:', departureAirportInfo);

        // 항공편 데이터 추출
        const items = await page.evaluate((args) => {
            const { depAirport, depCity } = args as { depAirport: string, depCity: string };
            const results: any[] = [];
            const listItems = document.querySelectorAll('#data_list > li.item');

            listItems.forEach((item, idx) => {
                try {
                    const airline = item.querySelector('.cell1 em')?.textContent?.trim() || '';
                    const priceStr = item.querySelector('.cell5 .txt_data strong')?.textContent?.replace(/,/g, '') || '0';
                    const price = parseInt(priceStr);

                    // 여기서 depAirport, depCity가 제대로 전달되는지 확인
                    console.log(`[DEBUG] Item ${idx}: depAirport=${depAirport}, depCity=${depCity}`);

                    if (price > 0) {
                        results.push({
                            airline,
                            price,
                            departure: {
                                city: depCity,    // 전달받은 값 사용
                                airport: depAirport  // 전달받은 값 사용
                            }
                        });
                    }
                } catch (e) {
                    console.error('Error:', e);
                }
            });
            return results;
        }, { depAirport: departureAirportInfo.airport, depCity: departureAirportInfo.city });

        console.log(`\n수집된 항공편: ${items.length}개`);
        items.forEach((item, idx) => {
            console.log(`  ${idx + 1}. ${item.airline} - ${item.departure.city}/${item.departure.airport} - ${item.price}원`);
        });

    } catch (e) {
        console.error('오류 발생:', e);
    } finally {
        await browser.close();
    }

    console.log('\n테스트 완료!');
}

testHanedaScraping();
