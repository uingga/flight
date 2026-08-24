import fs from 'fs';
import { scrapeMyrealtrip } from '../src/lib/scrapers/myrealtrip';
import { cleanDate, normalizedAirport } from './lib/flight-lifecycle';

function seedKey(flight: any): string {
    return [
        flight.source,
        normalizedAirport(flight.departure?.airport) || flight.departure?.city || '',
        normalizedAirport(flight.arrival?.airport) || flight.arrival?.city || '',
        cleanDate(flight.departure?.date) || '',
        cleanDate(flight.arrival?.date) || '',
    ].join('|');
}

async function main() {
    const cache = JSON.parse(fs.readFileSync('data/all-flights-cache.json', 'utf8'));
    const oldFlights = cache.flights.filter((f: any) => f.source === 'myrealtrip');
    const oldCount = oldFlights.length;
    const firstSeenByOffer = new Map<string, string>(
        oldFlights
            .filter((flight: any) => flight.firstSeen)
            .map((flight: any) => [seedKey(flight), flight.firstSeen]),
    );
    cache.flights = cache.flights.filter((f: any) => f.source !== 'myrealtrip');
    const newFlights = await scrapeMyrealtrip();
    const todayKst = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    newFlights.forEach((flight: any) => {
        flight.firstSeen = firstSeenByOffer.get(seedKey(flight)) || todayKst;
    });
    cache.flights.push(...newFlights);
    cache.lastUpdated = new Date().toISOString();
    fs.writeFileSync('data/all-flights-cache.json', JSON.stringify(cache));
    console.log(`교체: ${oldCount}개 → ${newFlights.length}개`);
    console.log(`전체: ${cache.flights.length}개`);
}
main().catch(console.error);
