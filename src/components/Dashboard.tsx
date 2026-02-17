'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Flight } from '@/types/flight';
import Logo from './Logo';
import Sparkline from './Sparkline';
import dynamic from 'next/dynamic';
import { ko } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import * as gtag from '@/lib/analytics';

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
    d.setDate(d.getDate() + 21);
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
    // 땡처리닷컴 추가 매핑
    '보홀(필리핀)': 'TAG', '산야(삼아)': 'SYX', '카오슝(대만)': 'KHH', '카오슝': 'KHH',
    '나트랑(깜란)': 'CXR', '연태(옌타이)': 'YNT', '위해(웨이하이)': 'WEH',
    '클락(앙헬레스)': 'CRK', '하코다테(북해도)': 'HKD', '하코다테': 'HKD',
    '고베': 'UKB', '기타큐슈': 'KKJ', '청도(칭다오)': 'TAO',
    '보라카이(깔리보)': 'KLO', '서울(김포)': 'GMP', '타이페이(송산)': 'TSA',
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
    // 땡처리닷컴: www.ttang.com → m.ttang.com
    if (url.includes('www.ttang.com')) {
        return url.replace('www.ttang.com', 'm.ttang.com');
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
    const [startDate, setStartDate] = useState<string>(getDefaultStartDate());
    const [endDate, setEndDate] = useState<string>(getDefaultEndDate());
    const [departureFilter, setDepartureFilter] = useState<string>('all');
    const [airlineFilter, setAirlineFilter] = useState<string>('all');
    const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE);
    const [showScrollTop, setShowScrollTop] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [shareToast, setShareToast] = useState<string | null>(null);
    const [bookingFlight, setBookingFlight] = useState<Flight | null>(null);
    const [passengers, setPassengers] = useState({ adult: 1, child: 0, infant: 0 });
    const [alertFlight, setAlertFlight] = useState<Flight | null>(null);
    const [alertPrice, setAlertPrice] = useState('');
    const [pushSubscription, setPushSubscription] = useState<PushSubscription | null>(null);
    const [alertToast, setAlertToast] = useState<string | null>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    const [headerHidden, setHeaderHidden] = useState(false);
    const [headerScrolled, setHeaderScrolled] = useState(false);
    const lastScrollY = useRef(0);

    // 서비스 워커 등록
    useEffect(() => {
        if ('serviceWorker' in navigator && 'PushManager' in window) {
            navigator.serviceWorker.register('/sw.js').then(reg => {
                reg.pushManager.getSubscription().then(sub => {
                    if (sub) setPushSubscription(sub);
                });
            }).catch(() => { });
        }
    }, []);

    const subscribePush = async (): Promise<PushSubscription | null> => {
        try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') return null;
            const reg = await navigator.serviceWorker.ready;
            const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
            if (!vapidKey) return null;
            const sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: vapidKey,
            });
            setPushSubscription(sub);
            return sub;
        } catch {
            return null;
        }
    };

    const setupAlert = async () => {
        if (!alertFlight) return;
        let sub = pushSubscription;
        if (!sub) {
            sub = await subscribePush();
            if (!sub) {
                setAlertToast('알림 권한이 필요합니다');
                setTimeout(() => setAlertToast(null), 3000);
                return;
            }
        }
        const maxPrice = alertPrice ? parseInt(alertPrice.replace(/[^0-9]/g, '')) : undefined;
        const arrCity = normalizeCity(alertFlight.arrival.city);
        const res = await fetch('/api/alerts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subscription: sub.toJSON(),
                conditions: { route: arrCity, maxPrice },
            }),
        });
        if (res.ok) {
            gtag.trackAlertSetup(arrCity, maxPrice);
            setAlertToast(`🔔 ${arrCity} ${maxPrice ? formatPrice(maxPrice) + ' 이하' : ''} 알림 설정 완료!`);
        } else {
            setAlertToast('알림 설정에 실패했습니다');
        }
        setTimeout(() => setAlertToast(null), 3000);
        setAlertFlight(null);
        setAlertPrice('');
    };

    useEffect(() => {
        fetchFlights();
        setIsMobile(checkIsMobile());


        // 30분마다 자동 새로고침
        const interval = setInterval(() => {
            fetchFlights();
        }, 30 * 60 * 1000);

        // 탭 다시 활성화 시 새로고침 (5분 이상 경과 시)
        let lastFetch = Date.now();
        const origFetch = fetchFlights;
        const handleVisibility = () => {
            if (document.visibilityState === 'visible' && Date.now() - lastFetch > 5 * 60 * 1000) {
                lastFetch = Date.now();
                origFetch();
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
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

    // 공유 기능
    const shareFlightText = (flight: Flight) => {
        const price = `${Math.floor(flight.price / 10000)}만원`;
        const depDate = formatDate(flight.departure.date);
        const arrDate = flight.arrival.date ? ` ~ ${formatDate(flight.arrival.date)}` : '';
        return `✈️ ${normalizeCity(flight.departure.city)} → ${normalizeCity(flight.arrival.city)} ${price} | ${depDate}${arrDate} | ${flight.airline} | ${getSourceName(flight.source)}\n🔗 ${flight.link}`;
    };

    const shareFlight = async (flight: Flight) => {
        const text = shareFlightText(flight);
        const route = `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`;
        const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        try {
            if (isTouchDevice && navigator.share) {
                await navigator.share({ text });
                gtag.trackShare(route, 'native_share');
            } else {
                await navigator.clipboard.writeText(text);
                gtag.trackShare(route, 'clipboard');
                setShareToast('복사됨!');
                setTimeout(() => setShareToast(null), 2000);
            }
        } catch {
            try {
                await navigator.clipboard.writeText(text);
                gtag.trackShare(route, 'clipboard');
                setShareToast('복사됨!');
                setTimeout(() => setShareToast(null), 2000);
            } catch { }
        }
    };

    // 인원수 반영 예약 URL 생성
    const getBookingUrl = (flight: Flight, pax: { adult: number; child: number; infant: number }) => {
        // 하나투어: psngrCntLst JSON
        if (flight.source === 'hanatour') {
            const psngrCntLst: Array<{ ageDvCd: string; psngrCnt: number }> = [];
            if (pax.adult > 0) psngrCntLst.push({ ageDvCd: 'A', psngrCnt: pax.adult });
            if (pax.child > 0) psngrCntLst.push({ ageDvCd: 'C', psngrCnt: pax.child });
            if (pax.infant > 0) psngrCntLst.push({ ageDvCd: 'I', psngrCnt: pax.infant });

            const fareIdMatch = flight.link.match(/fareId=([^&]+)/);
            const mobileSearchUrl = flight.searchLink
                ? flight.searchLink.replace('hope.hanatour.com', 'm.hanatour.com').replace('M200', 'M100')
                : 'https://m.hanatour.com/trp/air/CHPC0AIR0233M100';
            if (isMobile) {
                if (fareIdMatch) {
                    const mobileBookingUrl = `https://m.hanatour.com/com/pmt/CHPC0PMT0011M100?searchCond=${encodeURIComponent(JSON.stringify({ fareId: decodeURIComponent(fareIdMatch[1]), psngrCntLst }))}`;
                    return `/api/redirect?url=${encodeURIComponent(mobileBookingUrl)}&fallback=${encodeURIComponent(mobileSearchUrl)}`;
                }
                return mobileSearchUrl;
            }
            let pcUrl = flight.link.replace(/psngrCntLst=[^&]+/, `psngrCntLst=${encodeURIComponent(JSON.stringify(psngrCntLst))}`);
            return `/api/redirect?url=${encodeURIComponent(pcUrl)}&fallback=${encodeURIComponent(flight.searchLink || 'https://www.hanatour.com/trp/air/CHPC0AIR0233M200')}`;
        }

        // 모두투어: adult, child, infant 파라미터
        if (flight.source === 'modetour') {
            let url = flight.link
                .replace(/adult=\d+/, `adult=${pax.adult}`)
                .replace(/child=\d+/, `child=${pax.child}`)
                .replace(/infant=\d+/, `infant=${pax.infant}`);
            return getMobileUrl(url, isMobile);
        }

        // 땡처리닷컴: adt, chd, inf 파라미터
        if (flight.source === 'ttang') {
            let url = flight.link
                .replace(/adt=\d+/, `adt=${pax.adult}`)
                .replace(/chd=\d+/, `chd=${pax.child}`)
                .replace(/inf=\d+/, `inf=${pax.infant}`);
            return getMobileUrl(url, isMobile);
        }

        // 온라인투어: eventCode URL에 인원 파라미터 추가
        if (flight.source === 'onlinetour') {
            let url = flight.link;
            // 기존 파라미터가 있으면 교체, 없으면 추가
            if (url.includes('adt=')) {
                url = url.replace(/adt=\d+/, `adt=${pax.adult}`);
            } else {
                url += `&adt=${pax.adult}`;
            }
            if (pax.child > 0) url += `&chd=${pax.child}`;
            if (pax.infant > 0) url += `&inf=${pax.infant}`;
            return getMobileUrl(url, isMobile);
        }

        // 나머지 (ybtour 등): 인원 파라미터 없음
        return getMobileUrl(flight.link, isMobile);
    };

    const openBookingModal = (flight: Flight) => {
        setPassengers({ adult: 1, child: 0, infant: 0 });
        setBookingFlight(flight);
    };

    const confirmBooking = () => {
        if (!bookingFlight) return;
        const url = getBookingUrl(bookingFlight, passengers);
        const route = `${normalizeCity(bookingFlight.departure.city)}-${normalizeCity(bookingFlight.arrival.city)}`;
        gtag.trackBookingClick(bookingFlight.source, route, bookingFlight.price);
        window.open(url, '_blank', 'noopener,noreferrer');
        setBookingFlight(null);
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
            case 'ttang': return styles.badgeTtang;
            default: return '';
        }
    };

    const getSourceName = (source: string) => {
        switch (source) {

            case 'ybtour': return '노랑풍선';
            case 'modetour': return '모두투어';
            case 'hanatour': return '하나투어';
            case 'onlinetour': return '온라인투어';
            case 'ttang': return '땡처리닷컴';
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
                                placeholderText="언제 떠나세요?"
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
                                    <option value="ttang">땡처리닷컴</option>
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
                                                {(() => {
                                                    const seatNum = flight.availableSeats || (flight.seats ? parseInt(flight.seats) : 0);
                                                    if (!seatNum) return null;
                                                    return (
                                                        <span className={seatNum <= 9 ? styles.seatsBadgeCritical : styles.seatsBadge}>
                                                            {seatNum <= 5 && '🔥 '}{seatNum}석
                                                        </span>
                                                    );
                                                })()}
                                            </div>
                                            <div className={styles.cardHeaderRight}>
                                                <button
                                                    type="button"
                                                    className={styles.shareBtn}
                                                    onClick={(e) => {
                                                        e.preventDefault(); e.stopPropagation();
                                                        setAlertFlight(flight);
                                                        setAlertPrice(String(flight.price));
                                                    }}
                                                    title="가격 알림 설정"
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'none' }}>
                                                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                                                        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                                                    </svg>
                                                </button>
                                                <button
                                                    type="button"
                                                    className={styles.shareBtn}
                                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); shareFlight(flight); }}
                                                    title="공유하기"
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'none' }}>
                                                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                                                        <polyline points="16 6 12 2 8 6" />
                                                        <line x1="12" y1="2" x2="12" y2="15" />
                                                    </svg>
                                                </button>
                                            </div>
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
                                                {['hanatour', 'modetour'].includes(flight.source) ? (
                                                    <button
                                                        type="button"
                                                        className="btn btn-primary"
                                                        onClick={(e) => { e.stopPropagation(); openBookingModal(flight); }}
                                                    >
                                                        예약하기 →
                                                    </button>
                                                ) : (
                                                    <a
                                                        href={getMobileUrl(flight.link, isMobile)}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="btn btn-primary"
                                                        onClick={() => {
                                                            const r = `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`;
                                                            gtag.trackBookingClick(flight.source, r, flight.price);
                                                        }}
                                                    >
                                                        예약하기 →
                                                    </a>
                                                )}
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
                                                            <a href={naverUrl} target="_blank" rel="noopener noreferrer" className={styles.compareLink} title="네이버 항공권에서 비교"
                                                                onClick={() => gtag.trackCompareClick('naver', `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`, flight.price)}
                                                            >
                                                                네이버
                                                            </a>
                                                        )}
                                                        {skyscannerUrl && (
                                                            <a href={skyscannerUrl} target="_blank" rel="noopener noreferrer" className={styles.compareLink} title="스카이스캐너에서 비교"
                                                                onClick={() => gtag.trackCompareClick('skyscanner', `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`, flight.price)}
                                                            >
                                                                스카이스캐너
                                                            </a>
                                                        )}

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
                                <a href="https://www.ttang.com" target="_blank" rel="noopener noreferrer">땡처리닷컴</a>
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
                        <span>© 2026 티키티킷 · 여행을 더 쉽게</span>
                    </div>
                </div>
            </footer>

            {/* 인원 선택 모달 */}
            {bookingFlight && (
                <div className={styles.modalOverlay} onClick={() => setBookingFlight(null)}>
                    <div className={styles.modalSheet} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h3 className={styles.modalTitle}>탑승 인원 선택</h3>
                            <button className={styles.modalClose} onClick={() => setBookingFlight(null)}>×</button>
                        </div>
                        <div className={styles.modalFlightInfo}>
                            <span>{normalizeCity(bookingFlight.departure.city)} → {normalizeCity(bookingFlight.arrival.city)}</span>
                            <span className={styles.modalPrice}>{formatPrice(bookingFlight.price)}/1인</span>
                        </div>
                        <div className={styles.paxRows}>
                            <div className={styles.paxRow}>
                                <div className={styles.paxLabel}>
                                    <span className={styles.paxType}>성인</span>
                                    <span className={styles.paxAge}>만 12세 이상</span>
                                </div>
                                <div className={styles.paxCounter}>
                                    <button className={styles.paxBtn} disabled={passengers.adult <= 1} onClick={() => setPassengers(p => ({ ...p, adult: p.adult - 1 }))}>−</button>
                                    <span className={styles.paxCount}>{passengers.adult}</span>
                                    <button className={styles.paxBtn} disabled={passengers.adult >= 9} onClick={() => setPassengers(p => ({ ...p, adult: p.adult + 1 }))}>+</button>
                                </div>
                            </div>
                            <div className={styles.paxRow}>
                                <div className={styles.paxLabel}>
                                    <span className={styles.paxType}>소아</span>
                                    <span className={styles.paxAge}>만 2~11세</span>
                                </div>
                                <div className={styles.paxCounter}>
                                    <button className={styles.paxBtn} disabled={passengers.child <= 0} onClick={() => setPassengers(p => ({ ...p, child: p.child - 1 }))}>−</button>
                                    <span className={styles.paxCount}>{passengers.child}</span>
                                    <button className={styles.paxBtn} disabled={passengers.child >= 9} onClick={() => setPassengers(p => ({ ...p, child: p.child + 1 }))}>+</button>
                                </div>
                            </div>
                            <div className={styles.paxRow}>
                                <div className={styles.paxLabel}>
                                    <span className={styles.paxType}>유아</span>
                                    <span className={styles.paxAge}>만 2세 미만</span>
                                </div>
                                <div className={styles.paxCounter}>
                                    <button className={styles.paxBtn} disabled={passengers.infant <= 0} onClick={() => setPassengers(p => ({ ...p, infant: p.infant - 1 }))}>−</button>
                                    <span className={styles.paxCount}>{passengers.infant}</span>
                                    <button className={styles.paxBtn} disabled={passengers.infant >= 4} onClick={() => setPassengers(p => ({ ...p, infant: p.infant + 1 }))}>+</button>
                                </div>
                            </div>
                        </div>
                        <div className={styles.modalTotal}>
                            <span className={styles.modalTotalLabel}>총 {passengers.adult + passengers.child + passengers.infant}명</span>
                            <span className={styles.modalTotalPrice}>
                                {formatPrice(bookingFlight.price * (passengers.adult + passengers.child + passengers.infant))}
                            </span>
                        </div>
                        <button className={styles.modalConfirm} onClick={confirmBooking}>
                            {getSourceName(bookingFlight.source)}에서 예약하기 →
                        </button>
                    </div>
                </div>
            )}

            {/* 알림 설정 모달 */}
            {alertFlight && (
                <div className={styles.modalOverlay} onClick={() => setAlertFlight(null)}>
                    <div className={styles.modalSheet} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h3 className={styles.modalTitle}>🔔 가격 알림 설정</h3>
                            <button className={styles.modalClose} onClick={() => setAlertFlight(null)}>×</button>
                        </div>
                        <div className={styles.modalFlightInfo}>
                            <span>{normalizeCity(alertFlight.departure.city)} → {normalizeCity(alertFlight.arrival.city)}</span>
                            <span className={styles.modalPrice}>현재 {formatPrice(alertFlight.price)}</span>
                        </div>
                        <div className={styles.alertFormGroup}>
                            <label className={styles.alertLabel}>목표 가격 (이 가격 이하일 때 알림)</label>
                            <input
                                type="text"
                                className={styles.alertInput}
                                value={alertPrice ? Number(alertPrice).toLocaleString() + '원' : ''}
                                onChange={(e) => setAlertPrice(e.target.value.replace(/[^0-9]/g, ''))}
                                placeholder="예: 200000"
                            />
                        </div>
                        <p className={styles.alertDesc}>
                            {normalizeCity(alertFlight.arrival.city)} 행 항공편이 목표 가격 이하로 발견되면<br />
                            브라우저 푸시 알림으로 알려드립니다.
                        </p>
                        <button className={styles.modalConfirm} onClick={setupAlert}>
                            알림 설정하기 🔔
                        </button>
                    </div>
                </div>
            )}

            {/* 공유/알림 토스트 */}
            {shareToast && (
                <div className={styles.shareToast}>{shareToast}</div>
            )}
            {alertToast && (
                <div className={styles.shareToast}>{alertToast}</div>
            )}
        </div>
    );
}
