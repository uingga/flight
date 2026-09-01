'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Flight } from '@/types/flight';
import { isInterparkBenchmarkApplicable } from '@/lib/interpark-benchmark';
import styles from './page.module.css';

interface FlightsResponse {
    success: boolean;
    count: number;
    flights: Flight[];
    lastUpdated?: string | null;
    todayPickId?: string | null;
}

type SortMode = 'recommended' | 'price' | 'date';

const REACTIONS = [
    '냅다 선정',
    '일단 박제',
    '가격 반칙',
    '선 넘은 표',
    '긴급 채택',
    '급히 데려옴',
    '냉큼 확보',
    '급히 편성',
    '슬쩍 공개',
    '단톡방 소환',
    '연차 있음?',
    '일단 공유',
    '이걸 참아?',
    '다 비켜봐',
    '잠깐만 이거 뭐야',
    '네? 이 가격이요?',
    '얘들아 잠깐',
    '아니 이게 왜 돼',
    '비켜, 내가 누를게',
    '지금 뭐 본 거지',
    '아니 진짜로?',
    '아무튼 출국',
    '님아?',
    '저기요?',
    '이거 합법임?',
] as const;

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

const stripAirport = (city = '') => city.replace(/\([^)]*\)/g, '').trim();
const price = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`;

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
    const city = stripAirport(flight.departure.city);
    if (flight.departure.airport === 'ICN') return '인천';
    if (flight.departure.airport === 'GMP') return '김포';
    if (flight.departure.airport === 'PUS') return '부산';
    return city;
};

const seats = (flight: Flight) => {
    if (flight.availableSeats && flight.availableSeats > 0) return flight.availableSeats;
    const parsed = Number.parseInt(flight.seats || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const matchesDeparture = (flight: Flight, selected: string) => {
    if (selected === '전체 출발') return true;
    const airport = flight.departure.airport;
    if (selected === '인천/김포') return airport === 'ICN' || airport === 'GMP';
    if (selected === '부산/김해') return airport === 'PUS' || departureLabel(flight).includes('부산');
    return departureLabel(flight).includes(selected);
};

const matchesRegion = (flight: Flight, selected: string) => {
    if (selected === '전체') return true;
    return (flight.region || '').includes(selected);
};

const flightSearchText = (flight: Flight) => [
    flight.airline,
    SOURCE_NAMES[flight.source],
    flight.departure.city,
    flight.arrival.city,
    flight.departure.airport,
    flight.arrival.airport,
].join(' ').toLowerCase();

const dateValue = (value?: string) => parseDate(value)?.getTime() || Number.MAX_SAFE_INTEGER;

function PaperPlane() {
    return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
            <path d="M2 14.2 29.6 2.8 20 29.4l-6.3-10.7L2 14.2Z" fill="currentColor" />
            <path d="m13.7 18.7 15.9-15.9L10.8 17.6l2.9 1.1Z" fill="#fff" opacity=".72" />
        </svg>
    );
}

export default function DropReactionPreview() {
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
    const [reactionIndex, setReactionIndex] = useState(13);
    const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
    const [filterOpen, setFilterOpen] = useState(false);

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

    const drop = useMemo(() => {
        const picked = flights.find((flight) => flight.id === todayPickId);
        if (picked) return picked;
        return [...flights].sort((a, b) => a.price - b.price)[0] || null;
    }, [flights, todayPickId]);

    const currentReaction = REACTIONS[reactionIndex % REACTIONS.length];
    const cycleReaction = () => setReactionIndex((current) => (current + 1) % REACTIONS.length);
    const updatedLabel = lastUpdated
        ? new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' }).format(new Date(lastUpdated))
        : '오늘';

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <a className={styles.wordmark} href="/preview/drop-reaction" aria-label="티키티킷 홈">
                    <span className={styles.wordmarkPlane}><PaperPlane /></span>
                    <strong>티키티킷</strong>
                </a>
                <nav className={styles.primaryNav} aria-label="주요 메뉴">
                    <a href="#drop">오늘의 DROP</a>
                    <a href="#flights">표 구경</a>
                    <a href="#notes">가격 노트</a>
                </nav>
                <div className={styles.headerActions}>
                    <button type="button" className={styles.textAction}>내 여행</button>
                    <button type="button" className={styles.alertAction}>특가 알림</button>
                </div>
            </header>

            <section className={styles.reactionRail} aria-label="TIKIT DROP 반응">
                <span className={styles.railLabel}>TIKIT DROP</span>
                <button type="button" className={styles.railReaction} onClick={cycleReaction} aria-label="다른 반응 문구 보기">
                    {currentReaction}
                    <span aria-hidden="true">↗</span>
                </button>
                <span className={styles.railHint}>눌러서 다음 반응</span>
                <div className={styles.railTicker} aria-hidden="true">
                    <span>이상하게 싼 표만 데려옵니다</span>
                    <span>검색보다 발견</span>
                    <span>오늘도 출국할 이유 수집 중</span>
                </div>
            </section>

            <main>
                <section className={styles.hero} id="drop">
                    <div className={styles.heroCopy}>
                        <div className={styles.kicker}><span>DISCOVERY</span><i />NOT SEARCH</div>
                        <h1>여행 계획은<br />표가 먼저 <em>시작합니다.</em></h1>
                        <p>어디로 갈지 정하지 않아도 괜찮아요.<br />지금 이상하게 좋은 표부터 구경하세요.</p>
                        <div className={styles.heroProof}>
                            <span><b>{flights.length || '—'}</b> 오늘 볼 수 있는 표</span>
                            <span><b>6</b> 여행사에서 수집</span>
                            <span><b>{updatedLabel}</b> 가격 기준</span>
                        </div>
                    </div>

                    <div className={styles.featureWrap}>
                        <div className={styles.featureIndex}>TODAY&apos;S<br />DROP</div>
                        {drop ? (
                            <button className={styles.featureCard} type="button" onClick={() => setSelectedFlight(drop)}>
                                <div className={styles.featureTopline}>
                                    <span>{SOURCE_NAMES[drop.source]}</span>
                                    <span>{drop.airline || '항공사 확인'}</span>
                                    <span>NO. 001</span>
                                </div>
                                <div className={styles.featureReaction}>{currentReaction}</div>
                                <div className={styles.featureRoute}>
                                    <div>
                                        <b>{departureLabel(drop)}</b>
                                        <small>{shortDate(drop.departure.date)} · {drop.departure.time || '시간 확인'}</small>
                                    </div>
                                    <span className={styles.routeArrow}>→</span>
                                    <div>
                                        <b>{stripAirport(drop.arrival.city)}</b>
                                        <small>{shortDate(drop.arrival.date)} · {drop.arrival.time || '시간 확인'}</small>
                                    </div>
                                </div>
                                <div className={styles.featureBottom}>
                                    <div>
                                        <span>{stayLabel(drop)}</span>
                                        {seats(drop) && <span>{seats(drop)}석 남음</span>}
                                    </div>
                                    <strong>{price(drop.price)}</strong>
                                </div>
                                <span className={styles.featureCta}>표 자세히 보기 <i>↗</i></span>
                            </button>
                        ) : (
                            <div className={styles.featureLoading}>오늘의 표를 찾는 중...</div>
                        )}
                    </div>
                </section>

                <section className={styles.discoveryStrip} id="notes">
                    <div>
                        <span className={styles.discoveryNumber}>01</span>
                        <p><b>오늘 처음 보는 도시?</b><br />가격부터 보면 생각보다 가까울 수 있어요.</p>
                    </div>
                    <div>
                        <span className={styles.discoveryNumber}>02</span>
                        <p><b>일정이 조금 이상해도</b><br />가격이 좋으면 여행이 먼저 생깁니다.</p>
                    </div>
                    <div>
                        <span className={styles.discoveryNumber}>03</span>
                        <p><b>친구 한 명만 떠오르면</b><br />일단 공유부터 해보세요.</p>
                    </div>
                </section>

                <section className={styles.flightSection} id="flights">
                    <div className={styles.sectionHeading}>
                        <div>
                            <span>LIVE SHELF / {updatedLabel}</span>
                            <h2>오늘은 어디로 튈까요?</h2>
                        </div>
                        <p><b>{filtered.length}</b>개의 표가 기다리는 중</p>
                    </div>

                    <div className={styles.filterBar}>
                        <label className={styles.searchBox}>
                            <span aria-hidden="true">⌕</span>
                            <input
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="도시·항공사 검색"
                                aria-label="도시 또는 항공사 검색"
                            />
                        </label>
                        <div className={styles.regionFilters}>
                            {REGIONS.map((item) => (
                                <button
                                    type="button"
                                    key={item}
                                    className={region === item ? styles.filterActive : ''}
                                    onClick={() => setRegion(item)}
                                >
                                    {item}
                                </button>
                            ))}
                        </div>
                        <button type="button" className={styles.mobileFilterButton} onClick={() => setFilterOpen((open) => !open)}>
                            조건 {filterOpen ? '닫기' : '보기'}
                        </button>
                        <div className={`${styles.filterSelects} ${filterOpen ? styles.filterSelectsOpen : ''}`}>
                            <select value={departure} onChange={(event) => setDeparture(event.target.value)} aria-label="출발지">
                                {DEPARTURES.map((item) => <option key={item}>{item}</option>)}
                            </select>
                            <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)} aria-label="정렬">
                                <option value="recommended">추천순</option>
                                <option value="price">낮은 가격순</option>
                                <option value="date">빠른 출발순</option>
                            </select>
                        </div>
                    </div>

                    {loading && <div className={styles.stateBox}>오늘의 항공권을 펼치는 중...</div>}
                    {!loading && error && <div className={styles.stateBox}>{error}</div>}
                    {!loading && !error && filtered.length === 0 && <div className={styles.stateBox}>이 조건에는 아직 잡힌 표가 없어요.</div>}

                    <div className={styles.flightGrid}>
                        {filtered.slice(0, visible).map((flight, index) => (
                            <button
                                type="button"
                                className={styles.flightCard}
                                key={flight.id}
                                onClick={() => setSelectedFlight(flight)}
                            >
                                <div className={styles.cardTopline}>
                                    <span className={styles.cardSource}>{SOURCE_NAMES[flight.source]}</span>
                                    <span>{flight.airline || '항공사 확인'}</span>
                                    <span>{String(index + 1).padStart(2, '0')}</span>
                                </div>
                                <div className={styles.cardRoute}>
                                    <div>
                                        <b>{departureLabel(flight)}</b>
                                        <small>{shortDate(flight.departure.date)}</small>
                                        <em>{flight.departure.time || '시간 확인'}</em>
                                    </div>
                                    <span>
                                        <i>✈</i>
                                        <small>{stayLabel(flight)}</small>
                                    </span>
                                    <div>
                                        <b>{stripAirport(flight.arrival.city)}</b>
                                        <small>{shortDate(flight.arrival.date)}</small>
                                        <em>{flight.arrival.time || '시간 확인'}</em>
                                    </div>
                                </div>
                                <div className={styles.cardBottom}>
                                    <span>{seats(flight) ? `${seats(flight)}석 남음` : '좌석 확인'}</span>
                                    <div>
                                        {isInterparkBenchmarkApplicable(flight) && flight.discountRate && flight.discountRate > 0 ? <small>-{Math.round(flight.discountRate)}%</small> : null}
                                        <strong>{price(flight.price)}</strong>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>

                    {visible < filtered.length && (
                        <button className={styles.loadMore} type="button" onClick={() => setVisible((count) => count + 12)}>
                            표 더 펼치기 <span>{Math.min(12, filtered.length - visible)}장</span>
                        </button>
                    )}
                </section>

                <section className={styles.shareSection}>
                    <div className={styles.shareStamp}>SCREENSHOT<br />WELCOME</div>
                    <div>
                        <span>오늘 본 표를 친구에게</span>
                        <h2>여행 계획보다<br />단톡방이 먼저 열립니다.</h2>
                    </div>
                    <button type="button" onClick={() => navigator.share?.({ title: '티키티킷', url: window.location.href })}>
                        이 화면 공유하기 ↗
                    </button>
                </section>
            </main>

            <footer className={styles.footer}>
                <div className={styles.footerBrand}>
                    <span className={styles.wordmarkPlane}><PaperPlane /></span>
                    <strong>티키티킷</strong>
                </div>
                <p>좋은 표 하나가, 여행을 먼저 제안합니다.</p>
                <div><a href="#drop">TIKIT DROP</a><a href="#flights">항공권 보기</a><a href="/">운영 사이트</a></div>
            </footer>

            {selectedFlight && (
                <div className={styles.modalBackdrop} role="presentation" onClick={() => setSelectedFlight(null)}>
                    <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="reaction-detail-title" onClick={(event) => event.stopPropagation()}>
                        <button className={styles.modalClose} type="button" onClick={() => setSelectedFlight(null)} aria-label="닫기">×</button>
                        <div className={styles.modalEyebrow}>
                            <span>{SOURCE_NAMES[selectedFlight.source]}</span>
                            <span>{selectedFlight.airline || '항공사 확인'}</span>
                        </div>
                        <h2 id="reaction-detail-title">{departureLabel(selectedFlight)}에서<br />{stripAirport(selectedFlight.arrival.city)}까지</h2>
                        <div className={styles.modalRoute}>
                            <div>
                                <span>가는 날</span>
                                <b>{shortDate(selectedFlight.departure.date)}</b>
                                <strong>{selectedFlight.departure.time || '시간 확인'}</strong>
                                <small>{departureLabel(selectedFlight)} ({selectedFlight.departure.airport})</small>
                            </div>
                            <i>→</i>
                            <div>
                                <span>오는 날</span>
                                <b>{shortDate(selectedFlight.arrival.date)}</b>
                                <strong>{selectedFlight.arrival.time || '시간 확인'}</strong>
                                <small>{stripAirport(selectedFlight.arrival.city)} ({selectedFlight.arrival.airport})</small>
                            </div>
                        </div>
                        <div className={styles.modalPrice}>
                            <div>
                                <span>{stayLabel(selectedFlight)}</span>
                                {seats(selectedFlight) && <span>{seats(selectedFlight)}석 남음</span>}
                            </div>
                            <strong>{price(selectedFlight.price)}</strong>
                        </div>
                        {selectedFlight.source === 'ttang' && <p className={styles.modalNotice}>땡처리닷컴에서는 발권수수료 2만원이 더해질 수 있어요.</p>}
                        <p className={styles.modalNotice}>가격과 좌석은 실시간으로 바뀔 수 있어요. 예약 전에 여행사에서 다시 확인해주세요.</p>
                        <div className={styles.modalActions}>
                            <button type="button" onClick={() => navigator.share?.({ title: `${departureLabel(selectedFlight)}-${stripAirport(selectedFlight.arrival.city)} 항공권`, url: window.location.href })}>공유</button>
                            <a href={selectedFlight.link} target="_blank" rel="noopener noreferrer">여행사에서 확인 ↗</a>
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
}
