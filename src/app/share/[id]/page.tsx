import { Metadata } from 'next';
import { SITE_URL } from '@/lib/site';

type Props = {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

// 캐시에서 항공편 조회
async function getFlightById(id: string) {
    try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || SITE_URL;
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
    myrealtrip: '마이리얼트립',
    interpark: '인터파크',
};

// 날짜 포맷 (2026-03-01 → 3/1)
function shortDate(dateStr: string): string {
    if (!dateStr) return '';
    const match = dateStr.match(/(\d{4})[.-]?(\d{2})[.-]?(\d{2})/);
    if (match) return `${parseInt(match[2])}/${parseInt(match[3])}`;
    return dateStr;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
    const { id } = await params;
    const sp = await searchParams;
    const flight = await getFlightById(decodeURIComponent(id));

    if (!flight) {
        return {
            title: '지금 나온 땡처리 항공권 | 티키티킷',
            description: '여행사마다 따로 올라오는 저렴한 표를 한곳에서 확인하세요.',
        };
    }

    const dep = flight.departure?.city?.replace(/\([^)]+\)/g, '').trim() || '서울';
    const arr = flight.arrival?.city?.replace(/\([^)]+\)/g, '').trim() || '';
    const priceText = formatPrice(flight.price);
    const depDate = shortDate(flight.departure?.date);
    const arrDate = shortDate(flight.arrival?.date);
    const dateRange = arrDate ? `${depDate}~${arrDate}` : depDate;
    const sourceName = SOURCE_NAMES[flight.source] || flight.source;

    const title = `${dep}에서 ${arr}, 왕복 ${priceText} | 티키티킷`;
    const description = [
        dateRange,
        flight.airline,
        sourceName ? `${sourceName}에서 발견한 땡처리 항공권` : '지금 발견한 땡처리 항공권',
    ].filter(Boolean).join(' · ');

    // OG 이미지 URL — 최소 파라미터
    const ogParams = new URLSearchParams();
    ogParams.set('dep', dep);
    if (arr) ogParams.set('arr', arr);
    if (flight.price) ogParams.set('price', String(flight.price));
    if (dateRange) ogParams.set('date', dateRange);
    if (flight.airline) ogParams.set('airline', flight.airline);
    if (flight.source) ogParams.set('source', flight.source);
    if (typeof sp.v === 'string' && sp.v) ogParams.set('v', sp.v);

    const baseUrl = SITE_URL;
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

export default async function SharePage({ params, searchParams }: Props) {
    const { id } = await params;
    const sp = await searchParams;
    const flight = await getFlightById(decodeURIComponent(id));

    // Fallback 파라미터: flight ID가 변경되어도 같은 노선 항공편을 찾을 수 있도록
    // 소스 우선순위: 1) URL 쿼리 파라미터 (공유 시 삽입됨) 2) API에서 조회한 flight 데이터
    const fallbackParams = new URLSearchParams();
    fallbackParams.set('flight', id);

    const dep = (sp.dep as string) || flight?.departure?.city?.replace(/\([^)]+\)/g, '').trim();
    const arr = (sp.arr as string) || flight?.arrival?.city?.replace(/\([^)]+\)/g, '').trim();
    const date = (sp.date as string) || flight?.departure?.date?.replace(/[^0-9\-\.]/g, '').replace(/\./g, '-').replace(/-+$/, '');

    if (dep) fallbackParams.set('dep', dep);
    if (arr) fallbackParams.set('arr', arr);
    if (date) fallbackParams.set('date', date);

    const redirectUrl = `/?${fallbackParams.toString()}`;

    return (
        <html>
            <head>
                <meta httpEquiv="refresh" content={`0;url=${redirectUrl}`} />
                <script dangerouslySetInnerHTML={{
                    __html: `window.location.replace("${redirectUrl}");`
                }} />
            </head>
            <body>
                <p>이동 중입니다...</p>
            </body>
        </html>
    );
}
