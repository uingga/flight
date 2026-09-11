import type { Metadata } from 'next';
import AdminAcquisition from '@/components/AdminAcquisition';
import type { AcquisitionData } from '@/lib/acquisition';

export const metadata: Metadata = { title: '유입 출처 표 미리보기', robots: { index: false, follow: false } };
const sources = [
    { source: '(not set)', label: '출처 미확인', sessions: 12, users: 11, category: '출처 확인 불가' },
    { source: 'te31', label: 'TE31', sessions: 5, users: 5, category: '커뮤니티' },
    { source: 'google', label: '구글', sessions: 2, users: 2, category: '검색' },
    { source: 'naver', label: '네이버 검색', sessions: 1, users: 1, category: '검색' },
    { source: '(direct)', label: '직접 방문', sessions: 1, users: 1, category: '직접 방문' },
    ...Array.from({ length: 32 }, (_, i) => ({ source: `example-${String(i + 1).padStart(2, '0')}.com`, label: `테스트 사이트 ${String(i + 1).padStart(2, '0')}`, sessions: 1, users: i === 31 ? null : 1, category: '기타 외부 링크' })),
];
const data: AcquisitionData = {
    available: true,
    sourceRows: sources.map(({ category, ...source }) => ({ ...source, categories: [category] })),
    groups: Array.from(new Set(sources.map(s => s.category))).map(label => ({
        label, sessions: sources.filter(s => s.category === label).reduce((n, s) => n + s.sessions, 0), users: null,
        sources: sources.filter(s => s.category === label),
    })),
};
export default function Preview() {
    return <main style={{ maxWidth: 680, margin: '40px auto', padding: '0 14px', color: '#222' }}>
        <p style={{ fontSize: 13, color: '#707070', marginBottom: 20 }}>UI 미리보기 · 가상 출처 37개 · 운영 통계와 무관합니다.</p>
        <section style={{ border: '1px solid #ddd', borderRadius: 16, background: '#fff' }}>
            <h1 style={{ margin: 0, padding: '18px 16px', borderBottom: '1px solid #edf0f3', fontSize: 18, fontWeight: 700 }}>유입 유형과 출처</h1>
            <AdminAcquisition data={data} />
        </section>
    </main>;
}
