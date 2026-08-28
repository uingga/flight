import type { Metadata } from 'next';
import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import type { Flight } from '@/types/flight';
import { filterStaleMyrealtripFlights } from '@/lib/source-freshness';
import { SITE_URL } from '@/lib/site';
import styles from './drop.module.css';

interface DropData {
    issue: number;
    publishedAt: string;
    headline: string;
    intro: string;
    closing?: string;
    deals: Array<{
        flightId: string;
        theme: string;
        reason: string;
        caveat: string;
        story?: string;
        context?: string;
        bestFor?: string;
        notFor?: string;
        sources?: Array<{ label: string; url: string }>;
    }>;
}

const SOURCE_NAMES: Record<Flight['source'], string> = {
    ybtour: '노랑풍선', modetour: '모두투어', hanatour: '하나투어',
    onlinetour: '온라인투어', ttang: '땡처리닷컴', myrealtrip: '마이리얼트립',
};

function readJson<T>(relativePath: string): T | null {
    try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')) as T; }
    catch { return null; }
}

function loadFlights(): Flight[] {
    const parsed = readJson<Flight[] | { flights?: Flight[]; sourceUpdatedAt?: Record<string, string> }>('data/all-flights-cache.json');
    const flights = Array.isArray(parsed) ? parsed : parsed?.flights || [];
    const sourceUpdatedAt = Array.isArray(parsed) ? {} : parsed?.sourceUpdatedAt || {};
    return filterStaleMyrealtripFlights(flights, sourceUpdatedAt);
}

function cleanCity(value: string): string {
    return value.replace(/\([A-Z]{3}\)/g, '').replace('서울(인천)', '서울')
        .replace('나트랑(깜랑)', '나트랑').replace('다카마츠', '다카마쓰').replace('클락(앙헬레스)', '클락')
        .replace('장가계(다융)', '장가계').trim();
}

function departureLabel(flight: Flight): string {
    if (flight.departure.airport === 'ICN') return '인천';
    if (flight.departure.airport === 'GMP') return '김포';
    return cleanCity(flight.departure.city);
}

function effectivePrice(flight: Flight): number {
    return flight.price + (flight.source === 'ttang' ? 20_000 : 0);
}

function cleanDate(value: string): string {
    const match = value.match(/\d{4}[.-]\d{2}[.-]\d{2}/)?.[0];
    return match ? match.replaceAll('.', '-').slice(5).replace('-', '/') : value;
}

export async function generateMetadata(): Promise<Metadata> {
    const drop = readJson<DropData>('data/marketing/current-drop.json');
    const title = drop ? `${drop.headline} | 티키티킷 드롭` : '티키티킷 드롭';
    const description = drop?.intro || '가격과 날짜, 항공 시간을 함께 보고 지금 소개할 이유가 있는 표만 고릅니다.';
    const byId = new Map(loadFlights().map(flight => [flight.id, flight]));
    const imageParams = new URLSearchParams({ headline: drop?.headline || '티키티킷 드롭' });
    drop?.deals.forEach((deal, index) => {
        const flight = byId.get(deal.flightId);
        if (!flight) return;
        imageParams.set(`deal${index + 1}`, `${departureLabel(flight)} → ${cleanCity(flight.arrival.city)}  ${effectivePrice(flight).toLocaleString('ko-KR')}원`);
    });
    return {
        title,
        description,
        alternates: { canonical: '/drop' },
        openGraph: {
            title,
            description,
            type: 'article',
            images: [{ url: `/api/og/drop?${imageParams.toString()}`, width: 1200, height: 630 }],
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
            images: [`/api/og/drop?${imageParams.toString()}`],
        },
    };
}

export default function DropPage({ searchParams }: { searchParams?: { preview?: string } }) {
    const previewProposal = process.env.NODE_ENV !== 'production' && searchParams?.preview === 'proposal';
    const drop = readJson<DropData>(previewProposal ? 'data/marketing/drop-proposal.json' : 'data/marketing/current-drop.json');
    const byId = new Map(loadFlights().map(flight => [flight.id, flight]));
    const jsonLd = drop ? {
        '@context': 'https://schema.org',
        '@type': 'Article',
        '@id': `${SITE_URL}/drop#article`,
        mainEntityOfPage: `${SITE_URL}/drop`,
        headline: drop.headline,
        description: drop.intro,
        datePublished: drop.publishedAt,
        dateModified: drop.publishedAt,
        inLanguage: 'ko-KR',
        author: { '@id': `${SITE_URL}/#organization` },
        publisher: { '@id': `${SITE_URL}/#organization` },
        isAccessibleForFree: true,
    } : null;

    return (
        <main className={styles.page}>
            {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />}
            <Link href="/" className={styles.backLink}>← 항공권 목록</Link>
            {!drop ? (
                <section className={styles.empty}>
                    <p className={styles.eyebrow}>TIKITIKIT DROP</p>
                    <h1>오늘은 억지로 고르지 않았어요</h1>
                    <p>가격과 일정이 함께 눈에 띄는 표가 모이면 이곳에 새 드롭을 올립니다.</p>
                    <Link href="/" className={styles.secondaryButton}>지금 나온 표 전체 보기</Link>
                </section>
            ) : (
                <article>
                    <header className={styles.hero}>
                        <p className={styles.eyebrow}>TIKITIKIT DROP {String(drop.issue).padStart(2, '0')}</p>
                        <h1>{drop.headline.replaceAll('만 원', '만\u00a0원')}</h1>
                        <p>{drop.intro}</p>
                        <div className={styles.heroDeals}>
                            {drop.deals.map(deal => {
                                const flight = byId.get(deal.flightId);
                                if (!flight) return null;
                                return (
                                    <div key={deal.flightId}>
                                        <span>{departureLabel(flight)} → {cleanCity(flight.arrival.city)}</span>
                                        <strong>{effectivePrice(flight).toLocaleString('ko-KR')}원</strong>
                                        {flight.source === 'ttang' && <em>수수료 포함 예상 금액</em>}
                                        <small>{cleanDate(flight.departure.date)}~{cleanDate(flight.arrival.date)}</small>
                                    </div>
                                );
                            })}
                        </div>
                        <time dateTime={drop.publishedAt}>{drop.publishedAt.replaceAll('-', '.')} 선정</time>
                    </header>
                    <div id="tickets" className={styles.dealList}>
                        {drop.deals.map((deal, index) => {
                            const flight = byId.get(deal.flightId);
                            if (!flight) return (
                                <section className={`${styles.dealCard} ${styles.ended}`} key={deal.flightId}>
                                    <span className={styles.dealNumber}>{index + 1}</span>
                                    <div><p className={styles.dealTheme}>{deal.theme}</p><h2>이 표는 현재 목록에서 내려갔어요</h2>
                                        <Link href="/" className={styles.secondaryButton}>지금 남은 표 보기</Link></div>
                                </section>
                            );
                            const query = new URLSearchParams({ dep: departureLabel(flight), arr: cleanCity(flight.arrival.city), date: flight.departure.date.slice(0, 10).replaceAll('.', '-') });
                            return (
                                <section className={styles.dealCard} key={deal.flightId}>
                                    <span className={styles.dealNumber}>{index + 1}</span>
                                    <div className={styles.dealBody}>
                                        <p className={styles.dealTheme}>{deal.theme}</p>
                                        <h2>{departureLabel(flight)} → {cleanCity(flight.arrival.city)}</h2>
                                        <p className={styles.price}>{effectivePrice(flight).toLocaleString('ko-KR')}원 <small>{flight.source === 'ttang' ? `표시가 ${flight.price.toLocaleString('ko-KR')}원 + 발권수수료 20,000원 · 왕복 1인` : '왕복 1인'}</small></p>
                                        <dl className={styles.facts}>
                                            <div><dt>일정</dt><dd>{cleanDate(flight.departure.date)}~{cleanDate(flight.arrival.date)}</dd></div>
                                            <div><dt>항공 시간</dt><dd>{flight.departure.time} 출발 · {flight.arrival.time} 귀국편 출발</dd></div>
                                            <div><dt>항공사</dt><dd>{flight.airline}</dd></div>
                                            <div><dt>판매처</dt><dd>{SOURCE_NAMES[flight.source]}</dd></div>
                                        </dl>
                                        <p className={styles.caveat}><strong>확인할 점</strong>{deal.caveat}</p>
                                        <Link href={`/share/${encodeURIComponent(flight.id)}?${query.toString()}`} className={styles.primaryButton}>이 표 자세히 보기</Link>
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                    {drop.closing && <p className={styles.editorClosing}>{drop.closing}</p>}
                    <aside className={styles.notice}>가격과 좌석은 수집 시점 기준이며 판매처에서 달라질 수 있습니다. 결제 전 최종 금액, 수하물, 환불 규정을 확인하세요.</aside>
                </article>
            )}
            {/* 첫 방문(콜드 로드)에서는 폰트·데이터 로드로 레이아웃이 밀려 브라우저의
                기본 앵커 스크롤이 무시되는 경우가 있다. 로드가 끝난 뒤 한 번 더 보정한다.
                사용자가 이미 스크롤했다면 (scrollY 기준) 건드리지 않는다. */}
            <script dangerouslySetInnerHTML={{ __html: `(function(){
    if (location.hash !== '#tickets') return;
    var go = function(){
        var el = document.getElementById('tickets');
        if (el && window.scrollY < 100) el.scrollIntoView();
    };
    go();
    window.addEventListener('load', go);
})();` }} />
        </main>
    );
}
