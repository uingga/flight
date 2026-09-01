export interface ShareGroup {
    departure: string;
    arrival: string;
    price: number;
    dateText: string;
    airline: string;
    source: string;
    flightIds: string[];
}

export const SHARE_GROUPS: Record<string, ShareGroup> = {
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
