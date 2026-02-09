'use client';

import { useState, useEffect, useMemo } from 'react';
import { Flight } from '@/types/flight';
import styles from './Dashboard.module.css';

export default function Dashboard() {
    const [flights, setFlights] = useState<Flight[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState<'price' | 'date' | 'airline' | 'discount'>('price');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
    const [sourceFilter, setSourceFilter] = useState<string>('all');
    const [regionFilter, setRegionFilter] = useState<string>('all');
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');
    const [departureFilter, setDepartureFilter] = useState<string>('all');

    const [airlineFilter, setAirlineFilter] = useState<string>('all');

    useEffect(() => {
        fetchFlights();
    }, []);

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

    const filteredFlights = flights.filter(flight => {
        const matchesSearch =
            flight.departure.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
            flight.arrival.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
            flight.airline.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesSource = sourceFilter === 'all' || flight.source === sourceFilter;
        const matchesRegion = regionFilter === 'all' || flight.region === regionFilter;
        const matchesAirline = airlineFilter === 'all' || flight.airline === airlineFilter;
        const matchesDate =
            (!startDate || flight.departure.date >= startDate) &&
            (!endDate || flight.departure.date <= endDate);

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

    const formatPrice = (price: number) => {
        return new Intl.NumberFormat('ko-KR', {
            style: 'currency',
            currency: 'KRW',
        }).format(price);
    };

    const formatDate = (dateStr: string) => {
        if (!dateStr) return '-';
        try {
            const date = new Date(dateStr);
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
                    <h1 className={`${styles.title} gradient-text`}>✈️ 땡처리 항공권 대시보드</h1>
                    <p className={styles.subtitle}>
                        모두투어, 땡처리닷컴, 노랑풍선, 하나투어, 온라인투어의 특가 항공권을 한눈에
                    </p>
                </div>
            </header>

            <div className="container">
                <div className={styles.controls}>
                    <div className={styles.searchBox}>
                        <input
                            type="text"
                            placeholder="출발지, 도착지, 항공사 검색..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className={styles.searchInput}
                        />
                    </div>

                    <div className={styles.filters}>
                        <div className={styles.dateRange}>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className={styles.select}
                                aria-label="출발일 시작"
                            />
                            <span style={{ display: 'flex', alignItems: 'center', color: '#666' }}>~</span>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className={styles.select}
                                aria-label="출발일 종료"
                            />
                            {(startDate || endDate) && (
                                <button
                                    onClick={() => {
                                        setStartDate('');
                                        setEndDate('');
                                    }}
                                    className={`btn btn-secondary`}
                                    style={{ padding: 'var(--spacing-sm) var(--spacing-md)' }}
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                        <select
                            value={departureFilter}
                            onChange={(e) => setDepartureFilter(e.target.value)}
                            className={styles.select}
                        >
                            <option value="all">모든 출발지</option>
                            <option value="인천">인천/김포</option>
                            <option value="부산">부산/김해</option>
                            <option value="대구">대구</option>
                            <option value="청주">청주</option>
                            <option value="무안">무안</option>
                            <option value="제주">제주</option>
                        </select>


                        <select
                            value={regionFilter}
                            onChange={(e) => setRegionFilter(e.target.value)}
                            className={styles.select}
                        >
                            <option value="all">모든 지역</option>
                            <option value="동남아">동남아</option>
                            <option value="일본">일본</option>
                            <option value="중국">중국</option>
                            <option value="미주">미주</option>
                            <option value="유럽">유럽</option>
                            <option value="남태평양">남태평양</option>
                            <option value="기타">기타</option>
                        </select>

                        <select
                            value={airlineFilter}
                            onChange={(e) => setAirlineFilter(e.target.value)}
                            className={styles.select}
                        >
                            <option value="all">모든 항공사</option>
                            {uniqueAirlines.map(airline => (
                                <option key={airline} value={airline}>
                                    {airline}
                                </option>
                            ))}
                        </select>

                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as any)}
                            className={styles.select}
                        >
                            <option value="price">가격순</option>
                            <option value="discount">할인율순</option>
                            <option value="date">날짜순</option>
                            <option value="airline">항공사순</option>
                        </select>

                        <select
                            value={sourceFilter}
                            onChange={(e) => setSourceFilter(e.target.value)}
                            className={styles.select}
                        >
                            <option value="all">모든 사이트</option>
                            <option value="ttang">땡처리닷컴</option>
                            <option value="ybtour">노랑풍선</option>
                            <option value="modetour">모두투어</option>
                            <option value="hanatour">하나투어</option>
                            <option value="onlinetour">온라인투어</option>
                        </select>

                        <button
                            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                            className={`btn btn-secondary ${styles.sortBtn}`}
                        >
                            {sortOrder === 'asc' ? '↑ 오름차순' : '↓ 내림차순'}
                        </button>

                        <button
                            onClick={fetchFlights}
                            className="btn btn-primary"
                        >
                            🔄 새로고침
                        </button>
                    </div>
                </div>

                {loading && (
                    <div className={styles.loading}>
                        <div className={styles.spinner}></div>
                        <p>항공권 정보를 불러오는 중...</p>
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
                        <div className={styles.stats}>
                            <span>총 <strong>{filteredFlights.length}</strong>개의 항공권</span>
                        </div>

                        <div className={styles.flightGrid}>
                            {filteredFlights.map((flight) => (
                                <div key={flight.id} className={`card ${styles.flightCard} fade-in`}>

                                    <div className={styles.cardHeader}>
                                        <span className={`badge ${getSourceBadgeClass(flight.source)}`}>
                                            {getSourceName(flight.source)}
                                        </span>
                                        <span className={styles.airline}>{flight.airline}</span>
                                    </div>

                                    <div className={styles.route}>
                                        <div className={styles.location}>
                                            <div className={styles.city}>{flight.departure.city}</div>
                                            <div className={styles.date}>{formatDate(flight.departure.date)}</div>
                                            <div className={styles.time}>{flight.departure.time}</div>
                                        </div>

                                        <div className={styles.arrow}>→</div>

                                        <div className={styles.location}>
                                            <div className={styles.city}>{flight.arrival.city}</div>
                                            <div className={styles.date}>{formatDate(flight.arrival.date)}</div>
                                            <div className={styles.time}>{flight.arrival.time}</div>
                                        </div>
                                    </div>

                                    <div className={styles.cardFooter}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <div className={styles.price}>{formatPrice(flight.price)}</div>
                                            {(() => {
                                                const avgPrice = averagePrices[flight.arrival.city];
                                                if (avgPrice && flight.price > 0) {
                                                    const discount = avgPrice - flight.price;
                                                    const percent = (discount / avgPrice) * 100;
                                                    if (percent >= 5) {
                                                        return (
                                                            <span className={styles.discountBadge}>
                                                                (-{Math.round(percent)}%)
                                                            </span>
                                                        );
                                                    }
                                                }
                                                return null;
                                            })()}
                                        </div>
                                        <a
                                            href={flight.link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="btn btn-primary"
                                        >
                                            예약하기 →
                                        </a>
                                    </div>

                                    {flight.availableSeats && (
                                        <div className={styles.seats}>
                                            남은 좌석: {flight.availableSeats}석
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {filteredFlights.length === 0 && (
                            <div className={styles.empty}>
                                <p>검색 결과가 없습니다.</p>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
