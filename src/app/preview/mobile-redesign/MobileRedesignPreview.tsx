'use client';

import { useEffect, useMemo, useState } from 'react';
import Logo from '@/components/Logo';
import type { Flight } from '@/types/flight';
import styles from './page.module.css';

type SortMode = 'recommended' | 'price' | 'date';
type DatePeriod = 'all' | 'this-week' | 'this-weekend' | 'next-week' | 'this-month' | 'next-month';

interface FlightsResponse {
    success: boolean;
    count: number;
    flights: Flight[];
    lastUpdated?: string | null;
}

const SOURCE_NAMES: Record<Flight['source'], string> = {
    ybtour: '노랑풍선',
    modetour: '모두투어',
    hanatour: '하나투어',
    onlinetour: '온라인투어',
    ttang: '땡처리닷컴',
    myrealtrip: '마이리얼트립',
};

const REGION_OPTIONS = ['전체', '일본', '동남아', '중화권', '남태평양', '유럽', '미주', '기타'];
const DEPARTURE_OPTIONS = ['전체', '인천/김포', '부산/김해', '대구', '청주', '제주'];
const DATE_PERIOD_OPTIONS: Array<{ label: string; value: DatePeriod }> = [
    { label: '전체', value: 'all' },
    { label: '이번 주', value: 'this-week' },
    { label: '이번 주말', value: 'this-weekend' },
    { label: '다음 주', value: 'next-week' },
    { label: '이번 달', value: 'this-month' },
    { label: '다음 달', value: 'next-month' },
];
const PRICE_OPTIONS = [
    { label: '제한 없음', value: 0 },
    { label: '20만원 이하', value: 200_000 },
    { label: '30만원 이하', value: 300_000 },
    { label: '50만원 이하', value: 500_000 },
];

const stripAirport = (city: string) => city.replace(/\([^)]*\)/g, '').trim();

const departureName = (flight: Flight) => {
    if (flight.departure.airport === 'ICN') return '인천';
    if (flight.departure.airport === 'GMP') return '김포';
    if (flight.departure.airport === 'PUS') return '부산';
    return stripAirport(flight.departure.city);
};

const effectivePrice = (flight: Flight) => flight.price + (flight.source === 'ttang' ? 20_000 : 0);

const parseDate = (value: string) => {
    const normalized = value.replace(/\./g, '-').replace(/\([^)]*\)/g, '').trim().slice(0, 10);
    const date = new Date(`${normalized}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
};

const shortDate = (value: string) => {
    const date = parseDate(value);
    if (!date) return value || '날짜 확인';
    return new Intl.DateTimeFormat('ko-KR', {
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
    }).format(date).replace(/\.$/, '');
};

const tripLength = (flight: Flight) => {
    const departure = parseDate(flight.departure.date);
    const arrival = parseDate(flight.arrival.date);
    if (!departure || !arrival) return null;
    const days = Math.round((arrival.getTime() - departure.getTime()) / 86_400_000) + 1;
    return days > 0 ? `${days}일` : null;
};

const priceText = (price: number) => `${new Intl.NumberFormat('ko-KR').format(price)}원`;

const regionMatches = (flight: Flight, region: string) => {
    if (region === '전체') return true;
    const raw = flight.region || '';
    if (region === '중화권') return ['중국', '홍콩', '마카오', '대만', '중화권'].some(item => raw.includes(item));
    return raw.includes(region);
};

const departureMatches = (flight: Flight, departure: string) => {
    if (departure === '전체') return true;
    const airport = flight.departure.airport;
    if (departure === '인천/김포') return ['ICN', 'GMP'].includes(airport) || /서울|인천|김포/.test(flight.departure.city);
    if (departure === '부산/김해') return airport === 'PUS' || /부산|김해/.test(flight.departure.city);
    return flight.departure.city.includes(departure);
};

const addDays = (date: Date, days: number) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
};

const datePeriodMatches = (flight: Flight, period: DatePeriod, referenceDate: Date) => {
    if (period === 'all') return true;
    const departureDate = parseDate(flight.departure.date);
    if (!departureDate) return false;

    const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
    const mondayOffset = (today.getDay() + 6) % 7;
    const thisMonday = addDays(today, -mondayOffset);
    let start: Date;
    let end: Date;

    if (period === 'this-week') {
        start = thisMonday;
        end = addDays(thisMonday, 7);
    } else if (period === 'this-weekend') {
        start = addDays(thisMonday, 5);
        end = addDays(thisMonday, 7);
    } else if (period === 'next-week') {
        start = addDays(thisMonday, 7);
        end = addDays(thisMonday, 14);
    } else if (period === 'this-month') {
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    } else {
        start = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        end = new Date(today.getFullYear(), today.getMonth() + 2, 1);
    }

    return departureDate >= start && departureDate < end;
};

const recommendedScore = (flight: Flight) => {
    const discount = Math.max(0, flight.discountRate || 0);
    const seatBonus = flight.availableSeats && flight.availableSeats <= 9 ? 8 : 0;
    return effectivePrice(flight) - discount * 2_500 - seatBonus * 1_000;
};

function Icon({ name }: { name: 'sliders' | 'search' | 'star' | 'share' | 'close' | 'arrow' }) {
    const paths = {
        sliders: <><line x1="4" y1="7" x2="20" y2="7" /><circle cx="9" cy="7" r="2" /><line x1="4" y1="17" x2="20" y2="17" /><circle cx="15" cy="17" r="2" /></>,
        search: <><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></>,
        star: <polygon points="12 2.8 14.8 8.5 21.1 9.4 16.5 13.9 17.6 20.2 12 17.2 6.4 20.2 7.5 13.9 2.9 9.4 9.2 8.5 12 2.8" />,
        share: <><path d="M4 12v8h16v-8" /><polyline points="8 7 12 3 16 7" /><line x1="12" y1="3" x2="12" y2="15" /></>,
        close: <><line x1="5" y1="5" x2="19" y2="19" /><line x1="19" y1="5" x2="5" y2="19" /></>,
        arrow: <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="14 7 19 12 14 17" /></>,
    };
    return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function MobileRedesignPreview() {
    const [flights, setFlights] = useState<Flight[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [region, setRegion] = useState('전체');
    const [departure, setDeparture] = useState('전체');
    const [datePeriod, setDatePeriod] = useState<DatePeriod>('all');
    const [maxPrice, setMaxPrice] = useState(0);
    const [sort, setSort] = useState<SortMode>('recommended');
    const [query, setQuery] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [filterOpen, setFilterOpen] = useState(false);
    const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    const [visibleCount, setVisibleCount] = useState(16);
    const [toast, setToast] = useState('');

    useEffect(() => {
        let active = true;
        fetch('/api/flights?sortBy=price&sortOrder=asc')
            .then(response => {
                if (!response.ok) throw new Error('항공권을 불러오지 못했습니다.');
                return response.json() as Promise<FlightsResponse>;
            })
            .then(data => {
                if (!active) return;
                if (!data.success) throw new Error('항공권을 불러오지 못했습니다.');
                setFlights(data.flights || []);
                setLastUpdated(data.lastUpdated || null);
            })
            .catch(cause => {
                if (active) setError(cause instanceof Error ? cause.message : '항공권을 불러오지 못했습니다.');
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        document.body.style.overflow = selectedFlight || filterOpen ? 'hidden' : '';
        return () => { document.body.style.overflow = ''; };
    }, [selectedFlight, filterOpen]);

    useEffect(() => setVisibleCount(16), [region, departure, datePeriod, maxPrice, sort, query]);

    useEffect(() => {
        if (!toast) return;
        const timer = window.setTimeout(() => setToast(''), 2400);
        return () => window.clearTimeout(timer);
    }, [toast]);

    const filteredFlights = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        const referenceDate = new Date();
        const result = flights.filter(flight => {
            const matchesQuery = !normalizedQuery || [
                flight.departure.city,
                flight.arrival.city,
                flight.airline,
                SOURCE_NAMES[flight.source],
            ].some(value => value.toLowerCase().includes(normalizedQuery));
            return matchesQuery
                && regionMatches(flight, region)
                && departureMatches(flight, departure)
                && datePeriodMatches(flight, datePeriod, referenceDate)
                && (!maxPrice || effectivePrice(flight) <= maxPrice);
        });

        return result.sort((a, b) => {
            if (sort === 'price') return effectivePrice(a) - effectivePrice(b);
            if (sort === 'date') return (parseDate(a.departure.date)?.getTime() || 0) - (parseDate(b.departure.date)?.getTime() || 0);
            return recommendedScore(a) - recommendedScore(b);
        });
    }, [datePeriod, departure, flights, maxPrice, query, region, sort]);

    const filterCount = [departure !== '전체', region !== '전체', datePeriod !== 'all', maxPrice > 0].filter(Boolean).length;
    const updatedLabel = lastUpdated
        ? `${new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(lastUpdated))} 갱신`
        : '최근 수집 기준';

    const toggleFavorite = (id: string) => {
        setFavorites(current => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const shareFlight = async (flight: Flight) => {
        const url = `${window.location.origin}/share/${encodeURIComponent(flight.id)}`;
        const text = `${departureName(flight)}에서 ${stripAirport(flight.arrival.city)}, 왕복 ${priceText(effectivePrice(flight))}`;
        try {
            if (navigator.share) await navigator.share({ title: '티키티킷 항공권', text, url });
            else {
                await navigator.clipboard.writeText(`${text}\n${url}`);
                setToast('항공권 주소를 복사했어요.');
            }
        } catch {
            // 사용자가 공유 창을 닫은 경우에는 아무 안내도 띄우지 않는다.
        }
    };

    const resetFilters = () => {
        setDeparture('전체');
        setRegion('전체');
        setDatePeriod('all');
        setMaxPrice(0);
    };

    return (
        <main className={styles.previewPage}>
            <div className={styles.phoneCanvas}>
                <header className={styles.header}>
                    <a href="/preview/mobile-redesign" className={styles.logoLink} aria-label="티키티킷 모바일 디자인 미리보기 홈">
                        <Logo size={0.84} />
                    </a>
                    <div className={styles.headerActions}>
                        <button type="button" className={styles.iconButton} onClick={() => setSearchOpen(value => !value)} aria-label="검색">
                            <Icon name="search" />
                        </button>
                        <button type="button" className={styles.alertButton} onClick={() => setToast('알림 화면은 다음 단계에서 연결할 수 있어요.')}>특가 알림</button>
                    </div>
                </header>

                {searchOpen && (
                    <div className={styles.searchRow}>
                        <Icon name="search" />
                        <input
                            autoFocus
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            placeholder="도시나 항공사 검색"
                            aria-label="도시나 항공사 검색"
                        />
                        {query && <button type="button" onClick={() => setQuery('')}>지우기</button>}
                    </div>
                )}

                <section className={styles.feedIntro}>
                    <div>
                        <p>6개 여행사에서 모았어요</p>
                        <h1>지금 나온 땡처리 항공권</h1>
                    </div>
                    <span>{updatedLabel}</span>
                </section>

                <div className={styles.quickFilterStack}>
                    <div className={`${styles.quickFilters} ${styles.departureQuickFilters}`}>
                        <button type="button" className={filterCount ? styles.activeFilter : ''} onClick={() => setFilterOpen(true)}>
                            <Icon name="sliders" />
                            필터{filterCount ? ` ${filterCount}` : ''}
                        </button>
                        <label className={`${styles.departureSelect} ${departure !== '전체' ? styles.activeSelect : ''}`}>
                            <span>출발지</span>
                            <select value={departure} onChange={event => setDeparture(event.target.value)} aria-label="출발지 선택">
                                {DEPARTURE_OPTIONS.map(item => <option value={item} key={item}>{item}</option>)}
                            </select>
                        </label>
                    </div>
                    <nav className={`${styles.quickFilters} ${styles.regionQuickFilters}`} aria-label="도착 지역 빠른 선택">
                        {REGION_OPTIONS.map(item => (
                            <button
                                type="button"
                                key={item}
                                className={region === item ? styles.activeFilter : ''}
                                onClick={() => setRegion(item)}
                            >
                                {item}
                            </button>
                        ))}
                    </nav>
                </div>

                <section className={styles.feedSection}>
                    <div className={styles.feedHeading}>
                        <div>
                            <h2>{query ? `'${query}' 검색 결과` : region === '전체' ? '지금 볼 만한 표' : `${region} 특가`}</h2>
                            <span>총 {filteredFlights.length.toLocaleString('ko-KR')}개</span>
                        </div>
                        <label className={styles.sortSelect}>
                            <select value={sort} onChange={event => setSort(event.target.value as SortMode)} aria-label="항공권 정렬">
                                <option value="recommended">추천순</option>
                                <option value="price">낮은 가격순</option>
                                <option value="date">빠른 출발순</option>
                            </select>
                        </label>
                    </div>

                    {loading && (
                        <div className={styles.loadingList} aria-label="항공권 불러오는 중">
                            {[0, 1, 2].map(item => <div className={styles.skeletonCard} key={item} />)}
                        </div>
                    )}

                    {error && <div className={styles.emptyState}><strong>잠시 불러오지 못했어요.</strong><span>{error}</span></div>}

                    {!loading && !error && filteredFlights.length === 0 && (
                        <div className={styles.emptyState}>
                            <strong>조건에 맞는 표가 없어요.</strong>
                            <span>필터를 조금 넓혀보세요.</span>
                            <button type="button" onClick={resetFilters}>필터 초기화</button>
                        </div>
                    )}

                    <div className={styles.cardList}>
                        {filteredFlights.slice(0, visibleCount).map((flight, index) => {
                            const seats = flight.availableSeats || Number.parseInt(flight.seats || '', 10) || 0;
                            const duration = tripLength(flight);
                            const destination = stripAirport(flight.arrival.city);
                            const price = effectivePrice(flight);
                            return (
                                <article className={styles.flightCard} key={flight.id}>
                                    <button type="button" className={styles.cardBody} onClick={() => setSelectedFlight(flight)}>
                                        <div className={styles.cardTopline}>
                                            <div>
                                                <span className={`${styles.sourceBadge} ${styles[flight.source]}`}>{SOURCE_NAMES[flight.source]}</span>
                                                <span className={styles.airline}>{flight.airline || '항공사 확인'}</span>
                                            </div>
                                            <span className={styles.cardNumber}>{String(index + 1).padStart(2, '0')}</span>
                                        </div>

                                        <div className={styles.routePriceRow}>
                                            <div className={styles.routeTitle}>
                                                <span>{departureName(flight)}</span>
                                                <Icon name="arrow" />
                                                <strong>{destination}</strong>
                                            </div>
                                            <div className={styles.priceBlock}>
                                                <strong>{priceText(price)}</strong>
                                                <span>{flight.source === 'ttang' ? '수수료 포함' : '1인 왕복'}</span>
                                            </div>
                                        </div>

                                        <div className={styles.scheduleBox}>
                                            <div>
                                                <span>가는 날</span>
                                                <strong>{shortDate(flight.departure.date)}</strong>
                                                <em>{flight.departure.time || '시간 확인'}{flight.departure.arrivalTime ? ` → ${flight.departure.arrivalTime}` : ''}</em>
                                            </div>
                                            <div>
                                                <span>오는 날</span>
                                                <strong>{shortDate(flight.arrival.date)}</strong>
                                                <em>{flight.arrival.time || '시간 확인'}{flight.arrival.arrivalTime ? ` → ${flight.arrival.arrivalTime}` : ''}</em>
                                            </div>
                                        </div>

                                        <div className={styles.cardMeta}>
                                            <div>
                                                {duration && <span>{duration}</span>}
                                                {seats > 0 && <span className={seats <= 5 ? styles.lowSeats : ''}>{seats}석 남음</span>}
                                                {flight.minPax && flight.minPax > 1 && <span>{flight.minPax}인부터 예약</span>}
                                            </div>
                                            <span className={styles.viewCta}>이 표 보기 <Icon name="arrow" /></span>
                                        </div>
                                    </button>
                                    <button
                                        type="button"
                                        className={`${styles.favoriteButton} ${favorites.has(flight.id) ? styles.favoriteActive : ''}`}
                                        onClick={() => toggleFavorite(flight.id)}
                                        aria-label={favorites.has(flight.id) ? '찜 해제' : '찜하기'}
                                    >
                                        <Icon name="star" />
                                    </button>
                                </article>
                            );
                        })}
                    </div>

                    {visibleCount < filteredFlights.length && (
                        <button type="button" className={styles.moreButton} onClick={() => setVisibleCount(count => count + 16)}>
                            특가 더 보기
                        </button>
                    )}
                </section>

                <footer className={styles.previewFooter}>
                    <span>모바일 새 디자인 미리보기</span>
                    <a href="/">현재 티키티킷으로 돌아가기</a>
                </footer>
            </div>

            {filterOpen && (
                <div className={styles.sheetOverlay} onClick={() => setFilterOpen(false)}>
                    <section className={styles.bottomSheet} onClick={event => event.stopPropagation()} aria-label="항공권 필터">
                        <div className={styles.sheetHandle} />
                        <div className={styles.sheetHeader}>
                            <h2>표 골라보기</h2>
                            <button type="button" onClick={resetFilters}>초기화</button>
                        </div>

                        <div className={styles.filterGroup}>
                            <h3>출발지</h3>
                            <div className={styles.optionGrid}>
                                {DEPARTURE_OPTIONS.map(item => (
                                    <button type="button" key={item} className={departure === item ? styles.optionActive : ''} onClick={() => setDeparture(item)}>{item}</button>
                                ))}
                            </div>
                        </div>

                        <div className={styles.filterGroup}>
                            <h3>도착 지역</h3>
                            <div className={styles.optionGrid}>
                                {REGION_OPTIONS.map(item => (
                                    <button type="button" key={item} className={region === item ? styles.optionActive : ''} onClick={() => setRegion(item)}>{item}</button>
                                ))}
                            </div>
                        </div>

                        <div className={styles.filterGroup}>
                            <h3>1인 왕복 가격</h3>
                            <div className={styles.optionGrid}>
                                {PRICE_OPTIONS.map(item => (
                                    <button type="button" key={item.value} className={maxPrice === item.value ? styles.optionActive : ''} onClick={() => setMaxPrice(item.value)}>{item.label}</button>
                                ))}
                            </div>
                        </div>

                        <div className={styles.filterGroup}>
                            <h3>출발 시기</h3>
                            <div className={styles.optionGrid}>
                                {DATE_PERIOD_OPTIONS.map(item => (
                                    <button type="button" key={item.value} className={datePeriod === item.value ? styles.optionActive : ''} onClick={() => setDatePeriod(item.value)}>{item.label}</button>
                                ))}
                            </div>
                        </div>

                        <button type="button" className={styles.applyButton} onClick={() => setFilterOpen(false)}>
                            {filteredFlights.length.toLocaleString('ko-KR')}개 항공권 보기
                        </button>
                    </section>
                </div>
            )}

            {selectedFlight && (
                <div className={styles.sheetOverlay} onClick={() => setSelectedFlight(null)}>
                    <section className={`${styles.bottomSheet} ${styles.detailSheet}`} onClick={event => event.stopPropagation()} aria-label="항공권 상세">
                        <div className={styles.sheetHandle} />
                        <div className={styles.detailHeader}>
                            <span className={`${styles.sourceBadge} ${styles[selectedFlight.source]}`}>{SOURCE_NAMES[selectedFlight.source]}</span>
                            <button type="button" onClick={() => setSelectedFlight(null)} aria-label="닫기"><Icon name="close" /></button>
                        </div>

                        <div className={styles.detailTitle}>
                            <div>
                                <p>{departureName(selectedFlight)}에서</p>
                                <h2>{stripAirport(selectedFlight.arrival.city)} 왕복</h2>
                            </div>
                            <div>
                                <strong>{priceText(effectivePrice(selectedFlight))}</strong>
                                <span>{selectedFlight.source === 'ttang' ? '1인 · 발권수수료 포함' : '1인 왕복'}</span>
                            </div>
                        </div>

                        <div className={styles.detailSchedule}>
                            <div>
                                <span className={styles.outboundDot} />
                                <p><b>가는 날</b><strong>{shortDate(selectedFlight.departure.date)}</strong></p>
                                <em>{selectedFlight.departure.time || '시간 확인'}{selectedFlight.departure.arrivalTime ? ` → ${selectedFlight.departure.arrivalTime}` : ''}</em>
                            </div>
                            <div>
                                <span className={styles.inboundDot} />
                                <p><b>오는 날</b><strong>{shortDate(selectedFlight.arrival.date)}</strong></p>
                                <em>{selectedFlight.arrival.time || '시간 확인'}{selectedFlight.arrival.arrivalTime ? ` → ${selectedFlight.arrival.arrivalTime}` : ''}</em>
                            </div>
                        </div>

                        <div className={styles.detailFacts}>
                            <span>{selectedFlight.airline || '항공사 확인'}</span>
                            {tripLength(selectedFlight) && <span>{tripLength(selectedFlight)}</span>}
                            {(selectedFlight.availableSeats || Number.parseInt(selectedFlight.seats || '', 10)) > 0 && (
                                <span>{selectedFlight.availableSeats || Number.parseInt(selectedFlight.seats || '', 10)}석 남음</span>
                            )}
                            {selectedFlight.minPax && selectedFlight.minPax > 1 && <span>{selectedFlight.minPax}인부터 예약</span>}
                        </div>

                        <p className={styles.priceNotice}>가격과 좌석은 바뀔 수 있어요. 예약 전에 여행사에서 한 번 더 확인해주세요.</p>

                        <div className={styles.detailTools}>
                            <button type="button" onClick={() => shareFlight(selectedFlight)}><Icon name="share" />공유</button>
                            <button type="button" onClick={() => setToast('미리보기에서는 실제 신고를 저장하지 않아요.')}>가격이 달라요</button>
                            <button type="button" onClick={() => setToast('미리보기에서는 실제 신고를 저장하지 않아요.')}>예약이 안 돼요</button>
                        </div>

                        <a className={styles.bookingButton} href={selectedFlight.link} target="_blank" rel="noopener noreferrer">
                            {SOURCE_NAMES[selectedFlight.source]}에서 확인하기 <Icon name="arrow" />
                        </a>
                    </section>
                </div>
            )}

            {toast && <div className={styles.toast} role="status">{toast}</div>}
        </main>
    );
}
