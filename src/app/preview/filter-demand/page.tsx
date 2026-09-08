import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import AdminFilterDemand from '@/components/AdminFilterDemand';
import { flightOrderStorageMode } from '@/lib/server/flight-order-store';
import { parseFilterDemand } from '@/lib/filter-demand';

export const dynamic = 'force-dynamic';
export const metadata = { title: '검색 조건 통계 미리보기', robots: { index: false, follow: false } };
export default function FilterDemandPreview({ searchParams }: { searchParams: { state?: string } }) {
    const host = headers().get('host')?.split(':')[0];
    if (!['localhost', '127.0.0.1'].includes(host || '') || process.env.VERCEL || flightOrderStorageMode() !== 'preview' || !process.env.ADMIN_KEY) notFound();
    const values = { departure: ['인천', '부산', '청주', '대구'], region: ['일본', '동남아', '중국', '유럽'], max_price: ['200000', '300000', '400000'], airline: ['제주항공', '진에어', '대한항공'], source: ['ybtour', 'hanatour', 'myrealtrip'] };
    const rows = Object.entries(values).flatMap(([type, values]) => values.map((value, index) => ({ dimensionValues: [type, value].map(value => ({ value })), metricValues: [30 - index * 7, index === 0 ? 1 : 6 - index].map(value => ({ value: String(value) })) })));
    const cityRows = ['오사카', '도쿄', '방콕', '후쿠오카', '다낭', '타이베이', '반다르세리베가완'].map((value, index) => ({ dimensionValues: [{ value }], metricValues: [40 - index * 5, 10 - index].map(value => ({ value: String(value) })) }));
    const unavailable = searchParams.state === 'unavailable';
    const empty = searchParams.state === 'empty';
    const data = parseFilterDemand(unavailable || searchParams.state === 'partial' ? undefined : { rows: empty ? [] : rows }, unavailable ? undefined : { rows: empty ? [] : cityRows });
    const items = (labels: string[]) => unavailable ? null : empty ? [] : labels.map((label, index) => ({ label, count: [23, 18, 9, 6, 4][index] }));
    return <main style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 20px', color: '#202938' }}>
        <p style={{ color: '#9b3449', fontSize: 13 }}>검증용 예시 데이터 · 운영 통계가 아닙니다</p>
        <h1 style={{ fontSize: 23, margin: '18px 0 8px' }}>사람들이 어떤 조건으로 찾았나</h1>
        <p style={{ color: '#657082', fontSize: 14, marginBottom: 24 }}>출발지·도착지부터 가격과 날짜까지, 직접 고른 검색 조건을 비교합니다.</p>
        <AdminFilterDemand data={data} dates={{ leadTime: items(['3일 이내', '4~7일', '1~2주', '2주~1달', '1달 이후']), range: items(['하루', '2~3일', '4~7일', '1~2주', '2주 이상']), method: items(['달력에서 직접', '빠른 선택 칩']), presets: items(['다음 달', '다음 주', '이번 주']) }} />
    </main>;
}
