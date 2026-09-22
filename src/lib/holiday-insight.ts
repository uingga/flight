import type { Flight } from '@/types/flight';

export const holidayInsightCopy = {
    id: 'holiday-insight',
    eyebrow: '개천절·한글날 연휴',
    title: '개천절·한글날 연휴',
    description: '각 연휴 3일을 모두 포함한 항공권',
};

const holidays = [
    { label: '개천절 연휴', start: '2026-10-03', end: '2026-10-05', ids: ['ttang-ZE0831CJJYNJ-G5-2026-10-03', 'ttang-BX9115PUSIBR-G2-2026-10-03', 'ttang-7C3211ICNSPN-G2-2026-10-02'] },
    { label: '한글날 연휴', start: '2026-10-09', end: '2026-10-11', ids: ['modetour-SOPA-20180662', 'ttang-BX9115PUSIBR-G2-2026-10-09', 'ttang-7C3211ICNSPN-G2-2026-10-08', 'modetour-ASIA-19734389'] },
];

// Editorial selection: use only currently visible offers, never a saved price snapshot.
export function selectHolidayFlights(flights: Flight[], today: string) {
    const labels: Record<string, string> = {};
    const selected: Flight[] = [];
    for (const holiday of holidays) {
        if (today > holiday.start) continue;
        for (const id of holiday.ids) {
            const flight = flights.find(item => item.id === id
                && item.departure.date >= today
                && item.departure.date <= holiday.start
                && item.arrival.date >= holiday.end
                && item.price > 0
                && item.availableSeats !== 0);
            if (!flight) continue;
            selected.push(flight);
            labels[id] = holiday.label;
        }
    }
    return { flights: selected, labels };
}
