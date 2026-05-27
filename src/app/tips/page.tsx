import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './tips.module.css';

export const metadata: Metadata = {
    title: '여행 꿀팁 | 티키티킷',
    description: '땡처리 항공권 활용법, 저렴하게 여행하는 노하우를 모았습니다.',
    alternates: {
        canonical: '/tips',
    },
};

const tips = [
    { slug: 'cheap-flights-101', emoji: '✈️', title: '땡처리 항공권, 이렇게 싸도 되나요?', desc: '땡처리가 싼 이유와 가격 비교 절약법' },
    { slug: 'regional-airports', emoji: '🗺️', title: '지방공항이 인천보다 싼 노선 총정리', desc: '부산·청주·대구 출발이 더 싼 노선 비교' },
    { slug: 'faq-10', emoji: '❓', title: '땡처리 항공권 Q&A 10가지', desc: '환불, 수하물, 유아 동반 등 자주 묻는 질문' },
    { slug: 'japan-cherry-blossom', emoji: '🌸', title: '일본 벚꽃 시즌 항공권 특가 가이드', desc: '도시별 개화 시기 + 추천 코스 + 특가 노선' },
    { slug: 'southeast-asia-seasons', emoji: '🌏', title: '동남아 우기·건기 따져서 싸게 가는 법', desc: '시기별 가격 차이와 추천 여행지' },
    { slug: 'cheap-tickets-2026', emoji: '💰', title: '비행기 표 싸게 사는 법 2026 총정리', desc: '시기, 출발지, 비교 전략까지 한 번에' },
    { slug: 'is-it-really-cheap', emoji: '🔍', title: '땡처리, 무조건 싸다고요? 진짜 싼 건지 확인하는 법', desc: '땡처리 함정을 피하는 3가지 체크포인트' },
];

export default function TipsPage() {
    return (
        <div className={styles.tipsPage}>
            <Link href="/" className={styles.backLink}>← 홈으로</Link>
            <h1 className={styles.pageTitle}>✈️ 여행 꿀팁</h1>
            <p className={styles.pageSubtitle}>땡처리 항공권 활용법, 저렴하게 여행하는 노하우</p>

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
