import type { Metadata } from 'next';
import RedesignDashboard from '@/components/RedesignDashboard';
import todayPickJson from '../../data/today-pick.json';
import { SITE_DESCRIPTION } from '@/lib/seo';
import { homeShareMetadata } from '@/lib/home-share-metadata';
import {
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

const HOME_TITLE = '지금 나온 땡처리 항공권 | 티키티킷';

export function generateMetadata(): Metadata {
    return {
        title: { absolute: HOME_TITLE },
        description: SITE_DESCRIPTION,
        alternates: { canonical: '/' },
        ...homeShareMetadata,
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
