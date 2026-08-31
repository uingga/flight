import type { Metadata } from 'next';
import Logo from '@/components/Logo';
import type { Flight } from '@/types/flight';
import { getDestinationContext } from '@/lib/destination-contexts';
import flightCache from '../../../../data/all-flights-cache.json';
import LijiangInsightButton from './LijiangInsightButton';
import styles from './page.module.css';

export const metadata: Metadata = {
    title: '이전 요나고 인사이트바 미리보기',
    description: '이전에 사용하던 여행지 발견 인사이트바 디자인 미리보기',
    robots: {
        index: false,
        follow: false,
        googleBot: { index: false, follow: false },
    },
};

type PreviewTicket = {
    source: string;
    airline: string;
    departure: string;
    destination: string;
    dates: string;
    duration: string;
    seats: string;
    price: string;
};

const PREVIEW_TICKETS: PreviewTicket[] = [
    { source: '노랑풍선', airline: '에어로케이', departure: '청주', destination: '클락', dates: '9.19 — 9.24', duration: '5박 6일', seats: '15석 남음', price: '222,000원' },
    { source: '노랑풍선', airline: '제주항공', departure: '인천', destination: '오이타', dates: '9.8 — 9.10', duration: '2박 3일', seats: '4석 남음', price: '199,000원' },
    { source: '땡처리닷컴', airline: '에어서울', departure: '인천', destination: '다카마츠', dates: '9.16 — 9.18', duration: '2박 3일', seats: '8석 남음', price: '157,900원' },
    { source: '모두투어', airline: '이스타항공', departure: '인천', destination: '푸꾸옥', dates: '9.20 — 9.24', duration: '4박 5일', seats: '5석 남음', price: '289,000원' },
    { source: '노랑풍선', airline: '진에어', departure: '부산', destination: '기타큐슈', dates: '9.11 — 9.14', duration: '3박 4일', seats: '9석 남음', price: '204,000원' },
    { source: '온라인투어', airline: '티웨이항공', departure: '인천', destination: '자카르타', dates: '9.13 — 9.17', duration: '4박 5일', seats: '4석 남음', price: '359,900원' },
];

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function formatDate(date: string) {
    const [year, month, day] = date.split('-').map(Number);
    if (!year || !month || !day) return date;
    const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
    return `${month}.${day}(${weekday})`;
}

function tripLength(flight: Flight) {
    const departAt = Date.parse(`${flight.departure.date}T00:00:00Z`);
    const returnAt = Date.parse(`${flight.arrival.date}T00:00:00Z`);
    if (!Number.isFinite(departAt) || !Number.isFinite(returnAt)) return formatDate(flight.departure.date);
    const nights = Math.max(1, Math.round((returnAt - departAt) / 86_400_000));
    return `${nights}박 ${nights + 1}일`;
}

function departureName(city: string) {
    if (city.includes('인천')) return '인천';
    if (city.includes('김포')) return '김포';
    if (city.includes('김해')) return '부산';
    return city.replace(/\([^)]+\)/g, '').trim();
}

function flightScheduleKey(flight: Flight) {
    return [
        flight.departure.city,
        flight.departure.date,
        flight.departure.time,
        flight.arrival.city,
        flight.arrival.date,
        flight.arrival.time,
    ].join('|');
}

function TicketCard({ ticket }: { ticket: PreviewTicket }) {
    return (
        <article className={styles.ticketCard}>
            <div className={styles.ticketTopline}>
                <strong>{ticket.source}</strong>
                <span>{ticket.airline}</span>
                <span className={styles.bookmark} aria-hidden="true">♡</span>
            </div>
            <div className={styles.ticketRoute}>
                <span><strong>{ticket.departure}</strong></span>
                <span className={styles.flightPath}><i>✈</i><small>{ticket.duration}</small></span>
                <span><strong>{ticket.destination}</strong></span>
            </div>
            <p>{ticket.dates}</p>
            <div className={styles.ticketFooter}>
                <span>{ticket.seats}</span>
                <strong>{ticket.price}</strong>
            </div>
        </article>
    );
}

export default function YonagoInsightLegacyPreviewPage() {
    const flights = flightCache.flights as unknown as Flight[];
    const yonagoFlight = flights
        .filter(flight => flight.arrival.city.includes('요나고') && flight.price > 0)
        .sort((a, b) => a.price - b.price)[0] || null;
    const lijiangFlights = flights
        .filter(flight => flight.arrival.city === '리장' && flight.price > 0)
        .sort((a, b) => a.price - b.price);
    const lijiangScheduleFlights = Array.from(lijiangFlights.reduce((bySchedule, flight) => {
        const key = flightScheduleKey(flight);
        if (!bySchedule.has(key)) bySchedule.set(key, flight);
        return bySchedule;
    }, new Map<string, Flight>()).values());
    const lijiangFlight = lijiangScheduleFlights[0] || null;
    const context = getDestinationContext('요나고');
    const meta = yonagoFlight
        ? `${departureName(yonagoFlight.departure.city)} 출발 · ${tripLength(yonagoFlight)}`
        : '인천 출발 · 일정 확인 필요';
    const price = yonagoFlight ? `${yonagoFlight.price.toLocaleString('ko-KR')}원` : '가격 확인 중';
    const lijiangPrice = lijiangFlight ? `${lijiangFlight.price.toLocaleString('ko-KR')}원` : '가격 확인 중';
    const lijiangDeparture = lijiangFlight ? departureName(lijiangFlight.departure.city) : '인천';
    const lijiangSchedule = lijiangFlight
        ? `${lijiangDeparture} 출발 · ${formatDate(lijiangFlight.departure.date)} — ${formatDate(lijiangFlight.arrival.date)} · ${tripLength(lijiangFlight)}`
        : '일정 확인 중';
    const lijiangLocationMeta = lijiangScheduleFlights.length > 1
        ? `중국 윈난 · 일정 ${lijiangScheduleFlights.length}개`
        : '중국 윈난';
    const lijiangPriceLabel = lijiangScheduleFlights.length > 1 ? '왕복 최저가' : '왕복';

    return (
        <div className={styles.previewPage}>
            <header className={styles.header}>
                <Logo />
                <span>이전 인사이트바 미리보기</span>
            </header>

            <main className={styles.main}>
                <div className={styles.notice}>
                    <strong>이전에 쓰던 여행지 발견형</strong>
                    <span>현재 리장 주간 인사이트와 비교하기 위한 별도 미리보기예요.</span>
                </div>

                <section className={styles.feed} aria-label="이전 인사이트바가 들어간 항공권 목록">
                    {PREVIEW_TICKETS.slice(0, 3).map(ticket => <TicketCard key={`${ticket.departure}-${ticket.destination}`} ticket={ticket} />)}

                    <article className={styles.insightBar}>
                        <div className={styles.insightTopline}>
                            <span className={styles.insightEyebrow}>여행지 발견</span>
                            <span className={styles.arrow} aria-hidden="true">↗</span>
                        </div>
                        <h2>🧭 요나고 입문</h2>
                        <p>{context?.location || '조용한 소도시와 온천을 함께 둘러보기 좋은 여행지예요.'}</p>
                        <div className={styles.insightMetric}>
                            <strong>요나고</strong>
                            <b>{price}</b>
                        </div>
                        <div className={styles.insightFooter}>
                            <span>{meta}</span>
                            <em>처음 보는 도시</em>
                        </div>
                    </article>

                    <LijiangInsightButton flights={lijiangFlights}>
                        <div className={styles.currentDiscoveryIntro}>
                            <span>이번 주 낯선 도시</span>
                            <h2>🧭 리장 입문</h2>
                            <p>{lijiangLocationMeta}</p>
                        </div>
                        <div className={styles.currentDiscoveryContent}>
                            <div className={styles.currentDiscoveryTopline}>
                                <span className={styles.currentDiscoveryTheme}>
                                    <strong>고성과 설산을 함께</strong>
                                </span>
                                <span className={styles.currentDiscoveryPrice}>
                                    <small>{lijiangPriceLabel}</small>
                                    <strong>{lijiangPrice}</strong>
                                </span>
                            </div>
                            <p>오래된 골목을 걷고, 가까운 설산까지 하루에 이어 볼 수 있어요. 고성과 자연을 한 일정에 함께 보기 좋은 도시예요.</p>
                            <div className={styles.currentDiscoverySchedule}>{lijiangSchedule}</div>
                            <div className={styles.currentDiscoveryMobileFooter}>
                                <span className={styles.currentDiscoveryMobileSchedule}>{lijiangSchedule}</span>
                                <span className={styles.currentDiscoveryMobilePrice}>
                                    <small>{lijiangPriceLabel}</small>
                                    <strong>{lijiangPrice}</strong>
                                </span>
                            </div>
                        </div>
                    </LijiangInsightButton>

                    {PREVIEW_TICKETS.slice(3).map(ticket => <TicketCard key={`${ticket.departure}-${ticket.destination}`} ticket={ticket} />)}
                </section>
            </main>
        </div>
    );
}
