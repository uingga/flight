import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '../legal.module.css';

export const metadata: Metadata = {
    title: '이용약관',
    description: '티키티킷 서비스 이용약관',
    alternates: {
        canonical: '/terms',
    },
};

export default function TermsPage() {
    return (
        <div className={styles.legalPage}>
            <Link href="/" className={styles.backLink}>
                ← 홈으로 돌아가기
            </Link>

            <h1 className={styles.pageTitle}>이용약관</h1>
            <p className={styles.lastUpdated}>최종 수정일: 2026년 2월 24일</p>

            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>제1조 (목적)</h2>
                <div className={styles.sectionContent}>
                    <p>
                        본 약관은 티키티킷(이하 &quot;서비스&quot;)이 제공하는 항공권 가격 비교 정보 서비스의
                        이용 조건 및 절차에 관한 사항을 규정함을 목적으로 합니다.
                    </p>
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>제2조 (서비스의 내용)</h2>
                <div className={styles.sectionContent}>
                    <p>티키티킷은 다음과 같은 서비스를 제공합니다:</p>
                    <ul>
                        <li>하나투어, 모두투어, 노랑풍선, 온라인투어, 땡처리닷컴 등 여행사의 땡처리 항공권 정보 수집 및 비교</li>
                        <li>항공권 가격 변동 추적 및 알림</li>
                        <li>여행사 사이트로의 예약 링크 제공</li>
                    </ul>
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>제3조 (서비스 이용)</h2>
                <div className={styles.sectionContent}>
                    <p>
                        본 서비스는 별도의 회원가입 없이 누구나 무료로 이용할 수 있습니다.
                        서비스 이용 시 별도의 로그인이나 개인정보 입력이 필요하지 않습니다.
                    </p>
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>제4조 (면책 조항)</h2>
                <div className={styles.sectionContent}>
                    <p>
                        <strong>1.</strong> 본 서비스에서 제공하는 항공권 가격 및 좌석 정보는 각 여행사 웹사이트에서
                        수집한 정보를 기반으로 하며, 실시간 변동이 있을 수 있습니다.
                    </p>
                    <p>
                        <strong>2.</strong> 실제 예약 시점의 가격, 좌석 수, 운항 여부 등은 해당 여행사의 정보와
                        다를 수 있으며, 이로 인해 발생하는 차이에 대해 티키티킷은 책임을 지지 않습니다.
                    </p>
                    <p>
                        <strong>3.</strong> 항공권 예약 및 결제는 각 여행사 사이트에서 직접 이루어지며,
                        예약 변경, 취소, 환불 등 관련 문의는 해당 예약이 진행된 여행사로 직접 연락하셔야 합니다.
                    </p>
                    <p>
                        <strong>4.</strong> 티키티킷은 항공권 판매의 당사자가 아니며, 정보 제공 및
                        통신판매중개를 목적으로 합니다. 따라서 항공권의 운항, 결항, 지연 등에 대한
                        법적 책임은 실제 서비스를 제공하는 해당 여행사 및 항공사에 있습니다.
                    </p>
                    <p>
                        <strong>5.</strong> 천재지변, 기상 악화, 항공사 사정(파업, 파산, 운항 스케줄 변경 등) 및
                        여행사의 귀책사유로 인해 발생하는 항공권 취소, 지연 및 고객의 직·간접적인 피해(여행자 보험사 등
                        제3자의 구상권 청구 포함)에 대하여 티키티킷은 어떠한 책임도 지지 않습니다.
                    </p>
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>제5조 (지적재산권)</h2>
                <div className={styles.sectionContent}>
                    <p>
                        본 서비스의 디자인, 로고, 소프트웨어, 콘텐츠 등에 대한 저작권 및 지적재산권은
                        티키티킷에 귀속됩니다. 무단 복제, 배포, 수정을 금지합니다.
                    </p>
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>제6조 (서비스 변경 및 중단)</h2>
                <div className={styles.sectionContent}>
                    <p>
                        티키티킷은 서비스 개선, 기술적 이유 등으로 서비스의 전부 또는 일부를
                        변경하거나 중단할 수 있으며, 이에 대해 별도의 보상을 하지 않습니다.
                    </p>
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>제7조 (약관의 변경)</h2>
                <div className={styles.sectionContent}>
                    <p>
                        본 약관은 관련 법률 변경이나 서비스 정책 변경에 따라 수정될 수 있으며,
                        변경 시 본 페이지에 공지합니다.
                    </p>
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>문의</h2>
                <div className={styles.sectionContent}>
                    <div className={styles.contactInfo}>
                        <p><strong>서비스명:</strong> 티키티킷 (TikiTikit)</p>
                        <p><strong>이메일:</strong> uingga@gmail.com</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
