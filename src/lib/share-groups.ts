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

/** Published Threads links explicitly upgraded from a single flight to a collection. */
export const THREADS_SHARE_GROUP_OVERRIDES: Record<string, string> = {
    'modetour-ASIA-20136580': 'sgn-260914',
    'ttang-RF0384CJJIBR-G13-2026-10-10': 'ibr-260910',
};

export const SHARE_GROUPS: Record<string, ShareGroup> = {
    'can-260918': {
        departure: '부산',
        arrival: '광저우',
        price: 99000,
        dateText: '9.26–10.1 · 9.30–10.4',
        airline: '에어부산',
        source: '모두투어',
        flightIds: ['modetour-CHI-20081239', 'modetour-CHI-20081230'],
    },
    'china-260918': {
        title: '장가계·옌타이·광저우·상하이 항공권',
        departure: '대구·인천·부산·청주', arrival: '장가계·옌타이·광저우·상하이',
        price: 135000, dateText: '9–10월 출발 · 노선별 일정 확인',
        airline: '이스타항공·에어부산', source: '모두투어·땡처리닷컴',
        flightIds: [
            'modetour-CHI-20079724',
            'ttang-ZE0819ICNYNT-G1-2026-10-11', 'ttang-ZE0817ICNYNT-G23-2026-10-11',
            'ttang-ZE0819ICNYNT-G1-2026-10-12', 'ttang-ZE0817ICNYNT-G23-2026-10-12',
            'ttang-ZE0819ICNYNT-G1-2026-10-13', 'ttang-ZE0817ICNYNT-G23-2026-10-13',
            'ttang-ZE0819ICNYNT-G1-2026-10-14',
            'ttang-ZE0819ICNYNT-G1-2026-10-18', 'ttang-ZE0817ICNYNT-G23-2026-10-18',
            'modetour-CHI-20081239', 'modetour-CHI-20081238',
            'ttang-ZE0821CJJPVG-G17-2026-10-03', 'ttang-ZE0821CJJPVG-G17-2026-10-10', 'ttang-ZE0821CJJPVG-G17-2026-10-17',
        ],
        routes: [
            { label: '대구 → 장가계', flightIds: ['modetour-CHI-20079724'] },
            { label: '인천 → 옌타이', flightIds: [
                'ttang-ZE0819ICNYNT-G1-2026-10-11', 'ttang-ZE0817ICNYNT-G23-2026-10-11',
                'ttang-ZE0819ICNYNT-G1-2026-10-12', 'ttang-ZE0817ICNYNT-G23-2026-10-12',
                'ttang-ZE0819ICNYNT-G1-2026-10-13', 'ttang-ZE0817ICNYNT-G23-2026-10-13',
                'ttang-ZE0819ICNYNT-G1-2026-10-14',
                'ttang-ZE0819ICNYNT-G1-2026-10-18', 'ttang-ZE0817ICNYNT-G23-2026-10-18',
            ] },
            { label: '부산 → 광저우', flightIds: ['modetour-CHI-20081239', 'modetour-CHI-20081238'] },
            { label: '청주 → 상하이', flightIds: ['ttang-ZE0821CJJPVG-G17-2026-10-03', 'ttang-ZE0821CJJPVG-G17-2026-10-10', 'ttang-ZE0821CJJPVG-G17-2026-10-17'] },
        ],
    },
    'sha-260917': {
        departure: '청주',
        arrival: '상하이',
        price: 150100,
        dateText: '10.3–10.8 · 10.10–10.15 · 10.17–10.22',
        airline: '이스타항공',
        source: '땡처리닷컴 · 발권수수료 20,000원 별도',
        flightIds: [
            'ttang-ZE0821CJJPVG-G17-2026-10-03',
            'ttang-ZE0821CJJPVG-G17-2026-10-10',
            'ttang-ZE0821CJJPVG-G17-2026-10-17',
        ],
    },
    'cts-260915': {
        departure: '인천',
        arrival: '삿포로',
        price: 199000,
        dateText: '9.20(일)–9.23(수)',
        airline: '제주항공',
        source: '땡처리닷컴 · 발권수수료 20,000원 별도',
        flightIds: ['ttang-7C1501ICNCTS-G3-2026-09-20'],
    },
    'vietnam-260914': {
        title: '인천 출발 호치민·하노이',
        departure: '인천', arrival: '호치민·하노이',
        price: 210000, dateText: '10.5–10.8 · 10.6–10.9',
        airline: '썬푸꾸옥항공', source: '모두투어',
        flightIds: ['modetour-ASIA-20136581', 'modetour-ASIA-20136580', 'modetour-ASIA-20135786'],
        routes: [
            { label: '인천 → 호치민', flightIds: ['modetour-ASIA-20136581', 'modetour-ASIA-20136580'] },
            { label: '인천 → 하노이', flightIds: ['modetour-ASIA-20135786'] },
        ],
    },
    'sgn-260914': {
        departure: '인천',
        arrival: '호치민',
        price: 210000,
        dateText: '10.5–10.8 · 10.6–10.9',
        airline: '썬푸꾸옥항공',
        source: '모두투어',
        flightIds: ['modetour-ASIA-20136581', 'modetour-ASIA-20136580'],
    },
    'ibr-260910': {
        departure: '청주',
        arrival: '이바라키',
        price: 169000,
        dateText: '9.26–9.29 · 9.29–10.3 · 10.10–10.13',
        airline: '에어로케이',
        source: '땡처리닷컴',
        flightIds: [
            'ttang-RF0384CJJIBR-G11-2026-09-26',
            'ttang-RF0384CJJIBR-G14-2026-09-29',
            'ttang-RF0384CJJIBR-G13-2026-10-10',
        ],
    },
    'icn-260909': {
        title: '인천 출발 항공권 3개',
        departure: '인천', arrival: '나트랑·삿포로·하노이',
        price: 170000, dateText: '9월 출발 · 노선별 일정 확인',
        airline: '비엣젯항공·제주항공·썬푸꾸옥항공', source: '땡처리닷컴·모두투어',
        flightIds: [
            'ttang-VJ0835ICNCXR-G110-2026-09-13',
            'ttang-7C1501ICNCTS-G3-2026-09-18',
            'modetour-ASIA-20135807',
        ],
        routes: [
            { label: '인천 → 나트랑', flightIds: ['ttang-VJ0835ICNCXR-G110-2026-09-13'] },
            { label: '인천 → 삿포로', flightIds: ['ttang-7C1501ICNCTS-G3-2026-09-18'] },
            { label: '인천 → 하노이', flightIds: ['modetour-ASIA-20135807'] },
        ],
    },
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
