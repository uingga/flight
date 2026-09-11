import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { FlightOgCard } from './FlightOgCard';
import { SHARE_GROUPS } from '@/lib/share-groups';

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
    const blog = searchParams.get('format') === 'blog';
    const group = SHARE_GROUPS[searchParams.get('group') || ''];
    const fontData = await getFontData(request.nextUrl.origin).catch((error) => {
        console.error('Font load error:', error);
        return null;
    });

    return new ImageResponse(
        (
            group?.title ? <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', background: '#ff385c', color: 'white', padding: '70px', fontFamily: 'Pretendard' }}>
                <div style={{ display: 'flex', fontSize: 30, fontWeight: 600 }}>티키티킷 · 함께 보는 항공권</div>
                <div style={{ display: 'flex', fontSize: 72, fontWeight: 800, marginTop: 32 }}>{group.title}</div>
                <div style={{ display: 'flex', fontSize: 32, marginTop: 28 }}>{group.arrival}</div>
                <div style={{ display: 'flex', fontSize: 26, marginTop: 28 }}>소개한 노선 모음 · 현재 가능한 일정은 페이지에서 확인</div>
            </div> : <FlightOgCard
                dep={dep}
                arr={arr}
                priceText={priceText}
                dateText={dateText}
                format={blog ? 'blog' : 'default'}
                priceNote={blog && searchParams.get('fee') === 'included' ? '발권수수료 포함' : ''}
            />
        ),
        {
            width: 1200,
            height: blog ? 800 : 630,
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
