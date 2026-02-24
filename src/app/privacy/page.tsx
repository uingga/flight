import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '../legal.module.css';

export const metadata: Metadata = {
    title: '개인정보처리방침',
    description: '티키티킷 개인정보처리방침',
    alternates: {
        canonical: '/privacy',
    },
};

export default function PrivacyPage() {
    return (
        <div className={styles.legalPage}>
            <Link href="/" className={styles.backLink}>
                ← 홈으로 돌아가기
            </Link>

            <h1 className={styles.pageTitle}>개인정보처리방침</h1>
            <p className={styles.lastUpdated}>최종 수정일: 2026년 2월 18일</p>

            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>1. 개인정보 처리 목적</h2>
                <div className={styles.sectionContent}>
                    <p>
                        티키티킷(이하 &quot;서비스&quot;)은 항공권 가격 비교 정보를 제공하는 서비스로,
                        별도의 회원가입이나 로그인 없이 이용할 수 있습니다.
                    </p>
                    <p>서비스 운영 및 개선을 위해 다음의 목적으로 최소한의 정보를 처리합니다:</p>
                    <ul>
                        <li>서비스 이용 통계 분석 및 서비스 개선</li>
                        <li>가격 알림 기능 제공 (사용자 동의 시)</li>
                    </ul>
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>2. 수집하는 정보</h2>
                <div className={styles.sectionContent}>
                    <p>본 서비스는 회원가입을 요구하지 않으며, <strong>이름, 이메일, 전화번호 등 개인을 식별할 수 있는 정보를 직접 수집하지 않습니다.</strong></p>
                    <p>다만, 서비스 운영을 위해 다음 정보가 자동으로 수집될 수 있습니다:</p>

                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>수집 항목</th>
                                <th>수집 목적</th>
                                <th>보유 기간</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>방문 페이지, 체류 시간, 브라우저 종류</td>
                                <td>서비스 이용 통계 (Google Analytics)</td>
                                <td>14개월</td>
                            </tr>
                            <tr>
                                <td>브라우저 푸시 알림 토큰</td>
                                <td>가격 알림 기능 (사용자 동의 시)</td>
                                <td>알림 해제 시까지</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>3. Google Analytics 사용</h2>
                <div className={styles.sectionContent}>
                    <p>
                        본 서비스는 웹사이트 이용 현황을 분석하기 위해 <strong>Google Analytics 4 (GA4)</strong>를 사용합니다.
                    </p>
                    <p>Google Analytics는 쿠키를 사용하여 익명화된 사용 데이터를 수집하며, 개인을 식별하지 않습니다.</p>
                    <ul>
                        <li>수집 데이터: 페이지 조회수, 세션 시간, 기기 및 브라우저 정보, 유입 경로</li>
                        <li>IP 주소: Google에 의해 익명화 처리됩니다</li>
                        <li>데이터 보관: 14개월 후 자동 삭제</li>
                    </ul>
                    <p>
                        Google의 데이터 처리에 대한 자세한 내용은{' '}
                        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)' }}>
                            Google 개인정보처리방침
                        </a>
                        을 참고하시기 바랍니다.
                    </p>
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>4. 쿠키 사용</h2>
                <div className={styles.sectionContent}>
                    <p>본 서비스는 다음의 쿠키를 사용합니다:</p>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>쿠키명</th>
                                <th>용도</th>
                                <th>제공자</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>_ga, _ga_*</td>
                                <td>방문자 통계 분석</td>
                                <td>Google Analytics</td>
                            </tr>
                        </tbody>
                    </table>
                    <p>
                        브라우저 설정을 통해 쿠키 수집을 거부할 수 있습니다.
                        단, 이 경우 일부 서비스 이용에 제한이 있을 수 있습니다.
                    </p>
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>5. 개인정보의 제3자 제공</h2>
                <div className={styles.sectionContent}>
                    <p>
                        본 서비스는 이용자의 개인정보를 제3자에게 제공하지 않습니다.
                        다만, 법령에 의한 요청이 있는 경우에는 관련 법률에 따라 제공할 수 있습니다.
                    </p>
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>6. 이용자의 권리</h2>
                <div className={styles.sectionContent}>
                    <p>이용자는 다음의 권리를 행사할 수 있습니다:</p>
                    <ul>
                        <li>브라우저 설정을 통한 쿠키 삭제 및 차단</li>
                        <li>브라우저 알림 설정에서 푸시 알림 해제</li>
                        <li>Google Analytics 수집 거부 (<a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)' }}>GA 옵트아웃 브라우저 플러그인</a>)</li>
                    </ul>
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>7. 개인정보의 안전성 확보 조치</h2>
                <div className={styles.sectionContent}>
                    <p>본 서비스는 개인정보 보호를 위해 다음의 조치를 취하고 있습니다:</p>
                    <ul>
                        <li>HTTPS 암호화 통신 적용</li>
                        <li>최소한의 데이터만 수집</li>
                        <li>Google Analytics IP 익명화 처리</li>
                    </ul>
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>8. 개인정보처리방침의 변경</h2>
                <div className={styles.sectionContent}>
                    <p>
                        본 개인정보처리방침은 관련 법률 또는 서비스 정책 변경에 따라 수정될 수 있으며,
                        변경 시 본 페이지에 공지합니다.
                    </p>
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>9. 개인정보 보호책임자</h2>
                <div className={styles.sectionContent}>
                    <div className={styles.contactInfo}>
                        <p><strong>서비스명:</strong> 티키티킷 (TikiTikit)</p>
                        <p><strong>이메일:</strong> tikitikit.official@gmail.com</p>
                    </div>
                    <p style={{ marginTop: '12px' }}>
                        개인정보 관련 문의사항은 위 이메일로 연락해 주시기 바랍니다.
                    </p>
                </div>
            </div>
        </div>
    );
}
