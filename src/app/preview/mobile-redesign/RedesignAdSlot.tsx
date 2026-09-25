import styles from './page.module.css';

const USIMSA_AFFILIATE_URL = 'https://usimsa.com/affiliate/3624';

interface RedesignAdSlotProps {
    preview?: boolean;
}

export default function RedesignAdSlot({ preview = false }: RedesignAdSlotProps) {
    return (
        <aside className={styles.homeAdSlot} aria-label="유심사 여행용 eSIM 제휴 광고">
            <span className={styles.homeAdLabel}>광고</span>
            <a
                className={styles.homeEsimBanner}
                href={preview ? undefined : USIMSA_AFFILIATE_URL}
                target={preview ? undefined : '_blank'}
                rel={preview ? undefined : 'sponsored nofollow noopener noreferrer'}
                aria-disabled={preview || undefined}
                aria-label={preview ? '유심사 여행용 eSIM 배너 미리보기' : '유심사 여행지별 eSIM 요금제 보기 (새 창)'}
            >
                <span className={styles.homeEsimMark} aria-hidden="true">
                    <svg viewBox="0 0 32 32" fill="none">
                        <path d="M9 4h11l5 5v17a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.7" />
                        <rect x="11" y="14" width="10" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" />
                        <path d="M14 14v9m4-9v9m-7-5h10" stroke="currentColor" strokeWidth="1.3" />
                    </svg>
                </span>
                <span className={styles.homeEsimCopy}>
                    <span className={styles.homeEsimBrand}>유심사 · 여행용 eSIM</span>
                    <strong>항공권 다음은 현지 데이터</strong>
                    <span className={styles.homeEsimDetail}>여행지와 일정에 맞는 요금제를 찾아보세요</span>
                </span>
                <span className={styles.homeEsimAction}>eSIM 요금제 보기 <span aria-hidden="true">↗</span></span>
            </a>
        </aside>
    );
}
