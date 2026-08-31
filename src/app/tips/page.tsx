import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './tips.module.css';

export const metadata: Metadata = {
    title: '가격 기록과 여행 팁',
    description: '티키티킷이 직접 수집한 땡처리 항공권 가격 기록을 확인하세요.',
    alternates: {
        canonical: '/tips',
    },
    robots: { index: false, follow: true },
};

const tips = [
    { slug: 'price-watch', emoji: '📉', title: '최근 가격이 내려간 주요 노선', desc: '최근 2~3주 동안 수집한 실제 최저가 기록' },
];

export default function TipsPage() {
    return (
        <div className={styles.tipsPage}>
            <Link href="/" className={styles.backLink}>← 홈으로</Link>
            <h1 className={styles.pageTitle}>가격 기록과 여행 팁</h1>
            <p className={styles.pageSubtitle}>일반적인 여행 상식보다 티키티킷이 직접 확인한 가격 기록부터 보여드립니다.</p>

            <div className={styles.tipsList}>
                {tips.map(tip => (
                    <Link key={tip.slug} href={`/tips/${tip.slug}`} className={styles.tipCard}>
                        <span className={styles.tipEmoji}>{tip.emoji}</span>
                        <div className={styles.tipInfo}>
                            <div className={styles.tipTitle}>{tip.title}</div>
                            <div className={styles.tipDesc}>{tip.desc}</div>
                        </div>
                        <span className={styles.tipArrow}>›</span>
                    </Link>
                ))}
            </div>
        </div>
    );
}
