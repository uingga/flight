import { Metadata } from 'next';
import { redirect } from 'next/navigation';

type Props = {
    params: Promise<{ id: string }>;
};

// 캐시에서 항공편 조회
async function getFlightById(id: string) {
    try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://tikitikit.kr';
        const res = await fetch(`${baseUrl}/api/flights`, {
            next: { revalidate: 3600 } // 캐싱을 통해 불필요한 요청 방지
        });

        if (res.ok) {
            const data = await res.json();
            const flights = data.flights || [];
            return flights.find((f: { id: string }) => f.id === id) || null;
        }
    } catch (e) {
        console.error('Flight lookup error:', e);
    }
    return null;
}

// 가격 포맷
function formatPrice(price: number): string {
    if (price >= 10000) {
        const man = Math.floor(price / 10000);
        const chun = Math.floor((price % 10000) / 1000);
        return chun > 0 ? `${man}만${chun}천원` : `${man}만원`;
    }
    return `${price.toLocaleString()}원`;
}

// 여행사 이름
const SOURCE_NAMES: Record<string, string> = {
    hanatour: '하나투어',
    modetour: '모두투어',
    ybtour: '노랑풍선',
    onlinetour: '온라인투어',
    ttang: '땡처리닷컴',
    interpark: '인터파크',
};

// 날짜 포맷 (2026-03-01 → 3/1)
function shortDate(dateStr: string): string {
    if (!dateStr) return '';
    const match = dateStr.match(/(\d{4})[.-]?(\d{2})[.-]?(\d{2})/);
    if (match) return `${parseInt(match[2])}/${parseInt(match[3])}`;
    return dateStr;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { id } = await params;
    const flight = await getFlightById(decodeURIComponent(id));

    if (!flight) {
        return {
            title: '티키티킷 - 여행사 땡처리 항공권을 한 곳에서',
            description: '여행사 땡처리 항공권을 한 곳에서 비교하세요',
        };
    }

    const dep = flight.departure?.city?.replace(/\([^)]+\)/g, '').trim() || '서울';
    const arr = flight.arrival?.city?.replace(/\([^)]+\)/g, '').trim() || '';
    const priceText = formatPrice(flight.price);
    const depDate = shortDate(flight.departure?.date);
    const arrDate = shortDate(flight.arrival?.date);
    const dateRange = arrDate ? `${depDate}~${arrDate}` : depDate;
    const sourceName = SOURCE_NAMES[flight.source] || flight.source;

    const title = `✈️ ${dep} → ${arr} ${priceText}~ | 티키티킷`;
    const description = [
        `${dep} → ${arr}`,
        priceText + '~',
        dateRange,
        flight.airline,
        sourceName,
    ].filter(Boolean).join(' | ');

    // OG 이미지 URL — 최소 파라미터
    const ogParams = new URLSearchParams();
    ogParams.set('dep', dep);
    if (arr) ogParams.set('arr', arr);
    if (flight.price) ogParams.set('price', String(flight.price));
    if (dateRange) ogParams.set('date', dateRange);
    if (flight.airline) ogParams.set('airline', flight.airline);
    if (flight.source) ogParams.set('source', flight.source);

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://tikitikit.kr';
    const ogImageUrl = `${baseUrl}/api/og?${ogParams.toString()}`;

    return {
        title,
        description,
        alternates: {
            canonical: `/share/${id}`,
        },
        openGraph: {
            title,
            description,
            images: [{ url: ogImageUrl, width: 1200, height: 630 }],
            type: 'website',
            siteName: '티키티킷',
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
            images: [ogImageUrl],
        },
    };
}

export default async function SharePage({ params }: Props) {
    const { id } = await params;
    redirect(`/?flight=${encodeURIComponent(id)}`);
}
