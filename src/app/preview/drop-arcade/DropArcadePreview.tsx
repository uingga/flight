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
const TONES = ['yellow', 'pink', 'green', 'blue', 'orange', 'violet'] as const;
const REACTIONS = ['네? 이 가격이요?', '잠깐만 이거 뭐야', '다 비켜봐', '얘들아 잠깐', '아무튼 출국'];

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
    return `${date.getMonth() + 1}.${date.getDate()}(${weekdays[date.getDay()]})`;
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

const searchText = (flight: Flight) => [
    flight.airline,
    SOURCE_NAMES[flight.source],
    flight.departure.city,
    flight.arrival.city,
    flight.departure.airport,
    flight.arrival.airport,
].join(' ').toLowerCase();

const dateValue = (value?: string) => parseDate(value)?.getTime() || Number.MAX_SAFE_INTEGER;

function PlaneMark() {
    return (
        <svg viewBox="0 0 34 34" aria-hidden="true">
            <path d="M3 14.4 31 3 21.4 31l-6.7-11.1L3 14.4Z" fill="currentColor" />
            <path d="m14.7 19.9 16.3-17L11.6 18.6l3.1 1.3Z" fill="white" opacity=".75" />
        </svg>
    );
}

export default function DropArcadePreview() {
    const [flights, setFlights] = useState<Flight[]>([]);
    const [todayPickId, setTodayPickId] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [region, setRegion] = useState('전체');
    const [departure, setDeparture] = useState('전체 출발');
    const [sort, setSort] = useState<SortMode>('recommended');
    const [visible, setVisible] = useState(12);
    const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
    const [reactionIndex, setReactionIndex] = useState(0);

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
        setVisible(12);
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
        const normalized = query.trim().toLowerCase();
        const next = flights.filter((flight) => (
            (region === '전체' || (flight.region || '').includes(region))
            && matchesDeparture(flight, departure)
            && (!normalized || searchText(flight).includes(normalized))
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
                <a className={styles.brand} href="/preview/drop-arcade">
                    <span><PlaneMark /></span><strong>티키티킷</strong>
                </a>
                <div className={styles.headerMessage}>오늘도 출국할 핑계 접수 중 ●</div>
                <nav className={styles.headerNav} aria-label="주요 메뉴">
                    <a href="#drops">DROP</a><button type="button">특가 알림</button><button type="button">내 여행</button>
                </nav>
            </header>

            <div className={styles.alertRail}>
                <span>⚠ DROP SIGNAL</span>
                <div><b>이상한 가격 발견</b><i>★</i><b>좋은 표가 여행을 먼저 제안함</b><i>★</i><b>일단 구경하고 고민은 나중에</b><i>★</i></div>
            </div>

            <main>
                <section className={styles.hero}>
                    <div className={styles.heroBoard}>
                        <span className={styles.heroIssue}>TIKITIKIT / {updatedLabel} / LIVE</span>
                        <h1><span>DROP</span><span>DROP</span><span>DROP!</span></h1>
                        <p>갈 곳을 검색하지 마세요.<br />오늘 튀어나온 표부터 보세요.</p>
                        <button type="button" className={styles.reactionButton} onClick={() => setReactionIndex((current) => (current + 1) % REACTIONS.length)}>
                            {REACTIONS[reactionIndex]} <span>↻</span>
                        </button>
                        <i className={styles.cursorSticker}>↖</i>
                        <i className={styles.eyeSticker}><span /><span /></i>
                    </div>

                    <div className={styles.dropStage}>
                        <div className={styles.stageLabel}>TODAY&apos;S<br />MAIN DROP</div>
                        {drop ? (
                            <button type="button" className={styles.mainDrop} onClick={() => setSelectedFlight(drop)}>
                                <div className={styles.dropTop}><span>01 / 발견 완료</span><span>{SOURCE_NAMES[drop.source]}</span></div>
                                <div className={styles.dropDestination}><small>{departureLabel(drop)}에서</small><strong>{stripAirport(drop.arrival.city)}</strong><em>왕복</em></div>
                                <div className={styles.dropSchedule}>
                                    <span>{shortDate(drop.departure.date)}<small>{drop.departure.time || '시간 확인'}</small></span>
                                    <i>✈</i>
                                    <span>{shortDate(drop.arrival.date)}<small>{drop.arrival.time || '시간 확인'}</small></span>
                                </div>
                                <div className={styles.dropBottom}>
                                    <span>{drop.airline} · {stayLabel(drop)}{seatCount(drop) ? ` · ${seatCount(drop)}석` : ''}</span>
                                    <strong>{formatPrice(drop.price)}</strong>
                                </div>
                                <div className={styles.dropBurst}>!</div>
                            </button>
                        ) : <div className={styles.dropLoading}>오늘의 DROP 찾는 중...</div>}
                        <div className={styles.stageFacts}><span><b>{flights.length || '—'}</b>개 표</span><span><b>6</b>개 여행사</span><span><b>1</b>개 오늘의 DROP</span></div>
                    </div>
                </section>

                <section className={styles.mosaic} aria-label="티키티킷 특징">
                    <div className={styles.mosaicBlack}><span>01</span><b>검색보다<br />발견</b></div>
                    <div className={styles.mosaicYellow}><span>02</span><b>가격 먼저.<br />계획은 다음.</b></div>
                    <div className={styles.mosaicPink}><span className={styles.pixelHeart}>♥</span><b>친구 한 명<br />소환 완료</b></div>
                    <div className={styles.mosaicGreen}><span>LIVE</span><b>오늘 나온<br />표만 가득</b></div>
                </section>

                <section className={styles.dropList} id="drops">
                    <div className={styles.listHeading}>
                        <div><span>SCROLL TO ESCAPE ↓</span><h2>뭐가 떴나<br />보러 왔습니다.</h2></div>
                        <div className={styles.listCounter}><b>{filtered.length}</b><span>표 발견됨</span></div>
                    </div>

                    <div className={styles.filterPanel}>
                        <label className={styles.searchBox}><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="도시·항공사 검색" aria-label="도시 또는 항공사 검색" /></label>
                        <div className={styles.regionButtons}>
                            {REGIONS.map((item) => <button type="button" key={item} className={region === item ? styles.regionActive : ''} onClick={() => setRegion(item)}>{item}</button>)}
                        </div>
                        <label className={styles.selectBox}><span>출발</span><select value={departure} onChange={(event) => setDeparture(event.target.value)} aria-label="출발지">{DEPARTURES.map((item) => <option key={item}>{item}</option>)}</select></label>
                        <label className={styles.selectBox}><span>정렬</span><select value={sort} onChange={(event) => setSort(event.target.value as SortMode)} aria-label="정렬"><option value="recommended">추천순</option><option value="price">낮은 가격순</option><option value="date">빠른 출발순</option></select></label>
                    </div>

                    {loading && <div className={styles.stateBox}>DROP을 불러오는 중...</div>}
                    {!loading && error && <div className={styles.stateBox}>{error}</div>}
                    {!loading && !error && filtered.length === 0 && <div className={styles.stateBox}>이 조건에는 아직 잡힌 표가 없어요.</div>}

                    <div className={styles.flightGrid}>
                        {filtered.slice(0, visible).map((flight, index) => {
                            const tone = TONES[index % TONES.length];
                            return (
                                <button type="button" className={`${styles.flightCard} ${styles[tone]}`} key={flight.id} onClick={() => setSelectedFlight(flight)}>
                                    <div className={styles.cardSticker}>{String(index + 1).padStart(2, '0')}</div>
                                    <div className={styles.cardTop}><span>{SOURCE_NAMES[flight.source]}</span><span>{flight.airline || '항공사 확인'}</span></div>
                                    <div className={styles.cardRoute}><span>{departureLabel(flight)}</span><i>→</i><strong>{stripAirport(flight.arrival.city)}</strong></div>
                                    <div className={styles.cardDates}>
                                        <span>{shortDate(flight.departure.date)} <small>{flight.departure.time || '시간 확인'}</small></span>
                                        <em>{stayLabel(flight)}</em>
                                        <span>{shortDate(flight.arrival.date)} <small>{flight.arrival.time || '시간 확인'}</small></span>
                                    </div>
                                    <div className={styles.cardPrice}>
                                        <span>{seatCount(flight) ? `${seatCount(flight)}석 남음` : '좌석 확인'}</span>
                                        <div>{isInterparkBenchmarkApplicable(flight) && flight.discountRate && flight.discountRate > 0 ? <small>-{Math.round(flight.discountRate)}%</small> : null}<strong>{formatPrice(flight.price)}</strong></div>
                                    </div>
                                    <span className={styles.cardArrow}>↗</span>
                                </button>
                            );
                        })}
                    </div>

                    {visible < filtered.length && <button type="button" className={styles.loadMore} onClick={() => setVisible((current) => current + 12)}>DROP 더 풀기 <span>+{Math.min(12, filtered.length - visible)}</span></button>}
                </section>

                <section className={styles.shareZone}>
                    <span className={styles.shareCursor}>↖</span>
                    <div><small>NO PLAN? NO PROBLEM.</small><h2>일정 없던 사람도<br />표를 보면 달라집니다.</h2></div>
                    <button type="button" onClick={() => navigator.share?.({ title: '티키티킷 DROP ARCADE', url: window.location.href })}>단톡방에 투하 ↗</button>
                </section>
            </main>

            <footer className={styles.footer}>
                <div className={styles.footerBrand}><span><PlaneMark /></span><b>티키티킷</b></div>
                <p>GOOD TICKETS MAKE NEW PLANS.</p>
                <div><a href="#drops">DROP</a><a href="/">운영 사이트</a></div>
            </footer>

            {selectedFlight && (
                <div className={styles.modalBackdrop} role="presentation" onClick={() => setSelectedFlight(null)}>
                    <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="arcade-detail-title" onClick={(event) => event.stopPropagation()}>
                        <button type="button" className={styles.modalClose} onClick={() => setSelectedFlight(null)} aria-label="닫기">×</button>
                        <div className={styles.modalColor}>
                            <span>TICKET CAUGHT!</span>
                            <h2 id="arcade-detail-title">{stripAirport(selectedFlight.arrival.city)}</h2>
                            <p>{departureLabel(selectedFlight)}에서 출발</p>
                            <i>↗</i>
                        </div>
                        <div className={styles.modalBody}>
                            <div className={styles.modalSupplier}><b>{SOURCE_NAMES[selectedFlight.source]}</b><span>{selectedFlight.airline}</span></div>
                            <div className={styles.modalRoute}>
                                <div><span>가는 날</span><b>{shortDate(selectedFlight.departure.date)}</b><strong>{selectedFlight.departure.time || '시간 확인'}</strong><small>{departureLabel(selectedFlight)} ({selectedFlight.departure.airport})</small></div>
                                <i>→</i>
                                <div><span>오는 날</span><b>{shortDate(selectedFlight.arrival.date)}</b><strong>{selectedFlight.arrival.time || '시간 확인'}</strong><small>{stripAirport(selectedFlight.arrival.city)} ({selectedFlight.arrival.airport})</small></div>
                            </div>
                            <div className={styles.modalPrice}><span>{stayLabel(selectedFlight)}{seatCount(selectedFlight) ? ` · ${seatCount(selectedFlight)}석 남음` : ''}</span><strong>{formatPrice(selectedFlight.price)}</strong></div>
                            {selectedFlight.source === 'ttang' && <p className={styles.notice}>땡처리닷컴에서는 발권수수료 2만원이 더해질 수 있어요.</p>}
                            <p className={styles.notice}>가격과 좌석은 바뀔 수 있어요. 예약 전에 여행사에서 한 번 더 확인해주세요.</p>
                            <div className={styles.modalActions}><button type="button" onClick={() => shareFlight(selectedFlight)}>공유</button><a href={selectedFlight.link} target="_blank" rel="noopener noreferrer">여행사에서 확인 ↗</a></div>
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
}
