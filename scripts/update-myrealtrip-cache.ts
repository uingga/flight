import fs from 'fs';
import { scrapeMyrealtrip } from '../src/lib/scrapers/myrealtrip';

async function main() {
    const cache = JSON.parse(fs.readFileSync('data/all-flights-cache.json', 'utf8'));
    const oldCount = cache.flights.filter((f: any) => f.source === 'myrealtrip').length;
    cache.flights = cache.flights.filter((f: any) => f.source !== 'myrealtrip');
    const newFlights = await scrapeMyrealtrip();
    cache.flights.push(...newFlights);
    cache.lastUpdated = new Date().toISOString();
    fs.writeFileSync('data/all-flights-cache.json', JSON.stringify(cache));
    console.log(`교체: ${oldCount}개 → ${newFlights.length}개`);
    console.log(`전체: ${cache.flights.length}개`);
}
main().catch(console.error);
