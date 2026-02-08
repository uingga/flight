import { chromium } from 'playwright';

async function debugTtang() {
    console.log('Debugging Ttang Links...');
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    try {
        // A broken link from the log
        const brokenLink = 'https://www.ttang.com/ttangair/search/city/detail.do?masterId=PUS-DAD-BX-166400-50900-SB&gubun=SB&trip=RT&dep0=PUS&arr0=DAD&depDate0=20260323&arrDate0=20260323&adt=1&chd=0&inf=0&comp=Y&viaType=2&fareType=A';

        console.log(`\n1. Testing Broken Link: ${brokenLink}`);
        const res1 = await page.goto(brokenLink);
        console.log(`Status: ${res1?.status()}`);

        // Try Mobile Domain
        const mobileLink = brokenLink.replace('www.ttang.com', 'mm.ttang.com');
        console.log(`\n2. Testing Mobile Link: ${mobileLink}`);
        const res2 = await page.goto(mobileLink);
        console.log(`Status: ${res2?.status()}`);

        // Try Search List Fallback
        // https://mm.ttang.com/ttangair/search/city/list.do?trip=RT&dep0=ICN&arr0=DAD&adt=1...
        const searchLink = 'https://www.ttang.com/ttangair/search/city/list.do?trip=RT&dep0=PUS&arr0=DAD&adt=1&chd=0&inf=0&comp=Y&viaType=2&fareType=A';
        console.log(`\n3. Testing Search List Link: ${searchLink}`);
        const res3 = await page.goto(searchLink);
        console.log(`Status: ${res3?.status()}`);

    } catch (e) {
        console.error(e);
    } finally {
        await browser.close();
    }
}

debugTtang();
