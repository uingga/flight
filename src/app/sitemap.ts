import { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
    const baseUrl = 'https://mytikit.vercel.app';

    return [
        {
            url: baseUrl,
            lastModified: new Date(),
            changeFrequency: 'hourly',
            priority: 1,
        },
    ];
}
