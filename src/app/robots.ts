import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
    const baseUrl = 'https://flito.vercel.app';

    return {
        rules: {
            userAgent: '*',
            allow: '/',
            disallow: '/api/', // API 라우트는 크롤링 제한
        },
        sitemap: `${baseUrl}/sitemap.xml`,
    };
}
