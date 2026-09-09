import type { Metadata } from 'next';
import type { Flight } from '@/types/flight';
import flightCache from '../../../../data/all-flights-cache.json';
import UnknownCityInsightPreview from './UnknownCityInsightPreview';
import { LIJIANG_DISCOVERY, WEEKLY_DISCOVERY, matchesDiscoveryFlight } from '@/lib/weekly-discovery';
import WeeklyDiscoveryInsight from '@/components/WeeklyDiscoveryInsight';

export const metadata: Metadata = {
    title: '낯선 도시 인사이트바 미리보기',
    description: '지금 갈 수 있는 낯선 도시 인사이트바 디자인 미리보기',
    robots: {
        index: false,
        follow: false,
        googleBot: { index: false, follow: false },
    },
};

export default function UnknownCityInsightPreviewPage({ searchParams }: { searchParams?: { city?: string } }) {
    const item = searchParams?.city === 'lijiang' ? LIJIANG_DISCOVERY : WEEKLY_DISCOVERY;
    const weeklyFlights = (flightCache.flights as unknown as Flight[])
        .filter(flight => matchesDiscoveryFlight(flight, item)
            && flight.price > 0 && flight.link)
        .sort((a, b) => a.price - b.price);

    return (
        <UnknownCityInsightPreview>
            <WeeklyDiscoveryInsight flights={weeklyFlights} item={item} />
        </UnknownCityInsightPreview>
    );
}
