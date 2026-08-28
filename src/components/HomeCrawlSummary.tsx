import Link from 'next/link';
import { SITE_URL } from '@/lib/site';
import { groupByCity, loadActiveFlights, loadFlightCacheMeta } from '@/lib/flight-static';
import styles from './HomeCrawlSummary.module.css';

const MAX_CITIES = 12;

function formatCheckedAt(value: string) {
    if (!value) return '최근 수집';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '최근 수집';
    return new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: false,
    }).format(date);
}

export default function HomeCrawlSummary() {
    const flights = loadActiveFlights();
    const cities = groupByCity(flights).slice(0, MAX_CITIES);
    const meta = loadFlightCacheMeta();
    const checkedAt = meta.timestamp || meta.lastUpdated;
    const checkedLabel = formatCheckedAt(checkedAt);
    const sourceCount = new Set(flights.map(flight => flight.source)).size;

    if (flights.length === 0 || cities.length === 0) return null;

    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: '현재 항공권이 많이 나온 목적지',
        description: `${checkedLabel} 기준 티키티킷이 수집한 왕복 항공권의 주요 목적지와 최저 표시 가격`,
        dateModified: checkedAt || undefined,
        numberOfItems: cities.length,
        itemListElement: cities.map((city, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: `${city.city} 왕복 최저 ${city.minPrice.toLocaleString('ko-KR')}원, ${city.flights.length}장`,
            url: `${SITE_URL}/flights/${encodeURIComponent(city.city)}`,
        })),
    };

    return (
        <section className={styles.section} aria-labelledby="crawl-summary-title">
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
            <div className={styles.heading}>
                <div>
                    <p className={styles.eyebrow}>최근 수집 요약</p>
                    <h2 id="crawl-summary-title">지금 표가 많이 나온 목적지</h2>
                </div>
                <Link href="/about">수집 기준 보기 →</Link>
            </div>
            <p className={styles.answer}>
                <time dateTime={checkedAt || undefined}>{checkedLabel}</time> 기준, {sourceCount}개 여행사에서
                판매 중인 왕복 항공권 <strong>{flights.length.toLocaleString('ko-KR')}장</strong>을 확인했습니다.
                아래 가격은 목적지별 현재 최저 표시 가격입니다.
            </p>
            <ul className={styles.cityGrid}>
                {cities.map(city => (
                    <li key={city.city}>
                        <Link href={`/flights/${encodeURIComponent(city.city)}`}>
                            <span>{city.city}</span>
                            <strong>{city.minPrice.toLocaleString('ko-KR')}원</strong>
                            <small>{city.flights.length}장 판매 중</small>
                        </Link>
                    </li>
                ))}
            </ul>
            <p className={styles.note}>
                가격·좌석·일정은 수집 시점 기준이며 결제 전 각 여행사 예약 화면에서 다시 확인해야 합니다.
            </p>
        </section>
    );
}
