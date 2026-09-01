import type { Metadata } from 'next';
import RedesignDashboard from '@/components/RedesignDashboard';
import todayPickJson from '../../data/today-pick.json';
import { SITE_URL } from '@/lib/site';
import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/seo';
import {
    effectivePrice,
    loadActiveFlights,
    loadFlightCacheMeta,
    loadStaticInterparkPrices,
    loadStaticRecommendationPriceHistory,
} from '@/lib/flight-static';
import {
    buildRecommendationPresentation,
    buildRecommendationScoreState,
    compareRecommendedFlights,
} from '@/lib/flight-recommendation';

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
    const flights = loadActiveFlights();
    const todayPick = todayPickJson as { date?: string; flightId?: string };
    const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const currentPickId = todayPick.date === todayKst ? todayPick.flightId : null;
    return flights.find((flight) => flight.id === currentPickId)
        || [...flights].sort((a, b) => effectivePrice(a) - effectivePrice(b))[0];
}

export function generateMetadata(): Metadata {
    const flight = getFeaturedFlight();
    if (!flight) {
        return {
            title: { absolute: HOME_TITLE },
            description: SITE_DESCRIPTION,
            alternates: { canonical: '/' },
        };
    }

    const dep = cleanCity(flight.departure.city, '서울');
    const arr = cleanCity(flight.arrival.city, '지금 싼 곳');
    const priceText = `${effectivePrice(flight).toLocaleString('ko-KR')}원`;
    const routeTitle = `${dep} → ${arr} 왕복 ${priceText}`;
    const rawSeatText = flight.seats || (flight.availableSeats ? `${flight.availableSeats}석 남음` : '');
    const seatText = rawSeatText && !rawSeatText.includes('남음') ? `${rawSeatText} 남음` : rawSeatText;
    const shareDescription = [
        [shortDate(flight.departure.date), shortDate(flight.arrival.date)].filter(Boolean).join('–'),
        flight.airline,
        SOURCE_NAMES[flight.source] || flight.source,
        seatText,
    ].filter(Boolean).join(' · ');
    const fullTitle = `${routeTitle} | 티키티킷`;

    return {
        title: { absolute: HOME_TITLE },
        description: SITE_DESCRIPTION,
        alternates: { canonical: '/' },
        openGraph: {
            title: fullTitle,
            description: shareDescription,
            url: SITE_URL,
            siteName: SITE_NAME,
            images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: routeTitle }],
            locale: 'ko_KR',
            type: 'website',
        },
        twitter: {
            card: 'summary_large_image',
            title: fullTitle,
            description: shareDescription,
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
    const recommendationNow = Date.now();
    const recommendationState = buildRecommendationScoreState(
        allFlights,
        loadStaticInterparkPrices(allFlights),
        recommendationNow,
        loadStaticRecommendationPriceHistory(),
    );
    const rankedFlights = [...allFlights].sort((left, right) => compareRecommendedFlights(
        left,
        right,
        recommendationState.scores,
        recommendationNow,
        recommendationState.explanations,
    ));
    const pickedFlight = initialTodayPickId
        ? rankedFlights.find(flight => flight.id === initialTodayPickId)
        : undefined;
    const presentation = buildRecommendationPresentation(rankedFlights, recommendationState, {
        pinnedFlight: pickedFlight,
        balanceIncheon: true,
        now: recommendationNow,
    });
    const initialFlights = [
        ...(pickedFlight ? [pickedFlight] : []),
        ...presentation.orderedFlights,
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
