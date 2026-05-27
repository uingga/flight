import { chromium } from 'playwright';
import fs from 'fs';

async function main() {
    const gidMap = JSON.parse(fs.readFileSync('data/gid-map.json', 'utf8'));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    const tests = [
        { name: '오사카', code: 'KIX', dep: '2026-06-06', arr: '2026-06-09' },
        { name: '다낭', code: 'DAD', dep: '2026-06-09', arr: '2026-06-11' },
        { name: '난닝', code: 'NNG', dep: '2026-06-05', arr: '2026-06-08' },
    ];
    
    for (const t of tests) {
        const gid = gidMap[t.code];
        const url = `https://flights.myrealtrip.com/air/agent/b2c/AIR/AAA/offers.k1?gid=${gid}&depdt=${t.dep}&arrdt=${t.arr}&cabin=Y&adult=1&child=0&infant=0`;
        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(12000);
        
        const results = await page.evaluate(() => {
            const flights: any[] = [];
            document.querySelectorAll('*').forEach(el => {
                const t = (el as HTMLElement).innerText || '';
                if (t.includes('석 남음') && t.includes('원') && t.includes('직항') && t.length > 50 && t.length < 500) {
                    if (t.includes('경유') || t.includes('1회') || t.includes('2회')) return;
                    const pm = t.match(/([\d,]+)원/);
                    if (!pm) return;
                    const price = parseInt(pm[1].replace(/,/g, ''));
                    if (price < 100000 || price > 5000000) return;
                    
                    const lines = t.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    let airline = '';
                    for (const l of lines) {
                        if (l.includes('항공') || l.includes('에어') || l.includes('진에어')) {
                            airline = l.replace(/브랜드관.*/, '').trim();
                            break;
                        }
                    }
                    const times = t.match(/(\d{2}:\d{2})/g) || [];
                    const durs = t.match(/(\d+시간\s*\d+분)/g) || [];
                    
                    if (!flights.some(f => f.price === price)) {
                        flights.push({
                            price, airline,
                            dep: times[0]||'', arr: times[1]||'',
                            retDep: times[2]||'', retArr: times[3]||'',
                            dur: durs[0]||'', retDur: durs[1]||''
                        });
                    }
                }
            });
            return flights.sort((a,b) => a.price - b.price).slice(0, 2);
        });
        
        console.log(`\n=== ${t.name} ===`);
        if (results.length === 0) {
            console.log('  직항 없음');
        }
        results.forEach((r, i) => {
            console.log(`  [${i+1}] ${r.price.toLocaleString()}원 - ${r.airline}`);
            console.log(`      가는편: ${r.dep}→${r.arr} (${r.dur})`);
            console.log(`      오는편: ${r.retDep}→${r.retArr} (${r.retDur})`);
        });
    }
    
    await browser.close();
}

main().catch(console.error);
