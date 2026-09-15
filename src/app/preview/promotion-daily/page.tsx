import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { PromotionDailyView } from '@/components/AdminPromotionDaily';
import AdminTe31Posts from '@/components/AdminTe31Posts';
import { promotionFixture } from '../../../../scripts/fixtures/promotion-daily';
import styles from '@/components/AdminPromotionDaily.module.css';
export const dynamic = 'force-dynamic';
export default function Preview({ searchParams }: { searchParams: { state?: string } }) {
    const host = headers().get('host')?.split(':')[0];
    if (!['localhost', '127.0.0.1'].includes(host || '') || process.env.VERCEL || !process.env.FLIGHT_ORDER_PREVIEW_DIR || !process.env.ADMIN_KEY) notFound();
    const data = promotionFixture();
    // Synthetic long-copy samples make the compact/expanded layout visible without live access.
    data.latest = data.latest.map(row => ({ ...row, payload: { ...row.payload, posts: [
        { ...row.payload.posts[0], title: '주말 하루를 더 붙이면, 여행이 됩니다.\n금요일에 출발해 월요일에 돌아오는 일정으로 짧은 여행을 준비해 보세요.\n항공권을 비교하고 나에게 맞는 출발 시간을 골라볼 수 있어요. (화면 검증용 예시)' },
        { ...row.payload.posts[0], id: row.payload.posts[0].id + '-second', title: '낯선 도시에서 보내는 며칠\n익숙한 여행지 대신 새로운 골목과 풍경을 만나는 여행.\n이 본문과 모든 성과 수치는 디자인을 확인하기 위한 합성 예시입니다.' },
    ] } }));
    return <main className={styles.preview}><div className={styles.previewInner}><header className={styles.previewHeader}><span className={styles.previewLabel}>어드민 · 미리보기</span><h1>홍보 성과</h1><p>어떤 글에 반응하고, 사이트에서 무엇을 했는지 확인합니다.</p><p>합성 예시 데이터 · 실시간 통계가 아닙니다.</p></header>
        <PromotionDailyView data={searchParams.state === 'empty' ? { latest: [], runs: [], sources: [] } : data} />
        <details className={styles.collectionInfo}><summary>최근 30일 TE31 사이트 성과</summary><AdminTe31Posts dailyMode campaigns={[]} available days={30} /></details>
    </div></main>;
}
