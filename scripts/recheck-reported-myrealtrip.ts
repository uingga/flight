import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { getMyrealtripSearchPrice } from './lib/myrealtrip-search-page';

interface CachedFlight {
    id: string;
    source: string;
    airline: string;
    price: number;
    priceCheckedAt?: string;
    departure: { airport: string; date: string; time: string; arrivalTime?: string };
    arrival: { airport: string; date: string; time: string; arrivalTime?: string };
    duration?: string;
    returnDuration?: string;
}

interface CacheData {
    count: number;
    flights: CachedFlight[];
    sources?: Record<string, number>;
}

function cleanAirline(value: string, fallback: string): string {
    const cleaned = value.trim();
    if (!cleaned || cleaned.includes('항공권') || cleaned.includes('제공요금') || cleaned.length > 60) {
        return fallback || '항공사 미정';
    }
    return cleaned;
}

async function main() {
    const flightId = process.env.REPORT_FLIGHT_ID?.trim();
    if (!flightId) throw new Error('REPORT_FLIGHT_ID가 필요합니다.');

    const cachePath = path.resolve(process.cwd(), 'data/all-flights-cache.json');
    const gidMapPath = path.resolve(process.cwd(), 'data/gid-map.json');
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as CacheData;
    const index = cache.flights.findIndex(flight => flight.id === flightId && flight.source === 'myrealtrip');
    if (index < 0) {
        console.log('ℹ️ 신고된 마이리얼트립 항공권은 이미 현재 캐시에 없습니다.');
        return;
    }

    const target = cache.flights[index];
    const gidMap = JSON.parse(fs.readFileSync(gidMapPath, 'utf8')) as Record<string, number>;
    const gid = gidMap[target.arrival.airport];
    if (!gid) {
        console.log(`⚠️ ${target.arrival.airport} 노선 GID가 없어 기존 항공권을 유지합니다.`);
        return;
    }

    const browser = await chromium.launch({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled'],
    });
    const page = await browser.newPage();

    try {
        const result = await getMyrealtripSearchPrice(
            page,
            gid,
            target.departure.date,
            target.arrival.date,
        );

        if (result) {
            const checkedAt = new Date().toISOString();
            target.price = result.price;
            target.airline = cleanAirline(result.airline, target.airline);
            target.departure.time = result.depTime;
            target.departure.arrivalTime = result.arrTime;
            target.arrival.time = result.retDepTime;
            target.arrival.arrivalTime = result.retArrTime;
            target.duration = result.duration;
            target.returnDuration = result.retDuration;
            target.priceCheckedAt = checkedAt;
            fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
            console.log(`✅ 마이리얼트립 실제 결과 확인: ${result.price.toLocaleString()}원`);
            return;
        }

        const bodyText = await page.locator('body').innerText().catch(() => '');
        const explicitlyUnavailable = /검색 결과가 없|항공권이 없|항공권을 찾을 수 없|조건에 맞는 항공편이 없|판매 가능한 항공권이 없/.test(bodyText);
        if (!explicitlyUnavailable) {
            console.log('⚠️ 마이리얼트립 검색 결과를 판별하지 못해 기존 항공권을 유지합니다.');
            return;
        }

        cache.flights.splice(index, 1);
        cache.count = cache.flights.length;
        if (cache.sources) {
            cache.sources.myrealtrip = cache.flights.filter(flight => flight.source === 'myrealtrip').length;
        }
        fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
        console.log('🧹 마이리얼트립에서 판매 항공권 없음이 확인되어 목록에서 제거했습니다.');
    } finally {
        await browser.close();
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
