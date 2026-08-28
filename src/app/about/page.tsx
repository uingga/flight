import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_URL } from '@/lib/site';
import { groupByCity, loadActiveFlights, loadFlightCacheMeta } from '@/lib/flight-static';
import styles from './about.module.css';

export const metadata: Metadata = {
    title: '티키티킷은 어떤 항공권을 모으나요?',
    description: '티키티킷의 항공권 수집처, 갱신 방식, 가격 표시 기준과 서비스 역할을 설명합니다.',
    alternates: { canonical: '/about' },
    openGraph: {
        title: '티키티킷은 어떤 항공권을 모으나요?',
        description: '6개 여행사의 항공권을 어떻게 수집하고 비교하는지 확인하세요.',
        url: '/about',
        type: 'website',
    },
};

const SOURCES = [
    { name: '하나투어', url: 'https://www.hanatour.com' },
    { name: '모두투어', url: 'https://www.modetour.com' },
    { name: '노랑풍선', url: 'https://www.ybtour.co.kr' },
    { name: '온라인투어', url: 'https://www.onlinetour.co.kr' },
    { name: '땡처리닷컴', url: 'https://www.ttang.com' },
    { name: '마이리얼트립', url: 'https://www.myrealtrip.com' },
];

const FAQS = [
    {
        question: '티키티킷에서 항공권을 직접 판매하나요?',
        answer: '아니요. 티키티킷은 여러 여행사의 항공권 정보를 비교해 보여주고, 예약할 때 해당 여행사의 예약 화면으로 연결합니다.',
    },
    {
        question: '화면에 보이는 가격으로 바로 결제할 수 있나요?',
        answer: '가격과 좌석은 티키티킷이 수집한 시점 기준입니다. 남은 좌석, 수하물, 환불 조건과 최종 결제 금액은 여행사 예약 화면에서 다시 확인해야 합니다.',
    },
    {
        question: '항공권 정보는 얼마나 자주 바뀌나요?',
        answer: '여행사별 수집 방식에 따라 하루 여러 차례 갱신합니다. 출발이 가까운 특가 좌석은 그사이에도 판매가 끝나거나 가격이 달라질 수 있습니다.',
    },
    {
        question: 'TIKIT DROP은 전체 항공권 목록과 무엇이 다른가요?',
        answer: '메인은 수집한 항공권을 검색하고 비교하는 곳이고, DROP은 그중 가격과 일정 등을 다시 살펴 소개할 가치가 있다고 판단한 표를 고르는 콘텐츠입니다.',
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
    const sourceCount = new Set(flights.map(flight => flight.source)).size;

    const jsonLd = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'AboutPage',
                '@id': `${SITE_URL}/about#page`,
                url: `${SITE_URL}/about`,
                name: '티키티킷은 어떤 항공권을 모으나요?',
                description: '티키티킷의 항공권 수집처, 갱신 방식, 가격 표시 기준과 서비스 역할',
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
                <h1>여행사마다 흩어진 항공권을<br />한곳에서 먼저 확인합니다.</h1>
                <div className={styles.liveStatus}>
                    <time dateTime={checkedAt || undefined}>{checkedLabel}</time> 기준 · {sourceCount}개 여행사 · {cities.length}개 목적지 · {flights.length.toLocaleString('ko-KR')}장
                </div>
            </header>

            <section className={styles.section}>
                <h2>티키티킷이 하는 일</h2>
                <p>
                    티키티킷은 여행사가 보유한 출발 임박 특가와 현재 비교할 만한 항공권을 모아
                    노선·날짜·가격·남은 좌석을 한 화면에서 확인할 수 있게 정리합니다.
                    항공권을 직접 판매하지 않으며, 예약할 표를 고르면 해당 여행사의 예약 화면으로 이동합니다.
                </p>
            </section>

            <section className={styles.section}>
                <h2>어디에서 수집하나요?</h2>
                <p>현재 아래 6개 여행사의 공개 판매 정보와 예약 화면을 확인합니다.</p>
                <ul className={styles.sourceList}>
                    {SOURCES.map(source => (
                        <li key={source.name}>
                            <a href={source.url} target="_blank" rel="noopener noreferrer">{source.name}</a>
                        </li>
                    ))}
                </ul>
            </section>

            <section className={styles.section}>
                <h2>가격은 이렇게 읽어주세요</h2>
                <ol className={styles.rules}>
                    <li><strong>왕복 1인 기준</strong>으로 비교합니다.</li>
                    <li>땡처리닷컴 상품은 예약 단계의 <strong>발권수수료 20,000원을 더한 금액</strong>을 비교 가격으로 사용합니다.</li>
                    <li>가격·좌석·운항 일정은 수집 이후 달라질 수 있으므로 <strong>결제 직전 판매처에서 다시 확인</strong>해야 합니다.</li>
                    <li>수하물, 좌석 지정, 취소·환불 조건은 상품마다 다르며 판매처의 규정이 우선합니다.</li>
                </ol>
            </section>

            <section className={styles.section}>
                <h2>검색 결과와 DROP은 다릅니다</h2>
                <div className={styles.compare}>
                    <div><strong>항공권 목록</strong><p>수집한 표를 직접 검색하고 비교하는 곳</p></div>
                    <div><strong>TIKIT DROP</strong><p>그중 다시 볼 가치가 있다고 판단한 표를 고르는 곳</p></div>
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
