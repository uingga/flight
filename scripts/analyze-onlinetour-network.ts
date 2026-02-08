
import { chromium } from 'playwright';
import fs from 'fs';

async function analyzeNetwork() {
    console.log('Analyzing Online Tour Network...');
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    // Capture all XHR/fetch requests
    page.on('request', request => {
        if (['xhr', 'fetch'].includes(request.resourceType())) {
            console.log(`[REQ] ${request.url()}`);
        }
    });

    page.on('response', async response => {
        const url = response.url();
        const request = response.request();
        // Capture ALL JSON responses to find hidden APIs
        if (['xhr', 'fetch'].includes(request.resourceType())) {
            try {
                const json = await response.json();
                console.log(`[RES] Captured JSON from ${url}`);
                const filename = `debug_onlinetour_api_${Date.now()}_${Math.random().toString(36).substring(7)}.json`;
                fs.writeFileSync(filename, JSON.stringify(json, null, 2));
            } catch (e) {
                // Ignore non-JSON
            }
        }
    });

    try {
        const targetUrl = 'https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList?TabGubun=AS&SelectedCityCd=DAD&airSect=ICN';
        console.log(`Navigating to ${targetUrl}`);
        await page.goto(targetUrl, { timeout: 60000 });

        // Wait for potential data loading
        await page.waitForTimeout(10000);

        // Save FULL HTML
        const content = await page.content();
        fs.writeFileSync('debug_onlinetour_full.html', content);
        console.log('Saved full HTML to debug_onlinetour_full.html');

    } catch (e) {
        console.error('Analysis failed:', e);
    } finally {
        await browser.close();
    }
}

analyzeNetwork();
