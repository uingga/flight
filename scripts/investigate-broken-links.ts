import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

async function investigate() {
    console.log('Investigating broken links...');
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    try {
        const cachePath = path.join(process.cwd(), 'data', 'all-flights-cache.json');
        if (!fs.existsSync(cachePath)) {
            console.error('Cache not found!');
            return;
        }

        const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        const flights = data.flights || [];

        // Sample Ttang links
        const ttangFlights = flights.filter(f => f.source === 'ttang').slice(0, 3);
        // Sample Ybtour links
        const ybtourFlights = flights.filter(f => f.source === 'ybtour').slice(0, 3);

        console.log(`Checking ${ttangFlights.length} Ttang links and ${ybtourFlights.length} Ybtour links...`);

        // Check Ttang
        for (const f of ttangFlights) {
            console.log(`\n[Ttang] Checking ${f.link}`);
            try {
                const response = await page.goto(f.link, { timeout: 15000, waitUntil: 'domcontentloaded' });
                console.log(`  Status: ${response?.status()}`);
                console.log(`  Final URL: ${page.url()}`);

                const content = await page.content();
                if (content.includes('오류') || content.includes('존재하지 않는') || content.includes('판매종료')) {
                    console.log('  -> Content indicates ERROR/EXPIRED');
                } else if (content.includes('로그인')) {
                    console.log('  -> Content indicates LOGIN REQUIRED');
                } else {
                    console.log('  -> Content seems OK');
                }
            } catch (e) {
                console.log(`  -> Failed: ${e.message}`);
            }
        }

        // Check Ybtour
        for (const f of ybtourFlights) {
            console.log(`\n[Ybtour] Checking ${f.link}`);
            try {
                const response = await page.goto(f.link, { timeout: 15000, waitUntil: 'domcontentloaded' });
                console.log(`  Status: ${response?.status()}`);
                console.log(`  Final URL: ${page.url()}`);

                const content = await page.content();
                if (content.includes('일치하는 상품이 없습니다')) {
                    console.log('  -> Content indicates NO MATCH');
                } else {
                    console.log('  -> Content seems OK');
                }
            } catch (e) {
                console.log(`  -> Failed: ${e.message}`);
            }
        }

    } catch (e) {
        console.error(e);
    } finally {
        await browser.close();
    }
}

investigate();
