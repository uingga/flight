import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SITE_URL } from '@/lib/site';
import {
    loadActiveFlights, groupByCity, effectivePrice, departureLabel, formatKoreanDate,
    loadFlightCacheMeta, type CityDeals,
} from '@/lib/flight-static';
import { normalizeAirline } from '@/lib/utils/flight-helpers';
import type { Flight } from '@/types/flight';

const airlineName = (f: Flight) => normalizeAirline(f.airline || '') || (f.airline || '').trim();
import styles from './city.module.css';

// 캐시 커밋(하루 7회)마다 재빌드되는 정적 페이지
export const dynamic = 'force-static';

const SOURCE_NAMES: Record<string, string> = {
    ybtour: '노랑풍선', modetour: '모두투어', hanatour: '하나투어',
    onlinetour: '온라인투어', ttang: '땡처리닷컴', myrealtrip: '마이리얼트립',
};

// 몇 장만 보여주고 나머지는 본 사이트(검색 필터 적용)로 유도한다
const MAX_LISTED = 5;

function getCity(cityParam: string): CityDeals | undefined {
    const city = decodeURIComponent(cityParam);
    return groupByCity(loadActiveFlights()).find(c => c.city === city);
}

export function generateStaticParams() {
    return groupByCity(loadActiveFlights()).map(c => ({ city: c.city }));
}

export function generateMetadata({ params }: { params: { city: string } }): Metadata {
    const data = getCity(params.city);
    if (!data) return { title: '땡처리 항공권' };
    // 레이아웃 템플릿이 "| 티키티킷"을 붙이므로 여기서는 넣지 않는다
    const title = `${data.city} 땡처리 항공권 최저가 ${data.minPrice.toLocaleString('ko-KR')}원`;
    const description = `${data.city}행 땡처리 항공권 ${data.flights.length}장 판매 중. 왕복 최저 ${data.minPrice.toLocaleString('ko-KR')}원, 출발일 ${formatKoreanDate(data.earliestDate)}~${formatKoreanDate(data.latestDate)}. 하루 여러 차례 갱신됩니다.`;
    const canonical = `/flights/${encodeURIComponent(data.city)}`;
    return {
        title,
        description,
        alternates: { canonical },
        openGraph: { title, description, type: 'website', url: canonical },
    };
}

export default function CityFlightsPage({ params }: { params: { city: string } }) {
    const data = getCity(params.city);
    if (!data) notFound();

    const cacheMeta = loadFlightCacheMeta();
    const checkedAt = cacheMeta.timestamp || cacheMeta.lastUpdated;
    const checkedDate = checkedAt ? new Date(checkedAt) : new Date();
    const checkedLabel = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false,
    }).format(checkedDate);
    const listed = data.flights.slice(0, MAX_LISTED);
    const others = groupByCity(loadActiveFlights())
        .filter(c => c.city !== data.city)
        .slice(0, 8);

    const jsonLd = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'CollectionPage',
                '@id': `${SITE_URL}/flights/${encodeURIComponent(data.city)}#page`,
                url: `${SITE_URL}/flights/${encodeURIComponent(data.city)}`,
                name: `${data.city} 땡처리 항공권`,
                description: `${checkedLabel} 기준 ${data.city} 왕복 최저 ${data.minPrice.toLocaleString('ko-KR')}원, ${data.flights.length}장 판매 중`,
                dateModified: checkedAt || undefined,
                inLanguage: 'ko-KR',
                mainEntity: { '@id': `${SITE_URL}/flights/${encodeURIComponent(data.city)}#list` },
            },
            {
                '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: '홈', item: SITE_URL },
                    { '@type': 'ListItem', position: 2, name: `${data.city} 땡처리 항공권`, item: `${SITE_URL}/flights/${encodeURIComponent(data.city)}` },
                ],
            },
            {
                '@type': 'ItemList',
                '@id': `${SITE_URL}/flights/${encodeURIComponent(data.city)}#list`,
                name: `${data.city} 땡처리 항공권`,
                numberOfItems: listed.length,
                itemListElement: listed.map((f, i) => ({
                    '@type': 'ListItem',
                    position: i + 1,
                    name: `${departureLabel(f)}→${data.city} ${f.departure.date} 왕복 ${effectivePrice(f).toLocaleString('ko-KR')}원`,
                    url: `${SITE_URL}/share/${encodeURIComponent(f.id)}`,
                })),
            },
        ],
    };

    return (
        <main className={styles.page}>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
            <nav className={styles.breadcrumb}>
                <Link href="/">항공권 목록</Link><span> › </span><span>{data.city}</span>
            </nav>
            <h1>{data.city} 땡처리 항공권</h1>
            <p className={styles.answer}>
                {checkedLabel} 기준 {data.city} 왕복 땡처리 항공권 최저가는{' '}
                <strong>{data.minPrice.toLocaleString('ko-KR')}원</strong>입니다(왕복 1인).
                지금 {data.flights.length}장이 판매 중이고, 출발일은{' '}
                {formatKoreanDate(data.earliestDate)}부터 {formatKoreanDate(data.latestDate)} 사이입니다.
                {data.departures.length > 0 && <> 출발지는 {data.departures.join('·')}이고, {data.airlines.slice(0, 4).join('·')} 편이 있습니다.</>}
            </p>

            <ul className={styles.dealList}>
                {listed.map(f => (
                    <li key={f.id}>
                        <Link href={`/share/${encodeURIComponent(f.id)}`} className={styles.deal}>
                            <span className={styles.route}>
                                {departureLabel(f)} → {data.city}
                            </span>
                            <span className={styles.dates}>
                                {f.departure.date}{f.departure.time ? ` ${f.departure.time}` : ''} 출발
                                {f.arrival?.date ? ` · ${f.arrival.date} 귀국편` : ''}
                            </span>
                            <span className={styles.meta}>
                                {airlineName(f)}{f.seats ? ` · ${f.seats}` : ''} · {SOURCE_NAMES[f.source] || f.source}
                            </span>
                            <strong className={styles.price}>
                                {effectivePrice(f).toLocaleString('ko-KR')}원
                                {f.source === 'ttang' && <small> 발권수수료 포함</small>}
                            </strong>
                        </Link>
                    </li>
                ))}
            </ul>
            <p className={styles.more}>
                <Link href={`/?q=${encodeURIComponent(data.city)}`} className={styles.cta}>
                    {/* 대시보드는 기본 날짜 필터(30일)가 걸려 있어 여기의 총 장수와
                        착지 화면의 장수가 다를 수 있다 — 숫자는 쓰지 않는다 */}
                    {data.city} 표 전체 보기 →
                </Link>
            </p>

            <section className={styles.note}>
                <h2>확인해 두세요</h2>
                <p>
                    땡처리 항공권은 여행사가 확보한 좌석 중 팔리지 않은 표를 할인해 파는 것이라
                    좌석이 적고 예고 없이 종료됩니다. 위 가격과 좌석 수는 {checkedLabel} 수집 기준이며,
                    결제 전 판매처에서 최종 금액·수하물·환불 규정을 확인하세요.
                </p>
            </section>

            {others.length > 0 && (
                <section className={styles.others}>
                    <h2>다른 도시 땡처리 항공권</h2>
                    <ul>
                        {others.map(c => (
                            <li key={c.city}>
                                <Link href={`/flights/${encodeURIComponent(c.city)}`}>
                                    {c.city} 최저 {c.minPrice.toLocaleString('ko-KR')}원
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </main>
    );
}
