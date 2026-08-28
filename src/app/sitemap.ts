import { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';
import { loadActiveFlights, groupByCity, loadFlightCacheMeta } from '@/lib/flight-static';
import currentDropJson from '../../data/marketing/current-drop.json';

function safeDate(value: string | undefined): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

export default function sitemap(): MetadataRoute.Sitemap {
    const cacheMeta = loadFlightCacheMeta();
    const cacheModified = safeDate(cacheMeta.timestamp || cacheMeta.lastUpdated);
    const dropModified = safeDate((currentDropJson as { updatedAt?: string; publishedAt?: string }).updatedAt
        || (currentDropJson as { publishedAt?: string }).publishedAt);
    const tipSlugs = [
        'price-watch',
        'cheap-flights-101',
        'regional-airports',
        'faq-10',
        'japan-cherry-blossom',
        'southeast-asia-seasons',
        'cheap-tickets-2026',
        'is-it-really-cheap',
    ];

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
            url: `${SITE_URL}/tips`,
            changeFrequency: 'weekly' as const,
            priority: 0.8,
        },
        {
            url: `${SITE_URL}/drop`,
            lastModified: dropModified,
            changeFrequency: 'daily' as const,
            priority: 0.9,
        },
        ...tipSlugs.map(slug => ({
            url: `${SITE_URL}/tips/${slug}`,
            changeFrequency: 'monthly' as const,
            priority: 0.7,
        })),
        // 도시별 땡처리 항공권 페이지 — 캐시 커밋마다 재빌드되므로 daily
        ...groupByCity(loadActiveFlights()).map(c => ({
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
