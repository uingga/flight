import { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
    const baseUrl = 'https://mitikit.com';

    return [
        {
            url: baseUrl,
            lastModified: new Date(),
            changeFrequency: 'hourly',
            priority: 1,
        },
    ];
}
