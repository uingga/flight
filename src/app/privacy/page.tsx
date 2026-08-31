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
            <p className={styles.lastUpdated}>최종 수정일: 2026년 8월 31일</p>

            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>1. 개인정보 처리 목적</h2>
                <div className={styles.sectionContent}>
                    <p>
                        티키티킷(이하 &quot;서비스&quot;)은 항공권 가격 비교 정보를 제공하는 서비스입니다.
                        항공권 조회는 로그인 없이 이용할 수 있고, 개인 저장 기능은 선택적으로 로그인해 이용할 수 있습니다.
                    </p>
                    <p>서비스 운영 및 개선을 위해 다음의 목적으로 최소한의 정보를 처리합니다:</p>
                    <ul>
                        <li>서비스 이용 통계 분석 및 서비스 개선</li>
                        <li>가격 알림 기능 제공 (사용자 동의 시)</li>
                        <li>이메일 본인 확인 및 로그인 상태 유지</li>
                        <li>찜한 항공권, 최근 본 항공권, 저장한 검색 조건의 기기 간 동기화</li>
                    </ul>
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>2. 수집하는 정보</h2>
                <div className={styles.sectionContent}>
                    <p>항공권 조회에는 회원가입이 필요하지 않습니다. 로그인이나 문의 등 이용자가 선택한 기능에서만 다음 정보를 수집합니다.</p>

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
                            <tr>
                                <td>이메일 주소</td>
                                <td>일회용 인증번호 로그인 및 계정 식별</td>
                                <td>계정 삭제 시까지</td>
                            </tr>
                            <tr>
                                <td>찜한 항공권, 최근 본 항공권(최대 30건), 저장한 검색 조건(최대 10건)</td>
                                <td>개인 저장 기능과 기기 간 동기화</td>
                                <td>직접 삭제하거나 계정 삭제 시까지</td>
                            </tr>
                            <tr>
                                <td>인증번호와 로그인 토큰을 복원할 수 없게 변환한 값</td>
                                <td>본인 확인 및 로그인 상태 유지</td>
                                <td>인증번호 기록 24시간 이내, 로그인 세션 30일</td>
                            </tr>
                            <tr>
                                <td>이름, 이메일 주소, 문의 내용 (직접 입력하신 경우에만)</td>
                                <td>문의 및 항공권 제보에 답변</td>
                                <td>답변 후 보관하지 않음</td>
                            </tr>
                            <tr>
                                <td>접속 IP를 되돌릴 수 없게 변환한 값</td>
                                <td>알림 및 로그인 기능 남용 방지</td>
                                <td>각 기능 해제 시까지 또는 인증 요청 기록 24시간 이내</td>
                            </tr>
                            <tr>
                                <td>광고 식별을 위한 쿠키</td>
                                <td>Google AdSense 광고 노출</td>
                                <td>Google 정책에 따름</td>
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
                            <tr>
                                <td>Google 광고 쿠키</td>
                                <td>광고 제공, 노출 빈도 조절 및 광고 성과 측정</td>
                                <td>Google AdSense</td>
                            </tr>
                            <tr>
                                <td>__Host-tikitikit_session</td>
                                <td>로그인 상태 유지 (자바스크립트에서 읽을 수 없는 보안 쿠키)</td>
                                <td>티키티킷</td>
                            </tr>
                        </tbody>
                    </table>
                    <p>
                        브라우저 설정을 통해 쿠키 수집을 거부할 수 있습니다.
                        단, 이 경우 일부 서비스 이용에 제한이 있을 수 있습니다.
                    </p>
                    <p>
                        Google을 포함한 제3자 광고 제공업체는 광고를 제공하고 성과를 측정하기 위해
                        이용자의 브라우저에 쿠키를 저장하거나 기존 쿠키를 읽을 수 있으며,
                        웹 비콘 또는 IP 주소 등의 정보를 사용할 수 있습니다. 자세한 내용은{' '}
                        <a href="https://policies.google.com/technologies/partner-sites?hl=ko" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)' }}>
                            Google이 파트너 사이트의 정보를 사용하는 방식
                        </a>
                        에서 확인할 수 있습니다. 맞춤 광고는{' '}
                        <a href="https://adssettings.google.com/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)' }}>
                            Google 광고 설정
                        </a>
                        에서 관리할 수 있습니다.
                    </p>
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.sectionTitle}>5. 개인정보의 제3자 제공</h2>
                <div className={styles.sectionContent}>
                    <p>
                        본 서비스는 이용자의 개인정보를 판매하거나 광고 목적으로 다른 회사에 넘기지 않습니다.
                        다만 서비스를 운영하려면 아래 업체들의 도움을 받아야 하며, 그 과정에서 정보가 이들의 시스템에 저장됩니다.
                    </p>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>업체</th>
                                <th>맡기는 일</th>
                                <th>전달되는 정보</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Vercel</td>
                                <td>웹사이트 운영</td>
                                <td>접속 기록</td>
                            </tr>
                            <tr>
                                <td>Supabase</td>
                                <td>가격 알림 및 계정 정보 보관</td>
                                <td>푸시 알림 토큰, 알림 조건, 이메일, 개인 저장 데이터, 변환된 인증 정보</td>
                            </tr>
                            <tr>
                                <td>Google</td>
                                <td>이용 통계(Analytics), 광고(AdSense), 알림 및 로그인 인증 메일 전송</td>
                                <td>방문 기록, 쿠키, 푸시 알림 토큰, 인증 메일 수신 주소</td>
                            </tr>
                        </tbody>
                    </table>
                    <p>
                        법령에 따른 요청이 있는 경우에는 관련 법률에 따라 제공할 수 있습니다.
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
                        <li>내 여행 화면에서 저장한 검색 조건 삭제 및 계정 전체 삭제</li>
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
                        <li>인증번호 및 로그인 토큰 원문을 저장하지 않고 일방향 변환값만 보관</li>
                        <li>로그인 쿠키에 HttpOnly, Secure, SameSite 보안 속성 적용</li>
                        <li>계정 데이터는 브라우저가 데이터베이스에 직접 접근하지 않고 서버에서 로그인 상태 확인 후 제공</li>
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
