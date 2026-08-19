import { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';
import { loadActiveFlights, groupByCity } from '@/lib/flight-static';

export default function sitemap(): MetadataRoute.Sitemap {
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
            lastModified: new Date(),
            changeFrequency: 'daily' as const,
            priority: 1,
        },
        {
            url: `${SITE_URL}/tips`,
            lastModified: new Date(),
            changeFrequency: 'weekly' as const,
            priority: 0.8,
        },
        {
            url: `${SITE_URL}/drop`,
            lastModified: new Date(),
            changeFrequency: 'daily' as const,
            priority: 0.9,
        },
        ...tipSlugs.map(slug => ({
            url: `${SITE_URL}/tips/${slug}`,
            lastModified: new Date(),
            changeFrequency: 'monthly' as const,
            priority: 0.7,
        })),
        // 도시별 땡처리 항공권 페이지 — 캐시 커밋마다 재빌드되므로 daily
        ...groupByCity(loadActiveFlights()).map(c => ({
            url: `${SITE_URL}/flights/${encodeURIComponent(c.city)}`,
            lastModified: new Date(),
            changeFrequency: 'daily' as const,
            priority: 0.8,
        })),
        {
            url: `${SITE_URL}/terms`,
            lastModified: new Date(),
            changeFrequency: 'monthly' as const,
            priority: 0.3,
        },
        {
            url: `${SITE_URL}/privacy`,
            lastModified: new Date(),
            changeFrequency: 'monthly' as const,
            priority: 0.3,
        },
    ];
}
