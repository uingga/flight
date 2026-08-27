import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { FlightOgCard } from './FlightOgCard';

export const runtime = 'edge';

async function getFontData(origin: string) {
    const [regular, semiBold, extraBold, logo] = await Promise.all([
        fetch(`${origin}/Fonts/Pretendard-OG-Regular.otf`, { cache: 'no-store' }),
        fetch(`${origin}/Fonts/Pretendard-OG-SemiBold.otf`, { cache: 'no-store' }),
        fetch(`${origin}/Fonts/Pretendard-OG-ExtraBold.otf`, { cache: 'no-store' }),
        fetch(`${origin}/Fonts/YeogiOttaeJalnan-OG.woff`, { cache: 'no-store' }),
    ]);
    if (!regular.ok || !semiBold.ok || !extraBold.ok || !logo.ok) throw new Error('Failed to fetch OG font data');

    return {
        regular: await regular.arrayBuffer(),
        semiBold: await semiBold.arrayBuffer(),
        extraBold: await extraBold.arrayBuffer(),
        logo: await logo.arrayBuffer(),
    };
}

export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;
    const dep = searchParams.get('dep') || '서울';
    const arr = searchParams.get('arr') || '지금 싼 곳';
    const price = Number.parseInt(searchParams.get('price') || '', 10);
    const priceText = Number.isFinite(price) ? `${price.toLocaleString('ko-KR')}원` : '';
    const dateText = searchParams.get('date') || '';
    const fontData = await getFontData(request.nextUrl.origin).catch((error) => {
        console.error('Font load error:', error);
        return null;
    });

    return new ImageResponse(
        (
            <FlightOgCard
                dep={dep}
                arr={arr}
                priceText={priceText}
                dateText={dateText}
            />
        ),
        {
            width: 1200,
            height: 630,
            ...(fontData
                ? {
                    fonts: [
                        {
                            name: 'Pretendard',
                            data: fontData.regular,
                            style: 'normal' as const,
                            weight: 400 as const,
                        },
                        {
                            name: 'Pretendard',
                            data: fontData.semiBold,
                            style: 'normal' as const,
                            weight: 600 as const,
                        },
                        {
                            name: 'Pretendard',
                            data: fontData.extraBold,
                            style: 'normal' as const,
                            weight: 800 as const,
                        },
                        {
                            name: 'YeogiOttaeJalnan',
                            data: fontData.logo,
                            style: 'normal' as const,
                            weight: 400 as const,
                        },
                    ],
                }
                : {}),
        },
    );
}
