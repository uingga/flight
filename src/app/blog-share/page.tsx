import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/site';

const title = '티키티킷';
const description = '전국 여행사의 땡처리 항공권을 한눈에!';
const image = `${SITE_URL}/api/og?format=blog&brand=1&v=blog-mobile-safe-20260917`;
export const metadata: Metadata = {
    title, description,
    robots: { index: false, follow: true },
    alternates: { canonical: '/blog-share' },
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 720 }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
};

export default async function BlogHomeShare({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const sp = await searchParams;
    const query = new URLSearchParams({ utm_source: 'naver_blog' });
    for (const key of ['utm_medium', 'utm_campaign', 'utm_content']) {
        if (typeof sp[key] === 'string') query.set(key, sp[key]);
    }
    const target = `/?${query.toString()}`;
    return <><meta httpEquiv="refresh" content={`0;url=${target}`} /><a href={target}>티키티킷 항공권 보기</a></>;
}
