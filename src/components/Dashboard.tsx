'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Flight } from '@/types/flight';
import Logo from './Logo';
import Sparkline from './Sparkline';
import dynamic from 'next/dynamic';
import { ko } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DatePicker: any = dynamic(() => import('react-datepicker').then((mod: any) => mod.default), { ssr: false });
import styles from './Dashboard.module.css';

// Helper: string(YYYY-MM-DD) <-> Date
const toDate = (s: string) => s ? new Date(s + 'T00:00:00') : null;
const toStr = (d: Date | null) => d ? d.toISOString().slice(0, 10) : '';
const fmtDate = (s: string) => s ? s.slice(5).replace(/-/g, '.') : '';

// 도시명 정규화: "서울(ICN)" → "인천", "서울(GMP)" → "김포"
const normalizeCity = (city: string): string => {
    const match = city.match(/^(.+?)\(([A-Z]{3})\)$/);
    if (match) {
        const code = match[2];
        if (code === 'ICN') return '인천';
        if (code === 'GMP') return '김포';
        if (code === 'PUS') return '부산';
        return match[1]; // 기타: 괄호만 제거
    }
    return city;
};

const ITEMS_PER_PAGE = 20;

// 모바일 여부 체크
const checkIsMobile = () => {
    if (typeof navigator === 'undefined') return false;
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

// PC URL → 모바일 URL 변환
const getMobileUrl = (url: string, isMobile: boolean): string => {
    if (!isMobile || !url) return url;

    // 땡처리닷컴: 모바일 딥링크 미지원 → mm.ttang.com 모바일 할인 페이지로 이동
    if (url.includes('www.ttang.com')) {
        return 'https://mm.ttang.com/ttangair/search/discount/today.do?trip=RT&gubun=T';
    }
    // 온라인투어: www.onlinetour.co.kr → m.onlinetour.co.kr + /flight/w/ → /flight/m/
    if (url.includes('www.onlinetour.co.kr')) {
        return url.replace('www.onlinetour.co.kr', 'm.onlinetour.co.kr').replace('/flight/w/', '/flight/m/');
    }
    // 모두투어: www.modetour.com → m.modetour.com
    if (url.includes('www.modetour.com')) {
        return url.replace('www.modetour.com', 'm.modetour.com');
    }
    // 하나투어: hope.hanatour.com / www.hanatour.com → 모바일 항공 검색 페이지
    if (url.includes('hanatour.com')) {
        return 'https://m.hanatour.com/mma/smn/EX00000021';
    }
    // 노랑풍선: 모바일 딥링크 미지원 → 모바일 땡처리 항공 페이지로 이동
    if (url.includes('fly.ybtour.co.kr')) {
        return 'https://mfly.ybtour.co.kr/mobile/fr/booking/findDiscountAirMobile.lts?efcTpCode=INV&efcCode=INV';
    }
    return url;
};

export default function Dashboard() {
    const [flights, setFlights] = useState<Flight[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [priceHistory, setPriceHistory] = useState<Record<string, Array<{ date: string; minPrice: number }>>>({});
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState<'price' | 'date' | 'airline' | 'discount'>('price');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
    const [sourceFilter, setSourceFilter] = useState<string>('all');
    const [regionFilter, setRegionFilter] = useState<string>('all');
    const [startDate, setStartDate] = useState<string>('2026-02-09');
    const [endDate, setEndDate] = useState<string>('2026-03-09');
    const [departureFilter, setDepartureFilter] = useState<string>('all');
    const [airlineFilter, setAirlineFilter] = useState<string>('all');
    const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE);
    const [showScrollTop, setShowScrollTop] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const loadMoreRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        fetchFlights();
        setIsMobile(checkIsMobile());
    }, []);

    // 필터 변경 시 displayCount 리셋
    useEffect(() => {
        setDisplayCount(ITEMS_PER_PAGE);
    }, [searchTerm, sourceFilter, regionFilter, airlineFilter, startDate, endDate, departureFilter, sortBy]);

    // 스크롤 감지 (맨위로 버튼 표시)
    useEffect(() => {
        const handleScroll = () => {
            setShowScrollTop(window.scrollY > 400);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // IntersectionObserver 설정
    const lastElementRef = useCallback((node: HTMLDivElement | null) => {
        if (observerRef.current) observerRef.current.disconnect();
        observerRef.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting) {
                setDisplayCount(prev => prev + ITEMS_PER_PAGE);
            }
        });
        if (node) observerRef.current.observe(node);
    }, []);

    const scrollToTop = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const fetchFlights = async () => {
        setLoading(true);
        setError(null);

        try {
            const response = await fetch('/api/flights');

            if (!response.ok) {
                throw new Error('항공권 데이터를 불러오는데 실패했습니다.');
            }

            const data = await response.json();
            setFlights(data.flights || []);
            setLastUpdated(data.lastUpdated || null);
            setPriceHistory(data.priceHistory || {});
        } catch (err) {
            setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
        } finally {
            setLoading(false);
        }
    };

    const uniqueAirlines = useMemo(() => {
        const airlines = new Set(flights.map(f => f.airline).filter(Boolean));
        return Array.from(airlines).sort((a, b) => a.localeCompare(b));
    }, [flights]);

    const averagePrices = useMemo(() => {
        const stats: Record<string, { sum: number; count: number }> = {};

        flights.forEach(flight => {
            if (flight.price > 0) {
                const city = flight.arrival.city;
                if (!stats[city]) {
                    stats[city] = { sum: 0, count: 0 };
                }
                stats[city].sum += flight.price;
                stats[city].count += 1;
            }
        });

        const averages: Record<string, number> = {};
        Object.keys(stats).forEach(city => {
            averages[city] = stats[city].sum / stats[city].count;
        });

        return averages;
    }, [flights]);

    // 각 노선별 최저가 계산
    const lowestPrices = useMemo(() => {
        const lowest: Record<string, number> = {};
        flights.forEach(flight => {
            const route = `${flight.departure.city}-${flight.arrival.city}`;
            if (!lowest[route] || flight.price < lowest[route]) {
                lowest[route] = flight.price;
            }
        });
        return lowest;
    }, [flights]);

    // 필터 초기화
    const resetAllFilters = () => {
        setSearchTerm('');
        setSourceFilter('all');
        setRegionFilter('all');
        setAirlineFilter('all');
        setDepartureFilter('all');
        setStartDate('2026-02-09');
        setEndDate('2026-03-09');
        setSortBy('price');
    };

    // 활성 필터 여부
    const hasActiveFilters = searchTerm || sourceFilter !== 'all' || regionFilter !== 'all' ||
        airlineFilter !== 'all' || departureFilter !== 'all' || startDate || endDate;

    const filteredFlights = flights.filter(flight => {
        const matchesSearch =
            flight.departure.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
            flight.arrival.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
            flight.airline.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesSource = sourceFilter === 'all' || flight.source === sourceFilter;
        const matchesRegion = regionFilter === 'all' || flight.region === regionFilter;
        const matchesAirline = airlineFilter === 'all' || flight.airline === airlineFilter;
        const normalizeDate = (d: string) => {
            if (!d) return '';
            const m = d.match(/^(\d{4})[.\-](\d{2})[.\-](\d{2})/);
            return m ? `${m[1]}-${m[2]}-${m[3]}` : d;
        };
        const flightDate = normalizeDate(flight.departure.date);
        const matchesDate =
            (!startDate || flightDate >= startDate) &&
            (!endDate || flightDate <= endDate);

        const matchesDeparture = departureFilter === 'all' || (() => {
            if (departureFilter === '인천') return /인천|김포|서울|ICN|GMP|SEL/.test(flight.departure.city);
            if (departureFilter === '부산') return /부산|김해|PUS/.test(flight.departure.city);
            return flight.departure.city.includes(departureFilter);
        })();



        return matchesSearch && matchesSource && matchesRegion && matchesAirline && matchesDate && matchesDeparture;
    }).sort((a, b) => {
        let comparison = 0;

        switch (sortBy) {
            case 'price':
                comparison = a.price - b.price;
                break;
            case 'date':
                comparison = new Date(a.departure.date).getTime() - new Date(b.departure.date).getTime();
                if (comparison === 0) {
                    comparison = a.departure.time.localeCompare(b.departure.time);
                }
                break;
            case 'airline':
                comparison = a.airline.localeCompare(b.airline);
                break;
            case 'discount':
                const getDiscount = (f: Flight) => {
                    const avg = averagePrices[f.arrival.city];
                    if (!avg || f.price <= 0) return 0;
                    return ((avg - f.price) / avg) * 100;
                };
                comparison = getDiscount(b) - getDiscount(a);
                break;
        }

        return sortOrder === 'asc' ? comparison : -comparison;
    });

    // 표시할 항공권 (무한 스크롤용)
    const displayedFlights = filteredFlights.slice(0, displayCount);
    const hasMore = displayCount < filteredFlights.length;

    const formatPrice = (price: number) => {
        return new Intl.NumberFormat('ko-KR', {
            style: 'currency',
            currency: 'KRW',
        }).format(price);
    };

    const formatDate = (dateStr: string) => {
        if (!dateStr) return '날짜 확인';
        try {
            // 한국식 날짜 형식 처리: "2026.02.22(일)" -> "2026-02-22"
            let normalizedDate = dateStr;

            // "YYYY.MM.DD(요일)" 형식 처리
            const koreanDateMatch = dateStr.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
            if (koreanDateMatch) {
                normalizedDate = `${koreanDateMatch[1]}-${koreanDateMatch[2]}-${koreanDateMatch[3]}`;
            }

            // "YY.MM.DD" 형식 처리 (2자리 연도)
            const shortYearMatch = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{2})/);
            if (shortYearMatch && !koreanDateMatch) {
                normalizedDate = `20${shortYearMatch[1]}-${shortYearMatch[2]}-${shortYearMatch[3]}`;
            }

            const date = new Date(normalizedDate);
            if (isNaN(date.getTime())) {
                return dateStr; // 파싱 실패시 원본 반환
            }
            return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
        } catch {
            return dateStr;
        }
    };

    const getSourceBadgeClass = (source: string) => {
        switch (source) {
            case 'ttang': return styles.badgeTtang;
            case 'ybtour': return styles.badgeYbtour;
            case 'modetour': return styles.badgeModetour;
            case 'hanatour': return styles.badgeHanatour;
            case 'onlinetour': return styles.badgeOnlinetour;
            default: return '';
        }
    };

    const getSourceName = (source: string) => {
        switch (source) {
            case 'ttang': return '땡처리닷컴';
            case 'ybtour': return '노랑풍선';
            case 'modetour': return '모두투어';
            case 'hanatour': return '하나투어';
            case 'onlinetour': return '온라인투어';
            default: return source;
        }
    };

    return (
        <div className={styles.dashboard}>
            <header className={styles.header}>
                <div className="container">
                    <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Logo size={1.2} />

                    </h1>
                    <p className={styles.subtitle}>
                        전국 여행사의 <strong className={styles.highlight}>땡처리 항공권</strong>을 한눈에 비교하고 떠나보세요! 🚀
                    </p>
                </div>
            </header>

            <div className="container">
                <div className={styles.controls}>
                    {/* 1. 날짜 + 검색 한 줄 */}
                    <div className={styles.secondaryRow}>
                        <div className={styles.dateRange}>
                            <DatePicker
                                selected={toDate(startDate)}
                                onChange={(date: Date | null) => setStartDate(toStr(date))}
                                dateFormat="yy.MM.dd"
                                locale={ko}
                                className={styles.dateInput}
                                placeholderText="시작일"
                                popperClassName={styles.datePickerPopper}
                                calendarClassName={styles.datePickerCalendar}
                                minDate={new Date()}
                            />
                            <span className={styles.dateSeparator}>~</span>
                            <DatePicker
                                selected={toDate(endDate)}
                                onChange={(date: Date | null) => setEndDate(toStr(date))}
                                dateFormat="yy.MM.dd"
                                locale={ko}
                                className={styles.dateInput}
                                placeholderText="종료일"
                                popperClassName={styles.datePickerPopper}
                                calendarClassName={styles.datePickerCalendar}
                                minDate={toDate(startDate) || new Date()}
                            />
                        </div>
                        <div className={styles.searchBox} style={{ flex: 1, minWidth: '150px' }}>
                            <span className={styles.searchIcon}>🔍</span>
                            <input
                                type="text"
                                placeholder="도시, 항공사 검색"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className={styles.searchInput}
                            />
                        </div>
                    </div>

                    {/* 3. 출발지 + 도착지역 칩 필터 */}
                    <div className={styles.filterRow}>
                        {/* 출발지 칩 필터 */}
                        <div className={styles.filterGroup}>
                            <span className={styles.filterLabel}>출발지</span>
                            <div className={styles.chipGroup}>
                                {[
                                    { value: 'all', label: '전체' },
                                    { value: '인천', label: '인천/김포' },
                                    { value: '부산', label: '부산/김해' },
                                    { value: '대구', label: '대구' },
                                    { value: '청주', label: '청주' },
                                    { value: '제주', label: '제주' },
                                ].map((option) => (
                                    <button
                                        key={option.value}
                                        onClick={() => setDepartureFilter(option.value)}
                                        className={`${styles.chip} ${departureFilter === option.value ? styles.chipActive : ''}`}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* 지역 칩 필터 */}
                        <div className={styles.filterGroup}>
                            <span className={styles.filterLabel}>도착 지역</span>
                            <div className={styles.chipGroup}>
                                {[
                                    { value: 'all', label: '전체' },
                                    { value: '동남아', label: '동남아' },
                                    { value: '일본', label: '일본' },
                                    { value: '중국', label: '중국' },
                                    { value: '미주', label: '미주' },
                                    { value: '유럽', label: '유럽' },
                                    { value: '남태평양', label: '남태평양' },
                                    { value: '기타', label: '기타' },
                                ].map((option) => (
                                    <button
                                        key={option.value}
                                        onClick={() => setRegionFilter(option.value)}
                                        className={`${styles.chip} ${regionFilter === option.value ? styles.chipActive : ''}`}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                </div>


                {loading && (
                    <div className={styles.skeletonGrid}>
                        {[...Array(6)].map((_, i) => (
                            <div key={i} className={styles.skeletonCard}>
                                <div className={styles.skeletonBar}></div>
                                {/* 헤더: 여행사 + 항공사 */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                                    <div className={`${styles.skeletonLine} ${styles.short}`} style={{ marginBottom: 0 }}></div>
                                    <div className={`${styles.skeletonLine}`} style={{ width: '20%', marginBottom: 0 }}></div>
                                </div>
                                {/* 노선: 출발 → 도착 */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px 0' }}>
                                    <div style={{ flex: 1, textAlign: 'center' }}>
                                        <div className={styles.skeletonLine} style={{ width: '60%', height: '20px', margin: '0 auto 6px' }}></div>
                                        <div className={styles.skeletonLine} style={{ width: '80%', height: '12px', margin: '0 auto' }}></div>
                                    </div>
                                    <div className={styles.skeletonLine} style={{ width: '30px', height: '20px', flexShrink: 0, marginBottom: 0 }}></div>
                                    <div style={{ flex: 1, textAlign: 'center' }}>
                                        <div className={styles.skeletonLine} style={{ width: '60%', height: '20px', margin: '0 auto 6px' }}></div>
                                        <div className={styles.skeletonLine} style={{ width: '80%', height: '12px', margin: '0 auto' }}></div>
                                    </div>
                                </div>
                                {/* 푸터: 가격 + 버튼 */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '12px', borderTop: '1px solid var(--color-border)' }}>
                                    <div className={`${styles.skeletonLine} ${styles.tall}`} style={{ width: '35%', marginBottom: 0 }}></div>
                                    <div className={styles.skeletonLine} style={{ width: '80px', height: '36px', borderRadius: '8px', marginBottom: 0 }}></div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {error && (
                    <div className={styles.error}>
                        <p>⚠️ {error}</p>
                        <button onClick={fetchFlights} className="btn btn-primary">
                            다시 시도
                        </button>
                    </div>
                )}

                {!loading && !error && (
                    <>
                        {/* 적용된 필터 요약 */}
                        {hasActiveFilters && (
                            <div className={styles.filterSummary}>
                                {searchTerm && (
                                    <span className={styles.filterTag}>
                                        검색: {searchTerm}
                                        <button onClick={() => setSearchTerm('')}>×</button>
                                    </span>
                                )}
                                {departureFilter !== 'all' && (
                                    <span className={styles.filterTag}>
                                        {departureFilter}
                                        <button onClick={() => setDepartureFilter('all')}>×</button>
                                    </span>
                                )}
                                {regionFilter !== 'all' && (
                                    <span className={styles.filterTag}>
                                        {regionFilter}
                                        <button onClick={() => setRegionFilter('all')}>×</button>
                                    </span>
                                )}
                                {sourceFilter !== 'all' && (
                                    <span className={styles.filterTag}>
                                        {getSourceName(sourceFilter)}
                                        <button onClick={() => setSourceFilter('all')}>×</button>
                                    </span>
                                )}
                                {airlineFilter !== 'all' && (
                                    <span className={styles.filterTag}>
                                        {airlineFilter}
                                        <button onClick={() => setAirlineFilter('all')}>×</button>
                                    </span>
                                )}
                                {(startDate || endDate) && (
                                    <span className={styles.filterTag}>
                                        {fmtDate(startDate) || '시작'} ~ {fmtDate(endDate) || '종료'}
                                        <button onClick={() => { setStartDate(''); setEndDate(''); }}>×</button>
                                    </span>
                                )}
                                <button onClick={resetAllFilters} className={`btn ${styles.resetAllBtn}`}>
                                    전체 초기화
                                </button>
                            </div>
                        )}

                        {/* 항공권 수 + 여행사/항공사/정렬 드롭다운 */}
                        <div className={styles.stats}>
                            <span className={styles.resultCount}>총 <strong>{filteredFlights.length}</strong>개의 항공권</span>
                            <div className={styles.statsFilters}>
                                <select
                                    value={sourceFilter}
                                    onChange={(e) => setSourceFilter(e.target.value)}
                                    className={styles.statsSelect}
                                >
                                    <option value="all">전체 여행사</option>
                                    <option value="ttang">땡처리닷컴</option>
                                    <option value="ybtour">노랑풍선</option>
                                    <option value="modetour">모두투어</option>
                                    <option value="hanatour">하나투어</option>
                                    <option value="onlinetour">온라인투어</option>
                                </select>
                                <select
                                    value={airlineFilter}
                                    onChange={(e) => setAirlineFilter(e.target.value)}
                                    className={styles.statsSelect}
                                >
                                    <option value="all">전체 항공사</option>
                                    {uniqueAirlines.map(airline => (
                                        <option key={airline} value={airline}>
                                            {airline}
                                        </option>
                                    ))}
                                </select>
                                <select
                                    value={sortBy}
                                    onChange={(e) => setSortBy(e.target.value as any)}
                                    className={styles.statsSelect}
                                >
                                    <option value="price">가격순</option>
                                    <option value="discount">할인율순</option>
                                    <option value="date">날짜순</option>
                                </select>
                            </div>
                        </div>

                        <div className={styles.flightGrid}>
                            {displayedFlights.map((flight) => {
                                const route = `${flight.departure.city}-${flight.arrival.city}`;
                                const isLowestPrice = lowestPrices[route] === flight.price;

                                return (
                                    <div key={flight.id} className={`card ${styles.flightCard} fade-in`}>

                                        <div className={styles.cardHeader}>
                                            <div className={styles.cardHeaderLeft}>
                                                <span className={`badge ${getSourceBadgeClass(flight.source)}`}>
                                                    {getSourceName(flight.source)}
                                                </span>
                                                {flight.availableSeats && (
                                                    <span className={(flight.availableSeats || 0) <= 9 ? styles.seatsBadgeCritical : styles.seatsBadge}>
                                                        {(flight.availableSeats || 0) <= 5 && '🔥 '}{flight.availableSeats}석
                                                    </span>
                                                )}
                                            </div>
                                            <span className={styles.airline}>{flight.airline}</span>
                                        </div>

                                        <div className={styles.route}>
                                            <div className={styles.location}>
                                                <div className={styles.city}>{normalizeCity(flight.departure.city)}</div>
                                                <div className={styles.date}>{formatDate(flight.departure.date)}</div>
                                            </div>

                                            <div className={styles.arrowSection}>
                                                <div className={styles.arrow}>✈</div>
                                                <div className={styles.flightTimes}>
                                                    {flight.departure.time && flight.arrival.time
                                                        ? `${flight.departure.time} → ${flight.arrival.time}`
                                                        : ''}
                                                </div>
                                            </div>

                                            <div className={styles.location}>
                                                <div className={styles.city}>{normalizeCity(flight.arrival.city)}</div>
                                                <div className={styles.date}>{formatDate(flight.arrival.date)}</div>
                                            </div>
                                        </div>

                                        <div className={styles.cardFooterWrapper}>
                                            <div className={styles.badgesRow}>
                                                {isLowestPrice && (
                                                    <span className={styles.lowestPriceBadge}>최저가</span>
                                                )}
                                                {(() => {
                                                    const avgPrice = averagePrices[flight.arrival.city];
                                                    if (avgPrice && flight.price > 0) {
                                                        const discount = avgPrice - flight.price;
                                                        const percent = (discount / avgPrice) * 100;
                                                        if (percent >= 5) {
                                                            return (
                                                                <span className={styles.discountBadge}>
                                                                    -{Math.round(percent)}%
                                                                </span>
                                                            );
                                                        }
                                                    }
                                                    return null;
                                                })()}
                                            </div>
                                            <div className={styles.cardFooter}>
                                                <div className={styles.priceSection}>
                                                    <div className={styles.price}>{formatPrice(flight.price)}</div>
                                                    {(() => {
                                                        const key = `${flight.departure.city}-${flight.arrival.city}`;
                                                        const history = priceHistory[key];
                                                        if (history && history.length > 1) {
                                                            const prices = history.map(h => h.minPrice);
                                                            return (
                                                                <div className={styles.sparkline}>
                                                                    <Sparkline data={prices} width={60} height={20} />
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    })()}
                                                </div>
                                                <a
                                                    href={getMobileUrl(flight.link, isMobile)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="btn btn-primary"
                                                >
                                                    예약하기 →
                                                </a>
                                            </div>
                                        </div>


                                    </div>
                                );
                            })}
                        </div>

                        {/* 무한 스크롤 감지 요소 */}
                        {hasMore && (
                            <div ref={lastElementRef} className={styles.loadMore}>
                                <div className={styles.spinner}></div>
                                <span>더 불러오는 중...</span>
                            </div>
                        )}

                        {!hasMore && filteredFlights.length > ITEMS_PER_PAGE && (
                            <div className={styles.endMessage}>
                                모든 항공권을 불러왔습니다
                            </div>
                        )}

                        {filteredFlights.length === 0 && (
                            <div className={styles.emptyState}>
                                <div className={styles.emptyIcon}>✈️</div>
                                <p>검색 결과가 없습니다</p>
                                <p style={{ fontSize: '0.9rem', opacity: 0.7 }}>
                                    필터를 조정하거나 다른 조건으로 검색해보세요
                                </p>
                                {hasActiveFilters && (
                                    <button
                                        onClick={resetAllFilters}
                                        className="btn btn-secondary"
                                    >
                                        필터 초기화
                                    </button>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* 맨위로 버튼 */}
            {showScrollTop && (
                <button
                    onClick={scrollToTop}
                    className={styles.scrollTopBtn}
                    aria-label="맨 위로"
                >
                    ↑
                </button>
            )}

            {/* 푸터 */}
            <footer className={styles.footer}>
                <div className="container">
                    <div className={styles.footerContent}>
                        <div className={styles.footerLeft}>
                            <span className={styles.footerBrand}>✈️ 플리토</span>
                            <span className={styles.footerDesc}>여행사 땡처리 항공권을 한 곳에서</span>
                        </div>
                        <div className={styles.footerRight}>
                            <div className={styles.footerSources}>
                                데이터 소스: 땡처리닷컴 · 노랑풍선 · 하나투어 · 모두투어 · 온라인투어
                            </div>
                            {lastUpdated && (
                                <div className={styles.footerUpdated}>
                                    마지막 업데이트: {new Date(lastUpdated).toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className={styles.footerBottom}>
                        <span>© 2026 플리토. 항공권 정보는 각 여행사에서 제공됩니다.</span>
                    </div>
                </div>
            </footer>
        </div>
    );
}
