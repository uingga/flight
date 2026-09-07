import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import AdminFlightInterest from '@/components/AdminFlightInterest';
import { flightOrderStorageMode } from '@/lib/server/flight-order-store';
import { parseFlightInterest, unavailableFlightInterest } from '@/lib/flight-interest';

export const dynamic = 'force-dynamic';
export const metadata = { title: '항공권 클릭 통계 미리보기', robots: { index: false, follow: false } };

export default function FlightInterestPreview({ searchParams }: { searchParams: { state?: string } }) {
    const host = headers().get('host')?.split(':')[0];
    if (!['localhost', '127.0.0.1'].includes(host || '') || process.env.VERCEL || flightOrderStorageMode() !== 'preview' || !process.env.ADMIN_KEY) notFound();
    const demo = (label: string, multiplier: number) => parseFlightInterest({ rows: Array.from({ length: 13 }, (_, index) => ({
        dimensionValues: ['booking_click', index === 12 ? '(not set)' : `demo-${label}-${index + 1}`, `인천-${['도쿄', '오사카', '후쿠오카', '방콕'][index % 4]}`, 'ybtour', '2026-09-20', '2026-09-23', '진에어', '159000'].map(value => ({ value })),
        metricValues: [{ value: String((12 - index + 1) * multiplier) }],
    })).concat(Array.from({ length: 12 }, (_, index) => ({
        dimensionValues: ['detail_open', `demo-${label}-${index + 1}`, `인천-${['도쿄', '오사카', '후쿠오카', '방콕'][index % 4]}`].map(value => ({ value })),
        metricValues: [{ value: String((index + 1) * multiplier) }],
    }))) });
    const data = { today: demo('today', 1), recent7: demo('7days', 3), current: demo('30days', 7) };
    if (searchParams.state === 'empty') for (const key of ['today', 'recent7', 'current'] as const) data[key] = parseFlightInterest({});
    if (searchParams.state === 'unavailable') for (const key of ['today', 'recent7', 'current'] as const) data[key] = unavailableFlightInterest('항공권별 기록을 불러오지 못했습니다. GA4 항공권 ID 측정기준 설정과 조회 상태를 확인해 주세요.');
    const cities = [
        { city: '도쿄', details: { events: 20 }, bookings: { events: 5 }, searches: { events: 3 }, saves: { events: 2 }, shares: { events: 1 } },
        { city: '방콕', details: { events: 50 }, bookings: { events: 2 }, searches: { events: 2 }, saves: { events: 1 }, shares: { events: 0 } },
        { city: '노출만 있는 도시', details: { events: 0 }, bookings: { events: 0 }, searches: { events: 0 }, saves: { events: 0 }, shares: { events: 0 } },
    ];
    return <main style={{ maxWidth: 1000, margin: '0 auto', padding: 20 }}>
        <p>검증용 예시 데이터 · 운영 통계가 아닙니다</p>
        <h1 style={{ fontSize: 22 }}>어떤 항공권을 눌렀나</h1>
        <p>상세 조회와 여행사 예약 페이지로 이동한 횟수를 확인합니다.</p>
        <AdminFlightInterest data={data} cities={{ basis: 'destination', availablePeriods: { today: true, recent7: true, current: true }, periods: { today: cities.slice(0, 1), recent7: cities, current: cities } }} />
    </main>;
}
