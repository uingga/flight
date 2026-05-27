import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

/**
 * Playwright로 offers.k1 페이지의 실제 최저가를 추출하여 캐시를 보정합니다.
 * 하루 1회 실행 권장. GitHub Actions에서 크롤링 후 실행.
 * 
 * 사용법: npx tsx scripts/verify-myrealtrip-prices.ts
 */

interface CachedFlight {
    id: string;
    source: string;
    price: number;
    arrival: { airport: string; city: string };
    departure: { airport: string; date: string };
    link: string;
    [key: string]: any;
}

// gid 맵 로드
function loadGidMap(): Record<string, number> {
    try {
        const raw = fs.readFileSync(path.resolve(process.cwd(), 'data/gid-map.json'), 'utf8');
        const parsed = JSON.parse(raw);
        const map: Record<string, number> = {};
        for (const [code, val] of Object.entries(parsed)) {
            if (typeof val === 'number') map[code] = val;
            else if (typeof val === 'object' && val && 'gid' in val) map[code] = (val as any).gid;
        }
        return map;
    } catch {
        return {};
    }
}

// offers.k1 페이지에서 실제 최저가 추출
async function getActualPrice(
    page: any,
    gid: number,
    depDate: string,
    arrDate: string
): Promise<number | null> {
    const url = `https://flights.myrealtrip.com/air/agent/b2c/AIR/AAA/offers.k1?gid=${gid}&depdt=${depDate}&arrdt=${arrDate}&cabin=Y&adult=1&child=0&infant=0`;
    
    try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(8000); // 검색 결과 로딩 대기
        
        // 가격 추출
        const prices: number[] = await page.evaluate(() => {
            const results: number[] = [];
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
                const text = walker.currentNode.textContent?.trim() || '';
                const match = text.match(/^([\d,]+)\s*원?$/);
                if (match) {
                    const num = parseInt(match[1].replace(/,/g, ''));
                    if (num >= 50000 && num <= 5000000) results.push(num);
                }
            }
            return results;
        });
        
        if (prices.length === 0) return null;
        return Math.min(...prices);
    } catch (e) {
        console.error(`  ❌ 페이지 로드 실패`);
        return null;
    }
}

async function main() {
    console.log('=== 마이리얼트립 가격 검증 시작 (Playwright) ===\n');
    
    // 캐시 로드
    const cachePath = path.resolve(process.cwd(), 'data/all-flights-cache.json');
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    const mrtFlights: CachedFlight[] = cache.flights.filter((f: any) => f.source === 'myrealtrip');
    const gidMap = loadGidMap();
    
    console.log(`마이리얼트립 항공편: ${mrtFlights.length}개`);
    console.log(`GID 맵: ${Object.keys(gidMap).length}개 노선\n`);
    
    // gid가 있는 노선만 검증 (나머지는 링크 자체가 정확하지 않으므로)
    const verifiable = mrtFlights.filter(f => gidMap[f.arrival.airport]);
    console.log(`검증 가능: ${verifiable.length}개 (gid 있는 노선)\n`);
    
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    let updated = 0;
    let checked = 0;
    let failed = 0;
    
    for (const flight of verifiable) {
        const gid = gidMap[flight.arrival.airport];
        const depDate = flight.departure.date;
        // arrDate: link에서 추출 또는 arrival.date 사용
        const arrDate = flight.arrival?.date || '';
        
        if (!depDate || !arrDate || !gid) continue;
        
        checked++;
        const actualPrice = await getActualPrice(page, gid, depDate, arrDate);
        
        if (actualPrice !== null) {
            const diff = Math.abs(actualPrice - flight.price);
            const diffPercent = ((diff / flight.price) * 100).toFixed(0);
            
            if (diff > 10000) { // 1만원 이상 차이
                console.log(`  ${flight.arrival.city}: ${flight.price.toLocaleString()}원 → ${actualPrice.toLocaleString()}원 (${diffPercent}% 차이)`);
                
                // 캐시 업데이트
                const idx = cache.flights.findIndex((f: any) => f.id === flight.id);
                if (idx >= 0) {
                    cache.flights[idx].price = actualPrice;
                    updated++;
                }
            } else {
                console.log(`  ${flight.arrival.city}: ${flight.price.toLocaleString()}원 ✅ 정확`);
            }
        } else {
            failed++;
            console.log(`  ${flight.arrival.city}: 가격 추출 실패 ⚠️`);
        }
        
        // 진행률
        if (checked % 10 === 0) {
            console.log(`\n  --- ${checked}/${verifiable.length} 완료, ${updated}개 보정 ---\n`);
        }
    }
    
    await browser.close();
    
    // 캐시 저장
    if (updated > 0) {
        cache.lastUpdated = new Date().toISOString();
        fs.writeFileSync(cachePath, JSON.stringify(cache));
        console.log(`\n✅ ${updated}개 가격 보정 완료, 캐시 저장됨`);
    } else {
        console.log(`\n✅ 모든 가격이 정확합니다`);
    }
    
    console.log(`\n📊 결과: 검증 ${checked}, 보정 ${updated}, 실패 ${failed}`);
}

main().catch(console.error);
