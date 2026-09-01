'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Flight } from '@/types/flight';
import { isInterparkBenchmarkApplicable } from '@/lib/interpark-benchmark';
import styles from './page.module.css';

interface FlightsResponse {
    flights: Flight[];
    lastUpdated?: string | null;
    todayPickId?: string | null;
}

type SortMode = 'recommended' | 'price' | 'date';

const SOURCE_NAMES: Record<Flight['source'], string> = {
    ybtour: '노랑풍선',
    modetour: '모두투어',
    hanatour: '하나투어',
    onlinetour: '온라인투어',
    ttang: '땡처리닷컴',
    myrealtrip: '마이리얼트립',
};

const REGIONS = ['전체', '일본', '동남아', '중화권', '남태평양', '유럽', '미주', '기타'];
const DEPARTURES = ['전체 출발', '인천/김포', '부산/김해', '대구', '청주', '제주'];
const COLOR_CLASSES = ['lime', 'pink', 'sky', 'lilac', 'orange', 'cream'] as const;

const stripAirport = (city = '') => city.replace(/\([^)]*\)/g, '').trim();
const formatPrice = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`;

const parseDate = (value?: string) => {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
};

const shortDate = (value?: string) => {
    const date = parseDate(value);
    if (!date) return value || '날짜 확인';
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    return `${date.getMonth() + 1}.${date.getDate()} ${weekdays[date.getDay()]}`;
};

const stayLabel = (flight: Flight) => {
    const start = parseDate(flight.departure.date);
    const end = parseDate(flight.arrival.date);
    if (!start || !end) return '일정 확인';
    const nights = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
    return `${nights}박 ${nights + 1}일`;
};

const departureLabel = (flight: Flight) => {
    if (flight.departure.airport === 'ICN') return '인천';
    if (flight.departure.airport === 'GMP') return '김포';
    if (flight.departure.airport === 'PUS') return '부산';
    return stripAirport(flight.departure.city);
};

const seatCount = (flight: Flight) => {
    if (flight.availableSeats && flight.availableSeats > 0) return flight.availableSeats;
    const parsed = Number.parseInt(flight.seats || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const matchesDeparture = (flight: Flight, selected: string) => {
    if (selected === '전체 출발') return true;
    if (selected === '인천/김포') return flight.departure.airport === 'ICN' || flight.departure.airport === 'GMP';
    if (selected === '부산/김해') return flight.departure.airport === 'PUS' || departureLabel(flight).includes('부산');
    return departureLabel(flight).includes(selected);
};

const matchesRegion = (flight: Flight, selected: string) => selected === '전체' || (flight.region || '').includes(selected);
const dateValue = (value?: string) => parseDate(value)?.getTime() || Number.MAX_SAFE_INTEGER;
const flightSearchText = (flight: Flight) => [
    flight.airline,
    SOURCE_NAMES[flight.source],
    flight.departure.city,
    flight.arrival.city,
    flight.departure.airport,
    flight.arrival.airport,
].join(' ').toLowerCase();

function PlaneMark() {
    return (
        <svg viewBox="0 0 34 34" aria-hidden="true">
            <path d="M3 14.4 31 3 21.4 31l-6.7-11.1L3 14.4Z" fill="currentColor" />
            <path d="m14.7 19.9 16.3-17L11.6 18.6l3.1 1.3Z" fill="white" opacity=".78" />
        </svg>
    );
}

export default function TicketCatalogPreview() {
    const [flights, setFlights] = useState<Flight[]>([]);
    const [todayPickId, setTodayPickId] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [region, setRegion] = useState('전체');
    const [departure, setDeparture] = useState('전체 출발');
    const [sort, setSort] = useState<SortMode>('recommended');
    const [visible, setVisible] = useState(16);
    const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);

    useEffect(() => {
        let active = true;
        fetch('/api/flights')
            .then(async (response) => {
                if (!response.ok) throw new Error('항공권을 불러오지 못했습니다.');
                return response.json() as Promise<FlightsResponse>;
            })
            .then((data) => {
                if (!active) return;
                setFlights(data.flights || []);
                setTodayPickId(data.todayPickId || null);
                setLastUpdated(data.lastUpdated || null);
            })
            .catch((cause) => {
                if (active) setError(cause instanceof Error ? cause.message : '잠시 후 다시 확인해주세요.');
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        setVisible(16);
    }, [query, region, departure, sort]);

    useEffect(() => {
        if (!selectedFlight) return;
        const close = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setSelectedFlight(null);
        };
        window.addEventListener('keydown', close);
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', close);
            document.body.style.overflow = '';
        };
    }, [selectedFlight]);

    const filtered = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        const next = flights.filter((flight) => (
            matchesRegion(flight, region)
            && matchesDeparture(flight, departure)
            && (!normalizedQuery || flightSearchText(flight).includes(normalizedQuery))
        ));
        if (sort === 'price') return [...next].sort((a, b) => a.price - b.price);
        if (sort === 'date') return [...next].sort((a, b) => dateValue(a.departure.date) - dateValue(b.departure.date));
        return next;
    }, [departure, flights, query, region, sort]);

    const drop = useMemo(() => (
        flights.find((flight) => flight.id === todayPickId)
        || [...flights].sort((a, b) => a.price - b.price)[0]
        || null
    ), [flights, todayPickId]);

    const updatedLabel = lastUpdated
        ? new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' }).format(new Date(lastUpdated))
        : '오늘';

    const shareFlight = (flight: Flight) => {
        const title = `${departureLabel(flight)}-${stripAirport(flight.arrival.city)} ${formatPrice(flight.price)}`;
        if (navigator.share) navigator.share({ title, url: window.location.href }).catch(() => undefined);
        else navigator.clipboard?.writeText(window.location.href).catch(() => undefined);
    };

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <a className={styles.brand} href="/preview/ticket-catalog" aria-label="티키티킷 표 마켓 홈">
                    <span><PlaneMark /></span>
                    <strong>티키티킷</strong>
                </a>
                <nav className={styles.utilityNav} aria-label="주요 메뉴">
                    <a href="#market">표 마켓</a>
                    <a href="#drop">오늘의 DROP</a>
                    <button type="button">특가 알림</button>
                    <button type="button">내 여행</button>
                </nav>
            </header>

            <div className={styles.newTicker} aria-hidden="true">
                <div>
                    <span>NEW DROP</span><i>✦</i><span>NEW TICKET</span><i>✦</i><span>NEW TRIP</span><i>✦</i>
                    <span>NEW DROP</span><i>✦</i><span>NEW TICKET</span><i>✦</i><span>NEW TRIP</span><i>✦</i>
                </div>
            </div>

            <main>
                <section className={styles.hero} id="drop">
                    <div className={styles.heroIntro}>
                        <p className={styles.issueLabel}>TIKITIKIT MARKET — ISSUE 01 / {updatedLabel}</p>
                        <h1>오늘 들어온<br /><em>여행 재료</em>입니다.</h1>
                        <p className={styles.heroDescription}>목적지는 나중에 정해도 됩니다.<br />지금 가격이 먼저 말을 거는 표부터 꺼내봤어요.</p>
                        <div className={styles.marketFacts}>
                            <span><b>{flights.length || '—'}</b><small>진열 중인 표</small></span>
                            <span><b>6</b><small>여행사 수집</small></span>
                            <span><b>NOW</b><small>오늘 가격 기준</small></span>
                        </div>
                    </div>

                    <div className={styles.heroCatalog}>
                        <div className={styles.heroArt}>
                            <span className={styles.sunburst}>✦</span>
                            <p>GOOD TICKET<br />FOUND HERE</p>
                            <span className={styles.artRoute}>{drop ? `${departureLabel(drop)} → ${stripAirport(drop.arrival.city)}` : '표 찾는 중'}</span>
                        </div>
                        {drop ? (
                            <button className={styles.heroTicket} type="button" onClick={() => setSelectedFlight(drop)}>
                                <div className={styles.ticketIndex}>01</div>
                                <div className={styles.heroTicketTitle}>
                                    <span>TODAY&apos;S TIKIT DROP</span>
                                    <h2>{stripAirport(drop.arrival.city)}</h2>
                                    <p>{SOURCE_NAMES[drop.source]} · {drop.airline}</p>
                                </div>
                                <div className={styles.heroRoute}>
                                    <span>{departureLabel(drop)}<small>{shortDate(drop.departure.date)} {drop.departure.time}</small></span>
                                    <i>→</i>
                                    <span>{stripAirport(drop.arrival.city)}<small>{shortDate(drop.arrival.date)} {drop.arrival.time}</small></span>
                                </div>
                                <div className={styles.heroTicketBottom}>
                                    <span>{stayLabel(drop)}{seatCount(drop) ? ` · ${seatCount(drop)}석 남음` : ''}</span>
                                    <strong>{formatPrice(drop.price)}</strong>
                                </div>
                            </button>
                        ) : <div className={styles.heroTicketLoading}>오늘의 표를 꺼내는 중...</div>}
                    </div>
                </section>

                <section className={styles.statementGrid} aria-label="티키티킷 안내">
                    <div className={styles.statementPink}><span>01</span><b>SEARCH?</b><p>갈 곳을 정한 뒤<br />검색하는 대신</p></div>
                    <div className={styles.statementSky}><span>02</span><b>DISCOVER!</b><p>좋은 표를 보고<br />여행을 만듭니다</p></div>
                    <div className={styles.statementLime}><span>03</span><b>SHARE ↗</b><p>마음에 들면<br />친구부터 소환</p></div>
                </section>

                <section className={styles.market} id="market">
                    <div className={styles.marketTitleRow}>
                        <div>
                            <span>LIVE TICKET CATALOGUE</span>
                            <h2>오늘의 표 마켓</h2>
                        </div>
                        <p><strong>{filtered.length}</strong> ITEMS IN STOCK</p>
                    </div>

                    <div className={styles.filterTable}>
                        <label className={styles.searchField}>
                            <span>SEARCH</span>
                            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="도시·항공사" aria-label="도시 또는 항공사 검색" />
                        </label>
                        <div className={styles.regionField}>
                            <span>REGION</span>
                            <div>
                                {REGIONS.map((item) => (
                                    <button key={item} type="button" className={region === item ? styles.activeFilter : ''} onClick={() => setRegion(item)}>{item}</button>
                                ))}
                            </div>
                        </div>
                        <label className={styles.selectField}>
                            <span>FROM</span>
                            <select value={departure} onChange={(event) => setDeparture(event.target.value)} aria-label="출발지">
                                {DEPARTURES.map((item) => <option key={item}>{item}</option>)}
                            </select>
                        </label>
                        <label className={styles.selectField}>
                            <span>SORT</span>
                            <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)} aria-label="정렬">
                                <option value="recommended">추천순</option>
                                <option value="price">낮은 가격순</option>
                                <option value="date">빠른 출발순</option>
                            </select>
                        </label>
                    </div>

                    {loading && <div className={styles.stateBox}>새 표를 진열하는 중...</div>}
                    {!loading && error && <div className={styles.stateBox}>{error}</div>}
                    {!loading && !error && filtered.length === 0 && <div className={styles.stateBox}>이 조건에는 아직 진열할 표가 없어요.</div>}

                    <div className={styles.catalogGrid}>
                        {filtered.slice(0, visible).map((flight, index) => {
                            const color = COLOR_CLASSES[index % COLOR_CLASSES.length];
                            const destination = stripAirport(flight.arrival.city);
                            return (
                                <button key={flight.id} type="button" className={styles.catalogCard} onClick={() => setSelectedFlight(flight)}>
                                    <div className={`${styles.cardPoster} ${styles[color]}`}>
                                        <div className={styles.cardNumber}>{String(index + 1).padStart(2, '0')}</div>
                                        <div className={styles.posterStamp}>{flight.region || 'TRIP'}<br />TICKET</div>
                                        <h3>{destination}</h3>
                                        <p>{departureLabel(flight)} → {destination}</p>
                                        <span className={styles.posterArrow}>↗</span>
                                    </div>
                                    <div className={styles.cardInfo}>
                                        <div className={styles.cardSupplier}>
                                            <b>{SOURCE_NAMES[flight.source]}</b>
                                            <span>{flight.airline || '항공사 확인'}</span>
                                        </div>
                                        <div className={styles.cardSchedule}>
                                            <span>{shortDate(flight.departure.date)}<small>{flight.departure.time || '시간 확인'}</small></span>
                                            <i>{stayLabel(flight)}</i>
                                            <span>{shortDate(flight.arrival.date)}<small>{flight.arrival.time || '시간 확인'}</small></span>
                                        </div>
                                        <div className={styles.cardPriceRow}>
                                            <span>{seatCount(flight) ? `${seatCount(flight)}석 남음` : '좌석 확인'}</span>
                                            <div>
                                                {isInterparkBenchmarkApplicable(flight) && flight.discountRate && flight.discountRate > 0 ? <small>-{Math.round(flight.discountRate)}%</small> : null}
                                                <strong>{formatPrice(flight.price)}</strong>
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {visible < filtered.length && (
                        <button className={styles.loadMore} type="button" onClick={() => setVisible((count) => count + 16)}>
                            MORE TICKETS <span>+{Math.min(16, filtered.length - visible)}</span>
                        </button>
                    )}
                </section>

                <section className={styles.closingPanel}>
                    <div><span>SCREENSHOT / SHARE / ESCAPE</span><h2>좋은 표를 발견하면<br />여행 얘기가 시작됩니다.</h2></div>
                    <button type="button" onClick={() => navigator.share?.({ title: '티키티킷 표 마켓', url: window.location.href })}>친구에게 마켓 보내기 ↗</button>
                </section>
            </main>

            <footer className={styles.footer}>
                <div className={styles.footerBrand}><span><PlaneMark /></span><b>티키티킷</b></div>
                <p>좋은 표가 여행을 먼저 제안합니다.</p>
                <div><a href="#drop">TODAY&apos;S DROP</a><a href="#market">TICKET MARKET</a><a href="/">운영 사이트</a></div>
            </footer>

            {selectedFlight && (
                <div className={styles.modalBackdrop} role="presentation" onClick={() => setSelectedFlight(null)}>
                    <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="catalog-detail-title" onClick={(event) => event.stopPropagation()}>
                        <button className={styles.modalClose} type="button" onClick={() => setSelectedFlight(null)} aria-label="닫기">×</button>
                        <div className={styles.modalPoster}>
                            <span>SELECTED TICKET</span>
                            <h2 id="catalog-detail-title">{stripAirport(selectedFlight.arrival.city)}</h2>
                            <p>{departureLabel(selectedFlight)} → {stripAirport(selectedFlight.arrival.city)}</p>
                        </div>
                        <div className={styles.modalBody}>
                            <div className={styles.modalSupplier}><b>{SOURCE_NAMES[selectedFlight.source]}</b><span>{selectedFlight.airline}</span></div>
                            <div className={styles.modalSchedule}>
                                <div><span>가는 날</span><b>{shortDate(selectedFlight.departure.date)}</b><strong>{selectedFlight.departure.time || '시간 확인'}</strong><small>{departureLabel(selectedFlight)} ({selectedFlight.departure.airport})</small></div>
                                <i>→</i>
                                <div><span>오는 날</span><b>{shortDate(selectedFlight.arrival.date)}</b><strong>{selectedFlight.arrival.time || '시간 확인'}</strong><small>{stripAirport(selectedFlight.arrival.city)} ({selectedFlight.arrival.airport})</small></div>
                            </div>
                            <div className={styles.modalPrice}><span>{stayLabel(selectedFlight)}{seatCount(selectedFlight) ? ` · ${seatCount(selectedFlight)}석 남음` : ''}</span><strong>{formatPrice(selectedFlight.price)}</strong></div>
                            {selectedFlight.source === 'ttang' && <p className={styles.notice}>땡처리닷컴에서는 발권수수료 2만원이 더해질 수 있어요.</p>}
                            <p className={styles.notice}>가격과 좌석은 바뀔 수 있어요. 예약 전에 여행사에서 한 번 더 확인해주세요.</p>
                            <div className={styles.modalActions}>
                                <button type="button" onClick={() => shareFlight(selectedFlight)}>공유</button>
                                <a href={selectedFlight.link} target="_blank" rel="noopener noreferrer">여행사에서 확인 ↗</a>
                            </div>
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
}
