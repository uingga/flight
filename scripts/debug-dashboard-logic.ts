
import fs from 'fs';
import path from 'path';

// Mock Flight interface matching Dashboard.tsx expectation
interface Flight {
    id: string;
    source: string;
    airline: string;
    departure: {
        city: string;
        date: string;
        time: string;
    };
    arrival: {
        city: string;
        date: string;
        time: string;
    };
    price: number;
}

const normalizeDate = (d: string) => {
    if (!d) return '';
    const m = d.match(/^(\d{4})[.\-](\d{2})[.\-](\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : d;
};

async function main() {
    const cachePath = path.join(process.cwd(), 'data', 'all-flights-cache.json');
    if (!fs.existsSync(cachePath)) {
        console.error('Cache file not found');
        return;
    }

    const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    const flights: Flight[] = data.flights || [];

    console.log(`Total flights in cache: ${flights.length}`);

    // Simulate Dashboard filters
    const startDate = '2026-02-09';
    const endDate = '2026-03-09';

    console.log(`Filtering dates: ${startDate} ~ ${endDate}`);

    const filteredFlights = flights.filter(flight => {
        const flightDate = normalizeDate(flight.departure.date);

        // Debug date parsing for some flights
        if (flight.id.includes('ttang')) {
            // console.log(`[Ttang] ${flight.departure.date} -> ${flightDate}`);
        }

        const matchesDate =
            (!startDate || flightDate >= startDate) &&
            (!endDate || flightDate <= endDate);

        return matchesDate;
    });

    console.log(`Filtered flights count: ${filteredFlights.length}`);

    // Sort by price
    filteredFlights.sort((a, b) => a.price - b.price);

    // Show top 30
    console.log('\nTop 30 Flights:');
    filteredFlights.slice(0, 30).forEach((f, i) => {
        console.log(`${i + 1}. [${f.source}] ${f.airline} - ${f.departure.city}->${f.arrival.city} (${f.departure.date}) : ${f.price}`);
    });

    // Count by source in filtered list
    const sourceCounts: Record<string, number> = {};
    filteredFlights.forEach(f => {
        sourceCounts[f.source] = (sourceCounts[f.source] || 0) + 1;
    });
    console.log('\nSource counts in filtered list:');
    console.log(sourceCounts);
}

main();
