import { ImageResponse } from 'next/og';
import flightCacheJson from '../../data/all-flights-cache.json';
import todayPickJson from '../../data/today-pick.json';
import { FlightOgCard } from './api/og/FlightOgCard';
import type { Flight } from '@/types/flight';

export const runtime = 'edge';
export const alt = '티키티킷 오늘의 땡처리 항공권';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

function cleanCity(city: string | undefined, fallback: string) {
    return city?.replace(/\([^)]+\)/g, '').trim() || fallback;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function shortDate(dateText: string | undefined) {
    if (!dateText) return '';
    const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return dateText;
    const [, year, month, day] = match;
    const weekday = WEEKDAYS[new Date(`${year}-${month}-${day}T00:00:00+09:00`).getDay()];
    return `${Number(month)}.${Number(day)}(${weekday})`;
}

async function getFontData() {
    // Keep font binaries out of the Edge Function bundle. Vercel's Hobby plan
    // limits each Edge Function to 1 MB, while the Korean font files are much
    // larger. They are still served as public assets and fetched at runtime.
    const assetBaseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'https://www.tikitikit.kr').replace(/\/$/, '');
    const [regular, semiBold, extraBold, logo] = await Promise.all([
        fetch(`${assetBaseUrl}/Fonts/Pretendard-OG-Regular.otf`, { cache: 'force-cache' }),
        fetch(`${assetBaseUrl}/Fonts/Pretendard-OG-SemiBold.otf`, { cache: 'force-cache' }),
        fetch(`${assetBaseUrl}/Fonts/Pretendard-OG-ExtraBold.otf`, { cache: 'force-cache' }),
        fetch(`${assetBaseUrl}/Fonts/YeogiOttaeJalnan-OG.woff`, { cache: 'force-cache' }),
    ]);
    if (!regular.ok || !semiBold.ok || !extraBold.ok || !logo.ok) throw new Error('Failed to fetch OG font data');

    return {
        regular: await regular.arrayBuffer(),
        semiBold: await semiBold.arrayBuffer(),
        extraBold: await extraBold.arrayBuffer(),
        logo: await logo.arrayBuffer(),
    };
}

export default async function Image() {
    const cache = flightCacheJson as unknown as { flights: Flight[] };
    const todayPick = todayPickJson as { flightId?: string };
    const selectedFlight =
        cache.flights.find((flight) => flight.id === todayPick.flightId)
        || cache.flights.filter((flight) => flight.price > 0).sort((a, b) => a.price - b.price)[0];

    const dep = cleanCity(selectedFlight?.departure.city, '서울');
    const arr = cleanCity(selectedFlight?.arrival.city, '지금 싼 곳');
    const priceText = selectedFlight?.price
        ? `${selectedFlight.price.toLocaleString('ko-KR')}원`
        : '';
    const dateText = selectedFlight
        ? [shortDate(selectedFlight.departure.date), shortDate(selectedFlight.arrival.date)].filter(Boolean).join('–')
        : '';
    const fontData = await getFontData().catch((error) => {
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
            ...size,
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
