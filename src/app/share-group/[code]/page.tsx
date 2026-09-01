import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import RedesignDashboard from '@/components/RedesignDashboard';
import { SITE_URL } from '@/lib/site';
import { loadActiveFlights, loadFlightCacheMeta } from '@/lib/flight-static';
import { SHARE_GROUPS, type ShareGroup } from '@/lib/share-groups';
import type { Flight } from '@/types/flight';

type Props = {
    params: Promise<{ code: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function getShareGroup(code: string): ShareGroup | null {
    return SHARE_GROUPS[code] || null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { code } = await params;
    const group = getShareGroup(decodeURIComponent(code));

    if (!group) {
        return {
            title: { absolute: '지금 나온 땡처리 항공권 | 티키티킷' },
            description: '6개 여행사의 땡처리 항공권 가격과 일정을 한곳에서 비교하세요.',
            robots: { index: false, follow: true },
        };
    }

    const priceText = `${group.price.toLocaleString('ko-KR')}원`;
    const title = `${group.departure} → ${group.arrival} 왕복 ${priceText} | 티키티킷`;
    const description = `${group.dateText} · ${group.airline} · ${group.source}`;
    const ogParams = new URLSearchParams({
        dep: group.departure,
        arr: group.arrival,
        price: String(group.price),
        date: group.dateText,
        v: `group-${code}`,
    });
    const ogImageUrl = `${SITE_URL}/api/og?${ogParams.toString()}`;

    return {
        title: { absolute: title },
        description,
        robots: { index: false, follow: true },
        alternates: { canonical: `/share-group/${code}` },
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

export default async function ShareGroupPage({ params, searchParams }: Props) {
    const { code } = await params;
    const group = getShareGroup(decodeURIComponent(code));

    if (!group) redirect('/');

    // searchParams is intentionally consumed by the route so Threads UTM values remain
    // on the visible URL while this page renders the selected cards directly.
    await searchParams;
    const allFlights = loadActiveFlights();
    const flightsById = new Map(allFlights.map(flight => [flight.id, flight]));
    const groupedFlights = group.flightIds
        .map(flightId => flightsById.get(flightId))
        .filter((flight): flight is Flight => Boolean(flight));
    const cacheMeta = loadFlightCacheMeta();

    return (
        <main>
            <RedesignDashboard
                initialFlights={groupedFlights}
                initialFlightCount={allFlights.length}
                initialLastUpdated={cacheMeta.timestamp || cacheMeta.lastUpdated || null}
                initialTodayPickId={null}
                initialSharedFlightIds={group.flightIds}
                initialSharedDeparture={group.departure}
                initialSharedArrival={group.arrival}
            />
        </main>
    );
}
