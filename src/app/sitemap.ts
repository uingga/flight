import { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';
import {
    loadActiveFlights, groupByCity, loadFlightCacheMeta, loadStaticRecommendationPriceHistory,
    MIN_INDEXABLE_CITY_FLIGHTS,
} from '@/lib/flight-static';
function safeDate(value: string | undefined): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

export default function sitemap(): MetadataRoute.Sitemap {
    const activeFlights = loadActiveFlights();
    const cacheMeta = loadFlightCacheMeta();
    const cacheModified = safeDate(cacheMeta.timestamp || cacheMeta.lastUpdated);
    const priceHistoryLatest = Object.values(loadStaticRecommendationPriceHistory())
        .flat()
        .map(point => point.date)
        .filter(Boolean)
        .sort()
        .at(-1);
    const priceHistoryModified = safeDate(priceHistoryLatest
        ? `${priceHistoryLatest}T00:00:00+09:00`
        : undefined);

    return [
        {
            url: SITE_URL,
            lastModified: cacheModified,
            changeFrequency: 'daily' as const,
            priority: 1,
        },
        {
            url: `${SITE_URL}/about`,
            lastModified: cacheModified,
            changeFrequency: 'weekly' as const,
            priority: 0.8,
        },
        {
            url: `${SITE_URL}/tips/price-watch`,
            lastModified: priceHistoryModified,
            changeFrequency: 'daily' as const,
            priority: 0.8,
        },
        // 1~2장뿐인 도시는 사용자 검색으로는 열어두되 대량 색인은 피한다.
        ...groupByCity(activeFlights)
            .filter(c => c.flights.length >= MIN_INDEXABLE_CITY_FLIGHTS)
            .map(c => ({
            url: `${SITE_URL}/flights/${encodeURIComponent(c.city)}`,
            lastModified: cacheModified,
            changeFrequency: 'daily' as const,
            priority: 0.8,
            })),
        {
            url: `${SITE_URL}/terms`,
            changeFrequency: 'monthly' as const,
            priority: 0.3,
        },
        {
            url: `${SITE_URL}/privacy`,
            changeFrequency: 'monthly' as const,
            priority: 0.3,
        },
    ];
}
