'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
const toStr = (d: Date | null) => {
    if (!d) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};
const fmtDate = (s: string) => s ? s.slice(5).replace(/-/g, '.') : '';
const getDefaultStartDate = () => toStr(new Date());
const getDefaultEndDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return toStr(d);
};

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

// 도시명 → IATA 공항/도시 코드 매핑
const CITY_TO_AIRPORT: Record<string, string> = {
    // 출발지
    '인천': 'ICN', '김포': 'GMP', '부산': 'PUS', '부산(PUS)': 'PUS',
    '대구': 'TAE', '대구(TAE)': 'TAE', '제주': 'CJU', '제주시(CJU)': 'CJU',
    '청주': 'CJJ', '청주시(CJJ)': 'CJJ', '서울(ICN)': 'ICN',
    // 일본
    '도쿄(나리타)': 'NRT', '도쿄(NRT)': 'NRT', '도쿄(하네다)': 'HND',
    '오사카(간사이)': 'KIX', '오사카(KIX)': 'KIX',
    '후쿠오카': 'FUK', '삿포로(치토세)': 'CTS', '삿포로(CTS)': 'CTS', '치토세': 'CTS',
    '나고야': 'NGO', '오키나와': 'OKA', '오키나와(OKA)': 'OKA',
    '나가사키': 'NGS', '가고시마': 'KOJ', '가고시마(KOJ)': 'KOJ',
    '구마모토': 'KMJ', '마츠야마': 'MYJ', '다카마쓰': 'TAK',
    '시즈오카': 'FSZ',
    // 동남아
    '방콕': 'BKK', '방콕(BKK)': 'BKK', '방콕(수완나폼)': 'BKK', '방콕(돈무앙)': 'DMK',
    '다낭': 'DAD', '다낭(DAD)': 'DAD',
    '하노이': 'HAN', '하노이(HAN)': 'HAN',
    '나트랑': 'CXR', '나트랑(CXR)': 'CXR', '나트랑(깜랑)': 'CXR',
    '푸켓': 'HKT', '푸껫(HKT)': 'HKT',
    '세부': 'CEB', '세부(CEB)': 'CEB',
    '마닐라': 'MNL', '보홀': 'TAG', '보홀(TAG)': 'TAG', '보홀팡라오': 'TAG',
    '칼리보(보라카이)': 'KLO', '클락': 'CRK',
    '싱가포르': 'SIN', '싱가포르(SIN)': 'SIN', '싱가포르(창이공항)': 'SIN',
    '코타키나발루': 'BKI', '코타키나발루(BKI)': 'BKI',
    '치앙마이': 'CNX', '치앙마이(CNX)': 'CNX',
    '비엔티엔': 'VTE', '바탐': 'BTH', '바탐(인도네시아)': 'BTH',
    '발리': 'DPS', '발리(덴파사)': 'DPS', '마나도': 'MDC',
    '푸꾸옥': 'PQC', '푸꾸옥(PQC)': 'PQC',
    // 중화권
    '홍콩': 'HKG', '홍콩(HKG)': 'HKG',
    '대만(타이페이)': 'TPE', '타이페이': 'TPE', '타이베이': 'TPE', '타이베이(TPE)': 'TPE',
    '타이중': 'RMQ', '가오슝': 'KHH', '송산': 'TSA',
    '마카오': 'MFM', '싼야(SYX)': 'SYX',
    // 기타
    '괌': 'GUM', '사이판': 'SPN', '사이판(SPN)': 'SPN',
    '시드니': 'SYD', '브리즈번': 'BNE',
    '두바이': 'DXB', '아부다비': 'AUH',
    '로마': 'FCO', '이스탄불': 'IST', '트라브존': 'TZX',
    // 추가 누락 도시
    '보라카이': 'KLO', '호치민': 'SGN', '호치민(SGN)': 'SGN',
    '상해': 'PVG', '상하이': 'PVG', '칭다오': 'TAO',
    '사가': 'HSG', '요나고': 'YGJ', '히로시마': 'HIJ', '오이타': 'OIT',
    '밴쿠버': 'YVR', '비엔티안': 'VTE',
    '푸껫': 'HKT', '쿠알라룸푸르': 'KUL',
    '서울': 'ICN', '청주시': 'CJJ',
    '상해(푸동)': 'PVG', '오사카': 'KIX', '도쿄': 'NRT', '삿포로': 'CTS',
};

// 도시명에서 공항코드 추출
const getAirportCode = (city: string): string | null => {
    // 직접 매핑 확인
    if (CITY_TO_AIRPORT[city]) return CITY_TO_AIRPORT[city];
    // 괄호 안 코드 추출: "서울(ICN)" → ICN
    const match = city.match(/\(([A-Z]{3})\)/);
    if (match) return match[1];
    return null;
};

// 네이버 항공권 비교 URL 생성 (왕복)
const getNaverFlightUrl = (depCity: string, arrCity: string, depDate: string, retDate?: string): string | null => {
    const depCode = getAirportCode(depCity);
    const arrCode = getAirportCode(arrCity);
    if (!depCode || !arrCode) return null;
    const fmtDate = (d: string) => d.replace(/[\-\.]/g, '').slice(0, 8);
    const depStr = fmtDate(depDate);
    if (depStr.length !== 8) return null;
    // 왕복: 귀국 날짜가 있고, 출발일과 다르면 왕복 URL
    if (retDate) {
        const retStr = fmtDate(retDate);
        if (retStr.length === 8 && retStr !== depStr) {
            return `https://flight.naver.com/flights/international/${depCode}-${arrCode}-${depStr}/${arrCode}-${depCode}-${retStr}?adult=1&fareType=Y`;
        }
    }
    // 편도
    return `https://flight.naver.com/flights/international/${depCode}-${arrCode}-${depStr}?adult=1&fareType=Y`;
};

// 스카이스캐너 비교 URL 생성 (왕복)
const getSkyscannerUrl = (depCity: string, arrCity: string, depDate: string, retDate?: string): string | null => {
    const depCode = getAirportCode(depCity);
    const arrCode = getAirportCode(arrCity);
    if (!depCode || !arrCode) return null;
    const fmtDate = (d: string) => {
        const clean = d.replace(/[\-\.]/g, '').slice(0, 8);
        return clean.length === 8 ? clean.slice(2) : null; // YYMMDD
    };
    const depStr = fmtDate(depDate);
    if (!depStr) return null;
    const dep = depCode.toLowerCase();
    const arr = arrCode.toLowerCase();
    // 왕복: 귀국 날짜가 있고, 출발일과 다르면 왕복 URL
    if (retDate) {
        const retStr = fmtDate(retDate);
        if (retStr && retStr !== depStr) {
            return `https://www.skyscanner.co.kr/transport/flights/${dep}/${arr}/${depStr}/${retStr}/?adults=1`;
        }
    }
    // 편도
    return `https://www.skyscanner.co.kr/transport/flights/${dep}/${arr}/${depStr}/?adults=1`;
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


    // 온라인투어: m.onlinetour.co.kr + /flight/m/ 경로 사용
    if (url.includes('onlinetour.co.kr')) {
        let mobileUrl = url.replace('www.onlinetour.co.kr', 'm.onlinetour.co.kr');
        mobileUrl = mobileUrl.replace('/flight/w/', '/flight/m/');
        mobileUrl = mobileUrl.replace('/dcair/dcairReservation', '/dcair/dcairReservationGuest');
        mobileUrl = mobileUrl.replace('/dcair/dcairList', '/dcair/list');
        return mobileUrl;
    }
    // 모두투어: www.modetour.com → m.modetour.com
    if (url.includes('www.modetour.com')) {
        return url.replace('www.modetour.com', 'm.modetour.com');
    }
    // 하나투어: PC URL 그대로 (모바일 fallback은 href에서 /api/redirect로 처리)
    if (url.includes('hanatour.com')) {
        return url;
    }
    // 노랑풍선: PC URL 파라미터를 모바일 URL에 전달 (도시 탭 선택)
    if (url.includes('fly.ybtour.co.kr')) {
        try {
            const parsed = new URL(url);
            const mobileUrl = new URL('https://mfly.ybtour.co.kr/mobile/fr/booking/findDiscountAirMobile.lts');
            mobileUrl.searchParams.set('efcTpCode', 'INV');
            mobileUrl.searchParams.set('efcCode', 'INV');
            for (const key of ['efcBannerCode', 'inhId', 'depDate', 'efcCityCode']) {
                const val = parsed.searchParams.get(key);
                if (val) mobileUrl.searchParams.set(key, val);
            }
            return mobileUrl.toString();
        } catch {
            return 'https://mfly.ybtour.co.kr/mobile/fr/booking/findDiscountAirMobile.lts?efcTpCode=INV&efcCode=INV';
        }
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
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');
    const [departureFilter, setDepartureFilter] = useState<string>('all');
    const [airlineFilter, setAirlineFilter] = useState<string>('all');
    const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE);
    const [showScrollTop, setShowScrollTop] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    const [headerHidden, setHeaderHidden] = useState(false);
    const [headerScrolled, setHeaderScrolled] = useState(false);
    const lastScrollY = useRef(0);

    useEffect(() => {
        fetchFlights();
        setIsMobile(checkIsMobile());
        // localStorage에서 즐겨찾기 불러오기
        try {
            const saved = localStorage.getItem('flight-favorites');
            if (saved) setFavorites(new Set(JSON.parse(saved)));
        } catch { }
    }, []);

    // 필터 변경 시 displayCount 리셋
    useEffect(() => {
        setDisplayCount(ITEMS_PER_PAGE);
    }, [searchTerm, sourceFilter, regionFilter, airlineFilter, startDate, endDate, departureFilter, sortBy]);

    // 스크롤 감지 (맨위로 버튼 + 헤더 숨김)
    useEffect(() => {
        const handleScroll = () => {
            const currentY = window.scrollY;
            setShowScrollTop(currentY > 400);
            setHeaderScrolled(currentY > 10);
            if (currentY > lastScrollY.current && currentY > 60) {
                setHeaderHidden(true);
            } else {
                setHeaderHidden(false);
            }
            lastScrollY.current = currentY;
        };
        window.addEventListener('scroll', handleScroll, { passive: true });
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

    // 인기 도시 목록 (한국인 인기 여행지 기준, 데이터에 있는 도시만 표시)
    const popularCities = useMemo(() => {
        const topDestinations = [
            '오사카(간사이)', '도쿄(나리타)', '도쿄(하네다)', '후쿠오카',
            '다낭', '방콕', '세부', '나트랑',
            '타이베이', '홍콩', '괌', '사이판',
            '하노이', '호치민', '푸켓', '발리',
            '싱가포르', '코타키나발루', '오키나와', '삿포로'
        ];
        const availableCities = new Set(flights.map(f => f.arrival.city));
        return topDestinations.filter(city => availableCities.has(city)).slice(0, 8);
    }, [flights]);

    // 즐겨찾기 토글
    const getFlightKey = (f: Flight) =>
        `${f.source}|${f.departure.city}|${f.arrival.city}|${f.airline}|${f.departure.date}|${f.price}`;

    const toggleFavorite = (flight: Flight) => {
        setFavorites(prev => {
            const next = new Set(prev);
            const key = getFlightKey(flight);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            localStorage.setItem('flight-favorites', JSON.stringify(Array.from(next)));
            if (next.size === 0) setShowFavoritesOnly(false);
            return next;
        });
    };

    // 필터 초기화
    const resetAllFilters = () => {
        setSearchTerm('');
        setSourceFilter('all');
        setRegionFilter('all');
        setAirlineFilter('all');
        setDepartureFilter('all');
        setStartDate('');
        setEndDate('');
        setSortBy('price');
        setShowFavoritesOnly(false);
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



        const matchesFavorites = !showFavoritesOnly || favorites.has(getFlightKey(flight));

        return matchesSearch && matchesSource && matchesRegion && matchesAirline && matchesDate && matchesDeparture && matchesFavorites;
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

    const calcDuration = (depTime: string | undefined, arrTime: string | undefined, depDate: string | undefined, arrDate: string | undefined) => {
        if (!depTime || !arrTime) return null;
        const [dh, dm] = depTime.split(':').map(Number);
        const [ah, am] = arrTime.split(':').map(Number);
        if (isNaN(dh) || isNaN(dm) || isNaN(ah) || isNaN(am)) return null;
        let diffMin = (ah * 60 + am) - (dh * 60 + dm);
        // If arrival is earlier in the day, assume next day (overnight flight)
        if (diffMin <= 0 && depDate !== arrDate) {
            diffMin += 24 * 60;
        }
        if (diffMin <= 0) return null;
        const hours = Math.floor(diffMin / 60);
        const mins = diffMin % 60;
        return `${hours}시간${mins > 0 ? ` ${mins}분` : ''}`;
    };

    const getSourceBadgeClass = (source: string) => {
        switch (source) {

            case 'ybtour': return styles.badgeYbtour;
            case 'modetour': return styles.badgeModetour;
            case 'hanatour': return styles.badgeHanatour;
            case 'onlinetour': return styles.badgeOnlinetour;
            default: return '';
        }
    };

    const getSourceName = (source: string) => {
        switch (source) {

            case 'ybtour': return '노랑풍선';
            case 'modetour': return '모두투어';
            case 'hanatour': return '하나투어';
            case 'onlinetour': return '온라인투어';
            default: return source;
        }
    };

    return (
        <div className={styles.dashboard}>
            <header className={`${styles.header} ${headerHidden ? styles.headerHidden : ''} ${headerScrolled ? styles.headerScrolled : ''}`}>
                <div className={styles.headerContainer}>
                    <div className={styles.headerLeft}>
                        <h1 className={styles.title} onClick={() => { resetAllFilters(); window.scrollTo({ top: 0, behavior: 'smooth' }); }} style={{ cursor: 'pointer' }}>
                            <Logo size={isMobile ? 0.95 : 1.05} />
                        </h1>
                    </div>
                    <div className={styles.headerRight}>
                        <p className={styles.subtitle}>
                            전국 여행사의 <strong className={styles.highlight}>땡처리 항공권</strong>을 한눈에! 🚀
                        </p>
                    </div>
                </div>
            </header>

            <div className="container">
                <div className={styles.controls}>
                    {/* 1. 날짜 + 검색 한 줄 */}
                    <div className={styles.secondaryRow}>
                        <div className={styles.dateRange}>
                            <span className={styles.dateIcon}>📅</span>
                            <DatePicker
                                selectsRange={true}
                                startDate={toDate(startDate)}
                                endDate={toDate(endDate)}
                                onChange={(update: [Date | null, Date | null]) => {
                                    const [start, end] = update;
                                    setStartDate(toStr(start));
                                    setEndDate(toStr(end));
                                    if (end) {
                                        setTimeout(() => setIsCalendarOpen(false), 500);
                                    }
                                }}
                                open={isCalendarOpen}
                                onInputClick={() => setIsCalendarOpen(true)}
                                onClickOutside={() => setIsCalendarOpen(false)}
                                shouldCloseOnSelect={false}
                                dateFormat="yy.MM.dd"
                                locale={ko}
                                className={styles.dateInput}
                                placeholderText="출발 기간 선택"
                                popperClassName={styles.datePickerPopper}
                                calendarClassName={styles.datePickerCalendar}
                                minDate={new Date()}
                                isClearable={true}
                                onFocus={(e: React.FocusEvent<HTMLInputElement>) => e.target.blur()}
                            />
                        </div>
                        <div className={styles.searchBox} style={{ flex: 1, minWidth: '150px', position: 'relative' }}>
                            <span className={styles.searchIcon}>🔍</span>
                            <input
                                type="text"
                                placeholder="도시명으로 검색 (예: 다낭, 오사카)"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                onFocus={() => setShowSuggestions(true)}
                                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                                className={styles.searchInput}
                            />
                            {showSuggestions && !searchTerm && (
                                <ul className={styles.suggestionsDropdown}>
                                    <li className={styles.suggestionHeader}>인기 도시</li>
                                    {popularCities.map((city) => (
                                        <li
                                            key={city}
                                            className={styles.suggestionItem}
                                            onMouseDown={(e) => {
                                                e.preventDefault(); // Prevent blur
                                                setSearchTerm(city);
                                                setShowSuggestions(false);
                                            }}
                                        >
                                            {city}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>

                    {/* 3. 필터 토글 버튼 (모바일) + 출발지 + 도착지역 칩 필터 */}
                    <button
                        className={styles.filterToggleBtn}
                        onClick={() => setShowFilters(!showFilters)}
                    >
                        <span>
                            {departureFilter !== 'all' || regionFilter !== 'all'
                                ? [
                                    departureFilter !== 'all' && (departureFilter === '인천' ? '인천/김포' : departureFilter === '부산' ? '부산/김해' : departureFilter),
                                    regionFilter !== 'all' && regionFilter,
                                ].filter(Boolean).join(' · ')
                                : '출발지 · 지역 선택'}
                        </span>
                        <span className={`${styles.filterToggleArrow} ${showFilters ? styles.filterToggleArrowOpen : ''}`}>▾</span>
                    </button>
                    <div className={`${styles.filterRow} ${showFilters ? styles.filterRowOpen : ''}`}>
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
                            <div className={styles.statsHeader}>
                                <span className={styles.resultCount}>총 <strong>{filteredFlights.length}</strong>개의 항공권</span>
                                <button
                                    onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                                    className={`${styles.favFilterBtn} ${showFavoritesOnly ? styles.favFilterActive : ''}`}
                                    title={showFavoritesOnly ? '전체 보기' : '즐겨찾기만 보기'}
                                >
                                    {showFavoritesOnly ? '❤️' : '🤍'} {favorites.size > 0 ? favorites.size : ''}
                                </button>
                            </div>
                            <div className={styles.statsFilters}>
                                <select
                                    value={sourceFilter}
                                    onChange={(e) => setSourceFilter(e.target.value)}
                                    className={styles.statsSelect}
                                >
                                    <option value="all">{isMobile ? '여행사' : '전체 여행사'}</option>

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
                                    <option value="all">{isMobile ? '항공사' : '전체 항공사'}</option>
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
                                                <span className={styles.airline}>{flight.airline}</span>
                                                {flight.availableSeats && (
                                                    <span className={(flight.availableSeats || 0) <= 9 ? styles.seatsBadgeCritical : styles.seatsBadge}>
                                                        {(flight.availableSeats || 0) <= 5 && '🔥 '}{flight.availableSeats}석
                                                    </span>
                                                )}
                                            </div>
                                            <button
                                                className={`${styles.favBtn} ${favorites.has(getFlightKey(flight)) ? styles.favBtnActive : ''}`}
                                                onClick={(e) => { e.stopPropagation(); toggleFavorite(flight); }}
                                                title={favorites.has(getFlightKey(flight)) ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                                            >
                                                {favorites.has(getFlightKey(flight)) ? '❤️' : '🤍'}
                                            </button>
                                        </div>

                                        <div className={styles.route}>
                                            <div className={styles.location}>
                                                <div className={styles.city}>{normalizeCity(flight.departure.city)}</div>
                                                <div className={styles.date}>{formatDate(flight.departure.date)}</div>
                                                {flight.departure.time && (
                                                    <div className={styles.time}>{flight.departure.time}</div>
                                                )}
                                            </div>

                                            <div className={styles.arrowSection}>
                                                <div className={styles.arrow}>✈</div>
                                            </div>

                                            <div className={styles.location}>
                                                <div className={styles.city}>{normalizeCity(flight.arrival.city)}</div>
                                                <div className={styles.date}>{formatDate(flight.arrival.date)}</div>
                                                {flight.arrival.time && (
                                                    <div className={styles.time}>{flight.arrival.time}</div>
                                                )}
                                            </div>
                                        </div>

                                        <div className={styles.cardFooterWrapper}>
                                            <div className={styles.cardFooter}>
                                                <div className={styles.priceSection}>
                                                    <div className={styles.price}>{formatPrice(flight.price)}</div>
                                                    {!isMobile && (() => {
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
                                                <a
                                                    href={
                                                        (flight.source === 'onlinetour')
                                                            ? getMobileUrl(flight.link, isMobile)
                                                            : (flight.source === 'hanatour')
                                                                ? (() => {
                                                                    const fareIdMatch = flight.link.match(/fareId=([^&]+)/);
                                                                    const mobileSearchUrl = flight.searchLink
                                                                        ? flight.searchLink.replace('hope.hanatour.com', 'm.hanatour.com').replace('M200', 'M100')
                                                                        : 'https://m.hanatour.com/trp/air/CHPC0AIR0233M100';
                                                                    if (isMobile) {
                                                                        if (fareIdMatch) {
                                                                            const mobileBookingUrl = `https://m.hanatour.com/com/pmt/CHPC0PMT0011M100?searchCond=${encodeURIComponent(JSON.stringify({ fareId: decodeURIComponent(fareIdMatch[1]), psngrCntLst: [{ ageDvCd: 'A', psngrCnt: 1 }] }))}`;
                                                                            return `/api/redirect?url=${encodeURIComponent(mobileBookingUrl)}&fallback=${encodeURIComponent(mobileSearchUrl)}`;
                                                                        }
                                                                        return mobileSearchUrl;
                                                                    }
                                                                    return `/api/redirect?url=${encodeURIComponent(flight.link)}&fallback=${encodeURIComponent(flight.searchLink || 'https://www.hanatour.com/trp/air/CHPC0AIR0233M200')}`;
                                                                })()
                                                                : getMobileUrl(flight.link, isMobile)
                                                    }
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="btn btn-primary"
                                                >
                                                    예약하기 →
                                                </a>
                                            </div>
                                            {/* 가격 비교 링크 */}
                                            {(() => {
                                                const naverUrl = getNaverFlightUrl(flight.departure.city, flight.arrival.city, flight.departure.date, flight.arrival.date);
                                                const skyscannerUrl = getSkyscannerUrl(flight.departure.city, flight.arrival.city, flight.departure.date, flight.arrival.date);
                                                if (!naverUrl && !skyscannerUrl) return null;
                                                return (
                                                    <div className={styles.compareLinks}>
                                                        <span className={styles.compareLinkLabel}>가격비교</span>
                                                        {naverUrl && (
                                                            <a href={naverUrl} target="_blank" rel="noopener noreferrer" className={styles.compareLink} title="네이버 항공권에서 비교">
                                                                네이버
                                                            </a>
                                                        )}
                                                        {skyscannerUrl && (
                                                            <a href={skyscannerUrl} target="_blank" rel="noopener noreferrer" className={styles.compareLink} title="스카이스캐너에서 비교">
                                                                스카이스캐너
                                                            </a>
                                                        )}
                                                        <span className={styles.compareLinkNote}>💡 위탁수하물 미포함 요금일 수 있음</span>
                                                    </div>
                                                );
                                            })()}
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
                        {/* 서비스 소개 */}
                        <div className={styles.footerSection}>
                            <Logo size={0.7} />
                            <p className={styles.footerDesc}>
                                여행사 땡처리 항공권을 한 곳에서 비교하세요.<br />
                                여러 여행사의 특가 항공권을 실시간으로 모아 가장 저렴한 항공편을 쉽게 찾을 수 있습니다.
                            </p>
                        </div>

                        {/* 데이터 소스 */}
                        <div className={styles.footerSection}>
                            <h4 className={styles.footerTitle}>여행사 바로가기</h4>
                            <div className={styles.footerLinks}>
                                <a href="https://www.hanatour.com" target="_blank" rel="noopener noreferrer">하나투어</a>
                                <a href="https://www.onlinetour.co.kr" target="_blank" rel="noopener noreferrer">온라인투어</a>
                                <a href="https://www.ybtour.co.kr" target="_blank" rel="noopener noreferrer">노랑풍선</a>
                                <a href="https://www.modetour.com" target="_blank" rel="noopener noreferrer">모두투어</a>
                            </div>
                        </div>

                        {/* 인기 여행지 */}
                        <div className={styles.footerSection}>
                            <h4 className={styles.footerTitle}>인기 여행지</h4>
                            <div className={styles.footerTags}>
                                {['오사카', '도쿄', '후쿠오카', '다낭', '방콕', '세부', '괌', '타이베이'].map(city => (
                                    <span
                                        key={city}
                                        className={styles.footerTag}
                                        onClick={() => { setSearchTerm(city); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                        style={{ cursor: 'pointer' }}
                                    >{city}</span>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* 면책 조항 */}
                    <div className={styles.footerDisclaimer}>
                        본 서비스는 각 여행사의 특가 항공권 정보를 수집하여 제공하며, 실제 예약 시점의 가격 및 좌석 상태는 해당 여행사와 다를 수 있습니다. 예약은 각 여행사 사이트에서 직접 진행됩니다.
                    </div>

                    <div className={styles.footerBottom}>
                        <span>© 2026 티킷 · 여행을 더 쉽게</span>
                    </div>
                </div>
            </footer>
        </div>
    );
}
