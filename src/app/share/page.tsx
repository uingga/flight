import { Metadata } from 'next';
import { redirect } from 'next/navigation';

type Props = {
    searchParams: Promise<{
        dep?: string;
        arr?: string;
        price?: string;
        date?: string;
        airline?: string;
        source?: string;
        flight?: string;
    }>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
    const params = await searchParams;
    const dep = params.dep || '서울';
    const arr = params.arr || '';
    const price = params.price || '';
    const date = params.date || '';
    const airline = params.airline || '';
    const source = params.source || '';

    // 가격 포맷
    const priceNum = parseInt(price);
    const priceText = priceNum
        ? priceNum >= 10000
            ? `${Math.floor(priceNum / 10000)}만${priceNum % 10000 ? Math.floor((priceNum % 10000) / 1000) + '천' : ''}원~`
            : `${priceNum.toLocaleString()}원~`
        : '';

    const title = arr
        ? `✈️ ${dep} → ${arr} ${priceText} | 티키티킷`
        : '티키티킷 - 여행사 땡처리 항공권을 한 곳에서';

    const description = [
        arr ? `${dep} → ${arr}` : '',
        priceText,
        date,
        airline,
    ].filter(Boolean).join(' | ') || '여행사 땡처리 항공권을 한 곳에서 비교하세요';

    // OG 이미지 URL
    const ogParams = new URLSearchParams();
    if (dep) ogParams.set('dep', dep);
    if (arr) ogParams.set('arr', arr);
    if (price) ogParams.set('price', price);
    if (date) ogParams.set('date', date);
    if (airline) ogParams.set('airline', airline);
    if (source) ogParams.set('source', source);
    const ogImageUrl = `/api/og?${ogParams.toString()}`;

    return {
        title,
        description,
        openGraph: {
            title,
            description,
            images: [{ url: ogImageUrl, width: 1200, height: 630 }],
            type: 'website',
            siteName: '티키티킷',
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
            images: [ogImageUrl],
        },
    };
}

export default async function SharePage({ searchParams }: Props) {
    const params = await searchParams;
    const flightId = params.flight || '';

    // 메인 페이지로 리다이렉트 (flight ID 포함)
    const redirectUrl = flightId ? `/?flight=${encodeURIComponent(flightId)}` : '/';
    redirect(redirectUrl);
}
