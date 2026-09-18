import type { Metadata } from 'next';
import RedesignDashboard from '@/components/RedesignDashboard';
import { SITE_DESCRIPTION } from '@/lib/seo';
import { homeShareMetadata } from '@/lib/home-share-metadata';
import { homeRecommendation } from '@/lib/home-recommendation';
import { loadHomeFlightSnapshot } from '@/lib/server/home-flight-snapshot';

export const revalidate = 60;

const HOME_TITLE = '지금 나온 땡처리 항공권 | 티키티킷';

export function generateMetadata(): Metadata {
    return {
        title: { absolute: HOME_TITLE },
        description: SITE_DESCRIPTION,
        alternates: { canonical: '/' },
        ...homeShareMetadata,
    };
}

export default async function Home() {
    const data = await loadHomeFlightSnapshot();
    const initialFlights = homeRecommendation(data.flights, data.interparkPrices, data.priceHistory, {
        pinnedId: data.todayPickId, placements: data.manualFlightOrder?.placements,
    }).slice(0,72);
    return <main><RedesignDashboard
        initialFlights={initialFlights}
        initialFlightCount={data.flights.length}
        initialLastUpdated={data.lastUpdated || null}
        initialTodayPickId={data.todayPickId}
        initialTodayPickDate={data.todayPickDate}
        initialTodayPickFlightKeys={data.todayPickFlightKeys}
    /></main>;
}
