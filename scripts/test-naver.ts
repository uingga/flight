import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import * as fs from 'fs';
import * as path from 'path';
chromium.use(stealth());

const DATA_DIR = path.join(process.cwd(), 'data');
const ALL_FLIGHTS_FILE = path.join(DATA_DIR, 'all-flights-cache.json');

if (!['1', 'true'].includes(String(process.env.NAVER_LIVE_RUN || '').toLowerCase())) {
    throw new Error('실제 네이버 진단은 NAVER_LIVE_RUN=1을 명시해야 합니다.');
}

(async () => {
    const rawFile = JSON.parse(fs.readFileSync(ALL_FLIGHTS_FILE, 'utf-8'));
    const rawData = Array.isArray(rawFile) ? rawFile : (rawFile.flights || Object.values(rawFile).flat());
    const flights = (rawData as any[]).filter(f => f.price > 0 && f.departure?.airport && f.arrival?.airport)
        .sort((a, b) => a.price - b.price);

    const seen = new Set<string>();
    const testFlights = flights.filter(f => {
        const key = `${f.departure.airport}-${f.arrival.airport}_${f.departure.date}_${f.arrival.date}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, 3);

    console.log(`테스트 항공권: ${testFlights.length}건\n`);

    const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
    const page = await ctx.newPage();

    for (let i = 0; i < testFlights.length; i++) {
        const f = testFlights[i];
        const depDate = f.departure.date.replace(/-/g, '').substring(0, 8);
        const retDate = f.arrival.date.replace(/-/g, '').substring(0, 8);
        const url = `https://flight.naver.com/flights/international/${f.departure.airport}-${f.arrival.airport}-${depDate}/${f.arrival.airport}-${f.departure.airport}-${retDate}?adult=1&isDirect&fareType=Y`;

        console.log(`[${i + 1}/${testFlights.length}] ${f.departure.city}→${f.arrival.city} (${f.departure.date}~${f.arrival.date}) 현재가: ${f.price.toLocaleString()}원`);

        let lowestPrice: number | null = null;

        page.on('response', async (r) => {
            if (r.url().includes('flight-api.naver.com/graphql')) {
                try {
                    const json = await r.json();
                    const walk = (obj: any) => {
                        if (!obj || typeof obj !== 'object') return;
                        for (const key of ['price', 'farePrice', 'totalPrice', 'fare']) {
                            if (obj[key] !== undefined && typeof obj[key] === 'number' && obj[key] > 10000) {
                                if (lowestPrice === null || obj[key] < lowestPrice) lowestPrice = obj[key];
                            }
                        }
                        if (obj.adult?.fare) {
                            const total = (obj.adult.fare || 0) + (obj.adult.tax || 0) + (obj.adult.surcharge || 0);
                            if (total > 10000 && (lowestPrice === null || total < lowestPrice)) lowestPrice = total;
                        }
                        if (Array.isArray(obj)) obj.forEach(walk);
                        else Object.values(obj).forEach(walk);
                    };
                    walk(json);
                } catch { }
            }
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        console.log(`  ⏳ 대기 25초...`);
        await page.waitForTimeout(25000);

        // DOM에서도 가격 읽기
        const domPrice = await page.evaluate(() => {
            const els = document.querySelectorAll('[class*="item_num"]');
            const prices: number[] = [];
            els.forEach(el => {
                const text = (el as HTMLElement).innerText || '';
                const match = text.replace(/,/g, '').replace(/원/g, '').match(/(\d{4,})/);
                if (match) prices.push(parseInt(match[1]));
            });
            const valid = prices.filter(p => p > 10000);
            return valid.length > 0 ? Math.min(...valid) : null;
        });

        if (domPrice && (lowestPrice === null || domPrice < lowestPrice)) lowestPrice = domPrice;
        page.removeAllListeners('response');

        if (lowestPrice !== null) {
            const diff = f.price - lowestPrice;
            const emoji = diff <= 0 ? '✅' : '⚠️';
            console.log(`  ${emoji} 네이버 최저가: ${lowestPrice.toLocaleString()}원 (차이: ${diff >= 0 ? '+' : ''}${diff.toLocaleString()}원)`);
        } else {
            console.log(`  ❓ 네이버 최저가를 찾을 수 없음`);
        }
        console.log('');

        await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
    }

    await browser.close();
    console.log('✅ 테스트 완료!');
})();
