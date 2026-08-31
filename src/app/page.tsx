import type { Metadata } from 'next';
import RedesignDashboard from '@/components/RedesignDashboard';
import flightCacheJson from '../../data/all-flights-cache.json';
import todayPickJson from '../../data/today-pick.json';
import type { Flight } from '@/types/flight';
import { SITE_URL } from '@/lib/site';
import {
    effectivePrice as staticEffectivePrice,
    loadActiveFlights,
    loadFlightCacheMeta,
} from '@/lib/flight-static';
import { getComparisonPriceTier } from '@/lib/price-quality';

const SOURCE_NAMES: Record<string, string> = {
    hanatour: '하나투어',
    modetour: '모두투어',
    ybtour: '노랑풍선',
    onlinetour: '온라인투어',
    ttang: '땡처리닷컴',
    myrealtrip: '마이리얼트립',
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const HOME_TITLE = '지금 나온 땡처리 항공권 | 티키티킷';

function cleanCity(city: string | undefined, fallback: string) {
    return city?.replace(/\([^)]+\)/g, '').trim() || fallback;
}

function shortDate(dateText: string | undefined) {
    if (!dateText) return '';
    const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return dateText;
    const [, year, month, day] = match;
    const weekday = WEEKDAYS[new Date(`${year}-${month}-${day}T00:00:00+09:00`).getDay()];
    return `${Number(month)}.${Number(day)}(${weekday})`;
}

function getFeaturedFlight() {
    const cache = flightCacheJson as unknown as { flights: Flight[] };
    const todayPick = todayPickJson as { flightId?: string };
    return cache.flights.find((flight) => flight.id === todayPick.flightId)
        || cache.flights.filter((flight) => flight.price > 0).sort((a, b) => a.price - b.price)[0];
}

export function generateMetadata(): Metadata {
    const flight = getFeaturedFlight();
    if (!flight) return {};

    const dep = cleanCity(flight.departure.city, '서울');
    const arr = cleanCity(flight.arrival.city, '지금 싼 곳');
    const priceText = `${flight.price.toLocaleString('ko-KR')}원`;
    const routeTitle = `${dep} → ${arr} 왕복 ${priceText}`;
    const rawSeatText = flight.seats || (flight.availableSeats ? `${flight.availableSeats}석 남음` : '');
    const seatText = rawSeatText && !rawSeatText.includes('남음') ? `${rawSeatText} 남음` : rawSeatText;
    const description = [
        [shortDate(flight.departure.date), shortDate(flight.arrival.date)].filter(Boolean).join('–'),
        flight.airline,
        SOURCE_NAMES[flight.source] || flight.source,
        seatText,
    ].filter(Boolean).join(' · ');
    const fullTitle = `${routeTitle} | 티키티킷`;

    return {
        title: { absolute: HOME_TITLE },
        description,
        alternates: { canonical: '/' },
        openGraph: {
            title: fullTitle,
            description,
            url: SITE_URL,
            siteName: '티키티킷',
            images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: routeTitle }],
            locale: 'ko_KR',
            type: 'website',
        },
        twitter: {
            card: 'summary_large_image',
            title: fullTitle,
            description,
            images: ['/opengraph-image'],
        },
    };
}

export default function Home() {
    const allFlights = loadActiveFlights();
    const cacheMeta = loadFlightCacheMeta();
    const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const initialTodayPickId = todayPickJson.date === todayKst
        && typeof todayPickJson.flightId === 'string'
        && allFlights.some(flight => flight.id === todayPickJson.flightId)
        ? todayPickJson.flightId
        : null;
    const rankedFlights = [...allFlights].sort((left, right) => (
        getComparisonPriceTier(left) - getComparisonPriceTier(right)
        || staticEffectivePrice(left) - staticEffectivePrice(right)
        || left.id.localeCompare(right.id)
    ));
    const pickedFlight = initialTodayPickId
        ? rankedFlights.find(flight => flight.id === initialTodayPickId)
        : undefined;
    const initialFlights = [
        ...(pickedFlight ? [pickedFlight] : []),
        ...rankedFlights.filter(flight => flight.id !== initialTodayPickId),
    ].slice(0, 72);

    return (
        <main>
            <RedesignDashboard
                initialFlights={initialFlights}
                initialFlightCount={allFlights.length}
                initialLastUpdated={cacheMeta.timestamp || cacheMeta.lastUpdated || null}
                initialTodayPickId={initialTodayPickId}
            />
        </main>
    );
}
