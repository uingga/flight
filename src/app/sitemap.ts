import { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';
import {
    loadActiveFlights, groupByCity, loadFlightCacheMeta, MIN_INDEXABLE_CITY_FLIGHTS,
} from '@/lib/flight-static';
import currentDropJson from '../../data/marketing/current-drop.json';

interface CurrentDropData {
    deals?: Array<{ flightId?: string }>;
    updatedAt?: string;
    publishedAt?: string;
}

function safeDate(value: string | undefined): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

export default function sitemap(): MetadataRoute.Sitemap {
    const activeFlights = loadActiveFlights();
    const activeFlightIds = new Set(activeFlights.map(flight => flight.id));
    const currentDrop = currentDropJson as CurrentDropData;
    const hasLiveDrop = currentDrop.deals?.some(deal => deal.flightId && activeFlightIds.has(deal.flightId)) ?? false;
    const cacheMeta = loadFlightCacheMeta();
    const cacheModified = safeDate(cacheMeta.timestamp || cacheMeta.lastUpdated);
    const dropModified = safeDate(currentDrop.updatedAt || currentDrop.publishedAt);

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
        ...(hasLiveDrop ? [{
            url: `${SITE_URL}/drop`,
            lastModified: dropModified,
            changeFrequency: 'daily' as const,
            priority: 0.9,
        }] : []),
        {
            url: `${SITE_URL}/tips/price-watch`,
            changeFrequency: 'monthly' as const,
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
