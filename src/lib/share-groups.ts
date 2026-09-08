import type { Flight } from '@/types/flight';

export interface ShareGroup {
    /** Optional editorial heading for collections spanning several routes. */
    title?: string;
    routes?: Array<{ label: string; flightIds: string[] }>;
    departure: string;
    arrival: string;
    price: number;
    dateText: string;
    airline: string;
    source: string;
    flightIds: string[];
}

/** Only exact active IDs belong to a collection; never replace a missing ticket. */
export function resolveShareGroupFlights(group: ShareGroup, flights: Flight[]): Flight[] {
    const byId = new Map(flights.map(flight => [flight.id, flight]));
    return Array.from(new Set(group.flightIds)).flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
}

export const SHARE_GROUPS: Record<string, ShareGroup> = {
    'pus-260908': {
        title: '부산 출발 특가 5개',
        departure: '부산', arrival: '장가계·오사카·타이중·시즈오카·광저우',
        price: 199000, dateText: '9–10월 출발 · 노선별 일정 확인', airline: '제주항공·에어부산·진에어', source: '땡처리닷컴·모두투어',
        flightIds: [
            'ttang-7C8253PUSDYG-G11-2026-09-15', 'ttang-7C8253PUSDYG-G10-2026-09-19', 'ttang-7C8253PUSDYG-G10-2026-09-26',
            'modetour-JPN-20178714',
            'modetour-CHI-20107438', 'modetour-CHI-20107441', 'modetour-CHI-20107439',
            'modetour-JPN-19972825',
            'modetour-CHI-20081236', 'modetour-CHI-20081233', 'modetour-CHI-20081235', 'modetour-CHI-20081239',
        ],
        routes: [
            { label: '부산 → 장가계', flightIds: ['ttang-7C8253PUSDYG-G11-2026-09-15', 'ttang-7C8253PUSDYG-G10-2026-09-19', 'ttang-7C8253PUSDYG-G10-2026-09-26'] },
            { label: '부산 → 오사카', flightIds: ['modetour-JPN-20178714'] },
            { label: '부산 → 타이중', flightIds: ['modetour-CHI-20107438', 'modetour-CHI-20107441', 'modetour-CHI-20107439'] },
            { label: '부산 → 시즈오카', flightIds: ['modetour-JPN-19972825'] },
            { label: '부산 → 광저우', flightIds: ['modetour-CHI-20081236', 'modetour-CHI-20081233', 'modetour-CHI-20081235', 'modetour-CHI-20081239'] },
        ],
    },
    pqc1438: {
        departure: '인천',
        arrival: '푸꾸옥',
        price: 143800,
        dateText: '9.12–9.16 · 9.14–9.18',
        airline: '진에어',
        source: '모두투어',
        flightIds: [
            'modetour-manual-z3zer8',
            'modetour-manual-n6tqus',
        ],
    },
};
