import styles from './page.module.css';

const USIMSA_AFFILIATE_URL = 'https://usimsa.com/affiliate/3624';

interface RedesignAdSlotProps {
    preview?: boolean;
}

export default function RedesignAdSlot({ preview = false }: RedesignAdSlotProps) {
    return (
        <aside className={styles.homeAdSlot} aria-label="유심사 여행용 eSIM 제휴 광고">
            <span className={styles.homeAdLabel}>제휴 광고 · 구매 시 수수료를 받습니다</span>
            <a
                className={styles.homeEsimBanner}
                href={preview ? undefined : USIMSA_AFFILIATE_URL}
                target={preview ? undefined : '_blank'}
                rel={preview ? undefined : 'sponsored nofollow noopener noreferrer'}
                aria-disabled={preview || undefined}
                aria-label={preview ? '유심사 여행용 eSIM 배너 미리보기' : '유심사 여행용 eSIM 보기 (새 창)'}
            >
                <svg className={styles.homeEsimIcon} viewBox="0 0 32 32" fill="none" aria-hidden="true">
                    <path d="M10 3h10l6 6v18a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7a4 4 0 0 1 4-4Z" stroke="currentColor" strokeWidth="1.7" />
                    <rect x="11" y="14" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M16 14v10M11 19h10" stroke="currentColor" strokeWidth="1.3" />
                </svg>
                <span className={styles.homeEsimCopy}>
                    <strong>해외 데이터, 출발 전에.</strong>
                    <span>유심사 여행용 eSIM</span>
                </span>
                <span className={styles.homeEsimAction}>eSIM 보기 <span aria-hidden="true">→</span></span>
            </a>
        </aside>
    );
}
