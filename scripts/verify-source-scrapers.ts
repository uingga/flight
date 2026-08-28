import fs from 'node:fs';
import path from 'node:path';
import { scrapeOnlineTour } from '../src/lib/scrapers/onlinetour';
import { scrapeTtang } from '../src/lib/scrapers/ttang';

function verifyFlights(source: string, flights: any[]) {
    if (flights.length === 0) throw new Error(`${source}: 검증 결과가 0건입니다.`);
    const missing = flights.filter(flight => (
        !flight.id || !flight.departure?.date || !flight.arrival?.date || !flight.price || !flight.link
    ));
    if (missing.length > 0) throw new Error(`${source}: 필수값이 없는 항공권 ${missing.length}건`);

    const exactKeys = flights.map(flight => [
        flight.source,
        flight.airline,
        flight.departure?.airport,
        flight.arrival?.airport,
        flight.departure?.date,
        flight.arrival?.date,
        flight.price,
    ].join('|'));
    const uniqueRows = new Set(exactKeys);
    if (uniqueRows.size !== flights.length) {
        throw new Error(`${source}: 완전히 같은 항공권 ${flights.length - uniqueRows.size}건이 중복됐습니다.`);
    }
    const uniqueIds = new Set(flights.map(flight => flight.id));
    if (uniqueIds.size !== flights.length) {
        console.warn(`${source}: 원본 단계의 공용 상품 ID ${flights.length - uniqueIds.size}건은 후속 최저가 필터에서 정리됩니다.`);
    }
    console.log(`${source}: ${flights.length}건, 필수값·동일 항공권 중복 검증 통과`);
}

async function main() {
    const target = process.argv[2] || 'all';
    const cachePath = path.join(process.cwd(), 'data', 'all-flights-cache.json');
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    const previousFlights = Array.isArray(cache.flights) ? cache.flights : [];

    if (target === 'online' || target === 'all') {
        const flights = await scrapeOnlineTour(previousFlights);
        verifyFlights('온라인투어', flights);
    }

    if (target === 'ttang-api' || target === 'ttang' || target === 'all') {
        if (target === 'ttang-api') {
            console.log('ttang-api는 호환용 이름이며, 차단을 피하기 위해 브라우저 수집 전체를 검증합니다.');
        }
        const flights = await scrapeTtang(previousFlights);
        verifyFlights('땡처리닷컴', flights);
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
