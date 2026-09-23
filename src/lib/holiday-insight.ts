import type { Flight } from '@/types/flight';

export const holidayInsightCopy = {
    id: 'holiday-insight',
    eyebrow: '개천절·한글날 연휴',
    title: '개천절·한글날 연휴',
    description: '각 연휴 3일을 모두 포함한 항공권',
};

const holidays = [
    { label: '개천절 연휴', start: '2026-10-03', end: '2026-10-05' },
    { label: '한글날 연휴', start: '2026-10-09', end: '2026-10-11' },
];

export const holidayFlightKey = (flight: Flight) => [
    flight.id, flight.departure.date, flight.departure.time, flight.arrival.date, flight.arrival.time,
].join('|');

// Select current offers by the full holiday window, including newly collected schedules.
export function selectHolidayFlights(flights: Flight[], today: string) {
    const labels: Record<string, string> = {};
    const selected: Flight[] = [];
    const selectedKeys = new Set<string>();
    for (const holiday of holidays) {
        if (today > holiday.start) continue;
        for (const flight of flights) {
            if (flight.departure.date < today
                || flight.departure.date > holiday.start
                || flight.arrival.date < holiday.end
                || flight.price <= 0
                || flight.availableSeats === 0) continue;
            const key = holidayFlightKey(flight);
            if (selectedKeys.has(key)) {
                labels[key] = '개천절·한글날 연휴';
                continue;
            }
            selected.push(flight);
            selectedKeys.add(key);
            labels[key] = holiday.label;
        }
    }
    return { flights: selected, labels };
}
