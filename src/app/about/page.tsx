import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_URL } from '@/lib/site';
import { groupByCity, loadActiveFlights, loadFlightCacheMeta } from '@/lib/flight-static';
import styles from './about.module.css';

export const metadata: Metadata = {
    title: '티키티킷은 어떤 서비스인가요?',
    description: '목적지를 정하기 전에 지금 갈 만한 항공권을 발견하는 방법과 가격 표시 기준을 안내합니다.',
    alternates: { canonical: '/about' },
    openGraph: {
        title: '티키티킷은 어떤 서비스인가요?',
        description: '지금 갈 만한 항공권을 발견하고 예약하기 전 확인할 내용을 안내합니다.',
        url: '/about',
        type: 'website',
    },
};

const FAQS = [
    {
        question: '티키티킷에서 항공권을 직접 판매하나요?',
        answer: '아니요. 티키티킷은 여러 여행사의 항공권 정보를 비교해 보여주고, 예약할 때 해당 여행사의 예약 화면으로 연결합니다.',
    },
    {
        question: '화면에 보이는 가격으로 바로 결제할 수 있나요?',
        answer: '표시된 가격과 좌석은 확인 시점의 정보입니다. 남은 좌석, 수하물, 환불 조건과 최종 결제 금액은 여행사 예약 화면에서 다시 확인해야 합니다.',
    },
    {
        question: '같은 목적지인데 가격이 다른 이유는 무엇인가요?',
        answer: '출발일과 여행 기간, 항공사, 출도착 시간, 판매처와 남은 좌석이 다르면 가격도 달라집니다. 카드에서 일정과 시간을 함께 확인해 주세요.',
    },
    {
        question: '예약 화면에서 가격이 달라졌어요.',
        answer: '항공권 가격과 좌석은 실시간으로 바뀔 수 있습니다. 예약 화면에 표시되는 가격과 조건이 최종 정보이며, 판매가 끝난 항공권은 예약하지 못할 수 있습니다.',
    },
    {
        question: 'TIKIT DROP은 전체 항공권 목록과 무엇이 다른가요?',
        answer: '항공권 목록은 조건에 맞는 항공권을 직접 둘러보고 비교하는 곳이고, DROP은 가격과 일정을 다시 살펴 소개할 가치가 있다고 판단한 항공권을 고르는 콘텐츠입니다.',
    },
];

function formatCheckedAt(value: string) {
    if (!value) return '최근';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '최근';
    return new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: false,
    }).format(date);
}

export default function AboutPage() {
    const flights = loadActiveFlights();
    const cities = groupByCity(flights);
    const meta = loadFlightCacheMeta();
    const checkedAt = meta.timestamp || meta.lastUpdated;
    const checkedLabel = formatCheckedAt(checkedAt);

    const jsonLd = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'AboutPage',
                '@id': `${SITE_URL}/about#page`,
                url: `${SITE_URL}/about`,
                name: '티키티킷은 어떤 서비스인가요?',
                description: '목적지를 정하기 전에 지금 갈 만한 항공권을 발견하는 방법과 가격 표시 기준',
                inLanguage: 'ko-KR',
                dateModified: checkedAt || undefined,
                about: { '@id': `${SITE_URL}/#organization` },
            },
            {
                '@type': 'FAQPage',
                mainEntity: FAQS.map(item => ({
                    '@type': 'Question',
                    name: item.question,
                    acceptedAnswer: { '@type': 'Answer', text: item.answer },
                })),
            },
            {
                '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: '홈', item: SITE_URL },
                    { '@type': 'ListItem', position: 2, name: '서비스 소개', item: `${SITE_URL}/about` },
                ],
            },
        ],
    };

    return (
        <main className={styles.page}>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
            <nav className={styles.breadcrumb}><Link href="/">← 항공권 목록</Link></nav>

            <header className={styles.hero}>
                <p>ABOUT TIKITIKIT</p>
                <h1>찾던 여행보다<br />발견한 여행이 더 재밌을 때가 있습니다.</h1>
                <div className={styles.liveStatus}>
                    <time dateTime={checkedAt || undefined}>{checkedLabel}</time> 확인 · {cities.length}개 목적지 · {flights.length.toLocaleString('ko-KR')}개 항공권
                </div>
            </header>

            <section className={styles.section}>
                <h2>티키티킷이 하는 일</h2>
                <p>
                    정해둔 목적지가 없어도 괜찮습니다. 지금 나온 항공권을 둘러보다 마음 가는 도시가 생기면,
                    그때 여행을 시작해보세요.
                </p>
            </section>

            <section className={styles.section}>
                <h2>이렇게 보면 됩니다</h2>
                <ol className={styles.rules}>
                    <li><strong>출발지·목적지·날짜·예산</strong>을 정했다면 필터로 빠르게 좁혀보세요.</li>
                    <li>아직 정하지 않았다면 <strong>추천순에서 지금 눈에 띄는 항공권</strong>부터 둘러보세요.</li>
                    <li>카드를 열어 일정과 좌석을 확인한 뒤 <strong>여행사 예약 화면에서 최종 조건</strong>을 확인하세요.</li>
                </ol>
            </section>

            <section className={styles.section}>
                <h2>가격은 이렇게 읽어주세요</h2>
                <ol className={styles.rules}>
                    <li><strong>왕복 1인 기준</strong>으로 비교합니다.</li>
                    <li>땡처리닷컴 상품은 예약 단계의 <strong>발권수수료 20,000원을 더한 금액</strong>을 비교 가격으로 사용합니다.</li>
                    <li>가격·좌석·운항 일정은 표시 이후 달라질 수 있으므로 <strong>결제 직전 판매처에서 다시 확인</strong>해야 합니다.</li>
                    <li>수하물, 좌석 지정, 취소·환불 조건은 상품마다 다르며 판매처의 규정이 우선합니다.</li>
                </ol>
            </section>

            <section className={styles.section}>
                <h2>항공권 목록과 DROP은 다릅니다</h2>
                <div className={styles.compare}>
                    <div><strong>항공권 목록</strong><p>여러 항공권을 조건에 따라 둘러보고 비교하는 곳</p></div>
                    <div><strong>TIKIT DROP</strong><p>가격과 일정을 살펴 티키티킷이 한 번 더 고른 항공권</p></div>
                </div>
                <p className={styles.sectionLink}><Link href="/drop">현재 TIKIT DROP 보기 →</Link></p>
            </section>

            <section className={styles.faq}>
                <h2>자주 묻는 질문</h2>
                {FAQS.map(item => (
                    <details key={item.question}>
                        <summary>{item.question}</summary>
                        <p>{item.answer}</p>
                    </details>
                ))}
            </section>

            <footer className={styles.footer}>
                <Link href="/">지금 나온 항공권 보기</Link>
                <Link href="/tips/price-watch">최근 가격 기록 보기</Link>
            </footer>
        </main>
    );
}
