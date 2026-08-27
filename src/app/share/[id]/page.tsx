import { Metadata } from 'next';
import { SITE_URL } from '@/lib/site';
import shareSnapshots from '../../../../data/share-snapshots.json';

type Props = {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

type ShareSnapshot = {
    dep: string;
    arr: string;
    price: number;
    date: string;
    airline: string;
    source: string;
};

type ArchivedFlight = {
    flight_id: string;
    source: string;
    departure_city: string;
    arrival_city: string;
    departure_date: string | null;
    return_date: string | null;
    airline: string | null;
    listed_price: number;
};

function getShareSnapshot(id: string): ShareSnapshot | null {
    return (shareSnapshots as Record<string, ShareSnapshot>)[id] || null;
}

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

function formatPrice(price: number): string {
    return `${price.toLocaleString('ko-KR')}원`;
}

async function getArchivedFlightById(id: string): Promise<ArchivedFlight | null> {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) return null;

    try {
        const endpoint = new URL(`${supabaseUrl}/rest/v1/flight_price_daily`);
        endpoint.searchParams.set('flight_id', `eq.${id}`);
        endpoint.searchParams.set(
            'select',
            'flight_id,source,departure_city,arrival_city,departure_date,return_date,airline,listed_price',
        );
        endpoint.searchParams.set('order', 'snapshot_date.desc');
        endpoint.searchParams.set('limit', '1');

        const response = await fetch(endpoint, {
            headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
            },
            next: { revalidate: 300 },
        });
        if (!response.ok) return null;
        const rows = await response.json() as ArchivedFlight[];
        return rows[0] || null;
    } catch (error) {
        console.error('Archived flight lookup error:', error);
        return null;
    }
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

// 외부 글에 이미 게시된 공유 주소는 유지하면서, 판매가 끝난 상품을
// 현재 판매 중인 동일 일정 상품으로 넘긴다.
const SHARE_ID_ALIASES: Record<string, string> = {
    'online-260831116869': 'online-260830116868',
};

function resolveShareId(id: string): string {
    return SHARE_ID_ALIASES[id] || id;
}

// 날짜 포맷 (2026-03-01 → 3/1)
function shortDate(dateStr: string): string {
    if (!dateStr) return '';
    const match = dateStr.match(/(\d{4})[.-]?(\d{2})[.-]?(\d{2})/);
    if (match) return `${parseInt(match[2])}/${parseInt(match[3])}`;
    return dateStr;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function ogShortDate(dateStr: string): string {
    if (!dateStr) return '';
    const match = dateStr.match(/(\d{4})[.-]?(\d{2})[.-]?(\d{2})/);
    if (!match) return dateStr;
    const [, year, month, day] = match;
    const weekday = WEEKDAYS[new Date(`${year}-${month}-${day}T00:00:00+09:00`).getDay()];
    return `${parseInt(month)}.${parseInt(day)}(${weekday})`;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
    const { id } = await params;
    const sp = await searchParams;
    const decodedId = decodeURIComponent(id);
    const flight = await getFlightById(resolveShareId(decodedId));
    const archivedFlight = flight ? null : await getArchivedFlightById(resolveShareId(decodedId));

    if (!flight) {
        const snapshot = getShareSnapshot(decodeURIComponent(id));
        const archivedDate = archivedFlight
            ? [ogShortDate(archivedFlight.departure_date || ''), ogShortDate(archivedFlight.return_date || '')]
                .filter(Boolean)
                .join('–')
            : '';
        const fallbackDep = typeof sp.dep === 'string' ? sp.dep : snapshot?.dep || archivedFlight?.departure_city || '';
        const fallbackArr = typeof sp.arr === 'string' ? sp.arr : snapshot?.arr || archivedFlight?.arrival_city || '';
        const fallbackPrice = typeof sp.price === 'string' ? Number(sp.price) : snapshot?.price || archivedFlight?.listed_price || 0;
        const fallbackDate = typeof sp.date === 'string' ? sp.date : snapshot?.date || archivedDate;
        const fallbackAirline = typeof sp.airline === 'string' ? sp.airline : snapshot?.airline || archivedFlight?.airline || '';
        const fallbackSource = typeof sp.source === 'string' ? sp.source : snapshot?.source || archivedFlight?.source || '';

        if (fallbackArr) {
            const priceText = fallbackPrice > 0 ? formatPrice(fallbackPrice) : '';
            const sourceName = SOURCE_NAMES[fallbackSource] || fallbackSource;
            const routeText = `${fallbackDep || '서울'} → ${fallbackArr}`;
            const title = priceText
                ? `${routeText} 왕복 ${priceText} | 티키티킷`
                : `${routeText} | 티키티킷`;
            const description = [
                fallbackDate,
                fallbackAirline,
                sourceName || '지금 발견한 땡처리 항공권',
            ].filter(Boolean).join(' · ');
            const ogParams = new URLSearchParams({ dep: fallbackDep || '서울', arr: fallbackArr });
            if (fallbackPrice > 0) ogParams.set('price', String(fallbackPrice));
            if (fallbackDate) ogParams.set('date', fallbackDate);
            if (typeof sp.v === 'string' && sp.v) ogParams.set('v', sp.v);
            const ogImageUrl = `${SITE_URL}/api/og?${ogParams.toString()}`;

            return {
                title,
                description,
                alternates: { canonical: `/share/${id}` },
                openGraph: {
                    title,
                    description,
                    images: [{ url: ogImageUrl, width: 1200, height: 630 }],
                    type: 'website',
                    siteName: '티키티킷',
                },
                twitter: { card: 'summary_large_image', title, description, images: [ogImageUrl] },
            };
        }

        return {
            title: '지금 나온 땡처리 항공권 | 티키티킷',
            description: '6개 여행사의 땡처리 항공권 가격과 일정을 한곳에서 비교하세요.',
        };
    }

    const dep = flight.departure?.city?.replace(/\([^)]+\)/g, '').trim() || '서울';
    const arr = flight.arrival?.city?.replace(/\([^)]+\)/g, '').trim() || '';
    const priceText = formatPrice(flight.price);
    const depDate = shortDate(flight.departure?.date);
    const arrDate = shortDate(flight.arrival?.date);
    const dateRange = arrDate ? `${depDate}~${arrDate}` : depDate;
    const sourceName = SOURCE_NAMES[flight.source] || flight.source;

    const rawSeatText = flight.seats || (flight.availableSeats ? `${flight.availableSeats}석 남음` : '');
    const seatText = rawSeatText && !rawSeatText.includes('남음') ? `${rawSeatText} 남음` : rawSeatText;
    const title = `${dep} → ${arr} 왕복 ${priceText} | 티키티킷`;
    const description = [
        dateRange,
        flight.airline,
        sourceName || '지금 발견한 땡처리 항공권',
        seatText,
    ].filter(Boolean).join(' · ');

    // OG 이미지 URL — 최소 파라미터
    const ogParams = new URLSearchParams();
    ogParams.set('dep', dep);
    if (arr) ogParams.set('arr', arr);
    if (flight.price) ogParams.set('price', String(flight.price));
    const ogDateRange = [ogShortDate(flight.departure?.date), ogShortDate(flight.arrival?.date)].filter(Boolean).join('–');
    if (ogDateRange) ogParams.set('date', ogDateRange);
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
    const decodedId = decodeURIComponent(id);
    const resolvedId = resolveShareId(decodedId);
    const flight = await getFlightById(resolvedId);
    const snapshot = getShareSnapshot(decodedId);
    const archivedFlight = flight ? null : await getArchivedFlightById(resolvedId);

    // Fallback 파라미터: flight ID가 변경되어도 같은 노선 항공편을 찾을 수 있도록
    // 소스 우선순위: 1) URL 쿼리 파라미터 (공유 시 삽입됨) 2) API에서 조회한 flight 데이터
    const fallbackParams = new URLSearchParams();
    fallbackParams.set('flight', resolvedId);

    const dep = (sp.dep as string)
        || flight?.departure?.city?.replace(/\([^)]+\)/g, '').trim()
        || snapshot?.dep
        || archivedFlight?.departure_city;
    const arr = (sp.arr as string)
        || flight?.arrival?.city?.replace(/\([^)]+\)/g, '').trim()
        || snapshot?.arr
        || archivedFlight?.arrival_city;
    const date = (sp.date as string)
        || flight?.departure?.date?.replace(/[^0-9\-\.]/g, '').replace(/\./g, '-').replace(/-+$/, '')
        || snapshot?.date
        || archivedFlight?.departure_date
        || undefined;

    if (dep) fallbackParams.set('dep', dep);
    if (arr) fallbackParams.set('arr', arr);
    if (date) fallbackParams.set('date', date);

    // 외부 콘텐츠에서 공유 링크로 바로 들어온 경우에도 캠페인 출처를 잃지 않는다.
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
        const value = sp[key];
        if (typeof value === 'string' && value) fallbackParams.set(key, value);
    }

    const redirectUrl = `/?${fallbackParams.toString()}`;

    return (
        <html>
            <head>
                <meta httpEquiv="refresh" content={`0;url=${redirectUrl}`} />
                <script dangerouslySetInnerHTML={{
                    __html: `window.location.replace(${JSON.stringify(redirectUrl)});`
                }} />
            </head>
            <body>
                <p>이동 중입니다...</p>
            </body>
        </html>
    );
}
