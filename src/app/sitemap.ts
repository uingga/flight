import { MetadataRoute } from 'next';
import { isIndexableCity, featuredCityOrder } from '@/lib/city-search-policy';
import { SITE_URL } from '@/lib/site';
import {
    loadActiveFlights, groupByCity, loadFlightCacheMeta,
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
        // Only maintained featured destinations with enough current inventory enter search.
        ...groupByCity(activeFlights)
            .filter(c => isIndexableCity(c.city, c.flights.length))
            .sort((a, b) => featuredCityOrder(a.city) - featuredCityOrder(b.city))
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
