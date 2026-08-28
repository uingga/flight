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
import AdCard from './AdCard';

// 유틸리티 함수 (별도 파일로 분리)
import {
    toDate, toStr, fmtDate, getDefaultStartDate, getDefaultEndDate,
    normalizeCity, normalizeAirline,
    CITY_TO_AIRPORT, getAirportCode, calcFlightDuration,
    getNaverFlightUrl, getSkyscannerUrl,
} from '@/lib/utils/flight-helpers';
import {
    TRIPCOM_ALLIANCE_ID, TRIPCOM_SID, TRIPCOM_SUB3,
    AIRPORT_TO_TRIPCOM_CITY, TRIPCOM_CITY_DATA,
    TRIPCOM_HOTEL_SUB3, IATA_TO_ENGLISH,
    getTripcomHotelUrl, getTripcomTrackingId,
} from '@/lib/utils/tripcom-helpers';
import { checkIsMobile, getMobileUrl } from '@/lib/utils/mobile-url';
import { getTtangBookingUrl } from '@/lib/utils/ttang-url';
import { getYbtourBookingUrl } from '@/lib/utils/ybtour-url';
import { dealAlertRegionLabel, type DealAlertRegion } from '@/lib/deal-alerts';
import {
    getComparisonFreshness,
    getEffectivePrice,
} from '@/lib/price-quality';
import {
    buildRecommendationPresentation,
    buildRecommendationScoreState,
    compareRecommendedFlights,
    getRecommendationFreshness,
} from '@/lib/flight-recommendation';
import {
    getDestinationContext,
    getItineraryContext,
} from '@/lib/destination-contexts';
import AccountSheet from './account/AccountSheet';
import { useAccount, type AccountSearchFilters } from './account/useAccount';

const ITEMS_PER_PAGE = 20;

function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from(rawData, character => character.charCodeAt(0));
}

interface ManagedPriceAlert {
    id: string;
    type: 'price' | 'deal';
    departureCity: string;
    arrivalCity?: string;
    region?: DealAlertRegion;
    maxPrice: number;
    draftPrice: string;
    createdAt: string;
}

/** 가격 알림을 등록한 화면 — GA4에서 진입점별 전환을 비교하기 위해 함께 기록한다. */
type PriceAlertEntry = 'detail_modal' | 'filter_banner' | 'empty_state';

const getSourceName = (source: string) => {
    switch (source) {
        case 'ybtour': return '노랑풍선';
        case 'modetour': return '모두투어';
        case 'hanatour': return '하나투어';
        case 'onlinetour': return '온라인투어';
        case 'ttang': return '땡처리닷컴';
        case 'myrealtrip': return '마이리얼트립';
        default: return source;
    }
};

const DISMISSED_ALERT_ROUTES_KEY = 'tikitikit_dismissed_alert_routes';
const RECENT_FLIGHT_REPORTS_KEY = 'tikitikit_recent_flight_reports';
const FLIGHT_REPORT_VISIBLE_MS = 24 * 60 * 60 * 1000;

// 살짝 당기거나 빠르게 스친 동작은 닫기로 이어지지 않게 한다.
// 화면 크기에 따라 140~180px를 의도적으로 내려야 닫힘 구간에 들어간다.
const getDetailSheetCloseDistance = (sheetHeight: number) =>
    Math.min(180, Math.max(140, sheetHeight * 0.28));

export default function Dashboard() {
    const account = useAccount();
    const [flights, setFlights] = useState<Flight[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [priceHistory, setPriceHistory] = useState<Record<string, Array<{ date: string; minPrice: number }>>>({});
    const [interparkPrices, setInterparkPrices] = useState<Record<string, Record<string, { avg: number; lowest: number }>>>({});
    const [fixedTodayPickId, setFixedTodayPickId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState<'price' | 'date' | 'airline' | 'discount' | 'discountRate'>('discount');
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
    const [isScrolled, setIsScrolled] = useState(false);
    const [showStickyPopup, setShowStickyPopup] = useState(false);
    const [shareToast, setShareToast] = useState<string | null>(null);
    const [sharedFlightId, setSharedFlightId] = useState<string | null>(null);
    const [showFuelBanner, setShowFuelBanner] = useState(false);
    const sharedRouteFallback = useRef<{ dep: string | null; arr: string | null; date: string | null } | null>(null);
    const openedSharedFlightId = useRef<string | null>(null);
    const [ttangConfirmFlight, setTtangConfirmFlight] = useState<Flight | null>(null);
    const [passengers, setPassengers] = useState({ adult: 1, child: 0, infant: 0 });
    const [bookingDisclaimer, setBookingDisclaimer] = useState<{ source: string; url: string } | null>(null);
    const disclaimerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [modetourGuide, setModetourGuide] = useState<Flight | null>(null);
    const [naverDisclaimer, setNaverDisclaimer] = useState<{
        url: string;
        route: string;
        analyticsRoute: string;
        price: number;
    } | null>(null);
    const disclaimerWindowRef = useRef<Window | null>(null);
    const [favoriteFlights, setFavoriteFlights] = useState<string[]>([]);
    const [showAccount, setShowAccount] = useState(false);
    const [favFilter, setFavFilter] = useState(false);
    const [favToast, setFavToast] = useState<string | null>(null);
    const [showContactModal, setShowContactModal] = useState(false);
    const [contactForm, setContactForm] = useState({ name: '', email: '', message: '' });
    const [contactSending, setContactSending] = useState(false);
    const [flightReport, setFlightReport] = useState<{ flightId: string; status: 'sending' | 'sent' | 'error' } | null>(null);
    const [recentFlightReports, setRecentFlightReports] = useState<Record<string, number>>({});
    const [priceAlertSetup, setPriceAlertSetup] = useState<{
        key: string;
        entry: PriceAlertEntry;
        departureCity: string;
        arrivalCity: string;
        baseline?: { flightId: string; price: number };
        maxPrice: string;
        status: 'idle' | 'saving' | 'sent' | 'error';
        message?: string;
    } | null>(null);
    const [dismissedAlertRoutes, setDismissedAlertRoutes] = useState<string[]>([]);
    const [showPriceAlertManager, setShowPriceAlertManager] = useState(false);
    const [showDealAlertSetup, setShowDealAlertSetup] = useState(false);
    const [dealAlertSetup, setDealAlertSetup] = useState<{
        departureCity: string;
        region: DealAlertRegion;
        maxPrice: string;
        status: 'idle' | 'saving' | 'sent' | 'error';
        message?: string;
    }>({
        departureCity: '인천',
        region: '일본',
        maxPrice: '200000',
        status: 'idle',
    });
    const [managedPriceAlerts, setManagedPriceAlerts] = useState<ManagedPriceAlert[]>([]);
    const [managedPriceAlertsLoaded, setManagedPriceAlertsLoaded] = useState(false);
    const [priceAlertManagerStatus, setPriceAlertManagerStatus] = useState<'idle' | 'loading' | 'error'>('idle');
    const [priceAlertManagerMessage, setPriceAlertManagerMessage] = useState<string | null>(null);
    const [priceAlertManagerBusy, setPriceAlertManagerBusy] = useState<string | null>(null);
    const priceAlertAreaRef = useRef<HTMLDivElement>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    const [headerHidden, setHeaderHidden] = useState(false);
    const [headerScrolled, setHeaderScrolled] = useState(false);
    const lastScrollY = useRef(0);
    const filterAreaRef = useRef<HTMLDivElement>(null);
    const mergedAccountRef = useRef<string | null>(null);

    // 팝업이 열려 있는 동안 배경(body) 스크롤 잠금
    // (iOS Safari는 overflow:hidden만으로 안 막혀서 position:fixed 방식 사용)
    const anyModalOpen = !!(modetourGuide || bookingDisclaimer || naverDisclaimer || ttangConfirmFlight || showContactModal || showPriceAlertManager || showDealAlertSetup || showAccount);
    useEffect(() => {
        if (!anyModalOpen) return;
        const scrollY = window.scrollY;
        const body = document.body;
        body.style.position = 'fixed';
        body.style.top = `-${scrollY}px`;
        body.style.left = '0';
        body.style.right = '0';
        body.style.width = '100%';
        body.style.overflow = 'hidden';
        return () => {
            body.style.position = '';
            body.style.top = '';
            body.style.left = '';
            body.style.right = '';
            body.style.width = '';
            body.style.overflow = '';
            window.scrollTo(0, scrollY);
        };
    }, [anyModalOpen]);

    // 팁 페이지 데이터
    const tipPosts = useMemo(() => [
        { title: '땡처리 항공권, 이렇게 싸도 되나요?', slug: 'cheap-flights-101', emoji: '✈️' },
        { title: '지방공항이 인천보다 싼 노선 총정리', slug: 'regional-airports', emoji: '🗺️' },
        { title: '땡처리 항공권 Q&A 10가지', slug: 'faq-10', emoji: '❓' },
        { title: '일본 벚꽃 시즌 항공권 특가 가이드 🌸', slug: 'japan-cherry-blossom', emoji: '🌸' },
        { title: '동남아 우기·건기 따져서 싸게 가는 법', slug: 'southeast-asia-seasons', emoji: '🌏' },
        { title: '비행기 표 싸게 사는 법 2026 총정리', slug: 'cheap-tickets-2026', emoji: '💰' },
        { title: '땡처리, 무조건 싸다고요? 진짜 싼 건지 확인하는 법', slug: 'is-it-really-cheap', emoji: '🔍' },
    ], []);

    // 유류할증료 배너 표시 여부 (localStorage 체크)
    useEffect(() => {
        try {
            const dismissed = localStorage.getItem('fuelBannerDismissed');
            if (!dismissed) setShowFuelBanner(true);
        } catch { }
    }, []);

    const dismissFuelBanner = () => {
        setShowFuelBanner(false);
        try { localStorage.setItem('fuelBannerDismissed', 'true'); } catch { }
    };

    // 즐겨찾기 localStorage 로드
    useEffect(() => {
        try {
            const saved = localStorage.getItem('favoriteFlights');
            if (saved) setFavoriteFlights(JSON.parse(saved));
        } catch { }
    }, []);

    // 로그인 직후 이 브라우저에서 찜했던 표와 계정의 찜을 합친다.
    // 한 번 합친 뒤에는 서버 저장본을 기준으로 여러 기기에서 이어서 쓸 수 있다.
    useEffect(() => {
        if (account.status !== 'authenticated') {
            if (account.status === 'anonymous') mergedAccountRef.current = null;
            return;
        }
        if (!account.email || mergedAccountRef.current === account.email) return;
        mergedAccountRef.current = account.email;
        let localIds: string[] = [];
        try {
            const saved = JSON.parse(localStorage.getItem('favoriteFlights') || '[]');
            if (Array.isArray(saved)) localIds = saved.filter(id => typeof id === 'string');
        } catch { }
        const combined = Array.from(new Set([...localIds, ...account.favoriteIds]));
        setFavoriteFlights(combined);
        try { localStorage.setItem('favoriteFlights', JSON.stringify(combined)); } catch { }
        if (localIds.length) void account.mergeLocalFavorites(localIds).catch(() => undefined);
    }, [account, account.email, account.status]);

    // 신고를 마친 항공권은 새로고침해도 하루 동안 다시 신고 버튼을 보여주지 않는다.
    // 서버에서도 같은 항공권을 중복 저장하지 않지만, 브라우저에서 먼저 막아 불필요한 요청을 줄인다.
    useEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(RECENT_FLIGHT_REPORTS_KEY) || '{}') as Record<string, number>;
            const cutoff = Date.now() - FLIGHT_REPORT_VISIBLE_MS;
            const recent = Object.fromEntries(
                Object.entries(saved).filter(([, timestamp]) => Number(timestamp) >= cutoff),
            );
            setRecentFlightReports(recent);
            localStorage.setItem(RECENT_FLIGHT_REPORTS_KEY, JSON.stringify(recent));
        } catch { }
    }, []);

    // 필터 바깥 클릭 시 닫기
    useEffect(() => {
        if (!showFilters) return;
        const handleOutsideClick = (e: MouseEvent) => {
            if (filterAreaRef.current && !filterAreaRef.current.contains(e.target as Node)) {
                setShowFilters(false);
            }
        };
        document.addEventListener('mousedown', handleOutsideClick);
        document.addEventListener('touchstart', handleOutsideClick as any);
        return () => {
            document.removeEventListener('mousedown', handleOutsideClick);
            document.removeEventListener('touchstart', handleOutsideClick as any);
        };
    }, [showFilters]);

    const toggleFavorite = (flightId: string, cityName: string) => {
        setFavoriteFlights(prev => {
            const willFavorite = !prev.includes(flightId);
            const next = !willFavorite
                ? prev.filter(id => id !== flightId)
                : [...prev, flightId];
            localStorage.setItem('favoriteFlights', JSON.stringify(next));
            if (willFavorite) {
                setFavToast(`⭐ ${cityName} 항공권 즐겨찾기 등록!`);
            } else {
                setFavToast(`${cityName} 항공권 즐겨찾기 해제`);
            }
            setTimeout(() => setFavToast(null), 2000);
            void account.setFavorite(flightId, willFavorite).catch(() => {
                setFavToast('계정에는 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
            });
            return next;
        });
    };

    const isFavoriteFlight = (flightId: string) => favoriteFlights.includes(flightId);

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
    }, [searchTerm, sourceFilter, regionFilter, airlineFilter, startDate, endDate, departureFilter, sortBy, favFilter]);

    // 스크롤 감지 (맨위로 버튼 + 헤더 숨김)
    useEffect(() => {
        const handleScroll = () => {
            const currentY = window.scrollY;
            setShowScrollTop(currentY > 400);
            setIsScrolled(currentY > 300);
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
            const fetchedFlights: Flight[] = data.flights || [];
            setFlights(fetchedFlights);
            setLastUpdated(data.lastUpdated || null);
            setPriceHistory(data.priceHistory || {});
            setInterparkPrices(data.interparkPrices || {});
            setFixedTodayPickId(typeof data.todayPickId === 'string' ? data.todayPickId : null);
        } catch (err) {
            setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
        } finally {
            setLoading(false);
        }
    };

    // 공유 링크에서 특정 항공편 필터링
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const flightId = params.get('flight');
        const campaign = params.get('utm_campaign') || '';
        const content = params.get('utm_content');
        if (params.get('utm_source') === 'naver_blog' && /^tikitikit_drop_\d+$/.test(campaign)) {
            if (content === 'drop_deal') gtag.trackBlogLinkOpen('flight', campaign);
            if (content === 'alert_cta') gtag.trackBlogLinkOpen('alert', campaign);
        }
        if (flightId) {
            setSharedFlightId(flightId);
            // Fallback 노선 정보 저장 (share 페이지에서 전달)
            const dep = params.get('dep');
            const arr = params.get('arr');
            const date = params.get('date');
            if (dep || arr || date) {
                sharedRouteFallback.current = { dep, arr, date };
            }
            // 공유 링크 접근 시 모든 필터 해제 (날짜/출발지 등이 매칭을 방해하지 않도록)
            setStartDate('');
            setEndDate('');
            setDepartureFilter('all');
            setRegionFilter('all');
            setSourceFilter('all');
            setAirlineFilter('all');
            setSearchTerm('');
            // URL 정리
            window.history.replaceState({}, '', window.location.pathname);
        }
    }, []);

    // ─── 필터 ↔ 브라우저 히스토리 동기화 ───
    const isRestoringFromHistory = useRef(false);
    const historyInitialized = useRef(false);
    const defaultStartDate = useMemo(() => getDefaultStartDate(), []);
    const defaultEndDate = useMemo(() => getDefaultEndDate(), []);

    // 아무 필터도 손대지 않은 첫 화면인가 (기본 날짜 범위는 기본 화면으로 친다)
    const isDefaultView = !sharedFlightId && !favFilter && searchTerm === ''
        && departureFilter === 'all' && regionFilter === 'all' && sourceFilter === 'all' && airlineFilter === 'all'
        && startDate === defaultStartDate && endDate === defaultEndDate;

    // 필터 상태 → URL 쿼리 파라미터 직렬화
    type FilterState = { q: string; dep: string; region: string; source: string; airline: string; sort: string; order: string; from: string; to: string };
    const buildFilterState = useCallback((): FilterState => ({
        q: searchTerm, dep: departureFilter, region: regionFilter,
        source: sourceFilter, airline: airlineFilter, sort: sortBy,
        order: sortOrder, from: startDate, to: endDate,
    }), [searchTerm, departureFilter, regionFilter, sourceFilter, airlineFilter, sortBy, sortOrder, startDate, endDate]);

    const filterStateToUrl = useCallback((state: FilterState): string => {
        const params = new URLSearchParams();
        if (state.q) params.set('q', state.q);
        if (state.dep !== 'all') params.set('dep', state.dep);
        if (state.region !== 'all') params.set('region', state.region);
        if (state.source !== 'all') params.set('source', state.source);
        if (state.airline !== 'all') params.set('airline', state.airline);
        if (state.sort !== 'discount') params.set('sort', state.sort);
        if (state.order !== 'asc') params.set('order', state.order);
        if (state.from && state.from !== defaultStartDate) params.set('from', state.from);
        if (state.to && state.to !== defaultEndDate) params.set('to', state.to);
        const qs = params.toString();
        return qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    }, [defaultStartDate, defaultEndDate]);

    const restoreFilterState = useCallback((state: FilterState | null) => {
        isRestoringFromHistory.current = true;
        if (!state) {
            // null state = 최초 진입 상태 (기본 필터)
            setSearchTerm(''); setDepartureFilter('all'); setRegionFilter('all');
            setSourceFilter('all'); setAirlineFilter('all');
            setSortBy('discount'); setSortOrder('asc');
            setStartDate(defaultStartDate); setEndDate(defaultEndDate);
        } else {
            setSearchTerm(state.q || '');
            setDepartureFilter(state.dep || 'all');
            setRegionFilter(state.region || 'all');
            setSourceFilter(state.source || 'all');
            setAirlineFilter(state.airline || 'all');
            setSortBy((state.sort as typeof sortBy) || 'discount');
            setSortOrder((state.order as typeof sortOrder) || 'asc');
            setStartDate(state.from || '');
            setEndDate(state.to || '');
        }
        // 다음 렌더에서 플래그 해제 (useEffect가 pushState를 skip하게)
        requestAnimationFrame(() => { isRestoringFromHistory.current = false; });
    }, [defaultStartDate, defaultEndDate]);

    // 초기 로드 시 URL 파라미터에서 필터 복원
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        // 알림 설정 딥링크(/?dealAlert=1)는 아래 replaceState가 쿼리를 지우기 전에
        // 여기서 먼저 읽어야 한다. 별도 effect에서 읽으면 실행 순서상 이미 늦다.
        if (params.get('dealAlert') === '1') setShowDealAlertSetup(true);
        if (params.get('flight')) return; // 공유 링크는 위에서 처리
        const hasFilterParams = params.has('q') || params.has('dep') || params.has('region') || params.has('source') || params.has('airline') || params.has('sort') || params.has('from') || params.has('to');
        if (hasFilterParams) {
            const state: FilterState = {
                q: params.get('q') || '', dep: params.get('dep') || 'all',
                region: params.get('region') || 'all', source: params.get('source') || 'all',
                airline: params.get('airline') || 'all', sort: params.get('sort') || 'discount',
                order: params.get('order') || 'asc',
                from: params.get('from') || defaultStartDate, to: params.get('to') || defaultEndDate,
            };
            restoreFilterState(state);
            window.history.replaceState(state, '', filterStateToUrl(state));
        } else {
            // 초기 상태를 히스토리에 기록 (뒤로가기 시 돌아올 기준점)
            const state = buildFilterState();
            window.history.replaceState(state, '', window.location.pathname);
        }
        historyInitialized.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 필터 변경 시 pushState
    useEffect(() => {
        if (!historyInitialized.current) return;
        if (isRestoringFromHistory.current) return;
        const state = buildFilterState();
        const url = filterStateToUrl(state);
        window.history.pushState(state, '', url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchTerm, departureFilter, regionFilter, sourceFilter, airlineFilter, sortBy, sortOrder, startDate, endDate]);

    // popstate 이벤트: 뒤로가기/앞으로가기 감지
    useEffect(() => {
        const handler = (e: PopStateEvent) => {
            restoreFilterState(e.state as FilterState | null);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };
        window.addEventListener('popstate', handler);
        return () => window.removeEventListener('popstate', handler);
    }, [restoreFilterState]);

    const uniqueAirlines = useMemo(() => {
        const airlines = new Set(flights.map(f => normalizeAirline(f.airline)).filter(a => a && a.length <= 15));
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
            '다낭', '세부', '나트랑', '타이베이',
            '홍콩', '괌', '사이판', '하노이',
            '호치민', '푸켓', '발리', '싱가포르',
            '코타키나발루', '오키나와', '삿포로', '방콕'
        ];
        const availableCities = new Set(flights.map(f => f.arrival.city));
        return topDestinations.filter(city => availableCities.has(city)).slice(0, 8);
    }, [flights]);

    // 공유 기능
    const getFlightShareContent = (flight: Flight) => {
        const price = formatPrice(flight.price);
        const depDate = formatDate(flight.departure.date);
        const arrDate = flight.arrival.date ? ` ~ ${formatDate(flight.arrival.date)}` : '';
        // 짧은 공유 URL: /share/항공편ID → 서버에서 OG 이미지 생성 → 메인 페이지로 리다이렉트
        // dep/arr/date 파라미터: 원본 판매 종료 시 같은 노선 대안을 안내하는 용도
        const dep = normalizeCity(flight.departure.city);
        const arr = normalizeCity(flight.arrival.city);
        const dateRaw = flight.departure.date?.replace(/[^0-9\-\.]/g, '').replace(/\./g, '-').replace(/-+$/, '');
        const shareParams = new URLSearchParams();
        if (dep) shareParams.set('dep', dep);
        if (arr) shareParams.set('arr', arr);
        if (dateRaw) shareParams.set('date', dateRaw);
        shareParams.set('utm_source', 'user_share');
        shareParams.set('utm_medium', 'referral');
        shareParams.set('utm_campaign', 'tikitikit_user_share');
        const queryStr = shareParams.toString() ? `?${shareParams.toString()}` : '';
        const siteUrl = `${window.location.origin}/share/${encodeURIComponent(flight.id)}${queryStr}`;
        return {
            title: `${dep} → ${arr} ${price}`,
            text: `✈️ ${dep} → ${arr}\n💰 ${price}/1인\n📅 ${depDate}${arrDate}\n🛫 ${flight.airline} · ${getSourceName(flight.source)}`,
            url: siteUrl,
        };
    };

    const shareFlight = async (flight: Flight) => {
        const content = getFlightShareContent(flight);
        const clipboardText = `${content.text}\n🔗 ${content.url}`;
        const route = `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`;
        try {
            await navigator.clipboard.writeText(clipboardText);
            gtag.trackShare(route, 'clipboard');
            setShareToast('✅ 링크가 복사되었습니다!');
        } catch {
            setShareToast('링크를 복사하지 못했습니다. 다시 시도해주세요.');
        }
        setTimeout(() => setShareToast(null), 2000);
    };

    const reportFlightIssue = async (flight: Flight, reportType: 'price_changed' | 'unavailable') => {
        if (flightReport?.status === 'sending') return;
        if (recentFlightReports[flight.id]) {
            setFlightReport({ flightId: flight.id, status: 'sent' });
            setShareToast('이미 신고가 접수된 항공권이에요.');
            setTimeout(() => setShareToast(null), 2500);
            return;
        }
        setFlightReport({ flightId: flight.id, status: 'sending' });

        try {
            const response = await fetch('/api/flight-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    reportType,
                    flight: {
                        id: flight.id,
                        source: flight.source,
                        sourceName: getSourceName(flight.source),
                        departureCity: normalizeCity(flight.departure.city),
                        arrivalCity: normalizeCity(flight.arrival.city),
                        departureDate: flight.departure.date,
                        arrivalDate: flight.arrival.date,
                        airline: flight.airline,
                        price: flight.price,
                        priceCheckedAt: flight.priceCheckedAt,
                    },
                }),
            });
            const result = await response.json().catch(() => ({})) as {
                duplicate?: boolean;
                recheckQueued?: boolean;
                autoHidden?: boolean;
                error?: string;
            };
            if (!response.ok) throw new Error(result.error || 'report failed');
            const reportedAt = Date.now();
            const nextReports = { ...recentFlightReports, [flight.id]: reportedAt };
            setRecentFlightReports(nextReports);
            try {
                localStorage.setItem(RECENT_FLIGHT_REPORTS_KEY, JSON.stringify(nextReports));
            } catch { }

            setFlightReport({ flightId: flight.id, status: 'sent' });
            if (result.autoHidden) {
                setFlights(current => current.filter(item => item.id !== flight.id));
                setModetourGuide(null);
            }
            setShareToast(result.autoHidden
                ? '신고가 여러 건 접수되어 확인하는 동안 이 항공권을 잠시 숨겼습니다.'
                : result.duplicate
                ? result.recheckQueued === false
                    ? '이미 신고가 처리된 항공권이에요.'
                    : '이미 접수된 항공권이에요. 확인 중입니다.'
                : result.recheckQueued === false
                    ? '신고가 접수되었습니다. 같은 신고가 더 들어오면 잠시 숨겨집니다.'
                    : '신고가 접수되었습니다. 가격과 예약 가능 여부를 다시 확인할게요.');
        } catch (error) {
            setFlightReport({ flightId: flight.id, status: 'error' });
            setShareToast(error instanceof Error && error.message !== 'report failed'
                ? error.message
                : '신고 접수에 실패했습니다. 잠시 후 다시 시도해주세요.');
        }
        setTimeout(() => setShareToast(null), 2500);
    };

    const postPriceAlertAction = async (payload: Record<string, unknown>) => {
        const nonceResponse = await fetch('/api/alerts', {
            method: 'GET',
            credentials: 'same-origin',
        });
        if (!nonceResponse.ok) throw new Error('가격 알림 보안 확인에 실패했습니다.');

        const response = await fetch('/api/alerts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const errorMessages: Record<string, string> = {
                'test cooldown': '테스트 알림은 10분에 한 번 보낼 수 있습니다.',
                'no active alerts': '테스트할 수 있는 활성 알림이 없습니다.',
                'test unavailable': '테스트 알림 서비스를 잠시 사용할 수 없습니다.',
            };
            throw new Error(errorMessages[data.error] || '가격 알림 처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
        }
        return data;
    };

    const getCurrentPushSubscription = async () => {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
        const registration = await navigator.serviceWorker.getRegistration();
        return registration ? registration.pushManager.getSubscription() : null;
    };

    const refreshManagedPriceAlerts = async (openManager: boolean) => {
        if (openManager) {
            setShowPriceAlertManager(true);
            setPriceAlertManagerStatus('loading');
            setPriceAlertManagerMessage(null);
        }
        try {
            const subscription = await getCurrentPushSubscription();
            if (!subscription) {
                setManagedPriceAlerts([]);
                setManagedPriceAlertsLoaded(true);
                if (openManager) setPriceAlertManagerStatus('idle');
                return;
            }
            const data = await postPriceAlertAction({ action: 'list', subscription: subscription.toJSON() });
            const alerts = Array.isArray(data.alerts) ? data.alerts : [];
            setManagedPriceAlerts(alerts.map((alert: Omit<ManagedPriceAlert, 'draftPrice'>) => ({
                ...alert,
                draftPrice: String(alert.maxPrice),
            })));
            setManagedPriceAlertsLoaded(true);
            if (openManager) setPriceAlertManagerStatus('idle');
        } catch (error) {
            setManagedPriceAlertsLoaded(true);
            if (openManager) {
                setPriceAlertManagerStatus('error');
                setPriceAlertManagerMessage(error instanceof Error ? error.message : '내 알림을 불러오지 못했습니다.');
            }
        }
    };

    const loadManagedPriceAlerts = () => refreshManagedPriceAlerts(true);

    useEffect(() => {
        void refreshManagedPriceAlerts(false);
        // 페이지 진입 시 현재 브라우저의 알림 개수만 조용히 미리 불러옵니다.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // (알림 설정 딥링크 처리는 필터 복원 effect 안으로 이동 — replaceState 순서 문제)

    const updateManagedPriceAlert = async (alert: ManagedPriceAlert) => {
        const maxPrice = Number(alert.draftPrice);
        if (!Number.isFinite(maxPrice) || maxPrice < 10000 || maxPrice > 10000000) {
            setPriceAlertManagerMessage('목표 가격을 1만원 이상으로 입력해주세요.');
            return;
        }
        setPriceAlertManagerBusy(alert.id);
        setPriceAlertManagerMessage(null);
        try {
            const subscription = await getCurrentPushSubscription();
            if (!subscription) throw new Error('이 브라우저의 알림 연결을 찾지 못했습니다.');
            await postPriceAlertAction({
                action: 'update',
                subscription: subscription.toJSON(),
                alertId: alert.id,
                maxPrice,
            });
            setManagedPriceAlerts(current => current.map(item => item.id === alert.id
                ? { ...item, maxPrice: Math.round(maxPrice), draftPrice: String(Math.round(maxPrice)) }
                : item));
            setPriceAlertManagerMessage('목표 가격을 변경했습니다.');
        } catch (error) {
            setPriceAlertManagerMessage(error instanceof Error ? error.message : '목표 가격을 변경하지 못했습니다.');
        } finally {
            setPriceAlertManagerBusy(null);
        }
    };

    const deleteManagedPriceAlert = async (alert: ManagedPriceAlert) => {
        setPriceAlertManagerBusy(alert.id);
        setPriceAlertManagerMessage(null);
        try {
            const subscription = await getCurrentPushSubscription();
            if (!subscription) throw new Error('이 브라우저의 알림 연결을 찾지 못했습니다.');
            await postPriceAlertAction({ action: 'delete', subscription: subscription.toJSON(), alertId: alert.id });
            setManagedPriceAlerts(current => current.filter(item => item.id !== alert.id));
            const target = alert.type === 'deal' && alert.region
                ? `${alert.departureCity} 출발 · ${dealAlertRegionLabel(alert.region)}`
                : `${alert.departureCity} → ${alert.arrivalCity}`;
            setPriceAlertManagerMessage(`${target} 알림을 해제했습니다.`);
        } catch (error) {
            setPriceAlertManagerMessage(error instanceof Error ? error.message : '알림을 해제하지 못했습니다.');
        } finally {
            setPriceAlertManagerBusy(null);
        }
    };

    const sendManagedPriceAlertTest = async () => {
        setPriceAlertManagerBusy('test');
        setPriceAlertManagerMessage(null);
        try {
            const subscription = await getCurrentPushSubscription();
            if (!subscription) throw new Error('이 브라우저의 알림 연결을 찾지 못했습니다.');
            await postPriceAlertAction({ action: 'test', subscription: subscription.toJSON() });
            setPriceAlertManagerMessage('테스트 알림을 요청했습니다. 잠시 후 기기 알림을 확인해주세요.');
        } catch (error) {
            setPriceAlertManagerMessage(error instanceof Error ? error.message : '테스트 알림을 보내지 못했습니다.');
        } finally {
            setPriceAlertManagerBusy(null);
        }
    };

    const savePriceAlert = async () => {
        const target = priceAlertSetup;
        if (!target) return;
        const maxPrice = Number(target.maxPrice);
        if (!Number.isFinite(maxPrice) || maxPrice < 10000 || maxPrice > 10000000) {
            setPriceAlertSetup(current => current ? { ...current, status: 'error', message: '목표 가격을 다시 확인해주세요.' } : current);
            return;
        }

        const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent);
        const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || standaloneNavigator.standalone === true;
        if (isIOS && !isStandalone) {
            setPriceAlertSetup(current => current ? {
                ...current,
                status: 'error',
                message: '아이폰은 Safari 공유 버튼 → 홈 화면에 추가 후 티키티킷 아이콘에서 신청해주세요.',
            } : current);
            return;
        }

        if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
            setPriceAlertSetup(current => current ? { ...current, status: 'error', message: '이 브라우저는 가격 알림을 지원하지 않습니다.' } : current);
            return;
        }

        setPriceAlertSetup(current => current ? { ...current, status: 'saving', message: undefined } : current);
        try {
            const permission = Notification.permission === 'granted'
                ? 'granted'
                : await Notification.requestPermission();
            if (permission !== 'granted') {
                throw new Error('알림 권한이 허용되지 않았습니다. 브라우저 설정에서 알림을 허용해주세요.');
            }

            const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
            if (!vapidPublicKey) throw new Error('가격 알림 설정을 준비 중입니다. 잠시 후 다시 시도해주세요.');

            const registration = await navigator.serviceWorker.register('/sw.js');
            await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription()
                || await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
                });

            const result = await postPriceAlertAction({
                subscription: subscription.toJSON(),
                conditions: {
                    departureCity: target.departureCity,
                    arrivalCity: target.arrivalCity,
                    maxPrice,
                },
                ...(target.baseline ? { baseline: target.baseline } : {}),
            });

            gtag.trackAlertSetup(`${target.departureCity}-${target.arrivalCity}`, maxPrice, target.entry);
            setDismissedAlertRoutes(current => current.includes(target.key) ? current : [...current, target.key]);

            setPriceAlertSetup(current => current ? {
                ...current,
                status: 'sent',
                message: result.testQueued
                    ? `등록 완료! 테스트 알림을 요청했습니다. ${formatPrice(maxPrice)} 이하 특가가 나오면 알려드릴게요.`
                    : `${formatPrice(maxPrice)} 이하의 새로운 특가가 생기면 알려드릴게요.`,
            } : current);
            void refreshManagedPriceAlerts(false);
        } catch (error) {
            setPriceAlertSetup(current => current ? {
                ...current,
                status: 'error',
                message: error instanceof Error ? error.message : '가격 알림 저장에 실패했습니다.',
            } : current);
        }
    };

    const openDealAlertSetup = () => {
        const filteredDeparture = departureFilter !== 'all' ? normalizeCity(departureFilter) : null;
        const filteredRegion = ['일본', '동남아', '중국', '남태평양'].includes(regionFilter)
            ? regionFilter as DealAlertRegion
            : null;
        setDealAlertSetup(current => ({
            ...current,
            ...(filteredDeparture ? { departureCity: filteredDeparture } : {}),
            ...(filteredRegion ? { region: filteredRegion } : {}),
            status: 'idle',
            message: undefined,
        }));
        setShowDealAlertSetup(true);
    };

    const saveDealAlertSearch = async (maxPrice: number) => {
        if (account.status !== 'authenticated') return false;
        const filters: AccountSearchFilters = {
            searchTerm: '',
            sortBy: 'discount',
            sortOrder: 'asc',
            sourceFilter: 'all',
            regionFilter: dealAlertSetup.region,
            startDate: '',
            endDate: '',
            departureFilter: dealAlertSetup.departureCity,
            airlineFilter: 'all',
            maxPrice,
            datePeriod: 'all',
        };
        const alreadySaved = account.savedSearches.some(item => (
            item.filters.searchTerm === ''
            && item.filters.regionFilter === filters.regionFilter
            && item.filters.departureFilter === filters.departureFilter
            && item.filters.maxPrice === filters.maxPrice
            && (item.filters.datePeriod || 'all') === 'all'
        ));
        if (alreadySaved) return true;
        await account.saveSearch(
            `${dealAlertSetup.departureCity} 출발 · ${dealAlertRegionLabel(dealAlertSetup.region)} · ${Math.round(maxPrice / 10_000)}만원 이하`,
            filters,
        );
        gtag.trackAccountAction('save_search');
        return true;
    };

    const saveDealSearchOnly = async () => {
        const maxPrice = Number(dealAlertSetup.maxPrice);
        if (!Number.isFinite(maxPrice) || maxPrice < 10000 || maxPrice > 10000000) {
            setDealAlertSetup(current => ({ ...current, status: 'error', message: '예산을 1만원 이상으로 입력해주세요.' }));
            return;
        }
        setDealAlertSetup(current => ({ ...current, status: 'saving', message: undefined }));
        try {
            await saveDealAlertSearch(maxPrice);
            setDealAlertSetup(current => ({
                ...current,
                status: 'sent',
                message: `${current.departureCity} 출발 · ${dealAlertRegionLabel(current.region)} · ${formatPrice(maxPrice)} 이하. 내 여행에서 다시 볼 수 있어요.`,
            }));
        } catch (error) {
            setDealAlertSetup(current => ({
                ...current,
                status: 'error',
                message: error instanceof Error ? error.message : '조건을 저장하지 못했습니다.',
            }));
        }
    };

    const saveDealAlert = async () => {
        const maxPrice = Number(dealAlertSetup.maxPrice);
        if (!Number.isFinite(maxPrice) || maxPrice < 10000 || maxPrice > 10000000) {
            setDealAlertSetup(current => ({ ...current, status: 'error', message: '예산을 1만원 이상으로 입력해주세요.' }));
            return;
        }

        const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent);
        const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || standaloneNavigator.standalone === true;
        if (isIOS && !isStandalone) {
            setDealAlertSetup(current => ({
                ...current,
                status: 'error',
                message: '아이폰은 Safari 공유 버튼 → 홈 화면에 추가 후 티키티킷 아이콘에서 신청해주세요.',
            }));
            return;
        }

        if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
            setDealAlertSetup(current => ({ ...current, status: 'error', message: '이 브라우저는 특가 알림을 지원하지 않습니다.' }));
            return;
        }

        setDealAlertSetup(current => ({ ...current, status: 'saving', message: undefined }));
        try {
            const permission = Notification.permission === 'granted'
                ? 'granted'
                : await Notification.requestPermission();
            if (permission !== 'granted') {
                throw new Error('알림 권한이 허용되지 않았습니다. 브라우저 설정에서 알림을 허용해주세요.');
            }

            const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
            if (!vapidPublicKey) throw new Error('특가 알림 설정을 준비 중입니다. 잠시 후 다시 시도해주세요.');

            const registration = await navigator.serviceWorker.register('/sw.js');
            await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription()
                || await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
                });

            await postPriceAlertAction({
                subscription: subscription.toJSON(),
                conditions: {
                    alertType: 'deal',
                    departureCity: dealAlertSetup.departureCity,
                    region: dealAlertSetup.region,
                    maxPrice,
                },
            });

            gtag.trackDealAlertSetup(dealAlertSetup.departureCity, dealAlertSetup.region, maxPrice);
            if (account.status === 'authenticated') {
                try { await saveDealAlertSearch(maxPrice); } catch { }
            }
            setDealAlertSetup(current => ({
                ...current,
                status: 'sent',
                message: `${current.departureCity} 출발 · ${dealAlertRegionLabel(current.region)} · ${formatPrice(maxPrice)} 이하. 알림이 울리면, 볼 만한 표가 나왔다는 뜻이에요.`,
            }));
            void refreshManagedPriceAlerts(false);
        } catch (error) {
            setDealAlertSetup(current => ({
                ...current,
                status: 'error',
                message: error instanceof Error ? error.message : '특가 알림 저장에 실패했습니다.',
            }));
        }
    };

    useEffect(() => {
        if (!priceAlertSetup?.key) return;
        const frame = window.requestAnimationFrame(() => {
            priceAlertAreaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [priceAlertSetup?.key]);

    // 세션 중 닫았거나 이미 등록한 노선은 알림 제안을 다시 띄우지 않는다
    useEffect(() => {
        try {
            const saved = sessionStorage.getItem(DISMISSED_ALERT_ROUTES_KEY);
            if (saved) setDismissedAlertRoutes(JSON.parse(saved));
        } catch { }
    }, []);

    useEffect(() => {
        try {
            sessionStorage.setItem(DISMISSED_ALERT_ROUTES_KEY, JSON.stringify(dismissedAlertRoutes));
        } catch { }
    }, [dismissedAlertRoutes]);

    const openPriceAlert = (setup: {
        key: string;
        entry: PriceAlertEntry;
        departureCity: string;
        arrivalCity: string;
        baseline?: { flightId: string; price: number };
        maxPrice: number | null;
    }) => {
        setPriceAlertSetup({ ...setup, maxPrice: setup.maxPrice === null ? '' : String(setup.maxPrice), status: 'idle' });
    };

    const dismissPriceAlert = () => {
        const key = priceAlertSetup?.key;
        setPriceAlertSetup(null);
        if (key && key.startsWith('route:')) {
            setDismissedAlertRoutes(current => current.includes(key) ? current : [...current, key]);
        }
    };

    /** 알림 등록 패널 — 상세 모달·필터 배너·빈 결과에서 함께 쓴다 */
    const renderPriceAlertPanel = (note: string) => {
        if (!priceAlertSetup) return null;
        const setup = priceAlertSetup;
        return (
            <div className={styles.priceAlertPanel} aria-live="polite">
                <div className={styles.priceAlertPanelHeader}>
                    <div>
                        <strong>{setup.departureCity} → {setup.arrivalCity}</strong>
                        <span>{note}</span>
                    </div>
                    {setup.status !== 'sent' && (
                        <button
                            type="button"
                            className={styles.priceAlertCloseBtn}
                            onClick={dismissPriceAlert}
                            aria-label="가격 알림 설정 닫기"
                        >
                            ×
                        </button>
                    )}
                </div>
                {setup.status === 'sent' ? (
                    <p className={styles.priceAlertSuccess}>✓ {setup.message}</p>
                ) : (
                    <>
                        <label className={styles.priceAlertPriceField}>
                            <span>목표 가격</span>
                            <span className={styles.priceAlertInputWrap}>
                                <input
                                    type="number"
                                    min="10000"
                                    max="10000000"
                                    step="1000"
                                    inputMode="numeric"
                                    placeholder="예: 300000"
                                    value={setup.maxPrice}
                                    onChange={event => setPriceAlertSetup(current => current ? {
                                        ...current,
                                        maxPrice: event.target.value,
                                        status: 'idle',
                                        message: undefined,
                                    } : current)}
                                    aria-label="목표 가격"
                                />
                                <span>원 이하</span>
                            </span>
                        </label>
                        <p className={styles.priceAlertHelp}>
                            같은 노선이면 출발일과 일정이 달라도 목표 가격 이하의 새 특가를 알려드립니다.
                        </p>
                        {setup.message && (
                            <p className={styles.priceAlertError}>{setup.message}</p>
                        )}
                        <button
                            type="button"
                            className={styles.priceAlertSaveBtn}
                            disabled={setup.status === 'saving'}
                            onClick={savePriceAlert}
                        >
                            {setup.status === 'saving' ? '등록 중…' : '알림 등록'}
                        </button>
                    </>
                )}
            </div>
        );
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

            if (fareIdMatch) {
                // fareId가 있으면 상세 예약 페이지로 직접 이동
                if (isMobile) {
                    const mobileBookingUrl = `https://m.hanatour.com/com/pmt/CHPC0PMT0011M100?searchCond=${encodeURIComponent(JSON.stringify({ fareId: decodeURIComponent(fareIdMatch[1]), psngrCntLst }))}`;
                    const mobileSearchUrl = flight.searchLink
                        ? flight.searchLink.replace('hope.hanatour.com', 'm.hanatour.com').replace('M200', 'M100')
                        : 'https://m.hanatour.com/trp/air/CHPC0AIR0233M100';
                    return `/api/redirect?url=${encodeURIComponent(mobileBookingUrl)}&fallback=${encodeURIComponent(mobileSearchUrl)}`;
                }
                const pcBookingUrl = `https://www.hanatour.com/com/pmt/CHPC0PMT0011M200?searchCond=${encodeURIComponent(JSON.stringify({ fareId: decodeURIComponent(fareIdMatch[1]), psngrCntLst }))}`;
                const pcSearchLink = flight.searchLink || 'https://www.hanatour.com/trp/air/CHPC0AIR0233M200';
                return `/api/redirect?url=${encodeURIComponent(pcBookingUrl)}&fallback=${encodeURIComponent(pcSearchLink)}`;
            }

            // fareId가 없으면 searchCond URL의 인원수를 업데이트하여 검색 페이지로 이동
            let url = flight.link || flight.searchLink || '';
            if (url.includes('searchCond=')) {
                try {
                    const scMatch = url.match(/searchCond=([^&]+)/);
                    if (scMatch) {
                        const sc = JSON.parse(decodeURIComponent(scMatch[1]));
                        sc.psngrCntLst = psngrCntLst;
                        url = url.replace(/searchCond=[^&]+/, `searchCond=${encodeURIComponent(JSON.stringify(sc))}`);
                    }
                } catch { }
            }
            if (isMobile) {
                return url.replace('hope.hanatour.com', 'm.hanatour.com').replace('www.hanatour.com', 'm.hanatour.com').replace('M200', 'M100');
            }
            return url.replace('hope.hanatour.com', 'www.hanatour.com');
        }

        // 모두투어: 검색 페이지로 이동 (deep link 미지원)
        if (flight.source === 'modetour') {
            return getMobileUrl(flight.link, isMobile);
        }

        // 땡처리닷컴: 해당 노선·왕복 날짜의 실시간 검색 결과로 이동
        if (flight.source === 'ttang') {
            return getTtangBookingUrl(flight);
        }

        // 노랑풍선: 해당 노선·왕복 날짜·항공사의 모바일 실시간 검색 결과로 이동
        if (flight.source === 'ybtour') {
            return getYbtourBookingUrl(flight, pax);
        }

        // 온라인투어: 예약 페이지가 URL의 인원 파라미터를 완전히 무시하고
        // 자체 증감 버튼(chdIncrease 등)으로만 인원을 받는다 — 붙여봐야 화면이 달라지지 않아
        // 인원을 반영하는 것처럼 오해만 남기므로 링크를 그대로 연다.
        if (flight.source === 'onlinetour') {
            return getMobileUrl(flight.link, isMobile);
        }

        // 마이리얼트립: offers.k1 검색 URL (bridge/marketing return_url 내부, URL-인코딩됨)
        if (flight.source === 'myrealtrip') {
            let url = flight.link;
            url = url.replace(/adult%3D\d+/, `adult%3D${pax.adult}`);
            url = url.replace(/child%3D\d+/, `child%3D${pax.child}`);
            url = url.replace(/infant%3D\d+/, `infant%3D${pax.infant}`);
            try {
                const trackedUrl = new URL(url);
                const trackingId = [
                    'flight', flight.departure.airport, flight.arrival.airport,
                    flight.departure.date?.replace(/\D/g, ''), flight.arrival.date?.replace(/\D/g, ''),
                ].filter(Boolean).join('_').slice(0, 100);
                trackedUrl.searchParams.set('utm_campaign', 'tikitikit_flight');
                trackedUrl.searchParams.set('utm_content', trackingId);
                return trackedUrl.toString();
            } catch {
                return url;
            }
        }

        // 나머지 (ybtour 등): 인원 파라미터 없음
        return getMobileUrl(flight.link, isMobile);
    };

    // 면책 팝업 닫기 (타이머 취소 + 미리 열린 빈 창 닫기)
    const dismissDisclaimer = () => {
        if (disclaimerTimerRef.current) {
            clearTimeout(disclaimerTimerRef.current);
            disclaimerTimerRef.current = null;
        }
        if (disclaimerWindowRef.current && !disclaimerWindowRef.current.closed) {
            disclaimerWindowRef.current.close();
            disclaimerWindowRef.current = null;
        }
        setBookingDisclaimer(null);
    };

    const revenueClickDetails = (flight: Flight, trackingId?: string) => ({
        departureDate: flight.departure.date,
        returnDate: flight.arrival.date,
        departureAirport: flight.routeAirports?.outboundDeparture || flight.departure.airport,
        arrivalAirport: flight.routeAirports?.outboundArrival || flight.arrival.airport,
        airline: flight.airline,
        destination: normalizeCity(flight.arrival.city),
        trackingId,
    });

    // 예약 상세 시트를 여는 유일한 통로. entry로 "어디서 열었는지"를 남겨야
    // 카드 목록 → 상세 → 예약 클릭 퍼널의 중간 구간이 GA4에서 보인다.
    type DetailEntry = 'card_body' | 'book_button' | 'discovery_bar' | 'shared_link' | 'today_pick';
    const openFlightDetail = (flight: Flight, entry: DetailEntry) => {
        gtag.trackDetailOpen(
            `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`,
            flight.price,
            flight.source,
            entry,
        );
        account.recordRecent(flight.id);
        setModetourGuide(flight);
    };

    // 상세 시트 스크롤 힌트 — 화면 밖에 내용이 남아 있는지 사용자가 알 수 있게 한다
    const detailSheetRef = useRef<HTMLDivElement | null>(null);
    const detailSheetInnerRef = useRef<HTMLDivElement | null>(null);
    const detailDragRef = useRef({ pointerId: -1, startY: 0, lastY: 0 });
    const detailDragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [sheetHasMore, setSheetHasMore] = useState(false);
    const measureSheetScroll = () => {
        const el = detailSheetRef.current;
        if (!el) return;
        setSheetHasMore(el.scrollHeight - el.scrollTop - el.clientHeight > 60);
    };
    useEffect(() => {
        if (!modetourGuide) return;
        // 항공권마다 내용 길이가 달라 시트가 그려진 다음 프레임에 측정한다
        const id = requestAnimationFrame(measureSheetScroll);
        // 첫 페이지 로드 직후에는 레이아웃이 늦게 안정되므로 시트 등장 애니메이션(0.3s) 후 한 번 더 잰다
        const late = setTimeout(measureSheetScroll, 450);
        return () => { cancelAnimationFrame(id); clearTimeout(late); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modetourGuide]);

    const resetDetailSheetPosition = useCallback(() => {
        const sheet = detailSheetRef.current;
        const inner = detailSheetInnerRef.current;
        if (!sheet || !inner) return;
        sheet.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';
        sheet.style.transform = 'translate3d(0, 0, 0)';
        inner.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';
        inner.style.transform = 'translate3d(0, 0, 0)';
        detailDragTimerRef.current = setTimeout(() => {
            if (!detailSheetRef.current || !detailSheetInnerRef.current) return;
            detailSheetRef.current.style.transition = '';
            detailSheetRef.current.style.transform = '';
            detailSheetInnerRef.current.style.transition = '';
            detailSheetInnerRef.current.style.transform = '';
        }, 230);
    }, []);

    const applyDetailSheetPull = useCallback((offset: number) => {
        const sheet = detailSheetRef.current;
        const inner = detailSheetInnerRef.current;
        if (!sheet || !inner) return;
        const closeDistance = getDetailSheetCloseDistance(sheet.clientHeight);
        const resistedOffset = Math.min(16, Math.max(0, offset) * (16 / closeDistance));
        inner.style.transform = `translate3d(0, ${resistedOffset}px, 0)`;
        // 기준을 넘기기 전에는 외곽은 고정하고 내용만 저항감 있게 당긴다.
        const sheetOffset = Math.max(0, offset - closeDistance);
        sheet.style.transform = `translate3d(0, ${sheetOffset}px, 0)`;
    }, []);

    const beginDetailSheetDrag = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!isMobile || (event.pointerType === 'mouse' && event.button !== 0)) return;
        const sheet = detailSheetRef.current;
        if (!sheet) return;
        const target = event.target as HTMLElement;
        const startedOnHandle = !!target.closest('[data-detail-drag-handle]');
        const startedOnControl = !!target.closest('button, a, input, select, textarea, [role="button"]');
        // 버튼과 링크의 탭 동작은 보존한다. 본문에서는 스크롤이 맨 위일 때만
        // 아래로 끌어 닫기가 시작되고, 손잡이는 현재 스크롤 위치와 무관하게 동작한다.
        if (startedOnControl || (!startedOnHandle && sheet.scrollTop > 1)) return;
        if (detailDragTimerRef.current) clearTimeout(detailDragTimerRef.current);
        detailDragRef.current = {
            pointerId: event.pointerId,
            startY: event.clientY,
            lastY: event.clientY,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        sheet.style.animation = 'none';
        sheet.style.transition = 'none';
        if (detailSheetInnerRef.current) detailSheetInnerRef.current.style.transition = 'none';
    };

    const moveDetailSheetDrag = (event: React.PointerEvent<HTMLDivElement>) => {
        if (detailDragRef.current.pointerId !== event.pointerId) return;
        const offset = Math.max(0, event.clientY - detailDragRef.current.startY);
        detailDragRef.current.lastY = event.clientY;
        applyDetailSheetPull(offset);
        if (offset > 0) event.preventDefault();
    };

    const endDetailSheetDrag = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
        if (detailDragRef.current.pointerId !== event.pointerId) return;
        const sheet = detailSheetRef.current;
        const offset = Math.max(0, detailDragRef.current.lastY - detailDragRef.current.startY);
        detailDragRef.current.pointerId = -1;
        try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 이미 해제됨 */ }

        const closeDistance = getDetailSheetCloseDistance(sheet?.clientHeight || 480);
        const shouldClose = !cancelled && offset >= closeDistance;
        if (!sheet || !shouldClose) {
            resetDetailSheetPosition();
            return;
        }

        sheet.style.transition = 'transform 180ms ease-in';
        sheet.style.transform = `translate3d(0, ${sheet.clientHeight}px, 0)`;
        if (detailSheetInnerRef.current) {
            detailSheetInnerRef.current.style.transition = 'transform 120ms ease-out';
            detailSheetInnerRef.current.style.transform = 'translate3d(0, 0, 0)';
        }
        detailDragTimerRef.current = setTimeout(() => setModetourGuide(null), 170);
    };

    // 모바일 브라우저는 본문 영역의 pointer 이벤트를 세로 스크롤로 선점한다.
    // passive:false인 네이티브 touchmove에서, 스크롤 최상단의 아래 방향 제스처만
    // 시트 드래그로 전환해야 본문 어디서 시작해도 안정적으로 닫을 수 있다.
    useEffect(() => {
        if (!modetourGuide || !isMobile) return;
        const sheet = detailSheetRef.current;
        if (!sheet) return;

        let tracking = false;
        let dragging = false;
        let startY = 0;
        let lastY = 0;

        const onTouchStart = (event: TouchEvent) => {
            if (event.touches.length !== 1 || sheet.scrollTop > 1) return;
            const target = event.target as HTMLElement;
            if (target.closest('[data-detail-drag-handle], button, a, input, select, textarea, [role="button"]')) return;
            tracking = true;
            dragging = false;
            startY = event.touches[0].clientY;
            lastY = startY;
        };

        const onTouchMove = (event: TouchEvent) => {
            if (!tracking || event.touches.length !== 1) return;
            const currentY = event.touches[0].clientY;
            const offset = currentY - startY;
            if (!dragging) {
                if (offset <= 6) return;
                if (sheet.scrollTop > 1) { tracking = false; return; }
                dragging = true;
                if (detailDragTimerRef.current) clearTimeout(detailDragTimerRef.current);
                sheet.style.animation = 'none';
                sheet.style.transition = 'none';
                if (detailSheetInnerRef.current) detailSheetInnerRef.current.style.transition = 'none';
            }
            event.preventDefault();
            lastY = currentY;
            applyDetailSheetPull(Math.max(0, offset));
        };

        const finishTouchDrag = (cancelled: boolean) => {
            if (!tracking) return;
            tracking = false;
            if (!dragging) return;
            dragging = false;
            const offset = Math.max(0, lastY - startY);
            const closeDistance = getDetailSheetCloseDistance(sheet.clientHeight);
            const shouldClose = !cancelled && offset >= closeDistance;
            if (!shouldClose) {
                resetDetailSheetPosition();
                return;
            }
            sheet.style.transition = 'transform 180ms ease-in';
            sheet.style.transform = `translate3d(0, ${sheet.clientHeight}px, 0)`;
            if (detailSheetInnerRef.current) {
                detailSheetInnerRef.current.style.transition = 'transform 120ms ease-out';
                detailSheetInnerRef.current.style.transform = 'translate3d(0, 0, 0)';
            }
            detailDragTimerRef.current = setTimeout(() => setModetourGuide(null), 170);
        };

        const onTouchEnd = () => finishTouchDrag(false);
        const onTouchCancel = () => finishTouchDrag(true);
        sheet.addEventListener('touchstart', onTouchStart, { passive: true });
        sheet.addEventListener('touchmove', onTouchMove, { passive: false });
        sheet.addEventListener('touchend', onTouchEnd);
        sheet.addEventListener('touchcancel', onTouchCancel);
        return () => {
            sheet.removeEventListener('touchstart', onTouchStart);
            sheet.removeEventListener('touchmove', onTouchMove);
            sheet.removeEventListener('touchend', onTouchEnd);
            sheet.removeEventListener('touchcancel', onTouchCancel);
        };
    }, [applyDetailSheetPull, isMobile, modetourGuide, resetDetailSheetPosition]);

    useEffect(() => () => {
        if (detailDragTimerRef.current) clearTimeout(detailDragTimerRef.current);
    }, []);

    // 노랑풍선/온라인투어용: 인원선택 없이 면책조항 팝업 후 자동 이동
    const disclaimerThenRedirect = (flight: Flight) => {
        const url = getMobileUrl(flight.link, isMobile);
        const route = `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`;
        gtag.trackBookingClick(flight.source, route, flight.price, revenueClickDetails(flight));
        setBookingDisclaimer({ source: flight.source, url });

        if (!isMobile) {
            // 데스크탑: 면책 팝업 보여준 뒤 새 탭에서 열기
            disclaimerTimerRef.current = setTimeout(() => {
                window.open(url, '_blank', 'noopener,noreferrer');
                setBookingDisclaimer(null);
            }, 2000);
        }
        // 모바일: 면책 팝업 + 수동 이동 버튼 (자동 이동 없음)
    };

    // 필터 전체 초기화 (출발지·날짜 모두 해제)
    const resetAllFilters = () => {
        setSearchTerm('');
        setSourceFilter('all');
        setRegionFilter('all');
        setAirlineFilter('all');
        setDepartureFilter('all');
        setStartDate('');
        setEndDate('');
        setSortBy('discount');
    };

    const applyAccountSearch = (filters: AccountSearchFilters) => {
        setSearchTerm(filters.searchTerm);
        setSortBy(filters.sortBy);
        setSortOrder(filters.sortOrder);
        setSourceFilter(filters.sourceFilter);
        setRegionFilter(filters.regionFilter);
        setStartDate(filters.startDate);
        setEndDate(filters.endDate);
        setDepartureFilter(filters.departureFilter);
        setAirlineFilter(filters.airlineFilter);
        setFavFilter(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const openAccountFlight = (flightId: string) => {
        const flight = flights.find(item => item.id === flightId);
        if (!flight) {
            setFavToast('이 표는 현재 목록에서 내려갔어요. 저장 당시 정보는 내 여행에 남아 있어요.');
            setTimeout(() => setFavToast(null), 3000);
            return;
        }
        setShowAccount(false);
        openFlightDetail(flight, 'card_body');
    };

    const showSharedRouteAlternatives = () => {
        const fallback = sharedRouteFallback.current;
        const departure = fallback?.dep || '';
        const departureValue = /인천|김포|서울|ICN|GMP|SEL/i.test(departure) ? '인천'
            : /부산|김해|PUS/i.test(departure) ? '부산'
                : /대구|TAE/i.test(departure) ? '대구'
                    : /청주|CJJ/i.test(departure) ? '청주'
                        : /제주|CJU/i.test(departure) ? '제주'
                            : 'all';

        openedSharedFlightId.current = null;
        setSharedFlightId(null);
        resetAllFilters();
        if (fallback?.arr) setSearchTerm(fallback.arr);
        setDepartureFilter(departureValue);
        sharedRouteFallback.current = null;
    };

    // 홈으로 (인천/김포 + 기본 날짜 복원)
    const goHome = () => {
        setSearchTerm('');
        setSourceFilter('all');
        setRegionFilter('all');
        setAirlineFilter('all');
        setDepartureFilter('all');
        setStartDate(getDefaultStartDate());
        setEndDate(getDefaultEndDate());
        setSortBy('discount');
        setSharedFlightId(null);
        sharedRouteFallback.current = null;
    };

    // 활성 필터 여부
    const hasActiveFilters = searchTerm || sourceFilter !== 'all' || regionFilter !== 'all' ||
        airlineFilter !== 'all' || departureFilter !== 'all' || startDate || endDate;

    // 조건별 판정을 분리해 둔다 — 결과가 0건일 때 어느 조건이 막았는지 되짚어야 하기 때문
    //
    // 검색은 도시명만 본다. 항공사명까지 훑으면 도시명이 사명에 들어간 경우
    // (푸꾸옥/썬푸꾸옥항공, 부산/에어부산) 엉뚱한 노선이 섞인다. 항공사는 별도 드롭다운으로 고른다.
    const matchesSearchTerm = (flight: Flight) => {
        const term = searchTerm.toLowerCase();
        return flight.departure.city.toLowerCase().includes(term) ||
            flight.arrival.city.toLowerCase().includes(term) ||
            normalizeCity(flight.departure.city).toLowerCase().includes(term) ||
            normalizeCity(flight.arrival.city).toLowerCase().includes(term);
    };
    const matchesSourceFilter = (flight: Flight) => sourceFilter === 'all' || flight.source === sourceFilter;
    const matchesRegionFilter = (flight: Flight) => regionFilter === 'all' || flight.region === regionFilter;
    const matchesAirlineFilter = (flight: Flight) => airlineFilter === 'all' || normalizeAirline(flight.airline) === airlineFilter;
    const matchesDateFilter = (flight: Flight) => {
        const m = flight.departure.date?.match(/^(\d{4})[.\-](\d{2})[.\-](\d{2})/);
        const flightDate = m ? `${m[1]}-${m[2]}-${m[3]}` : (flight.departure.date || '');
        return (!startDate || flightDate >= startDate) && (!endDate || flightDate <= endDate);
    };
    const matchesDepartureFilter = (flight: Flight) => {
        if (departureFilter === 'all') return true;
        if (departureFilter === '인천') return /인천|김포|서울|ICN|GMP|SEL/.test(flight.departure.city);
        if (departureFilter === '부산') return /부산|김해|PUS/.test(flight.departure.city);
        return flight.departure.city.includes(departureFilter);
    };
    const matchesNonDateFilters = (flight: Flight) =>
        matchesSearchTerm(flight) && matchesSourceFilter(flight) && matchesRegionFilter(flight)
        && matchesAirlineFilter(flight) && matchesDepartureFilter(flight);
    const flightDateKey = (flight: Flight) => {
        const m = flight.departure.date?.match(/^(\d{4})[.\-](\d{2})[.\-](\d{2})/);
        return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
    };

    // 달력에 표시할 출발일별 최저가 (날짜를 뺀 나머지 필터 기준).
    // 목적지 없이 전체를 보는 기본 화면에서는 거의 모든 날에 표가 있고 최저가도
    // "아무 도시나 제일 싼 값"이라 오해만 부르므로 아무것도 표시하지 않는다.
    const hasNonDateFilter = !!searchTerm || sourceFilter !== 'all' || regionFilter !== 'all'
        || airlineFilter !== 'all' || departureFilter !== 'all';
    const dayMinPrices = useMemo(() => {
        const map = new Map<string, number>();
        if (!hasNonDateFilter) return map;
        flights.forEach(flight => {
            if (!matchesNonDateFilters(flight)) return;
            const key = flightDateKey(flight);
            const price = getEffectivePrice(flight);
            if (!key || price <= 0) return;
            const prev = map.get(key);
            if (prev === undefined || price < prev) map.set(key, price);
        });
        return map;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flights, hasNonDateFilter, searchTerm, sourceFilter, regionFilter, airlineFilter, departureFilter]);

    const calendarDayClassName = (date: Date) => {
        if (dayMinPrices.size === 0) return '';
        const key = toStr(date);
        if (key < toStr(new Date())) return '';
        return dayMinPrices.has(key) ? '' : styles.dayNoDeal;
    };
    const renderCalendarDay = (dayOfMonth: number, date?: Date) => {
        if (!date || dayMinPrices.size === 0) return dayOfMonth;
        const price = dayMinPrices.get(toStr(date));
        return (
            <div className={styles.dayCell}>
                <span>{dayOfMonth}</span>
                <span className={styles.dayPrice}>{price ? `${Math.floor(price / 10000)}만` : ''}</span>
            </div>
        );
    };

    // 방금 고른 범위로 몇 건이 보이게 되는지 — date_filter 이벤트에 실어 보낸다
    const countInDateRange = (start: string, end: string) => flights.reduce((n, f) => {
        if (!matchesNonDateFilters(f)) return n;
        const key = flightDateKey(f);
        return key && (!start || key >= start) && (!end || key <= end) ? n + 1 : n;
    }, 0);

    // 달력 안 빠른 선택 — 날짜만 바꾼다 (다른 필터는 건드리지 않는다)
    const dateRangePresets = useMemo(() => {
        const now = new Date();
        const day = now.getDay();
        // 이번 주말: 다가오는 토~일. 토요일이면 오늘~내일, 일요일이면 오늘 하루.
        const sat = new Date(now);
        sat.setDate(now.getDate() + (6 - day));
        const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
        const weekendStart = day === 0 ? now : sat;
        const weekendEnd = day === 0 ? now : sun;
        const nextMon = new Date(now); nextMon.setDate(now.getDate() + ((8 - day) % 7 || 7));
        const nextSun = new Date(nextMon); nextSun.setDate(nextMon.getDate() + 6);
        const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
        const presets = [
            { label: '이번 주말', start: toStr(weekendStart), end: toStr(weekendEnd) },
            { label: '다음 주', start: toStr(nextMon), end: toStr(nextSun) },
            { label: '이번 달', start: toStr(now), end: toStr(thisMonthEnd) },
            { label: '다음 달', start: toStr(nextMonthStart), end: toStr(nextMonthEnd) },
        ];
        return presets.filter(p => p.start <= p.end);
    }, []);

    const applyDatePreset = (preset: { label: string; start: string; end: string }) => {
        setStartDate(preset.start);
        setEndDate(preset.end);
        gtag.trackDateFilter(preset.start, preset.end, {
            method: 'preset', presetLabel: preset.label, resultCount: countInDateRange(preset.start, preset.end),
        });
    };
    const renderDatePresets = (onApplied?: () => void) => (
        <div className={styles.datePresetRow}>
            <div className={styles.datePresetChips}>
                {dateRangePresets.map(preset => (
                    <button
                        key={preset.label}
                        type="button"
                        className={styles.datePresetChip}
                        onClick={() => { applyDatePreset(preset); onApplied?.(); }}
                    >
                        {preset.label}
                    </button>
                ))}
            </div>
            <p className={styles.dateBasisNote}>
                출발일 기준으로 검색됩니다.
            </p>
        </div>
    );

    // 추천순(스마트 정렬) 점수 — 낮을수록 상위.
    // 먼저 신선한 외부 비교가 기준으로 구간을 나누고, 구간 안에서는 실질 가격과 기존 벤치마크를 종합한다.
    const recommendScoreState = useMemo(
        () => buildRecommendationScoreState(flights, interparkPrices),
        [flights, interparkPrices],
    );
    const recommendScores = recommendScoreState.scores;

    // 오늘의 표 — 파격적인 절대가격을 먼저 잡고, 없을 때 현재 판매 중인 전체 항공권에서 고른다.
    // 신규·가격 하락은 일반 후보의 동점일 때만 우선한다.
    const todayPick = useMemo(() => {
        if (!flights.length) return null;
        const ABSOLUTE_DROP_MAX = 150_000;
        const DEEP_DROP_MAX = 200_000;
        const DEEP_DROP_RATIO = 0.75;
        const COMPARISON_TOLERANCE = 1.05;
        const pad = (n: number) => String(n).padStart(2, '0');
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const yest = new Date(now);
        yest.setDate(now.getDate() - 1);
        const yestStr = `${yest.getFullYear()}-${pad(yest.getMonth() + 1)}-${pad(yest.getDate())}`;

        const sorted = flights.map(f => recommendScores.get(f.id) ?? Infinity).sort((a, b) => a - b);
        const cutoff = sorted[Math.floor(sorted.length * 0.2)] ?? Infinity;

        const parseDay = (value?: string) => {
            const matched = (value || '').replace(/\./g, '-').match(/(\d{4})-(\d{2})-(\d{2})/);
            return matched ? new Date(`${matched[1]}-${matched[2]}-${matched[3]}T00:00:00`) : null;
        };
        const LOCAL_AIRPORTS: Record<string, string> = { PUS: '부산', TAE: '대구', CJJ: '청주', CJU: '제주' };
        const monthAgo = new Date(now);
        monthAgo.setDate(now.getDate() - 30);
        const monthAgoStr = `${monthAgo.getFullYear()}-${pad(monthAgo.getMonth() + 1)}-${pad(monthAgo.getDate())}`;

        // 왜 이 표인지를 한 줄로. 외부 비교가는 쓰지 않는다 — 우리 가격 기록과 항공권 자체의 사실만.
        // 드문 사실일수록 앞에 둬서, 가장 눈에 띄는 근거가 뽑히게 한다.
        const describePick = (
            flight: Flight,
            history: Array<{ date: string; minPrice: number }> | undefined,
            dropAmount: number,
            isNew: boolean,
            isToday: boolean,
        ): string => {
            const payablePrice = getEffectivePrice(flight);
            const recent = (history || []).filter(entry => entry.date >= monthAgoStr);
            if (recent.length >= 7 && payablePrice <= Math.min(...recent.map(entry => entry.minPrice))) {
                return '최근 한 달 중 가장 싼 가격이에요';
            }
            if (dropAmount > 0) {
                return `${isToday ? '어제보다' : '어제 하루 새'} ${dropAmount.toLocaleString()}원 내렸어요`;
            }

            const departDay = parseDay(flight.departure.date);
            const returnDay = parseDay(flight.arrival.date);
            const departHour = Number((flight.departure.time || '').slice(0, 2));
            // 금요일 저녁에 떠나 일요일에 돌아오는 일정일 때만 쓴다
            if (departDay?.getDay() === 5 && departHour >= 17 && returnDay?.getDay() === 0) {
                return '연차 없이 다녀올 수 있는 일정이에요';
            }

            const localCity = LOCAL_AIRPORTS[flight.departure.airport || ''];
            if (localCity) return `${localCity}에서 바로 떠나는 표예요`;

            if (departDay) {
                const daysLeft = Math.round((departDay.getTime() - new Date(`${todayStr}T00:00:00`).getTime()) / 86400000);
                if (daysLeft >= 0 && daysLeft <= 3) return '3일 안에 떠날 수 있어요';
            }
            if (returnDay && departDay) {
                const nights = Math.round((returnDay.getTime() - departDay.getTime()) / 86400000);
                if (nights >= 4 && payablePrice < 300000) return `${nights}박 ${nights + 1}일을 30만원 아래로 다녀와요`;
            }
            if (payablePrice < 200000) return '20만원 아래로 다녀올 수 있어요';

            if (isNew) return `${isToday ? '오늘' : '어제'} 새로 올라온 표 중에서 골랐어요`;
            return `왕복 ${Math.floor(payablePrice / 10000)}만원대로 나온 항공권이에요`;
        };

        const findPick = (refStr: string, prevStr: string, isToday: boolean) => {
            let best: { flight: Flight; reason: string; score: number; changePriority: number } | null = null;
            for (const flight of flights) {
                if (!flight.price || flight.price <= 0) continue;
                const score = recommendScores.get(flight.id) ?? Infinity;
                if (score > cutoff) continue;

                const history = priceHistory[`${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`];
                const todayEntry = history?.find(entry => entry.date === refStr);
                const prevEntry = history?.find(entry => entry.date === prevStr);
                // 이 표가 기준일의 노선 최저가일 때만 "내렸다"고 말한다 (남의 하락을 빌려 쓰지 않기)
                const payablePrice = getEffectivePrice(flight);
                const dropAmount = todayEntry && prevEntry && prevEntry.minPrice > todayEntry.minPrice && payablePrice <= todayEntry.minPrice
                    ? prevEntry.minPrice - todayEntry.minPrice
                    : 0;
                const isNew = flight.firstSeen === refStr;
                const changePriority = dropAmount > 0 ? 2 : isNew ? 1 : 0;
                if (best && (score > best.score || (score === best.score && changePriority <= best.changePriority))) continue;

                const reason = describePick(flight, history, dropAmount, isNew, isToday);
                best = { flight, reason, score, changePriority };
            }
            return best;
        };

        const getMarketReference = (flight: Flight): number | null => {
            if (flight.naverLowest && flight.naverLowest > 0 && getComparisonFreshness(flight.naverCheckedAt).usable) {
                return flight.naverLowest;
            }
            const city = flight.arrival.city?.replace(/\([^)]+\)/, '').trim();
            const depMonth = flight.departure.date?.replace(/\./g, '-').replace(/\(.*\)/g, '').trim().substring(0, 7);
            const cityData = interparkPrices[city];
            let monthData = cityData?.[depMonth];
            if (!monthData && cityData && depMonth) {
                const closest = Object.keys(cityData).sort().reduce((best, month) => {
                    const diff = Math.abs(month.localeCompare(depMonth));
                    const bestDiff = best ? Math.abs(best.localeCompare(depMonth)) : Infinity;
                    return diff < bestDiff ? month : best;
                }, '' as string);
                if (closest) monthData = cityData[closest];
            }
            return monthData?.lowest || null;
        };

        const isExceptionalCandidate = (flight: Flight) => {
            const payablePrice = getEffectivePrice(flight);
            if (payablePrice <= 0 || payablePrice > DEEP_DROP_MAX) return false;
            const referencePrice = getMarketReference(flight);
            const absoluteDrop = payablePrice <= ABSOLUTE_DROP_MAX
                && (!referencePrice || payablePrice <= referencePrice * COMPARISON_TOLERANCE);
            const deepDrop = !!referencePrice && payablePrice <= referencePrice * DEEP_DROP_RATIO;
            return absoluteDrop || deepDrop;
        };

        const buildPick = (flight: Flight) => {
            const history = priceHistory[`${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`];
            const todayEntry = history?.find(entry => entry.date === todayStr);
            const prevEntry = history?.find(entry => entry.date === yestStr);
            const payablePrice = getEffectivePrice(flight);
            const dropAmount = todayEntry && prevEntry && prevEntry.minPrice > todayEntry.minPrice && payablePrice <= todayEntry.minPrice
                ? prevEntry.minPrice - todayEntry.minPrice
                : 0;
            const isNew = flight.firstSeen === todayStr;
            const defaultReason = describePick(flight, history, dropAmount, isNew, true);
            const exceptionalReason = flight.source === 'ttang'
                ? `발권수수료를 더해도 왕복 ${Math.floor(payablePrice / 10000)}만원대예요`
                : `왕복 ${Math.floor(payablePrice / 10000)}만원대로 나온 파격가예요`;
            return {
                flight,
                reason: isExceptionalCandidate(flight) ? exceptionalReason : defaultReason,
                score: recommendScores.get(flight.id) ?? Infinity,
                changePriority: dropAmount > 0 ? 2 : isNew ? 1 : 0,
            };
        };

        // 하루 한 번 고정된 표가 있어도 이후 크롤에서 진짜 파격가가 들어오면 즉시 교체한다.
        const exceptionalFlight = flights
            .filter(isExceptionalCandidate)
            .sort((a, b) => getEffectivePrice(a) - getEffectivePrice(b)
                || (recommendScores.get(a.id) ?? Infinity) - (recommendScores.get(b.id) ?? Infinity))[0];
        if (exceptionalFlight) return buildPick(exceptionalFlight);

        if (fixedTodayPickId) {
            const fixedFlight = flights.find(flight => flight.id === fixedTodayPickId);
            if (fixedFlight) return buildPick(fixedFlight);
        }

        return findPick(todayStr, yestStr, true);
    }, [flights, priceHistory, interparkPrices, recommendScores, fixedTodayPickId]);

    const filteredFlights = flights.filter(flight => {
        // 공유 링크로 접근 시 해당 항공편만 표시
        if (sharedFlightId) {
            // ID가 달라진 다른 항공권을 원본인 것처럼 자동으로 열지 않는다.
            // 원본이 없으면 만료 안내를 먼저 보여준 뒤 사용자가 같은 노선을 선택하게 한다.
            return flight.id === sharedFlightId;
        }

        const matchesFav = !favFilter || isFavoriteFlight(flight.id);

        return matchesSearchTerm(flight) && matchesSourceFilter(flight) && matchesRegionFilter(flight)
            && matchesAirlineFilter(flight) && matchesDateFilter(flight) && matchesDepartureFilter(flight)
            && matchesFav;
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
            case 'discountRate': {
                const getDiscountRate = (f: Flight) => {
                    const city = f.arrival.city?.replace(/\([^)]+\)/, '').trim();
                    const depMonth = f.departure.date?.replace(/\./g, '-').replace(/\(.*\)/g, '').trim().substring(0, 7);
                    const ipMonthData = interparkPrices[city]?.[depMonth];
                    if (ipMonthData?.avg && f.price > 0) {
                        return ((ipMonthData.avg - f.price) / ipMonthData.avg) * 100;
                    }
                    return -999;
                };
                comparison = getDiscountRate(b) - getDiscountRate(a);
                break;
            }
            case 'discount': {
                // 추천순은 신선한 비교가 이하를 먼저, 비교 불가를 그다음,
                // 신선한 비교가 초과를 마지막에 둔다. 각 그룹 안에서는 종합 품질점수를 유지한다.
                comparison = compareRecommendedFlights(a, b, recommendScores);
                break;
            }
        }

        return sortOrder === 'asc' ? comparison : -comparison;
    });

    // 결과가 0건인 이유를 가려낸다.
    // 검색어에 맞는 항공권이 있는데도 안 보이면 그건 "특가가 없는 것"이 아니라 필터가 막은 것이므로,
    // 알림을 권하기 전에 어떤 조건이 걸렸는지 먼저 알려준다.
    const emptyDiagnosis = useMemo(() => {
        if (filteredFlights.length > 0 || sharedFlightId || !searchTerm.trim()) return null;

        const byTerm = flights.filter(matchesSearchTerm);
        if (byTerm.length === 0) return { kind: 'noDeals' as const, blockers: [], available: 0 };

        const departureLabel = departureFilter === '인천' ? '인천/김포'
            : departureFilter === '부산' ? '부산/김해' : departureFilter;
        const blockers = [
            {
                id: 'region',
                label: `도착 지역 · ${regionFilter}`,
                active: regionFilter !== 'all',
                passes: byTerm.some(matchesRegionFilter),
                clear: () => setRegionFilter('all'),
            },
            {
                id: 'departure',
                label: `출발지 · ${departureLabel}`,
                active: departureFilter !== 'all',
                passes: byTerm.some(matchesDepartureFilter),
                clear: () => setDepartureFilter('all'),
            },
            {
                id: 'date',
                label: `출발일 · ${fmtDate(startDate)}~${fmtDate(endDate)}`,
                active: !!(startDate || endDate),
                passes: byTerm.some(matchesDateFilter),
                clear: () => { setStartDate(''); setEndDate(''); },
            },
            {
                id: 'airline',
                label: `항공사 · ${airlineFilter}`,
                active: airlineFilter !== 'all',
                passes: byTerm.some(matchesAirlineFilter),
                clear: () => setAirlineFilter('all'),
            },
            {
                id: 'source',
                label: `여행사 · ${getSourceName(sourceFilter)}`,
                active: sourceFilter !== 'all',
                passes: byTerm.some(matchesSourceFilter),
                clear: () => setSourceFilter('all'),
            },
        ].filter(b => b.active && !b.passes);

        return { kind: 'filtered' as const, blockers, available: byTerm.length };
    }, [filteredFlights.length, flights, searchTerm, sharedFlightId,
        regionFilter, departureFilter, airlineFilter, sourceFilter, startDate, endDate]);

    // 검색으로 목적지가 하나로 좁혀졌을 때만 알림을 제안한다.
    // 알림 등록에는 출발·도착 도시가 특정돼야 하고, 근거로 보여줄 최저가도 필요하다.
    const alertSuggestion = useMemo(() => {
        if (sharedFlightId || favFilter || !searchTerm.trim()) return null;

        if (filteredFlights.length > 0) {
            const priced = filteredFlights.filter(f => f.price > 0);
            if (priced.length === 0) return null;
            // 목적지가 둘 이상 섞여 있으면 "이 노선"이라고 말할 수 없다 (도쿄 나리타/하네다 등)
            if (new Set(priced.map(f => normalizeCity(f.arrival.city))).size !== 1) return null;
            const cheapest = priced.reduce((min, f) => (f.price < min.price ? f : min), priced[0]);
            return {
                mode: 'results' as const,
                departureCity: normalizeCity(cheapest.departure.city),
                arrivalCity: normalizeCity(cheapest.arrival.city),
                price: cheapest.price,
                flightId: cheapest.id,
            };
        }

        // 결과 0건 — 필터가 막은 경우가 아니라, 정말로 이 목적지 특가가 하나도 없을 때만 제안한다
        if (emptyDiagnosis?.kind !== 'noDeals') return null;
        const term = searchTerm.trim();
        const arrivalCity = normalizeCity(term);
        // 캐시에 없는 도시라 표기를 검증할 수 없으면 등록하지 않는다 (오타·항공사명 입력 방지)
        if (!CITY_TO_AIRPORT[term] && !CITY_TO_AIRPORT[arrivalCity]) return null;
        const departureCity = departureFilter === 'all' ? '인천' : normalizeCity(departureFilter);
        // 보여줄 항공권이 없으니 기준가는 인터파크 월평균이 있으면 쓰고, 없으면 직접 입력받는다
        const months = interparkPrices[arrivalCity] ? Object.values(interparkPrices[arrivalCity]) : [];
        const avg = months.length ? Math.round(months.reduce((s, m) => s + m.avg, 0) / months.length / 10000) * 10000 : null;
        return { mode: 'empty' as const, departureCity, arrivalCity, price: avg, flightId: null };
    }, [searchTerm, filteredFlights, sharedFlightId, favFilter, emptyDiagnosis, departureFilter, interparkPrices]);

    const alertRouteKey = alertSuggestion
        ? `route:${alertSuggestion.departureCity}-${alertSuggestion.arrivalCity}`
        : null;
    const alertPanelOpen = !!alertRouteKey && priceAlertSetup?.key === alertRouteKey;
    const showAlertCta = !!alertRouteKey && !dismissedAlertRoutes.includes(alertRouteKey);

    const openSuggestedPriceAlert = () => {
        if (!alertSuggestion || !alertRouteKey) return;
        openPriceAlert({
            key: alertRouteKey,
            entry: alertSuggestion.mode === 'results' ? 'filter_banner' : 'empty_state',
            departureCity: alertSuggestion.departureCity,
            arrivalCity: alertSuggestion.arrivalCity,
            // 빈 결과에서는 지금 보이는 항공권이 없으므로 기준가를 남기지 않는다
            ...(alertSuggestion.mode === 'results'
                ? { baseline: { flightId: alertSuggestion.flightId, price: alertSuggestion.price } }
                : {}),
            maxPrice: alertSuggestion.price,
        });
    };

    // 오늘의 표를 먼저 고른 뒤, 같은 목적지의 일반 카드는 추천 배열에서 분리한다.
    const pinnedTodayPick = todayPick && isDefaultView ? todayPick.flight : undefined;
    const recommendationPresentation = buildRecommendationPresentation(
        filteredFlights,
        recommendScoreState,
        {
            pinnedFlight: pinnedTodayPick,
            diversify: sortBy === 'discount' && !searchTerm,
            balanceIncheon: departureFilter === 'all',
        },
    );
    const diversifiedFlights = recommendationPresentation.orderedFlights;

    // 표시할 항공권 (무한 스크롤용)
    const hasPinnedTodayPick = !!todayPick && isDefaultView;
    const poolDisplayCount = Math.max(0, displayCount - (hasPinnedTodayPick ? 1 : 0));
    const displayedFlightsBase = diversifiedFlights.slice(0, poolDisplayCount);
    // 오늘의 표는 기본 화면에서 목록 맨 앞에 온다 — 일반 카드와 같은 모습, 위치와 표식만 특별하다
    const displayedFlights = hasPinnedTodayPick
        ? [todayPick!.flight, ...displayedFlightsBase]
        : displayedFlightsBase;
    const hasMore = poolDisplayCount < diversifiedFlights.length;

    // 공유 링크로 들어오면 해당 항공권의 상세 팝업을 바로 연다.
    useEffect(() => {
        if (!sharedFlightId || loading || openedSharedFlightId.current === sharedFlightId) return;

        const sharedFlight = flights.find((flight) => flight.id === sharedFlightId);

        if (!sharedFlight) return;
        openedSharedFlightId.current = sharedFlightId;
        openFlightDetail(sharedFlight, 'shared_link');
    }, [sharedFlightId, loading, flights]);

    // ============================================
    // Insight Bars — 카드 사이에 삽입되는 정보 바
    // ============================================
    const generateInsightBar = (barIndex: number) => {
        // 첫 영역에서는 가격표만으로 알기 어려운 낯선 목적지의 여행 맥락을 먼저 제안한다.
        const barOrder = [16, 2, 15, 11, 10, 8, 7, 6, 9, 14, 5];
        const barType = barOrder[barIndex % barOrder.length];

        // 공유 도시 이미지맵 & 카드 렌더러
        const cityImageMap: Record<string, string> = {
            // Japan
            '오사카': 'osaka', '도쿄': 'tokyo', '후쿠오카': 'fukuoka', '삿포로': 'sapporo',
            '나고야': 'nagoya', '나가사키': 'nagasaki', '구마모토': 'kumamoto',
            '다카마쓰': 'takamatsu', '다카마츠': 'takamatsu', '마츠야마': 'matsuyama',
            '오키나와': 'okinawa', '미야코지마': 'miyakojima', '이시가키': 'ishigaki',
            '시모지시마': 'shimojishima', '시즈오카': 'shizuoka', '나라': 'nara',
            '도야마': 'toyama', '하나마키': 'hanamaki', '하코다테': 'hakodate',
            '쿠마모토': 'kumamoto',
            // Vietnam
            '다낭': 'danang', '나트랑': 'nhatrang', '하노이': 'hanoi', '호치민': 'hochiminh',
            '푸꾸옥': 'phuquoc', '하이퐁': 'haiphong',
            // Thailand
            '방콕': 'bangkok', '푸켓': 'phuket', '치앙마이': 'chiangmai',
            // Philippines
            '세부': 'cebu', '보라카이': 'boracay', '보홀': 'bohol', '클락': 'clark', '칼리보': 'kalibo',
            // Taiwan
            '타이베이': 'taipei', '타이페이': 'taipei', '가오슝': 'kaohsiung', '대만': 'taipei',
            '타이중': 'taichung', '화련': 'hualien', '화롄': 'hualien',
            // China
            '상하이': 'shanghai', '상해': 'shanghai', '청도': 'qingdao', '칭다오': 'qingdao',
            '계림': 'guilin', '구이린': 'guilin', '장가계': 'zhangjiajie',
            '위해': 'weihai', '웨이하이': 'weihai', '연태': 'yantai', '옌타이': 'yantai',
            '제남': 'jinan', '지난': 'jinan',
            // Southeast Asia & Others
            '싱가포르': 'singapore', '홍콩': 'hongkong', '마카오': 'macau',
            '코타키나발루': 'kotakinabalu', '마나도': 'manado', '바탐': 'batam',
            '발리': 'bali', '비엔티엔': 'vientiane', '끄라비': 'krabi',
            '자카르타': 'jakarta', '쿠알라룸푸르': 'kualalumpur', '양곤': 'yangon',
            '시엠립': 'siemreap', '프놈펜': 'phnompenh', '코사무이': 'kosamui',
            // Pacific
            '괌': 'guam', '사이판': 'saipan', '호놀룰루': 'honolulu',
            // Europe
            '두바이': 'dubai', '이스탄불': 'istanbul', '로마': 'rome',
            '브리즈번': 'brisbane', '시드니': 'sydney', '런던': 'london', '울란바토르': 'ulaanbaatar',
            '파리': 'paris', '바르셀로나': 'barcelona', '암스테르담': 'amsterdam',
            '프라하': 'prague', '밀라노': 'milan', '아테네': 'athens',
            '부다페스트': 'budapest', '빈': 'vienna', '비엔나': 'vienna',
            '헬싱키': 'helsinki', '코펜하겐': 'copenhagen', '프랑크푸르트': 'frankfurt',
            '리스본': 'lisbon', '블라디보스토크': 'vladivostok',
            // Americas
            '뉴욕': 'newyork',
            // Central Asia
            '알마티': 'almaty',
            // India
            '델리': 'delhi',
            // Americas (more)
            '라스베이거스': 'lasvegas', '샌프란시스코': 'sanfrancisco',
            '시카고': 'chicago', '캔쿤': 'cancun',
            // Europe (more)
            '뮌헨': 'munich', '베를린': 'berlin', '두브로브니크': 'dubrovnik',
            '산토리니': 'santorini', '스톡홀름': 'stockholm', '취리히': 'zurich',
            // China (more)
            '베이징': 'beijing', '청두': 'chengdu', '싼야': 'sanya', '쿤밍': 'kunming',
            // Japan (more)
            '가고시마': 'kagoshima', '센다이': 'sendai', '미야자키': 'miyazaki',
            // Southeast Asia (more)
            '달랏': 'dalat', '랑카위': 'langkawi', '페낭': 'penang',
            '카트만두': 'kathmandu', '루앙프라방': 'luangprabang', '후에': 'hue',
            // Resort
            '몰디브': 'maldives',
            // Aliases with chitose
            '치토세': 'sapporo',
            // Seasonal / domestic
            '교토': 'kyoto', '하코네': 'hakone', '유후인': 'yufuin',
            '히로시마': 'hiroshima', '나하': 'naha', '부산': 'busan', '제주': 'jeju',
            '기타큐슈': 'kitakyushu', '고베': 'kobe', '마닐라': 'manila', '울란바타르': 'ulaanbaatar',
            // 추가 도시 썸네일
            '도쿠시마': 'tokushima', '오이타': 'oita', '오카야마': 'okayama',
            '후허하오터': 'hohhot', '인촨': 'yinchuan', '부지': 'fuji', '오비히로': 'obihiro',
        };
        const regionGradients: Record<string, string> = {
            '일본': 'linear-gradient(135deg, #e84393 0%, #a855f7 100%)',
            '동남아': 'linear-gradient(135deg, #0891b2 0%, #059669 100%)',
            '중국': 'linear-gradient(135deg, #dc2626 0%, #f59e0b 100%)',
            '대만': 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
            '유럽': 'linear-gradient(135deg, #7c3aed 0%, #db2777 100%)',
            '대양주': 'linear-gradient(135deg, #ea580c 0%, #d97706 100%)',
            '미주': 'linear-gradient(135deg, #4338ca 0%, #7c3aed 100%)',
            '중동': 'linear-gradient(135deg, #b45309 0%, #dc2626 100%)',
            '중앙아시아': 'linear-gradient(135deg, #0e7490 0%, #2563eb 100%)',
            '아프리카': 'linear-gradient(135deg, #9333ea 0%, #4f46e5 100%)',
            '남태평양': 'linear-gradient(135deg, #0d9488 0%, #0284c7 100%)',
            '기타': 'linear-gradient(135deg, #475569 0%, #6366f1 100%)',
        };
        const cityRegionMap: Record<string, string> = {};
        flights.forEach(f => {
            const base = (f.arrival?.city || '').replace(/\(.+\)/, '').trim();
            if (base && f.region) cityRegionMap[base] = f.region;
        });
        const getCityBackground = (city: string): { bg: string; hasVisual: boolean } => {
            const base = city.replace(/\(.+\)/, '').trim();
            const imgKey = cityImageMap[base];
            if (imgKey) return { bg: `url(/images/cities/${imgKey}.png)`, hasVisual: true };
            const region = cityRegionMap[base];
            const gradient = regionGradients[region] || regionGradients['기타'];
            return { bg: gradient, hasVisual: true };
        };
        const renderCityCard = (key: string, city: string, line1: string, line2: string, onClick: (e: React.MouseEvent) => void) => {
            const { bg, hasVisual } = getCityBackground(city);
            return (
                <div
                    key={key}
                    className={`${styles.newFlightMiniCard} ${hasVisual ? styles.newFlightMiniCardImg : ''}`}
                    style={hasVisual ? { backgroundImage: bg } : undefined}
                    onClick={onClick}
                >
                    {hasVisual && <div className={styles.newFlightOverlay} />}
                    <div className={styles.newFlightRoute} style={hasVisual ? { color: 'white', position: 'relative', zIndex: 1, textShadow: '0 1px 4px rgba(0,0,0,0.5)' } : undefined}>{city}</div>
                    <div className={styles.newFlightPrice} style={hasVisual ? { color: 'white', position: 'relative', zIndex: 1, textShadow: '0 1px 4px rgba(0,0,0,0.5)', fontWeight: 800 } : undefined}>{line1}</div>
                    <div className={styles.newFlightAirline} style={hasVisual ? { color: 'rgba(255,255,255,0.9)', position: 'relative', zIndex: 1, textShadow: '0 1px 3px rgba(0,0,0,0.4)' } : undefined}>{line2}</div>
                </div>
            );
        };
        const renderCardBar = (barIdx: number, icon: string, title: string, cards: React.ReactNode) => {
            const scrollerId = `scroller-${barIdx}`;
            const scrollBy = (dir: number) => {
                const el = document.getElementById(scrollerId);
                if (el) el.scrollBy({ left: dir * 200, behavior: 'smooth' });
            };
            return (
                <div key={`insight-${barIdx}`} className={`${styles.insightBar} ${styles.insightBarNew}`}>
                    <div className={styles.newFlightHeader}>
                        <span>{icon} {title}</span>
                    </div>
                    <div className={styles.scrollerWrap}>
                        <button className={`${styles.scrollBtn} ${styles.scrollBtnLeft}`} onClick={(e) => { e.stopPropagation(); scrollBy(-1); }} aria-label="이전">‹</button>
                        <div id={scrollerId} className={styles.newFlightScroller}
                            onMouseDown={(e) => {
                                const el = e.currentTarget;
                                el.dataset.dragging = 'true';
                                el.dataset.dragged = 'false';
                                el.dataset.startX = String(e.pageX);
                                el.dataset.scrollLeft = String(el.scrollLeft);
                                el.dataset.prevX = String(e.pageX);
                                el.dataset.prevTime = String(Date.now());
                                el.dataset.velocity = '0';
                                el.style.cursor = 'grabbing';
                                el.style.userSelect = 'none';
                            }}
                            onMouseMove={(e) => {
                                const el = e.currentTarget;
                                if (el.dataset.dragging !== 'true') return;
                                const dx = e.pageX - Number(el.dataset.startX);
                                el.scrollLeft = Number(el.dataset.scrollLeft) - dx;
                                if (Math.abs(dx) > 5) {
                                    el.dataset.dragged = 'true';
                                    el.style.pointerEvents = 'auto';
                                    el.querySelectorAll<HTMLElement>(':scope > *').forEach(c => c.style.pointerEvents = 'none');
                                }
                                const now = Date.now();
                                const dt = now - Number(el.dataset.prevTime);
                                if (dt > 0) {
                                    el.dataset.velocity = String((e.pageX - Number(el.dataset.prevX)) / dt);
                                }
                                el.dataset.prevX = String(e.pageX);
                                el.dataset.prevTime = String(now);
                            }}
                            onMouseUp={(e) => {
                                const el = e.currentTarget;
                                el.dataset.dragging = 'false';
                                el.style.cursor = '';
                                el.style.userSelect = '';
                                let v = Number(el.dataset.velocity) * 15;
                                const glide = () => {
                                    if (Math.abs(v) < 0.5) {
                                        el.querySelectorAll<HTMLElement>(':scope > *').forEach(c => c.style.pointerEvents = '');
                                        return;
                                    }
                                    el.scrollLeft -= v;
                                    v *= 0.92;
                                    requestAnimationFrame(glide);
                                };
                                if (el.dataset.dragged === 'true') {
                                    requestAnimationFrame(glide);
                                } else {
                                    el.querySelectorAll<HTMLElement>(':scope > *').forEach(c => c.style.pointerEvents = '');
                                }
                            }}
                            onMouseLeave={(e) => {
                                const el = e.currentTarget;
                                if (el.dataset.dragging === 'true') {
                                    el.dataset.dragging = 'false';
                                    el.style.cursor = '';
                                    el.style.userSelect = '';
                                    let v = Number(el.dataset.velocity) * 15;
                                    const glide = () => {
                                        if (Math.abs(v) < 0.5) {
                                            el.querySelectorAll<HTMLElement>(':scope > *').forEach(c => c.style.pointerEvents = '');
                                            return;
                                        }
                                        el.scrollLeft -= v;
                                        v *= 0.92;
                                        requestAnimationFrame(glide);
                                    };
                                    requestAnimationFrame(glide);
                                }
                            }}
                        >
                            {cards}
                        </div>
                        <button className={`${styles.scrollBtn} ${styles.scrollBtnRight}`} onClick={(e) => { e.stopPropagation(); scrollBy(1); }} aria-label="다음">›</button>
                    </div>
                </div>
            );
        };

        switch (barType) {
            case 16: { // 🧭 낯선 여행지 발견
                const candidate = diversifiedFlights.find(flight => {
                    const context = getDestinationContext(flight.arrival.city);
                    return !!context;
                });
                if (!candidate) return null;
                const context = getDestinationContext(candidate.arrival.city);
                if (!context) return null;
                const departure = normalizeCity(candidate.departure.city);
                const arrival = normalizeCity(candidate.arrival.city);
                return (
                    <button
                        key={`insight-${barIndex}`}
                        type="button"
                        className={styles.destinationDiscoveryBar}
                        onClick={(event) => {
                            event.stopPropagation();
                            openFlightDetail(candidate, 'discovery_bar');
                        }}
                    >
                        <span className={styles.destinationDiscoveryIcon} aria-hidden="true">🧭</span>
                        <span className={styles.destinationDiscoveryCopy}>
                            <span className={styles.destinationDiscoveryEyebrow}>여행지 발견</span>
                            <strong>{arrival}, 이런 곳이에요</strong>
                            <span>{context.location}</span>
                        </span>
                        <span className={styles.destinationDiscoveryDeal}>
                            <strong>{departure} 출발 · {formatPrice(candidate.price)}</strong>
                            <span>위치와 일정 보기 →</span>
                        </span>
                    </button>
                );
            }
            case 1: { // 🌏 지역별 현황
                const regionCounts: Record<string, number> = {};
                flights.forEach(f => {
                    if (f.region) {
                        regionCounts[f.region] = (regionCounts[f.region] || 0) + 1;
                    }
                });
                const regions = Object.entries(regionCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
                if (regions.length === 0) return null;
                return (
                    <div key={`insight-${barIndex}`} className={styles.insightBar}>
                        <span className={styles.insightIcon}>🌏</span>
                        <div className={styles.insightContent}>
                            {regions.map(([region, count]) => (
                                <span
                                    key={region}
                                    className={styles.insightChip}
                                    onClick={(e) => { e.stopPropagation(); setRegionFilter(region); setDepartureFilter('all'); setStartDate(''); setEndDate(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                >
                                    {region} <span className={styles.insightChipCount}>{count}건</span>
                                </span>
                            ))}
                        </div>
                    </div>
                );
            }
            case 2: { // 🗺️ 도시 바로가기
                if (popularCities.length === 0) return null;
                return renderCardBar(barIndex, '🗺️', '인기 도시', popularCities.map(city => {
                    const nc = normalizeCity(city);
                    const cityFlights = flights.filter(f => normalizeCity(f.arrival.city) === nc);
                    const minP = cityFlights.length > 0 ? Math.min(...cityFlights.map(f => f.price)) : 0;
                    return renderCityCard(city, nc, minP > 0 ? `${Math.floor(minP / 10000)}만원~` : '', `${cityFlights.length}건`, (e) => { e.stopPropagation(); setSearchTerm(city); setStartDate(''); setEndDate(''); setDepartureFilter('all'); setRegionFilter('all'); setSortBy('price'); setSortOrder('asc'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
                }));
            }
            case 3: { // ✈️ 항공사별 최저가
                const airlinePrices: Record<string, number> = {};
                flights.forEach(f => {
                    if (f.airline && f.price > 0 && (!airlinePrices[f.airline] || f.price < airlinePrices[f.airline])) {
                        airlinePrices[f.airline] = f.price;
                    }
                });
                const topAirlines = Object.entries(airlinePrices).sort((a, b) => a[1] - b[1]).slice(0, 4);
                if (topAirlines.length === 0) return null;
                return (
                    <div key={`insight-${barIndex}`} className={styles.insightBar}>
                        <span className={styles.insightIcon}>✈️</span>
                        <div className={styles.insightContent}>
                            <span>항공사별 최저가 —</span>
                            {topAirlines.map(([airline, price]) => (
                                <span
                                    key={airline}
                                    className={styles.insightChip}
                                    onClick={(e) => { e.stopPropagation(); setAirlineFilter(airline); setStartDate(''); setEndDate(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                >
                                    {airline} <strong>{Math.floor(price / 10000)}만원~</strong>
                                </span>
                            ))}
                        </div>
                    </div>
                );
            }
            case 4: { // 📅 출발 시기별
                const now = new Date();
                const thisWeekEnd = new Date(now);
                thisWeekEnd.setDate(now.getDate() + (7 - now.getDay()));
                const nextWeekEnd = new Date(thisWeekEnd);
                nextWeekEnd.setDate(thisWeekEnd.getDate() + 7);
                const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);

                let thisWeek = 0, nextWeek = 0, thisMonth = 0, nextMonth = 0;
                flights.forEach(f => {
                    const d = new Date(f.departure.date?.replace(/\./g, '-') || '');
                    if (isNaN(d.getTime())) return;
                    if (d <= thisWeekEnd) thisWeek++;
                    else if (d <= nextWeekEnd) nextWeek++;
                    if (d <= thisMonthEnd) thisMonth++;
                    else if (d <= nextMonthEnd) nextMonth++;
                });

                const chips: Array<{ label: string; count: number; start: string; end: string }> = [];
                if (thisWeek > 0) chips.push({ label: '이번 주 출발', count: thisWeek, start: toStr(now), end: toStr(thisWeekEnd) });
                if (nextWeek > 0) chips.push({ label: '다음 주 출발', count: nextWeek, start: toStr(thisWeekEnd), end: toStr(nextWeekEnd) });
                if (thisMonth > 0) chips.push({ label: '이번 달', count: thisMonth, start: toStr(now), end: toStr(thisMonthEnd) });
                if (nextMonth > 0) chips.push({ label: '다음 달', count: nextMonth, start: toStr(thisMonthEnd), end: toStr(nextMonthEnd) });

                if (chips.length === 0) return null;
                return (
                    <div key={`insight-${barIndex}`} className={styles.insightBar}>
                        <span className={styles.insightIcon}>📅</span>
                        <div className={styles.insightContent}>
                            {chips.slice(0, 4).map(chip => (
                                <span
                                    key={chip.label}
                                    className={styles.insightChip}
                                    // 날짜만 바꾼다 — 예전엔 출발지·도착지까지 초기화해서 걸어둔 필터가 날아갔다
                                    onClick={(e) => { e.stopPropagation(); applyDatePreset({ label: chip.label, start: chip.start, end: chip.end }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                >
                                    {chip.label} <span className={styles.insightChipCount}>{chip.count}건</span>
                                </span>
                            ))}
                        </div>
                    </div>
                );
            }
            case 5: { // 📝 여행 팁
                return renderCardBar(barIndex, '📝', '여행 꿀팁', tipPosts.map((post, i) => (
                    <a
                        key={`tip-${i}`}
                        href={`/tips/${post.slug}`}
                        className={styles.newFlightMiniCard}
                        style={{ textDecoration: 'none', color: 'inherit', padding: '14px 18px', maxWidth: '180px' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className={styles.newFlightRoute} style={{ fontSize: '0.93rem', whiteSpace: 'normal' }}>{post.emoji} {post.title}</div>
                        <div className={styles.newFlightAirline}>읽어보기 →</div>
                    </a>
                )));
            }
            case 6: { // 🔥 역대급 할인 Top 5
                const discountFlights: Array<{ flight: Flight; percent: number }> = [];
                flights.forEach(f => {
                    const city = f.arrival.city?.replace(/\([^)]+\)/, '').trim();
                    const depMonth = f.departure.date?.replace(/\./g, '-').replace(/\(.*\)/g, '').trim().substring(0, 7);
                    const ipMonthData = interparkPrices[city]?.[depMonth];
                    if (ipMonthData?.avg && f.price > 0) {
                        const percent = ((ipMonthData.avg - f.price) / ipMonthData.avg) * 100;
                        if (percent >= 10) {
                            discountFlights.push({ flight: f, percent });
                        }
                    }
                });
                // 할인율 내림차순 → 같은 도시 중복 제거 → Top 5
                discountFlights.sort((a, b) => b.percent - a.percent);
                const seenCities = new Set<string>();
                const top5 = discountFlights.filter(({ flight }) => {
                    const city = normalizeCity(flight.arrival.city);
                    if (seenCities.has(city)) return false;
                    seenCities.add(city);
                    return true;
                }).slice(0, 7);
                if (top5.length === 0) return null;
                return renderCardBar(barIndex, '🔥', '할인율 높은 항공권 Top 7', top5.map(({ flight, percent }) => {
                    const city = normalizeCity(flight.arrival.city);
                    const depDate = flight.departure.date?.replace(/\./g, '-').replace(/\(.*\)/g, '').trim().substring(0, 10) || '';
                    return renderCityCard(flight.id, city, `${Math.floor(flight.price / 10000)}만원`, `-${Math.round(percent)}%`, (e) => { e.stopPropagation(); setSearchTerm(city); setStartDate(''); setEndDate(''); setSortBy('price'); setSortOrder('asc'); setDepartureFilter('all'); setRegionFilter('all'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
                }));
            }
            case 7: { // 💨 곧 출발
                const now7 = new Date();
                const toDateStr7 = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                const tomorrow7 = new Date(now7); tomorrow7.setDate(now7.getDate() + 1);
                const day3 = new Date(now7); day3.setDate(now7.getDate() + 3);
                const tomorrowStr7 = toDateStr7(tomorrow7);
                const day3Str7 = toDateStr7(day3);

                const soonFlights: Flight[] = [];
                flights.forEach(f => {
                    const fd = f.departure.date?.replace(/\./g, '-').replace(/\(.*\)/g, '').trim().substring(0, 10);
                    if (!fd) return;
                    if (fd >= tomorrowStr7 && fd <= day3Str7) soonFlights.push(f);
                });
                if (soonFlights.length === 0) return null;
                soonFlights.sort((a, b) => a.price - b.price);
                const seen7 = new Set<string>();
                const unique7 = soonFlights.filter(f => {
                    const city = normalizeCity(f.arrival.city);
                    if (seen7.has(city)) return false;
                    seen7.add(city);
                    return true;
                }).slice(0, 10);
                return renderCardBar(barIndex, '💨', '3일 이내 바로 떠날 수 있는 곳', unique7.map(f => {
                    const city = normalizeCity(f.arrival.city);
                    const fd = f.departure.date?.replace(/\./g, '-').replace(/\(.*\)/g, '').trim().substring(0, 10) || '';
                    return renderCityCard(f.id, city, `${Math.floor(f.price / 10000)}만원~`, '곧 출발', (e) => { e.stopPropagation(); setSearchTerm(city); setStartDate(''); setEndDate(''); setSortBy('price'); setSortOrder('asc'); setDepartureFilter('all'); setRegionFilter('all'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
                }));
            }
            case 9: { // ☀️ 주말 출발
                const weekendFlights9: Flight[] = [];
                flights.forEach(f => {
                    const fd = f.departure.date?.replace(/\./g, '-').replace(/\(.*\)/g, '').trim().substring(0, 10);
                    if (!fd) return;
                    const dt = new Date(fd);
                    if (isNaN(dt.getTime())) return;
                    const day = dt.getDay();
                    if (day === 0 || day === 6) weekendFlights9.push(f);
                });
                if (weekendFlights9.length === 0) return null;
                weekendFlights9.sort((a, b) => a.price - b.price);
                const seen9 = new Set<string>();
                const unique9 = weekendFlights9.filter(f => {
                    const city = normalizeCity(f.arrival.city);
                    if (seen9.has(city)) return false;
                    seen9.add(city);
                    return true;
                }).slice(0, 10);
                return renderCardBar(barIndex, '☀️', '주말 출발 특가', unique9.map(f => {
                    const city = normalizeCity(f.arrival.city);
                    return renderCityCard(f.id, city, `${Math.floor(f.price / 10000)}만원~`, '주말 출발', (e) => { e.stopPropagation(); setSearchTerm(city); setStartDate(''); setEndDate(''); setSortBy('price'); setSortOrder('asc'); setDepartureFilter('all'); setRegionFilter('all'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
                }));
            }
            case 10: { // 💸 20만원 이하
                const cheapFlights: Flight[] = [];
                flights.forEach(f => {
                    if (f.price > 0 && f.price < 200000) cheapFlights.push(f);
                });
                if (cheapFlights.length === 0) return null;
                cheapFlights.sort((a, b) => a.price - b.price);
                const seen10 = new Set<string>();
                const unique10 = cheapFlights.filter(f => {
                    const city = normalizeCity(f.arrival.city);
                    if (seen10.has(city)) return false;
                    seen10.add(city);
                    return true;
                }).slice(0, 5);
                return renderCardBar(barIndex, '💸', '20만원 이하로 갈 수 있는 곳', unique10.map(f => {
                    const city = normalizeCity(f.arrival.city);
                    return renderCityCard(f.id, city, `${Math.floor(f.price / 10000)}만원`, '20만원 이하', (e) => { e.stopPropagation(); setSearchTerm(city); setStartDate(''); setEndDate(''); setSortBy('price'); setSortOrder('asc'); setDepartureFilter('all'); setRegionFilter('all'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
                }));
            }
            case 8: { // 🌙 금요일 출발
                const friFlights8: Array<{ flight: Flight; time: string }> = [];
                flights.forEach(f => {
                    const dateStr = f.departure.date?.replace(/\./g, '-').replace(/\(.*\)/g, '').trim().substring(0, 10);
                    if (!dateStr) return;
                    const d = new Date(dateStr);
                    if (isNaN(d.getTime())) return;
                    if (d.getDay() === 5 && f.price > 0) {
                        friFlights8.push({ flight: f, time: f.departure?.time || '' });
                    }
                });
                if (friFlights8.length === 0) return null;
                friFlights8.sort((a, b) => a.flight.price - b.flight.price);
                const seenCities8 = new Set<string>();
                const uniqueFri8 = friFlights8.filter(({ flight }) => {
                    const city = normalizeCity(flight.arrival.city);
                    if (seenCities8.has(city)) return false;
                    seenCities8.add(city);
                    return true;
                }).slice(0, 10);
                return renderCardBar(barIndex, '🌙', '금요일 출발 특가', uniqueFri8.map(({ flight }) => {
                    const city = normalizeCity(flight.arrival.city);
                    const friDate = flight.departure.date?.replace(/\./g, '-').replace(/\(.*\)/g, '').trim().substring(0, 10) || '';
                    return renderCityCard(flight.id, city, `${Math.floor(flight.price / 10000)}만원~`, '금요일 밤', (e) => { e.stopPropagation(); setSearchTerm(city); setStartDate(''); setEndDate(''); setSortBy('price'); setSortOrder('asc'); setDepartureFilter('all'); setRegionFilter('all'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
                }));
            }
            case 11: { // 📉 가격 하락 노선
                const today11 = new Date();
                const todayStr11 = `${today11.getFullYear()}-${String(today11.getMonth() + 1).padStart(2, '0')}-${String(today11.getDate()).padStart(2, '0')}`;
                const yesterday11 = new Date(today11);
                yesterday11.setDate(today11.getDate() - 1);
                const yesterdayStr11 = `${yesterday11.getFullYear()}-${String(yesterday11.getMonth() + 1).padStart(2, '0')}-${String(yesterday11.getDate()).padStart(2, '0')}`;

                type PriceDrop = { route: string; city: string; todayPrice: number; yesterdayPrice: number; drop: number };
                const drops: PriceDrop[] = [];

                for (const [route, history] of Object.entries(priceHistory)) {
                    if (!history || history.length < 2) continue;
                    const todayEntry = history.find(h => h.date === todayStr11);
                    const yesterdayEntry = history.find(h => h.date === yesterdayStr11);
                    if (!todayEntry || !yesterdayEntry) continue;
                    const drop = yesterdayEntry.minPrice - todayEntry.minPrice;
                    if (drop > 0) {
                        // 노선명에서 도시 추출: "부산-세부" → "세부", normalizeCity로 통일
                        const city = normalizeCity(route.split('-')[1] || route);
                        drops.push({ route, city, todayPrice: todayEntry.minPrice, yesterdayPrice: yesterdayEntry.minPrice, drop });
                    }
                }

                if (drops.length === 0) return null;
                // 하락폭 큰 순, 도시 중복 제거
                drops.sort((a, b) => b.drop - a.drop);
                const seenCities11 = new Set<string>();
                const topDrops = drops.filter(d => {
                    const nc = normalizeCity(d.city);
                    if (seenCities11.has(nc)) return false;
                    seenCities11.add(nc);
                    return true;
                }).slice(0, 5);

                return renderCardBar(barIndex, '📉', '어제보다 가격 내린 항공권', topDrops.map(d =>
                    renderCityCard(d.route, d.city, `${Math.floor(d.todayPrice / 10000)}만원`, `↓${Math.floor(d.drop / 10000)}만원`, (e) => { e.stopPropagation(); setSearchTerm(d.city); setStartDate(''); setEndDate(''); setSortBy('price'); setSortOrder('asc'); setDepartureFilter('all'); setRegionFilter('all'); window.scrollTo({ top: 0, behavior: 'smooth' }); })
                ));
            }
            case 12: { // 👀 인기 항공권 (목적지별 항공편 수 기준)
                const destCounts: Record<string, { count: number; minPrice: number }> = {};
                flights.forEach(f => {
                    const city = normalizeCity(f.arrival.city);
                    if (!destCounts[city]) destCounts[city] = { count: 0, minPrice: f.price };
                    destCounts[city].count++;
                    if (f.price < destCounts[city].minPrice) destCounts[city].minPrice = f.price;
                });
                const popular = Object.entries(destCounts)
                    .sort((a, b) => b[1].count - a[1].count)
                    .slice(0, 5);
                if (popular.length === 0) return null;
                return (
                    <div key={`insight-${barIndex}`} className={styles.insightBar}>
                        <span className={styles.insightIcon}>👀</span>
                        <div className={styles.insightContent}>
                            <span>오늘 항공권 많은 도시 —</span>
                            {popular.map(([city, data]) => (
                                <span
                                    key={city}
                                    className={styles.insightChip}
                                    onClick={(e) => { e.stopPropagation(); setSearchTerm(city); setSortBy('price'); setSortOrder('asc'); setStartDate(''); setEndDate(''); setDepartureFilter('all'); setRegionFilter('all'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                >
                                    {city} <span className={styles.insightChipCount}>{data.count}건</span>
                                </span>
                            ))}
                        </div>
                    </div>
                );
            }
            case 14: { // 🌸 계절 추천
                const month = new Date().getMonth() + 1;
                type SeasonRec = { emoji: string; city: string; reason: string };
                const seasonMap: Record<number, { title: string; recs: SeasonRec[] }> = {
                    1: {
                        title: '1월 여행 추천', recs: [
                            { emoji: '❄️', city: '삿포로', reason: '눈축제' },
                            { emoji: '🏖️', city: '다낭', reason: '건기 시작' },
                            { emoji: '🌴', city: '방콕', reason: '건기 여행' },
                            { emoji: '⛷️', city: '나세라', reason: '강설 코스' },
                        ]
                    },
                    2: {
                        title: '2월 여행 추천', recs: [
                            { emoji: '🌺', city: '다낭', reason: '꽃 시즌' },
                            { emoji: '🌴', city: '세부', reason: '건기 여행' },
                            { emoji: '🌞', city: '푸켓', reason: '건기 성수기' },
                            { emoji: '🌴', city: '방콕', reason: '건기 여행' },
                        ]
                    },
                    3: {
                        title: '3월 여행 추천', recs: [
                            { emoji: '🌸', city: '후쿠오카', reason: '벚꽃 시작' },
                            { emoji: '🏖️', city: '다낭', reason: '건기 여행' },
                            { emoji: '🌺', city: '타이페이', reason: '벚꽃 시즌' },
                            { emoji: '🌴', city: '세부', reason: '건기 끝무렵' },
                        ]
                    },
                    4: {
                        title: '4월 여행 추천', recs: [
                            { emoji: '🌸', city: '도쿄', reason: '벚꽃 절정' },
                            { emoji: '🌸', city: '오사카', reason: '벚꽃 절정' },
                            { emoji: '🌿', city: '다낭', reason: '건기 여행' },
                            { emoji: '🏖️', city: '보라카이', reason: '바다 시즌' },
                        ]
                    },
                    5: {
                        title: '5월 여행 추천', recs: [
                            { emoji: '🌿', city: '오키나와', reason: '우기 전 바다' },
                            { emoji: '🌺', city: '다낭', reason: '건기 마지막' },
                            { emoji: '🏖️', city: '발리', reason: '건기 여행' },
                            { emoji: '🌞', city: '타이페이', reason: '망고 시즌' },
                        ]
                    },
                    6: {
                        title: '6월 여행 추천', recs: [
                            { emoji: '🏖️', city: '오키나와', reason: '우기 전 마지막' },
                            { emoji: '🌿', city: '후쿠오카', reason: '매실 전 여유' },
                            { emoji: '🏖️', city: '괌', reason: '건기 여행' },
                            { emoji: '🌞', city: '런던', reason: '여름 시작' },
                        ]
                    },
                    7: {
                        title: '7월 여행 추천', recs: [
                            { emoji: '🏖️', city: '세부', reason: '우기 피한 해변' },
                            { emoji: '🌊', city: '괌', reason: '투명 바다' },
                            { emoji: '🌞', city: '런던', reason: '여름 여행' },
                            { emoji: '🏔️', city: '울란바토르', reason: '초원 여행' },
                        ]
                    },
                    8: {
                        title: '8월 여행 추천', recs: [
                            { emoji: '🏖️', city: '사이판', reason: '투명 바다' },
                            { emoji: '🌊', city: '발리', reason: '건기 여행' },
                            { emoji: '🏖️', city: '다낭', reason: '우기지만 저렴' },
                            { emoji: '🌞', city: '로마', reason: '유럽 여행' },
                        ]
                    },
                    9: {
                        title: '9월 여행 추천', recs: [
                            { emoji: '🍁', city: '오사카', reason: '가을 여행' },
                            { emoji: '🌿', city: '다낭', reason: '우기 끝무렵' },
                            { emoji: '🏖️', city: '세부', reason: '비수기 특가' },
                            { emoji: '🌞', city: '방콕', reason: '비수기 특가' },
                        ]
                    },
                    10: {
                        title: '10월 여행 추천', recs: [
                            { emoji: '🍁', city: '도쿄', reason: '단풍 여행' },
                            { emoji: '🌿', city: '다낭', reason: '건기 시작' },
                            { emoji: '🏖️', city: '푸켓', reason: '건기 시작' },
                            { emoji: '🌞', city: '발리', reason: '건기 여행' },
                        ]
                    },
                    11: {
                        title: '11월 여행 추천', recs: [
                            { emoji: '🍁', city: '나라', reason: '단풍 마지막' },
                            { emoji: '🌴', city: '다낭', reason: '건기 여행' },
                            { emoji: '🏖️', city: '세부', reason: '건기 여행' },
                            { emoji: '🌞', city: '방콕', reason: '건기 시작' },
                        ]
                    },
                    12: {
                        title: '12월 여행 추천', recs: [
                            { emoji: '❄️', city: '삿포로', reason: '눈축제 여행' },
                            { emoji: '🌴', city: '세부', reason: '건기 여행' },
                            { emoji: '🏖️', city: '푸켓', reason: '건기 성수기' },
                            { emoji: '🌞', city: '방콕', reason: '건기 여행' },
                        ]
                    },
                };
                const season = seasonMap[month];
                if (!season) return null;
                return renderCardBar(barIndex, '🌸', season.title, season.recs.map(r =>
                    renderCityCard(r.city, r.city, r.reason, r.emoji, (e) => { e.stopPropagation(); setSearchTerm(r.city); setStartDate(''); setEndDate(''); setSortBy('price'); setSortOrder('asc'); setDepartureFilter('all'); setRegionFilter('all'); window.scrollTo({ top: 0, behavior: 'smooth' }); })
                ));
            }
            case 15: { // ✨ 새로 올라온 항공권
                const todayStr15 = new Date().toISOString().split('T')[0];
                let titlePrefix = '오늘';

                // 그룹핑 함수
                const groupFlights = (list: Flight[]) => {
                    const rm = new Map<string, { dep: string; arr: string; minPrice: number; count: number; depDate: string; arrDate: string; latestSeen: string }>();
                    list.forEach((f: any) => {
                        const dep = normalizeCity(f.departure.city);
                        const arr = normalizeCity(f.arrival.city);
                        const seen = f.firstSeen || '';
                        const existing = rm.get(arr);
                        if (!existing) {
                            rm.set(arr, { dep, arr, minPrice: f.price, count: 1, depDate: f.departure.date, arrDate: f.arrival.date, latestSeen: seen });
                        } else {
                            existing.count++;
                            if (seen > existing.latestSeen) existing.latestSeen = seen;
                            if (f.price < existing.minPrice) {
                                existing.minPrice = f.price;
                                existing.dep = dep;
                                existing.depDate = f.departure.date;
                                existing.arrDate = f.arrival.date;
                            }
                        }
                    });
                    // 최근 등록순 (내림차순) → 같은 날이면 가격순
                    return Array.from(rm.values()).sort((a, b) => a.latestSeen > b.latestSeen ? -1 : a.latestSeen < b.latestSeen ? 1 : a.minPrice - b.minPrice);
                };

                // 오늘 것 먼저
                let newFlights15 = flights.filter((f: any) => f.firstSeen === todayStr15 && f.price > 0);
                let groupedRoutes = groupFlights(newFlights15);

                // 노선이 7개 미만이면 최근 3일까지 확장
                if (groupedRoutes.length < 7) {
                    const d3 = new Date();
                    d3.setDate(d3.getDate() - 3);
                    const d3Str = d3.toISOString().split('T')[0];
                    newFlights15 = flights.filter((f: any) => f.firstSeen && f.firstSeen >= d3Str && f.price > 0);
                    groupedRoutes = groupFlights(newFlights15);
                    titlePrefix = '최근';
                }
                if (groupedRoutes.length === 0) return null;

                const routeLabel = groupedRoutes.length <= 10 ? ` ${groupedRoutes.length}개 노선` : '';
                return renderCardBar(barIndex, '✨', `${titlePrefix} 올라온 특가${routeLabel}`, groupedRoutes.slice(0, 20).map((r, i) => {
                    const depDate = r.depDate ? new Date(r.depDate.replace(/\./g, '-')) : null;
                    const arrDate = r.arrDate ? new Date(r.arrDate.replace(/\./g, '-')) : null;
                    const dateStr = depDate && arrDate && !isNaN(depDate.getTime()) && !isNaN(arrDate.getTime())
                        ? `${depDate.getMonth() + 1}/${depDate.getDate()}~${arrDate.getMonth() + 1}/${arrDate.getDate()}`
                        : '';
                    const priceStr = `${Math.floor(r.minPrice / 10000)}만${r.minPrice % 10000 > 0 ? Math.floor((r.minPrice % 10000) / 1000) + '천' : ''}원~`;
                    const dateInfo = `${dateStr}${r.count > 1 ? ` 외 ${r.count - 1}건` : ''}`;
                    return renderCityCard(`new-${i}`, r.arr, priceStr, dateInfo, (e) => { e.stopPropagation(); setSearchTerm(r.arr); setStartDate(''); setEndDate(''); setSortBy('price'); setSortOrder('asc'); setDepartureFilter('all'); setRegionFilter('all'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
                }));
            }
            default:
                return null;
        }
    };

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

            case 'ybtour': return styles.badgeYbtour;
            case 'modetour': return styles.badgeModetour;
            case 'hanatour': return styles.badgeHanatour;
            case 'onlinetour': return styles.badgeOnlinetour;
            case 'ttang': return styles.badgeTtang;
            case 'myrealtrip': return styles.badgeMyrealtrip;
            default: return '';
        }
    };

    // 목록 중간에만 놓는다 — "떠날 만한 표가 없나요?"는 몇 개 훑어본 뒤라야 성립하는 질문이다
    const renderDealAlertBanner = () => (
        <div key="deal-alert" className={`${styles.dealAlertBanner} ${styles.listDealAlertBanner}`}>
            <div>
                <strong>떠날 만한 표가 없나요? 좋은 표만 골라서 알려드려요</strong>
                <span>출발지·지역·예산만 골라두세요. 아무 표나 울리지 않고, 가격과 일정이 좋은 표만 보내드려요.</span>
            </div>
            <button type="button" onClick={openDealAlertSetup}>
                원하는 특가 알림 받기
            </button>
        </div>
    );

    return (
        <div className={`${styles.dashboard} legacy-dashboard`}>
            <header className={`${styles.header} ${(headerHidden || (isMobile && isScrolled)) ? styles.headerHidden : ''} ${headerScrolled ? styles.headerScrolled : ''}`}>
                <div className={styles.headerContainer}>
                    <div className={styles.headerLeft}>
                        <h1 className={styles.title} onClick={() => { goHome(); window.scrollTo({ top: 0, behavior: 'smooth' }); }} style={{ cursor: 'pointer' }}>
                            <Logo size={isMobile ? 0.95 : 1.05} />
                        </h1>
                    </div>
                    <div className={styles.headerRight}>
                        <p className={styles.subtitle}>
                            오늘은 어디가 싸게 나왔을까요?
                        </p>
                        <button type="button" className={styles.accountButton} onClick={() => { gtag.trackAccountAction('open', 'main'); setShowAccount(true); }}>
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <circle cx="12" cy="8" r="3.5" />
                                <path d="M5.5 19c.6-3.5 3-5.4 6.5-5.4s5.9 1.9 6.5 5.4" />
                            </svg>
                            <span>{account.status === 'authenticated' ? '내 여행' : '로그인'}</span>
                            {account.status === 'authenticated' && account.favorites.length > 0 && <b>{account.favorites.length}</b>}
                        </button>
                    </div>
                </div>
            </header>




            {/* 스크롤 시 고정 필터 바 */}
            {(() => {
                const [stickyDrop, setStickyDrop] = React.useState<'date' | 'departure' | 'region' | null>(null);
                return (
                <>
                {stickyDrop && <div className={styles.stickyBackdrop} onClick={() => setStickyDrop(null)} />}
                <div className={`${styles.stickyFilterBar} ${isScrolled ? styles.stickyFilterBarVisible : ''}`}>
                    <div className={styles.stickyChips}>
                        {/* 날짜 칩 */}
                        <div className={styles.stickyChipWrap}>
                            <button
                                className={`${styles.stickyChip} ${startDate ? styles.stickyChipActive : ''} ${stickyDrop === 'date' ? styles.stickyChipOpen : ''}`}
                                onClick={(e) => { e.stopPropagation(); setStickyDrop(stickyDrop === 'date' ? null : 'date'); }}
                            >
                                📅 {startDate ? `${startDate.slice(5).replace('-', '.')}` : '전체'}
                                {endDate ? ` ~ ${endDate.slice(5).replace('-', '.')}` : ''}
                                <span className={styles.stickyChevron}>{stickyDrop === 'date' ? '▲' : '▼'}</span>
                            </button>
                            {stickyDrop === 'date' && (
                                <div className={`${styles.stickyMiniDrop} ${styles.stickyMiniDropLeft}`}>
                                    <DatePicker
                                        selectsRange={true}
                                        startDate={toDate(startDate)}
                                        endDate={toDate(endDate)}
                                        onChange={(update: [Date | null, Date | null]) => {
                                            const [start, end] = update;
                                            setStartDate(toStr(start));
                                            setEndDate(toStr(end));
                                            if (end) {
                                                gtag.trackDateFilter(toStr(start), toStr(end), {
                                                    resultCount: countInDateRange(toStr(start), toStr(end)),
                                                });
                                                setStickyDrop(null);
                                            }
                                        }}
                                        locale={ko}
                                        inline
                                        minDate={new Date()}
                                        calendarClassName={styles.stickyCalendar}
                                        dayClassName={calendarDayClassName}
                                        renderDayContents={renderCalendarDay}
                                    >
                                        {renderDatePresets(() => setStickyDrop(null))}
                                    </DatePicker>
                                    {(startDate || endDate) && (
                                        <button
                                            className={styles.stickyResetBtn}
                                            onClick={() => { setStartDate(''); setEndDate(''); setStickyDrop(null); }}
                                        >
                                            날짜 초기화
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* 출발 칩 */}
                        <div className={styles.stickyChipWrap}>
                            <button
                                className={`${styles.stickyChip} ${departureFilter !== 'all' ? styles.stickyChipActive : ''} ${stickyDrop === 'departure' ? styles.stickyChipOpen : ''}`}
                                onClick={(e) => { e.stopPropagation(); setStickyDrop(stickyDrop === 'departure' ? null : 'departure'); }}
                            >
                                ✈️ 출발 {departureFilter === 'all' ? '전체' : departureFilter === '인천' ? '인천/김포' : departureFilter === '부산' ? '부산/김해' : departureFilter}
                                <span className={styles.stickyChevron}>{stickyDrop === 'departure' ? '▲' : '▼'}</span>
                            </button>
                            {stickyDrop === 'departure' && (
                                <div className={styles.stickyMiniDrop}>
                                    <div className={styles.stickyMiniList}>
                                        {[
                                            { value: 'all', label: '전체' },
                                            { value: '인천', label: '인천/김포' },
                                            { value: '부산', label: '부산/김해' },
                                            { value: '대구', label: '대구' },
                                            { value: '청주', label: '청주' },
                                            { value: '제주', label: '제주' },
                                        ].map((opt) => (
                                            <button
                                                key={opt.value}
                                                className={`${styles.stickyOptionChip} ${departureFilter === opt.value ? styles.stickyOptionActive : ''}`}
                                                onClick={() => { setDepartureFilter(opt.value); gtag.trackFilterChange('departure', opt.value); setStickyDrop(null); }}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 도착 칩 */}
                        <div className={styles.stickyChipWrap}>
                            <button
                                className={`${styles.stickyChip} ${regionFilter !== 'all' ? styles.stickyChipActive : ''} ${stickyDrop === 'region' ? styles.stickyChipOpen : ''}`}
                                onClick={(e) => { e.stopPropagation(); setStickyDrop(stickyDrop === 'region' ? null : 'region'); }}
                            >
                                📍 도착 {regionFilter === 'all' ? '전체' : regionFilter}
                                <span className={styles.stickyChevron}>{stickyDrop === 'region' ? '▲' : '▼'}</span>
                            </button>
                            {stickyDrop === 'region' && (
                                <div className={`${styles.stickyMiniDrop} ${styles.stickyMiniDropRight}`}>
                                    <div className={styles.stickyMiniList}>
                                        {[
                                            { value: 'all', label: '전체' },
                                            { value: '동남아', label: '동남아' },
                                            { value: '일본', label: '일본' },
                                            { value: '중국', label: '중국' },
                                            { value: '미주', label: '미주' },
                                            { value: '유럽', label: '유럽' },
                                            { value: '남태평양', label: '남태평양' },
                                            { value: '기타', label: '기타' },
                                        ].map((opt) => (
                                            <button
                                                key={opt.value}
                                                className={`${styles.stickyOptionChip} ${regionFilter === opt.value ? styles.stickyOptionActive : ''}`}
                                                onClick={() => { setRegionFilter(opt.value); setStickyDrop(null); }}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                </>
                );
            })()}

            {/* SEO: 검색엔진 크롤러용 콘텐츠 (JavaScript 미지원 시 표시) */}
            <noscript>
                <div style={{ padding: '40px 20px', maxWidth: '800px', margin: '0 auto', lineHeight: 1.8 }}>
                    <h2>지금 나온 땡처리 항공권 | 티키티킷</h2>
                    <p>
                        여행사마다 따로 올라오는 저렴한 땡처리 항공권을 한곳에 모아 보여주는 무료 서비스입니다.
                    </p>
                    <h3>인기 여행지 땡처리 항공권</h3>
                    <ul>
                        <li>일본 항공권: 오사카, 도쿄, 후쿠오카, 삿포로, 오키나와</li>
                        <li>동남아 항공권: 다낭, 방콕, 세부, 나트랑, 푸켓, 발리, 호치민, 하노이</li>
                        <li>중화권 항공권: 대만(타이페이), 홍콩, 마카오</li>
                        <li>기타: 괌, 사이판, 싱가포르, 코타키나발루</li>
                    </ul>
                    <h3>서비스 특징</h3>
                    <ul>
                        <li>하루 여러 차례 항공권 정보 업데이트</li>
                        <li>여러 여행사의 땡처리 항공권을 한곳에서 확인</li>
                        <li>출발일, 도착지, 항공사별 필터링</li>
                        <li>관심 노선 즐겨찾기</li>
                        <li>회원가입 없이 무료 이용</li>
                    </ul>
                    <p>이 페이지를 정상적으로 이용하려면 JavaScript를 활성화해주세요.</p>
                </div>
            </noscript>

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
                                        gtag.trackDateFilter(toStr(start), toStr(end), {
                                            resultCount: countInDateRange(toStr(start), toStr(end)),
                                        });
                                        setTimeout(() => setIsCalendarOpen(false), 500);
                                    }
                                }}
                                open={isCalendarOpen}
                                onInputClick={() => setIsCalendarOpen(true)}
                                onClickOutside={() => setIsCalendarOpen(false)}
                                shouldCloseOnSelect={false}
                                dateFormat="MM.dd"
                                locale={ko}
                                className={styles.dateInput}
                                placeholderText="언제 떠나세요?"
                                popperClassName={styles.datePickerPopper}
                                calendarClassName={styles.datePickerCalendar}
                                minDate={new Date()}
                                isClearable={true}
                                onFocus={(e: React.FocusEvent<HTMLInputElement>) => e.target.blur()}
                                dayClassName={calendarDayClassName}
                                renderDayContents={renderCalendarDay}
                            >
                                {renderDatePresets(() => setTimeout(() => setIsCalendarOpen(false), 300))}
                            </DatePicker>
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
                            {showSuggestions && (() => {
                                // 검색어 입력 중이면 데이터에서 매칭되는 도시 제안
                                if (searchTerm) {
                                    const term = searchTerm.toLowerCase();
                                    const matchCities = new Set<string>();
                                    flights.forEach(f => {
                                        const dep = normalizeCity(f.departure.city);
                                        const arr = normalizeCity(f.arrival.city);
                                        if (dep.toLowerCase().includes(term)) matchCities.add(dep);
                                        if (arr.toLowerCase().includes(term)) matchCities.add(arr);
                                    });
                                    const matches = Array.from(matchCities).slice(0, 8);
                                    if (matches.length === 0) return null;
                                    return (
                                        <ul className={styles.suggestionsDropdown}>
                                            <li className={styles.suggestionHeader}>검색 결과</li>
                                            {matches.map((item) => (
                                                <li key={item} className={styles.suggestionItem}
                                                    onMouseDown={(e) => { e.preventDefault(); setSearchTerm(item); setShowSuggestions(false); }}>
                                                    {item}
                                                </li>
                                            ))}
                                        </ul>
                                    );
                                }
                                // 빈 칸이면 인기 도시 표시
                                return (
                                    <ul className={styles.suggestionsDropdown}>
                                        <li className={styles.suggestionHeader}>인기 도시</li>
                                        {popularCities.map((city) => (
                                            <li key={city} className={styles.suggestionItem}
                                                onMouseDown={(e) => { e.preventDefault(); setSearchTerm(city); setShowSuggestions(false); }}>
                                                {city}
                                            </li>
                                        ))}
                                    </ul>
                                );
                            })()}
                        </div>
                    </div>

                    {/* 3. 필터 토글 버튼 (모바일) + 출발지 + 도착지역 칩 필터 */}
                    <div ref={filterAreaRef}>
                    <button
                        className={styles.filterToggleBtn}
                        onClick={() => setShowFilters(!showFilters)}
                    >
                        <span>
                            {/* 접힌 상태에서는 '지역'이 출발 쪽인지 도착 쪽인지 읽는 사람이 알 수 없었다.
                                펼친 뒤의 항목명(출발지 / 도착 지역), 상단 고정 칩(✈️ 출발 / 📍 도착)과
                                같은 방향 표기를 여기에도 붙인다. */}
                            {departureFilter !== 'all' || regionFilter !== 'all'
                                ? [
                                    departureFilter !== 'all' && ((departureFilter === '인천' ? '인천/김포' : departureFilter === '부산' ? '부산/김해' : departureFilter) + ' 출발'),
                                    regionFilter !== 'all' && (regionFilter + ' 도착'),
                                ].filter(Boolean).join(' · ')
                                : '출발지 · 도착 지역 선택'}
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
                                        onClick={() => { setDepartureFilter(option.value); gtag.trackFilterChange('departure', option.value); }}
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
                                        출발지 : {departureFilter}
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
                                {managedPriceAlertsLoaded && managedPriceAlerts.length > 0 && (
                                    <button
                                        type="button"
                                        className={styles.alertManagerBtn}
                                        onClick={loadManagedPriceAlerts}
                                    >
                                        {isMobile ? '내 알림' : '🔔 내 알림'} {managedPriceAlerts.length}
                                    </button>
                                )}
                                {favoriteFlights.length > 0 && (
                                    <button
                                        className={`${styles.alertManagerBtn} ${favFilter ? styles.alertManagerBtnActive : ''}`}
                                        onClick={() => setFavFilter(!favFilter)}
                                    >
                                        {isMobile ? '즐겨찾기' : '⭐ 즐겨찾기'} {favoriteFlights.length}
                                    </button>
                                )}
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
                                    <option value="myrealtrip">마이리얼트립</option>
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
                                    <option value="discount">추천순</option>
                                    <option value="price">가격순</option>
                                    <option value="discountRate">할인율순</option>
                                    <option value="date">날짜순</option>
                                </select>
                            </div>
                        </div>


                        {sharedFlightId && (
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '12px 16px', marginBottom: '12px',
                                background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-lg)',
                                border: '1px solid var(--color-border)', fontSize: '0.9rem'
                            }}>
                                <span>✈️ 공유된 항공편</span>
                                <button
                                    onClick={() => setSharedFlightId(null)}
                                    className="btn btn-primary"
                                    style={{ fontSize: '0.8rem', padding: '6px 14px' }}
                                >
                                    전체 항공편 보기
                                </button>
                            </div>
                        )}

                        {alertSuggestion?.mode === 'results' && (alertPanelOpen || showAlertCta) && (
                            <div className={styles.alertSuggestBar}>
                                {alertPanelOpen ? renderPriceAlertPanel('출발일이 달라도 알려드려요') : (
                                    <>
                                        <span className={styles.alertSuggestText}>
                                            {alertSuggestion.arrivalCity}, 지금 {formatPrice(alertSuggestion.price)}부터 있어요.
                                            {' '}더 내려가면 알려드릴까요?
                                        </span>
                                        <span className={styles.alertSuggestActions}>
                                            <button
                                                type="button"
                                                className={styles.alertSuggestBtn}
                                                onClick={openSuggestedPriceAlert}
                                            >
                                                알림 받기
                                            </button>
                                            <button
                                                type="button"
                                                className={styles.alertSuggestDismiss}
                                                onClick={() => setDismissedAlertRoutes(current =>
                                                    alertRouteKey && !current.includes(alertRouteKey) ? [...current, alertRouteKey] : current)}
                                                aria-label="알림 제안 닫기"
                                            >
                                                ×
                                            </button>
                                        </span>
                                    </>
                                )}
                            </div>
                        )}

                        <div className={styles.flightGrid}>
                            {displayedFlights.flatMap((flight, index) => {
                                const route = `${flight.departure.city}-${flight.arrival.city}`;
                                const isLowestPrice = lowestPrices[route] === flight.price;
                                const items: React.ReactNode[] = [];

                                // 인사이트 바 삽입: 모바일 3개 후 시작(9개 간격), PC 6개 후 시작(12개 간격)
                                const insightOffset = isMobile ? 3 : 12;
                                const insightInterval = isMobile ? 9 : 12;
                                // 알림 배너는 인사이트 바 자리 하나를 대신 차지한다 — 그래야 위아래로
                                // 같은 간격(PC 12장)의 항공권이 놓여 다른 바와 같은 리듬으로 읽힌다.
                                const dealAlertSlot = index === (isMobile ? 12 : 24);
                                if (dealAlertSlot) {
                                    items.push(renderDealAlertBanner());
                                }
                                if (index > 0 && index >= insightOffset && (index - insightOffset) % insightInterval === 0 && !searchTerm && !dealAlertSlot) {
                                    const bar = generateInsightBar(Math.floor((index - insightOffset) / insightInterval));
                                    if (bar) items.push(bar);
                                }

                                // 광고 카드 삽입 (현재 비활성화 — 트래픽 증가 후 재활성화)
                                // TODO: 일 방문자 100명+ 달성 시 아래 주석 해제
                                // const adOffset = isMobile ? 4 : 10;
                                // const adInterval = isMobile ? 16 : 20;
                                // const isAdSlot = index > 0 && index >= adOffset && (index - adOffset) % adInterval === 0 && !searchTerm;
                                // if (isAdSlot) {
                                //     items.push(
                                //         <div key={`ad-row-${index}`} className={styles.adRow}>
                                //             <AdCard />
                                //         </div>
                                //     );
                                // }

                                // 표식을 카드 안에 넣으면 그 카드만 높아져 같은 행의 카드까지 늘어난다.
                                // 그리드의 독립된 행으로 빼면 모든 카드가 같은 크기를 유지한다.
                                if (isDefaultView && todayPick?.flight.id === flight.id) {
                                    items.push(
                                        <div key="today-pick-label" className={styles.todayPickLabel}>
                                            <span>오늘의 표</span>{todayPick.reason}
                                        </div>
                                    );
                                }

                                items.push(
                                    <div
                                        key={flight.id}
                                        className={`card ${styles.flightCard} fade-in${isDefaultView && todayPick?.flight.id === flight.id ? ` ${styles.todayPickCard}` : ''}`}
                                        onClick={() => openFlightDetail(flight, isDefaultView && todayPick?.flight.id === flight.id ? 'today_pick' : 'card_body')}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <div className={styles.cardHeader}>
                                            <div className={styles.cardHeaderLeft}>
                                                <span className={`badge ${getSourceBadgeClass(flight.source)}`}>
                                                    {getSourceName(flight.source)}
                                                </span>
                                                <span className={styles.airline}>{normalizeAirline(flight.airline)}</span>
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
                                                    className={isFavoriteFlight(flight.id) ? styles.favBtnActive : styles.shareBtn}
                                                    onClick={(e) => {
                                                        e.preventDefault(); e.stopPropagation();
                                                        toggleFavorite(flight.id, normalizeCity(flight.arrival.city));
                                                    }}
                                                    title={isFavoriteFlight(flight.id) ? '즐겨찾기 해제' : '즐겨찾기'}
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill={isFavoriteFlight(flight.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'none' }}>
                                                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                                    </svg>
                                                </button>
                                                <button
                                                    type="button"
                                                    className={styles.shareBtn}
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        shareFlight(flight);
                                                    }}
                                                    aria-label="이 항공권 공유하기"
                                                    title="공유하기"
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ pointerEvents: 'none' }}>
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
                                                    {(() => {
                                                        const city = flight.arrival.city?.replace(/\([^)]+\)/, '').trim();
                                                        const depMonth = flight.departure.date?.replace(/\./g, '-').replace(/\(.*\)/g, '').trim().substring(0, 7);
                                                        const ipCityData = interparkPrices[city];
                                                        const ipMonthData = ipCityData?.[depMonth];
                                                        if (ipMonthData?.avg && flight.price > 0) {
                                                            const percent = ((ipMonthData.avg - flight.price) / ipMonthData.avg) * 100;
                                                            if (percent >= 5) {
                                                                return <span className={styles.discountBadge}>-{Math.round(percent)}%</span>;
                                                            }
                                                        }
                                                        return null;
                                                    })()}

                                                </div>
                                                {(
                                                    <button
                                                        type="button"
                                                        className="btn btn-primary"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            openFlightDetail(flight, 'book_button');
                                                        }}
                                                    >
                                                        예약하기 →
                                                    </button>
                                                )}
                                            </div>
                                            {(() => {
                                                const naverUrl = flight.source === 'myrealtrip' && !flight.routeAirports
                                                    ? null
                                                    : getNaverFlightUrl(
                                                    flight.departure.city,
                                                    flight.arrival.city,
                                                    flight.departure.date,
                                                    flight.arrival.date,
                                                    flight.departure.airport,
                                                    flight.arrival.airport,
                                                    flight.routeAirports,
                                                );
                                                const tripcomTrackingId = getTripcomTrackingId(flight.arrival.city, flight.departure.date, flight.arrival.date, flight.arrival.airport, flight.departure.city, flight.departure.airport);
                                                const tripcomHotelUrl = getTripcomHotelUrl(flight.arrival.city, flight.departure.date, flight.arrival.date, flight.arrival.airport, flight.departure.city, flight.departure.airport);
                                                if (!naverUrl && !tripcomHotelUrl) return null;
                                                return (
                                                    <div className={styles.compareLinks}>
                                                        {naverUrl && (
                                                            <button className={styles.compareLink} title="네이버 항공권에서 비교"
                                                                onClick={(e) => {
                                                                    // 카드 본문 클릭(상세 열기)까지 함께 발생하지 않게 막는다
                                                                    e.stopPropagation();
                                                                    gtag.trackCompareClick('naver', `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`, flight.price);
                                                                    setNaverDisclaimer({
                                                                        url: naverUrl,
                                                                        route: `${normalizeCity(flight.departure.city)} → ${normalizeCity(flight.arrival.city)}`,
                                                                        analyticsRoute: `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`,
                                                                        price: flight.price,
                                                                    });
                                                                }}
                                                            >
                                                                네이버 가격비교 ›
                                                            </button>
                                                        )}
                                                        {/* 제휴 링크라는 사실은 링크에 올렸을 때 뜨는 설명과 푸터 고지로 밝힌다.
                                                            카드마다 딱지를 붙이면 목록이 지저분해져 두 곳으로 나눴다. */}
                                                        {tripcomHotelUrl && (
                                                            <a href={tripcomHotelUrl} target="_blank" rel="noopener noreferrer" className={styles.compareLinkHotel}
                                                                title="트립닷컴에서 호텔 검색 (예약이 완료되면 티키티킷이 수수료를 받을 수 있습니다)"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    gtag.trackHotelAffiliateClick(
                                                                        `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`,
                                                                        flight.price,
                                                                        revenueClickDetails(flight, tripcomTrackingId),
                                                                    );
                                                                }}
                                                            >
                                                                🏨 {normalizeCity(flight.arrival.city)} 호텔도 비교 ›
                                                            </a>
                                                        )}
                                                    </div>
                                                );
                                            })()}

                                        </div>


                                    </div>
                                );
                                return items;
                            })}
                            {!hasMore && displayedFlights.length > 0 && displayedFlights.length <= (isMobile ? 12 : 24) && renderDealAlertBanner()}
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
                                {sharedFlightId ? (
                                    <>
                                        <p>이 항공권은 판매가 종료되었습니다</p>
                                        <p style={{ fontSize: '0.9rem', opacity: 0.7 }}>
                                            판매 종료 후에도 같은 노선의 다른 항공권을 확인할 수 있어요.
                                        </p>
                                        <button
                                            onClick={showSharedRouteAlternatives}
                                            className="btn btn-primary"
                                        >
                                            {sharedRouteFallback.current?.arr ? '같은 노선의 다른 항공권 보기' : '현재 항공권 보기'}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        {emptyDiagnosis?.kind === 'filtered' && emptyDiagnosis.blockers.length > 0 ? (
                                            <>
                                                <p>{searchTerm} 항공권은 {emptyDiagnosis.available}건 있습니다</p>
                                                <p style={{ fontSize: '0.9rem', opacity: 0.7 }}>
                                                    아래 조건과 맞지 않아 가려졌어요. 눌러서 해제할 수 있습니다.
                                                </p>
                                                <div className={styles.emptyBlockers}>
                                                    {emptyDiagnosis.blockers.map(blocker => (
                                                        <button
                                                            key={blocker.id}
                                                            type="button"
                                                            className={styles.emptyBlockerChip}
                                                            onClick={blocker.clear}
                                                        >
                                                            {blocker.label}
                                                            <span aria-hidden="true">×</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <p>검색 결과가 없습니다</p>
                                                <p style={{ fontSize: '0.9rem', opacity: 0.7 }}>
                                                    필터를 조정하거나 다른 조건으로 검색해보세요
                                                </p>
                                            </>
                                        )}
                                        {hasActiveFilters && (
                                            <button
                                                onClick={resetAllFilters}
                                                className="btn btn-secondary"
                                            >
                                                필터 초기화
                                            </button>
                                        )}
                                        {alertSuggestion?.mode === 'empty' && (alertPanelOpen || showAlertCta) && (
                                            <div className={styles.alertEmptyCta}>
                                                {alertPanelOpen ? renderPriceAlertPanel('특가가 나오면 알려드려요') : (
                                                    <>
                                                        <p className={styles.alertEmptyText}>
                                                            지금은 {alertSuggestion.arrivalCity} 특가가 없습니다. 나오면 알려드릴까요?
                                                        </p>
                                                        <button
                                                            type="button"
                                                            className={styles.alertSuggestBtn}
                                                            onClick={openSuggestedPriceAlert}
                                                        >
                                                            알림 받기
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </>
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
                            <p className={styles.footerBrandMessage}>좋은 표 하나가, 없던 여행 계획을 만듭니다.</p>
                            <div className={styles.footerLinks}>
                                <a href="/drop">티키티킷 드롭</a>
                                <a href="/tips">가격 기록과 여행 팁</a>
                            </div>
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
                        <br /><br />
                        티키티킷은 통신판매중개자로서 통신판매의 당사자가 아닙니다. 따라서 항공권의 예약, 결제, 취소, 환불 및 운항 스케줄 등에 대한 모든 의무와 법적 책임은 해당 상품을 판매하는 여행사 및 항공사에 있습니다.
                        <br /><br />
                        일부 링크는 제휴 링크이며, 이를 통해 예약이 완료되면 티키티킷이 수수료를 받을 수 있습니다. 이용자가 부담하는 가격은 달라지지 않습니다.
                    </div>

                    <div className={styles.footerBottom}>
                        <span>© 2026 티키티킷</span>
                        <span style={{ display: 'flex', gap: '12px', fontSize: '0.8rem' }}>
                            <a href="/terms" style={{ color: 'var(--color-text-muted)' }}>이용약관</a>
                            <a href="/privacy" style={{ color: 'var(--color-text-muted)' }}>개인정보처리방침</a>
                            <a href="#" onClick={(e) => { e.preventDefault(); setShowContactModal(true); }} style={{ color: 'var(--color-text-muted)' }}>문의하기</a>
                        </span>
                    </div>
                </div>
            </footer>


            {/* 인원 선택 모달 */}
            {/* 항공편 상세 뷰 팝업 (전체 여행사 공용) */}
            {modetourGuide && (() => {
                const mdt = modetourGuide.modetourDetail;
                const depCity = normalizeCity(modetourGuide.departure.city);
                const arrCity = normalizeCity(modetourGuide.arrival.city);
                const exactAirports = modetourGuide.routeAirports;
                const depAirport = exactAirports?.outboundDeparture || modetourGuide.departure.airport || '';
                const arrAirport = exactAirports?.outboundArrival || modetourGuide.arrival.airport || '';
                const depDate = modetourGuide.departure.date || '';
                const arrDate = modetourGuide.arrival.date || '';
                const depTime = modetourGuide.departure.time || '';
                // 가는편 도착시간
                const depArrTime = mdt?.departureArrivalTime || modetourGuide.departure.arrivalTime || '';
                // 오는편 출발/도착시간
                const retDepTime = mdt?.returnDepartureTime || modetourGuide.arrival.time || '';
                const retArrTime = mdt?.returnArrivalTime || modetourGuide.arrival.arrivalTime || '';
                // 비행시간
                // 여행사가 준 비행시간이 있으면 그대로, 없으면 현지 시각 차이에 시차를 보정해 계산한다.
                // 같은 화면에 두 출처가 나란히 놓이므로 표기는 계산값 형식으로 맞춘다 ("05:40" → "5시간 40분")
                const fmtAgencyFlyTime = (value: string) => {
                    const parsed = value.match(/^(\d{1,2}):(\d{2})/);
                    if (!parsed) return '';
                    const hours = Number(parsed[1]);
                    const minutes = Number(parsed[2]);
                    return `${hours}시간${minutes > 0 ? ` ${minutes}분` : ''}`;
                };
                const flyTime = calcFlightDuration(depCity, depTime, depDate, arrCity, depArrTime)
                    || (mdt?.flyingTime && fmtAgencyFlyTime(mdt.flyingTime)) || '';
                const retFlyTime = calcFlightDuration(arrCity, retDepTime, arrDate, depCity, retArrTime)
                    || (mdt?.returnFlyingTime && fmtAgencyFlyTime(mdt.returnFlyingTime)) || '';
                // 총 체류기간 (N박 M일)
                const stayNights = (() => {
                    if (!depDate || !arrDate) return '';
                    const parse = (d: string) => { const m = d.match(/^(\d{4})[.\-](\d{2})[.\-](\d{2})/); return m ? new Date(`${m[1]}-${m[2]}-${m[3]}`) : new Date(d); };
                    const d1 = parse(depDate);
                    const d2 = parse(arrDate);
                    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return '';
                    const nights = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
                    return nights > 0 ? nights : '';
                })();
                const stayDuration = stayNights ? `${stayNights}박 ${stayNights + 1}일` : '';
                const destinationContext = getDestinationContext(arrCity);
                // 직항
                const isDirect = mdt?.isDirect ?? true;
                const isRetDirect = mdt?.isReturnDirect ?? isDirect;
                // 편명
                const depFlightNo = mdt?.departureFlightNo || modetourGuide.flightNumber?.split('/')[0]?.trim() || '';
                const retFlightNo = mdt?.returnFlightNo || modetourGuide.flightNumber?.split('/')[1]?.trim() || '';
                // 귀국편 공항
                const retDepAirport = exactAirports?.returnDeparture || mdt?.returnDepartureAirport || arrAirport;
                const retArrAirport = exactAirports?.returnArrival || mdt?.returnArrivalAirport || depAirport;
                // 가격
                const normalPrice = mdt?.normalPrice || 0;
                const discountRate = mdt?.sourceDiscountRate || 0;
                const baseFare = mdt?.baseFare || 0;
                const tax = (mdt?.tax || 0) + (mdt?.tax2 || 0);
                const totalPrice = modetourGuide.price;
                const displayAirline = normalizeAirline(modetourGuide.airline);
                const detailHotelTrackingId = getTripcomTrackingId(
                    arrCity,
                    depDate,
                    arrDate,
                    arrAirport,
                    depCity,
                    depAirport,
                );
                const detailHotelUrl = getTripcomHotelUrl(
                    arrCity,
                    depDate,
                    arrDate,
                    arrAirport,
                    depCity,
                    depAirport,
                );
                // 요일
                const cleanDate = (d: string) => d ? d.replace(/\(.*/g, '').replace(/\./g, '-') : '';
                const getDayName = (d: string) => {
                    if (!d) return '';
                    try {
                        const clean = cleanDate(d);
                        const dt = new Date(clean + 'T00:00:00');
                        if (isNaN(dt.getTime())) return '';
                        return ['일', '월', '화', '수', '목', '금', '토'][dt.getDay()];
                    } catch { return ''; }
                };
                const depDay = getDayName(depDate);
                const arrDay = getDayName(arrDate);
                // 날짜 짧은 형식
                const shortDate = (d: string, day: string) => {
                    if (!d) return '';
                    const clean = cleanDate(d);
                    const short = clean.slice(5).replace('-', '.');
                    return day ? `${short}(${day})` : short;
                };
                // 공항코드 표시 (빈 값이면 괄호 생략)
                const fmtAirport = (city: string, airport: string) => airport ? `${city}(${airport})` : city;

                return (
                    <div className={styles.modalOverlay} onClick={() => setModetourGuide(null)}>
                        <div
                            className={styles.mdtDetailSheet}
                            onClick={(e) => e.stopPropagation()}
                            style={{ position: 'relative' }}
                            ref={detailSheetRef}
                            onScroll={measureSheetScroll}
                        >
                            <div className={styles.mdtSheetInner} ref={detailSheetInnerRef}>
                            <div
                                className={styles.mdtDragHandleArea}
                                data-detail-drag-handle
                                aria-hidden="true"
                                onPointerDown={beginDetailSheetDrag}
                                onPointerMove={moveDetailSheetDrag}
                                onPointerUp={(event) => endDetailSheetDrag(event)}
                                onPointerCancel={(event) => endDetailSheetDrag(event, true)}
                            >
                                <span className={styles.mdtDragHandle} />
                            </div>
                            {/* 여행사 + 항공사 + 좌석 */}
                            <div className={styles.mdtSummaryBar}>
                                <div className={styles.mdtAirlineInfo}>
                                    <span className={`badge ${getSourceBadgeClass(modetourGuide.source)}`}>{getSourceName(modetourGuide.source)}</span>
                                    {displayAirline && <span className={styles.airline}>{displayAirline}</span>}
                                    {(() => {
                                        const seatNum = modetourGuide.availableSeats || (modetourGuide.seats ? parseInt(modetourGuide.seats) : 0);
                                        if (!seatNum) return null;
                                        return (
                                            <span className={seatNum <= 9 ? styles.seatsBadgeCritical : styles.seatsBadge}>
                                                {seatNum <= 5 && '🔥 '}{seatNum}석
                                            </span>
                                        );
                                    })()}
                                </div>
                                <div className={styles.mdtSummaryActions}>
                                    {priceAlertSetup?.key !== `flight:${modetourGuide.id}` && (
                                        <button
                                            type="button"
                                            className={styles.priceAlertOpenBtn}
                                            onClick={() => openPriceAlert({
                                                key: `flight:${modetourGuide.id}`,
                                                entry: 'detail_modal',
                                                departureCity: depCity,
                                                arrivalCity: arrCity,
                                                baseline: { flightId: modetourGuide.id, price: modetourGuide.price },
                                                maxPrice: modetourGuide.price,
                                            })}
                                        >
                                            <span aria-hidden="true">🔔</span>
                                            가격 알림
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className={styles.mdtCloseBtn}
                                        onClick={() => setModetourGuide(null)}
                                        aria-label="상세 팝업 닫기"
                                    >
                                        ×
                                    </button>
                                </div>
                            </div>

                            {priceAlertSetup?.key === `flight:${modetourGuide.id}` && (
                                <div ref={priceAlertAreaRef} className={styles.priceAlertArea}>
                                    {renderPriceAlertPanel('출발일이 달라도 알려드려요')}
                                </div>
                            )}

                            {/* 타임라인 요약 */}
                            <div className={styles.mdtTimeline}>
                                <div className={styles.mdtTimePoint}>
                                    <div className={styles.mdtTimeValue}>{depTime || '--:--'}</div>
                                    <div className={styles.mdtTimeCity}>{depCity}<br />{shortDate(depDate, depDay)}</div>
                                </div>
                                <div className={styles.mdtTimeConnector}>
                                    {stayDuration && <span className={styles.mdtDuration}>{stayDuration}</span>}
                                    {isDirect && <span className={styles.mdtDirectBadgeSm}>직항</span>}
                                    <div className={styles.mdtLine} />
                                </div>
                                <div className={styles.mdtTimePoint}>
                                    <div className={styles.mdtTimeValue}>{retDepTime || '--:--'}</div>
                                    <div className={styles.mdtTimeCity}>{arrCity}<br />{shortDate(arrDate, arrDay)}</div>
                                </div>
                            </div>

                            {/* 마이리얼트립은 그날 최저가만 제공하고 실제 항공편은 예약 단계에서 정해진다 */}
                            {modetourGuide.source === 'myrealtrip' && !depTime && (
                                <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted)', textAlign: 'center' }}>
                                    이 가격의 실제 항공편(출발·도착 시간)은 마이리얼트립 예약 페이지에서 선택할 때 확인돼요.
                                </p>
                            )}

                            {/* 가격 요약 바 */}
                            {(normalPrice > 0 || discountRate > 0) && (
                                <div className={styles.mdtPriceBar}>
                                    {normalPrice > 0 && <span className={styles.mdtNormalPrice}>{formatPrice(normalPrice)}</span>}
                                    <div className={styles.mdtDiscountGroup}>
                                        {discountRate > 0 && <span className={styles.mdtDiscountRate}>{discountRate}%</span>}
                                        <span className={styles.mdtFinalPrice}>{formatPrice(totalPrice)}</span>
                                        <span className={styles.mdtPriceSuffix}>~</span>
                                    </div>
                                </div>
                            )}

                            {destinationContext && (
                                <section className={styles.mdtTravelContext} aria-labelledby="travel-context-title">
                                    <div className={styles.mdtTravelContextHeader}>
                                        <span aria-hidden="true">🧭</span>
                                        <div>
                                            <span>처음 가는 곳이라면</span>
                                            <strong id="travel-context-title">{arrCity}, 이런 곳이에요</strong>
                                        </div>
                                    </div>
                                    <div className={styles.mdtTravelContextFacts}>
                                        <p><b>어디에 있나요</b><span>{destinationContext.location}</span></p>
                                        <p><b>공항 이동</b><span>{destinationContext.transfer}</span></p>
                                        <p><b>{stayDuration || '이 일정'}으로 가능한 여행</b><span>{getItineraryContext(destinationContext, Number(stayNights) || 0)}</span></p>
                                    </div>
                                    <details className={styles.mdtTravelContextMore}>
                                        <summary>누구에게 잘 맞을까요?</summary>
                                        <div>
                                            <p><b>잘 맞아요</b>{destinationContext.goodFor.join(' · ')}</p>
                                            <p><b>미리 확인하세요</b>{destinationContext.caution.join(' · ')}</p>
                                        </div>
                                    </details>
                                </section>
                            )}

                            {/* 상세 항공편 섹션 */}
                            <div className={styles.mdtFlightSections}>
                                {/* 가는 항공편 */}
                                <div className={styles.mdtFlightSection}>
                                    <div className={styles.mdtSectionHeader}>
                                        <div className={styles.mdtSectionTitle}>
                                            <span>가는 항공편</span>
                                            {isDirect && <span className={styles.mdtDirectBadge}>직항</span>}
                                        </div>
                                        {flyTime && <span className={styles.mdtFlyTime}>비행시간: {flyTime}</span>}
                                    </div>
                                    <div className={styles.mdtDetailTimeline}>
                                        <div className={styles.mdtDetailDots}>
                                            <div className={styles.mdtDot} />
                                            <div className={styles.mdtDotLine} />
                                            <div className={styles.mdtDot} />
                                        </div>
                                        <div className={styles.mdtDetailStops}>
                                            <div className={styles.mdtStop}>
                                                <div>
                                                    <span className={styles.mdtStopTime}>{depTime}</span>
                                                    <span className={styles.mdtStopDate}> {shortDate(depDate, depDay)}</span>
                                                </div>
                                                <span className={styles.mdtStopCity}>{fmtAirport(depCity, depAirport)}</span>
                                            </div>
                                            <div className={styles.mdtStop}>
                                                <div>
                                                    <span className={styles.mdtStopTime}>{depArrTime || '--:--'}</span>
                                                    <span className={styles.mdtStopDate}> {shortDate(depDate, depDay)}</span>
                                                </div>
                                                <span className={styles.mdtStopCity}>{fmtAirport(arrCity, arrAirport)}</span>
                                            </div>
                                        </div>
                                    </div>
                                    {depFlightNo && (
                                        <div className={styles.mdtFlightNo}>
                                            <span className={styles.mdtFlightNoIcon}>✈️</span>
                                            <span>{modetourGuide.airline} {depFlightNo}편</span>
                                        </div>
                                    )}
                                </div>

                                {/* 오는 항공편 */}
                                <div className={styles.mdtFlightSection}>
                                    <div className={styles.mdtSectionHeader}>
                                        <div className={styles.mdtSectionTitle}>
                                            <span>오는 항공편</span>
                                            {isRetDirect && <span className={styles.mdtDirectBadge}>직항</span>}
                                        </div>
                                        {retFlyTime && <span className={styles.mdtFlyTime}>비행시간: {retFlyTime}</span>}
                                    </div>
                                    <div className={styles.mdtDetailTimeline}>
                                        <div className={styles.mdtDetailDots}>
                                            <div className={styles.mdtDot} />
                                            <div className={styles.mdtDotLine} />
                                            <div className={styles.mdtDot} />
                                        </div>
                                        <div className={styles.mdtDetailStops}>
                                            <div className={styles.mdtStop}>
                                                <div>
                                                    <span className={styles.mdtStopTime}>{retDepTime || '--:--'}</span>
                                                    <span className={styles.mdtStopDate}> {shortDate(arrDate, arrDay)}</span>
                                                </div>
                                                <span className={styles.mdtStopCity}>{fmtAirport(arrCity, retDepAirport)}</span>
                                            </div>
                                            <div className={styles.mdtStop}>
                                                <div>
                                                    <span className={styles.mdtStopTime}>{retArrTime || '--:--'}</span>
                                                    <span className={styles.mdtStopDate}> {shortDate(arrDate, arrDay)}</span>
                                                </div>
                                                <span className={styles.mdtStopCity}>{fmtAirport(depCity, retArrAirport)}</span>
                                            </div>
                                        </div>
                                    </div>
                                    {retFlightNo && (
                                        <div className={styles.mdtFlightNo}>
                                            <span className={styles.mdtFlightNoIcon}>✈️</span>
                                            <span>{modetourGuide.airline} {retFlightNo}편</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* 가격 상세 */}
                            {baseFare > 0 && (
                                <div className={styles.mdtPriceDetail}>
                                    <div className={styles.mdtPriceRow}>
                                        <span>항공료</span>
                                        <strong>{formatPrice(baseFare)}</strong>
                                    </div>
                                    {tax > 0 && (
                                        <div className={styles.mdtPriceRow}>
                                            <span>유류/제세공과금</span>
                                            <strong>{formatPrice(tax)}</strong>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* 표시 금액 */}
                            <div className={styles.mdtPriceTotal}>
                                <div className={styles.mdtPriceTotalSub}>(유류/제세공과금 포함)</div>
                                <div className={styles.mdtPriceTotalValue}>{formatPrice(totalPrice)}</div>
                            </div>

                            {modetourGuide.source === 'myrealtrip' && (
                                <div className={styles.mdtMyrealtripSortNotice}>
                                    <span aria-hidden="true">💡</span>
                                    <span>
                                        이 항공권은 검색 결과의 <strong>직항 최저가</strong>예요.
                                        예약 페이지는 추천순으로 열리므로 <strong>‘가격 낮은 순’</strong>을 누른 뒤
                                        같은 항공사·시간을 확인해 주세요.
                                    </span>
                                </div>
                            )}

                            {/* 하단 */}
                            <div className={styles.mdtFooter}>



                                {/* 모두투어: 면책조항 */}
                                {modetourGuide.source === 'modetour' && (
                                    <div className={styles.mdtDisclaimer}>
                                        표시된 가격 및 좌석은 실시간 변동될 수 있으며,
                                        실제 예약은 모두투어에서 직접 이루어집니다.
                                    </div>
                                )}

                                {/* 인원 선택 — 예약 URL이 인원수를 반영하는 여행사만
                                    (모두투어: 딥링크 없음,
                                     온라인투어: 예약 페이지가 인원 파라미터를 무시하고 자체 선택 UI 사용,
                                     땡처리닷컴: 특가 목록이 인원을 반영하지 않고 고정 1인 기준가만 보여준다.
                                       게다가 특가 절반이 최소 2인 조건이라 "가격 × 인원" 계산이 실제와 다르다) */}
                                {modetourGuide.source !== 'modetour' && modetourGuide.source !== 'onlinetour'
                                    && modetourGuide.source !== 'ttang' && (
                                    <>
                                        <div className={styles.mdtPaxSection}>
                                            <div className={styles.mdtPaxTitle}>탑승 인원</div>
                                            <div className={styles.mdtPaxRows}>
                                                <div className={styles.mdtPaxRow}>
                                                    <div className={styles.mdtPaxLabel}>
                                                        <span>성인</span>
                                                        <span className={styles.mdtPaxAge}>만 12세 이상</span>
                                                    </div>
                                                    <div className={styles.mdtPaxCounter}>
                                                        <button className={styles.mdtPaxBtn} disabled={passengers.adult <= 1} onClick={() => setPassengers(p => ({ ...p, adult: p.adult - 1 }))}>−</button>
                                                        <span className={styles.mdtPaxCount}>{passengers.adult}</span>
                                                        <button className={styles.mdtPaxBtn} disabled={passengers.adult >= 9} onClick={() => setPassengers(p => ({ ...p, adult: p.adult + 1 }))}>+</button>
                                                    </div>
                                                </div>
                                                <div className={styles.mdtPaxRow}>
                                                    <div className={styles.mdtPaxLabel}>
                                                        <span>소아</span>
                                                        <span className={styles.mdtPaxAge}>만 2~11세</span>
                                                    </div>
                                                    <div className={styles.mdtPaxCounter}>
                                                        <button className={styles.mdtPaxBtn} disabled={passengers.child <= 0} onClick={() => setPassengers(p => ({ ...p, child: p.child - 1 }))}>−</button>
                                                        <span className={styles.mdtPaxCount}>{passengers.child}</span>
                                                        <button className={styles.mdtPaxBtn} disabled={passengers.child >= 9} onClick={() => setPassengers(p => ({ ...p, child: p.child + 1 }))}>+</button>
                                                    </div>
                                                </div>
                                                <div className={styles.mdtPaxRow}>
                                                    <div className={styles.mdtPaxLabel}>
                                                        <span>유아</span>
                                                        <span className={styles.mdtPaxAge}>만 2세 미만</span>
                                                    </div>
                                                    <div className={styles.mdtPaxCounter}>
                                                        <button className={styles.mdtPaxBtn} disabled={passengers.infant <= 0} onClick={() => setPassengers(p => ({ ...p, infant: p.infant - 1 }))}>−</button>
                                                        <span className={styles.mdtPaxCount}>{passengers.infant}</span>
                                                        <button className={styles.mdtPaxBtn} disabled={passengers.infant >= 4} onClick={() => setPassengers(p => ({ ...p, infant: p.infant + 1 }))}>+</button>
                                                    </div>
                                                </div>
                                            </div>
                                            {(passengers.adult + passengers.child + passengers.infant) > 1 && (
                                                <div className={styles.mdtPaxTotal}>
                                                    총 {passengers.adult + passengers.child + passengers.infant}명 · 예상 {formatPrice(totalPrice * (passengers.adult + passengers.child + passengers.infant))}
                                                </div>
                                            )}
                                            {(passengers.child + passengers.infant) > 0 && (
                                                <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                                    소아·유아 요금은 성인과 달라서, 정확한 금액은 예약 페이지에서 확인돼요.
                                                </p>
                                            )}
                                        </div>
                                    </>
                                )}

                                {/* 온라인투어 / 노랑풍선 / 하나투어: 면책조항 */}
                                {(modetourGuide.source === 'onlinetour' || modetourGuide.source === 'ybtour' || modetourGuide.source === 'hanatour') && (
                                    <div className={styles.mdtDisclaimer}>
                                        표시된 가격 및 좌석은 실시간 변동될 수 있으며,
                                        실제 예약은 {getSourceName(modetourGuide.source)}에서 직접 이루어집니다.
                                    </div>
                                )}

                                {/* 마이리얼트립: 예약 주체 안내 */}
                                {modetourGuide.source === 'myrealtrip' && (
                                    <div className={styles.mdtDisclaimer}>
                                        표시된 가격 및 좌석은 실시간 변동될 수 있으며,
                                        실제 예약은 마이리얼트립에서 직접 이루어집니다.
                                    </div>
                                )}
                                {/* 땡처리닷컴: TASF 수수료 안내 + 특가 목록에서 찾는 방법 */}
                                {modetourGuide.source === 'ttang' && (
                                    <>
                                        <div className={styles.mdtTtangNotice}>
                                            <span className={styles.mdtTtangNoticeIcon}>💡</span>
                                            <span>땡처리닷컴에서는 예약·결제 단계에서 <b>발권수수료 20,000원</b>이 추가될 수 있어요.</span>
                                        </div>
                                        <div className={styles.mdtDisclaimer}>
                                            표시된 가격 및 좌석은 실시간 변동될 수 있으며,
                                            실제 예약은 땡처리닷컴에서 직접 이루어집니다.
                                        </div>
                                    </>
                                )}

                                <div className={styles.mdtFreshnessReport}>
                                    <span className={styles.mdtFreshnessText}>
                                        가격 정보 · {getRecommendationFreshness(modetourGuide.priceCheckedAt).label}
                                    </span>
                                    {(recentFlightReports[modetourGuide.id]
                                        || (flightReport?.flightId === modetourGuide.id && flightReport.status === 'sent')) ? (
                                        <span className={styles.mdtReportDone}>✓ 신고 접수 완료</span>
                                    ) : (
                                        <div className={styles.mdtReportActions} aria-label="항공권 정보 신고">
                                            <span>정보가 다른가요?</span>
                                            <button
                                                type="button"
                                                onClick={() => reportFlightIssue(modetourGuide, 'price_changed')}
                                                disabled={flightReport?.status === 'sending'}
                                            >
                                                가격이 달라요
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => reportFlightIssue(modetourGuide, 'unavailable')}
                                                disabled={flightReport?.status === 'sending'}
                                            >
                                                예약이 안 돼요
                                            </button>
                                        </div>
                                    )}
                                </div>

                            </div>

                            {/* 예약 버튼: 스크롤 콘텐츠 하단에서 항상 고정 표시 */}
                            <div className={styles.mdtBookBtnWrap}>
                                <div
                                    aria-hidden="true"
                                    className={sheetHasMore ? styles.mdtScrollFade : `${styles.mdtScrollFade} ${styles.mdtScrollFadeHidden}`}
                                />
                                <div className={styles.mdtActionRow}>
                                    <button
                                        type="button"
                                        className={styles.mdtShareBtn}
                                        onClick={() => shareFlight(modetourGuide)}
                                        aria-label="이 항공권 공유하기"
                                    >
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                                            <polyline points="16 6 12 2 8 6" />
                                            <line x1="12" y1="2" x2="12" y2="15" />
                                        </svg>
                                        <span>공유</span>
                                    </button>
                                    {detailHotelUrl && (
                                        <a
                                            href={detailHotelUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={styles.mdtHotelBtn}
                                            title="트립닷컴에서 호텔 검색 (예약이 완료되면 티키티킷이 수수료를 받을 수 있습니다)"
                                            onClick={() => gtag.trackHotelAffiliateClick(
                                                `${depCity}-${arrCity}`,
                                                totalPrice,
                                                revenueClickDetails(modetourGuide, detailHotelTrackingId),
                                            )}
                                        >
                                            <span aria-hidden="true">🏨</span>
                                            <span>
                                                <strong>{arrCity} 호텔도 비교</strong>
                                                <small>트립닷컴 · 제휴</small>
                                            </span>
                                            <span aria-hidden="true">›</span>
                                        </a>
                                    )}
                                </div>
                                <button className={styles.mdtBookBtn} onClick={() => {
                                        gtag.trackBookingClick(modetourGuide.source, `${depCity}-${arrCity}`, totalPrice, revenueClickDetails(modetourGuide));
                                        if (modetourGuide.source === 'modetour') {
                                            const url = getMobileUrl(modetourGuide.link, isMobile);
                                            window.open(url, '_blank', 'noopener,noreferrer');
                                        } else if (modetourGuide.source === 'hanatour' || modetourGuide.source === 'onlinetour' || modetourGuide.source === 'ybtour' || modetourGuide.source === 'myrealtrip') {
                                            const url = getBookingUrl(modetourGuide, passengers);
                                            window.open(url, '_blank', 'noopener,noreferrer');
                                        } else if (modetourGuide.source === 'ttang') {
                                            const url = getTtangBookingUrl(modetourGuide);
                                            window.open(url, '_blank', 'noopener,noreferrer');
                                        } else {
                                            const url = getMobileUrl(modetourGuide.link, isMobile);
                                            window.open(url, '_blank', 'noopener,noreferrer');
                                        }
                                        setModetourGuide(null);
                                    }}>
                                        {getSourceName(modetourGuide.source)}에서 예약하기 →
                                </button>
                                {modetourGuide.source === 'myrealtrip' && (
                                    <p className={styles.affiliateDisclosure}>
                                        제휴 링크 안내: 이 링크를 통해 예약이 완료되면 티키티킷이 수수료를 받을 수 있습니다.
                                    </p>
                                )}
                            </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* 예약 면책조항 팝업 */}
            {bookingDisclaimer && (
                <div className={styles.modalOverlay} onClick={dismissDisclaimer}>
                    <div className={styles.modalSheet} onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
                        <div className={styles.modalHeader}>
                            <h3 className={styles.modalTitle}>안내</h3>
                            <button className={styles.modalClose} onClick={dismissDisclaimer}>×</button>
                        </div>
                        <div style={{ padding: '20px 16px 8px', lineHeight: 1.7 }}>
                            {!isMobile && (
                                <>
                                    {bookingDisclaimer.source === 'hanatour' ? (
                                        <div style={{ fontSize: '36px', marginBottom: '8px' }}>⏳</div>
                                    ) : (
                                        <div style={{ fontSize: '36px', marginBottom: '8px' }}>✈️</div>
                                    )}
                                    <p style={{ fontSize: '14px', color: '#555', margin: '0 0 4px' }}>
                                        잠시 후 자동으로 이동합니다
                                    </p>
                                    {bookingDisclaimer.source === 'hanatour' && (
                                        <p style={{ fontSize: '13px', color: '#888', margin: '0 0 4px' }}>
                                            하나투어 페이지 연결에 시간이 걸릴 수 있어요
                                        </p>
                                    )}
                                </>
                            )}
                        </div>
                        {isMobile && (
                            <div style={{ fontSize: '36px', textAlign: 'center', margin: '0 0 8px' }}>✈️</div>
                        )}
                        <div style={{ padding: '0 16px 20px', fontSize: '12px', color: '#999', lineHeight: 1.6, textAlign: 'left' }}>
                            <p style={{ margin: '0 0 6px', fontWeight: 600, color: '#aaa', fontSize: '11px' }}>안내사항</p>
                            <p style={{ margin: 0 }}>
                                표시된 가격 및 좌석은 실시간 변동될 수 있으며,
                                실제 예약은 해당 여행사에서 직접 이루어집니다.
                                티키티킷은 가격 비교 정보를 제공하며,
                                예약·결제·환불 등에 대한 책임은 해당 여행사에 있습니다.
                            </p>
                        </div>
                        {isMobile && (
                            <div style={{ padding: '0 16px 16px' }}>
                                <a
                                    href={bookingDisclaimer.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={styles.modalConfirm}
                                    style={{ display: 'block', textDecoration: 'none', textAlign: 'center' }}
                                    onClick={() => setBookingDisclaimer(null)}
                                >
                                    {getSourceName(bookingDisclaimer.source)}에서 예약하기 →
                                </a>
                            </div>
                        )}
                    </div>
                </div>
            )}



            {/* 네이버 가격비교 주의사항 안내 모달 */}
            {naverDisclaimer && (
                <div className={styles.modalOverlay} onClick={() => setNaverDisclaimer(null)}>
                    <div className={styles.modalSheet} onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
                        <div className={styles.modalHeader}>
                            <h3 className={styles.modalTitle}>네이버 가격비교 안내</h3>
                            <button className={styles.modalClose} onClick={() => setNaverDisclaimer(null)}>×</button>
                        </div>
                        <div style={{ padding: '16px 20px 0', textAlign: 'center' }}>
                            <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔍</div>
                            <p style={{ fontSize: '14px', fontWeight: 600, color: '#333', margin: '0 0 16px' }}>
                                {naverDisclaimer.route} 노선을 네이버에서 비교합니다
                            </p>
                        </div>
                        <div style={{ padding: '0 20px 16px' }}>
                            <div className={styles.naverDisclaimerList}>
                                <div className={styles.naverDisclaimerItem}>
                                    <span className={styles.naverDisclaimerIcon}>💰</span>
                                    <div>
                                        <strong>표시 가격 ≠ 실제 결제 가격</strong>
                                        <p>검색 결과의 최저가를 클릭하면 실제 가격이 다를 수 있습니다 (세금·수수료 별도 등)</p>
                                    </div>
                                </div>
                                <div className={styles.naverDisclaimerItem}>
                                    <span className={styles.naverDisclaimerIcon}>🧳</span>
                                    <div>
                                        <strong>위탁수하물 포함 여부 확인</strong>
                                        <p>최저가 항공권은 위탁수하물이 별도일 수 있으니 포함 여부를 확인하세요</p>
                                    </div>
                                </div>
                                <div className={styles.naverDisclaimerItem}>
                                    <span className={styles.naverDisclaimerIcon}>🌐</span>
                                    <div>
                                        <strong>해외 업체 주의</strong>
                                        <p>해외 OTA(온라인 여행사)는 CS(고객센터) 대응이 어렵고, 환불·변경이 까다로울 수 있습니다</p>
                                    </div>
                                </div>
                                <div className={styles.naverDisclaimerItem}>
                                    <span className={styles.naverDisclaimerIcon}>🕐</span>
                                    <div>
                                        <strong>출도착 시간 확인</strong>
                                        <p>비선호 시간대라 저렴한 경우가 있으니 출도착 시간을 확인하세요</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div style={{ padding: '0 20px 20px', display: 'flex', gap: '8px' }}>
                            <button
                                className={styles.modalCancel}
                                onClick={() => setNaverDisclaimer(null)}
                                style={{ flex: 1 }}
                            >
                                닫기
                            </button>
                            <a
                                href={naverDisclaimer.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.modalConfirm}
                                style={{ flex: 2, display: 'block', textDecoration: 'none', textAlign: 'center' }}
                                onClick={() => {
                                    gtag.trackCompareOutboundClick(
                                        'naver',
                                        naverDisclaimer.analyticsRoute,
                                        naverDisclaimer.price,
                                    );
                                    setNaverDisclaimer(null);
                                }}
                            >
                                네이버에서 비교하기 →
                            </a>
                        </div>
                    </div>
                </div>
            )}

            {/* 땡처리닷컴 수수료 안내 모달 */}
            {ttangConfirmFlight && (
                <div className={styles.modalOverlay} onClick={() => setTtangConfirmFlight(null)}>
                    <div className={styles.modalSheet} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h3 className={styles.modalTitle}>안내</h3>
                            <button className={styles.modalClose} onClick={() => setTtangConfirmFlight(null)}>×</button>
                        </div>
                        <div style={{ padding: '12px 20px 16px', fontSize: '15px', color: '#333', lineHeight: 1.8, textAlign: 'center' }}>
                            표시된 금액은 수수료 전 가격이에요.<br />
                            땡처리닷컴에서 <b>발권수수료 20,000원</b>이 추가될 수 있어요.
                        </div>
                        <div style={{ padding: '0 16px 16px', fontSize: '12px', color: '#999', lineHeight: 1.6, textAlign: 'left' }}>
                            <p style={{ margin: '0 0 6px', fontWeight: 600, color: '#aaa', fontSize: '11px' }}>안내사항</p>
                            <p style={{ margin: 0 }}>
                                표시된 가격 및 좌석은 실시간 변동될 수 있으며,
                                실제 예약은 해당 여행사에서 직접 이루어집니다.
                                티키티킷은 가격 비교 정보를 제공하며,
                                예약·결제·환불 등에 대한 책임은 해당 여행사에 있습니다.
                            </p>
                        </div>
                        <button className={styles.modalConfirm} onClick={() => {
                            const f = ttangConfirmFlight;
                            const r = `${normalizeCity(f.departure.city)}-${normalizeCity(f.arrival.city)}`;
                            gtag.trackBookingClick(f.source, r, f.price, revenueClickDetails(f));
                            const url = getTtangBookingUrl(f);
                            window.open(url, '_blank', 'noopener,noreferrer');
                            setTtangConfirmFlight(null);
                        }}>
                            땡처리닷컴에서 예약하기 →
                        </button>
                    </div>
                </div>
            )}

            {/* 출발지 + 지역 + 예산 조건형 특가 알림 베타 */}
            {showDealAlertSetup && (
                <div className={styles.modalOverlay} onClick={() => setShowDealAlertSetup(false)}>
                    <div className={styles.dealAlertSheet} onClick={(event) => event.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <div>
                                <h3 className={styles.modalTitle}>🔔 원하는 특가 알림 받기</h3>
                                <p className={styles.alertManagerSubtitle}>날짜와 목적지는 정하지 않아도 됩니다.</p>
                            </div>
                            <button className={styles.modalClose} onClick={() => setShowDealAlertSetup(false)}>×</button>
                        </div>

                        <div className={styles.dealAlertBody}>
                            {dealAlertSetup.status === 'sent' ? (
                                <div className={styles.dealAlertSuccess}>
                                    <span>✓</span>
                                    <strong>조건을 저장했습니다.</strong>
                                    <p>{dealAlertSetup.message}</p>
                                    <button type="button" onClick={() => setShowDealAlertSetup(false)}>확인</button>
                                </div>
                            ) : (
                                <>
                                    <label className={styles.dealAlertField}>
                                        <span>어디서 출발하세요?</span>
                                        <select
                                            value={dealAlertSetup.departureCity}
                                            onChange={event => setDealAlertSetup(current => ({
                                                ...current,
                                                departureCity: event.target.value,
                                                status: 'idle',
                                                message: undefined,
                                            }))}
                                        >
                                            <option value="인천">인천</option>
                                            <option value="부산">부산</option>
                                            <option value="대구">대구</option>
                                            <option value="청주">청주</option>
                                        </select>
                                    </label>

                                    <label className={styles.dealAlertField}>
                                        <span>어디쯤 가고 싶으세요?</span>
                                        <select
                                            value={dealAlertSetup.region}
                                            onChange={event => setDealAlertSetup(current => ({
                                                ...current,
                                                region: event.target.value as DealAlertRegion,
                                                status: 'idle',
                                                message: undefined,
                                            }))}
                                        >
                                            <option value="일본">일본</option>
                                            <option value="동남아">동남아</option>
                                            <option value="중국">중화권</option>
                                            <option value="남태평양">남태평양</option>
                                            <option value="all">아무데나</option>
                                        </select>
                                    </label>

                                    <div className={styles.dealAlertField}>
                                        <span>얼마까지 괜찮으세요?</span>
                                        <div className={styles.dealAlertBudgetButtons}>
                                            {[150000, 200000, 300000].map(price => (
                                                <button
                                                    key={price}
                                                    type="button"
                                                    className={dealAlertSetup.maxPrice === String(price) ? styles.dealAlertBudgetActive : ''}
                                                    onClick={() => setDealAlertSetup(current => ({
                                                        ...current,
                                                        maxPrice: String(price),
                                                        status: 'idle',
                                                        message: undefined,
                                                    }))}
                                                >
                                                    {price / 10000}만원
                                                </button>
                                            ))}
                                        </div>
                                        <div className={styles.dealAlertCustomPrice}>
                                            <input
                                                type="number"
                                                min="10000"
                                                max="10000000"
                                                step="1000"
                                                inputMode="numeric"
                                                placeholder="직접 입력"
                                                value={dealAlertSetup.maxPrice}
                                                onChange={event => setDealAlertSetup(current => ({
                                                    ...current,
                                                    maxPrice: event.target.value,
                                                    status: 'idle',
                                                    message: undefined,
                                                }))}
                                            />
                                            <span>원 이하</span>
                                        </div>
                                    </div>

                                    <p className={styles.dealAlertNote}>
                                        조건에 맞는 표를 모두 보내지는 않습니다. 가격이 좋고 일정이 괜찮은 표만 알려드려요.
                                        지금은 알림을 보내기 전에 후보를 확인하는 베타 단계입니다.
                                    </p>
                                    {dealAlertSetup.message && (
                                        <p className={styles.priceAlertError}>{dealAlertSetup.message}</p>
                                    )}
                                    <button
                                        type="button"
                                        className={styles.dealAlertSubmit}
                                        disabled={dealAlertSetup.status === 'saving'}
                                        onClick={saveDealAlert}
                                    >
                                        {dealAlertSetup.status === 'saving' ? '저장 중…' : '이 조건으로 알려주세요'}
                                    </button>
                                    {account.status === 'authenticated' && (
                                        <button
                                            type="button"
                                            className={styles.dealAlertSaveOnly}
                                            disabled={dealAlertSetup.status === 'saving'}
                                            onClick={() => void saveDealSearchOnly()}
                                        >
                                            알림 없이 조건만 저장
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 현재 브라우저의 가격 알림 관리 */}
            {showPriceAlertManager && (
                <div className={styles.modalOverlay} onClick={() => setShowPriceAlertManager(false)}>
                    <div className={styles.alertManagerSheet} onClick={(event) => event.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <div>
                                <h3 className={styles.modalTitle}>🔔 내 가격 알림</h3>
                                <p className={styles.alertManagerSubtitle}>이 브라우저에서 등록한 알림만 표시됩니다.</p>
                            </div>
                            <button className={styles.modalClose} onClick={() => setShowPriceAlertManager(false)}>×</button>
                        </div>

                        <div className={styles.alertManagerBody}>
                            <button
                                type="button"
                                className={styles.alertManagerCreateDealBtn}
                                onClick={() => {
                                    setShowPriceAlertManager(false);
                                    openDealAlertSetup();
                                }}
                            >
                                <span className={styles.alertManagerCreateDealIcon}>✨</span>
                                <span>
                                    <strong>원하는 특가 알림 추가하기</strong>
                                    <small>날짜·목적지 없이 출발지·지역·예산만 선택</small>
                                </span>
                                <b aria-hidden="true">›</b>
                            </button>

                            {priceAlertManagerStatus === 'loading' ? (
                                <div className={styles.alertManagerEmpty}>알림을 불러오는 중…</div>
                            ) : managedPriceAlerts.length === 0 ? (
                                <div className={styles.alertManagerEmpty}>
                                    <span>🔕</span>
                                    <strong>등록된 가격 알림이 없습니다.</strong>
                                    <p>항공권 상세 화면에서 원하는 노선의 가격 알림을 등록할 수 있어요.</p>
                                </div>
                            ) : (
                                <div className={styles.alertManagerList}>
                                    {managedPriceAlerts.map(alert => (
                                        <div key={alert.id} className={styles.alertManagerItem}>
                                            <div className={styles.alertManagerRoute}>
                                                <strong>
                                                    {alert.type === 'deal' && alert.region
                                                        ? `${alert.departureCity} 출발 · ${dealAlertRegionLabel(alert.region)}`
                                                        : `${alert.departureCity} → ${alert.arrivalCity}`}
                                                </strong>
                                                <span>{alert.type === 'deal' ? '맡겨둔 조건 · 베타' : '출발일 상관없이'}</span>
                                            </div>
                                            <label className={styles.alertManagerPrice}>
                                                    <span>{alert.type === 'deal' ? '최대 예산' : '목표 가격'}</span>
                                                <div>
                                                    <input
                                                        type="number"
                                                        min="10000"
                                                        max="10000000"
                                                        step="1000"
                                                        inputMode="numeric"
                                                        value={alert.draftPrice}
                                                        onChange={event => setManagedPriceAlerts(current => current.map(item => item.id === alert.id
                                                            ? { ...item, draftPrice: event.target.value }
                                                            : item))}
                                                        aria-label={alert.type === 'deal' && alert.region
                                                            ? `${alert.departureCity} 출발 ${dealAlertRegionLabel(alert.region)} 최대 예산`
                                                            : `${alert.departureCity}에서 ${alert.arrivalCity} 목표 가격`}
                                                    />
                                                    <span>원 이하</span>
                                                </div>
                                            </label>
                                            <div className={styles.alertManagerActions}>
                                                <button
                                                    type="button"
                                                    className={styles.alertManagerSaveBtn}
                                                    disabled={priceAlertManagerBusy !== null || alert.draftPrice === String(alert.maxPrice)}
                                                    onClick={() => updateManagedPriceAlert(alert)}
                                                >
                                                    {priceAlertManagerBusy === alert.id ? '저장 중…' : '변경 저장'}
                                                </button>
                                                <button
                                                    type="button"
                                                    className={styles.alertManagerDeleteBtn}
                                                    disabled={priceAlertManagerBusy !== null}
                                                    onClick={() => deleteManagedPriceAlert(alert)}
                                                >
                                                    알림 해제
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {priceAlertManagerMessage && (
                                <p className={priceAlertManagerStatus === 'error' ? styles.alertManagerError : styles.alertManagerMessage}>
                                    {priceAlertManagerMessage}
                                </p>
                            )}

                            {managedPriceAlerts.length > 0 && (
                                <button
                                    type="button"
                                    className={styles.alertManagerTestBtn}
                                    disabled={priceAlertManagerBusy !== null}
                                    onClick={sendManagedPriceAlertTest}
                                >
                                    {priceAlertManagerBusy === 'test' ? '테스트 알림 보내는 중…' : '테스트 알림 보내기'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 문의하기 모달 */}
            {showContactModal && (
                <div className={styles.modalOverlay} onClick={() => setShowContactModal(false)}>
                    <div className={styles.modalSheet} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <h3 className={styles.modalTitle}>📬 문의하기</h3>
                            <button className={styles.modalClose} onClick={() => setShowContactModal(false)}>×</button>
                        </div>
                        <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div>
                                <label style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: '4px', display: 'block' }}>이름 (선택)</label>
                                <input
                                    type="text"
                                    value={contactForm.name}
                                    onChange={(e) => setContactForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="홍길동"
                                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '0.95rem' }}
                                />
                            </div>
                            <div>
                                <label style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: '4px', display: 'block' }}>이메일 (선택)</label>
                                <input
                                    type="email"
                                    value={contactForm.email}
                                    onChange={(e) => setContactForm(f => ({ ...f, email: e.target.value }))}
                                    placeholder="reply@example.com"
                                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '0.95rem' }}
                                />
                            </div>
                            <div>
                                <label style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: '4px', display: 'block' }}>문의 내용 *</label>
                                <textarea
                                    value={contactForm.message}
                                    onChange={(e) => setContactForm(f => ({ ...f, message: e.target.value }))}
                                    placeholder="문의 내용을 입력해주세요."
                                    rows={4}
                                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '0.95rem', resize: 'vertical', fontFamily: 'inherit' }}
                                />
                            </div>
                            <button
                                className={styles.modalConfirm}
                                disabled={!contactForm.message.trim() || contactSending}
                                onClick={async () => {
                                    setContactSending(true);
                                    try {
                                        const res = await fetch('/api/contact', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify(contactForm),
                                        });
                                        if (res.ok) {
                                            setShowContactModal(false);
                                            setContactForm({ name: '', email: '', message: '' });
                                            setShareToast('✅ 문의가 전송되었습니다. 감사합니다!');
                                            setTimeout(() => setShareToast(''), 3000);
                                        } else {
                                            const data = await res.json();
                                            setShareToast(`❌ ${data.error || '전송에 실패했습니다.'}`);
                                            setTimeout(() => setShareToast(''), 3000);
                                        }
                                    } catch {
                                        setShareToast('❌ 네트워크 오류가 발생했습니다.');
                                        setTimeout(() => setShareToast(''), 3000);
                                    } finally {
                                        setContactSending(false);
                                    }
                                }}
                            >
                                {contactSending ? '전송 중...' : '문의 보내기 ✉️'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <AccountSheet
                open={showAccount}
                onClose={() => setShowAccount(false)}
                account={account}
                onApplySearch={applyAccountSearch}
                onOpenFlight={openAccountFlight}
                onOpenAlert={() => {
                    setShowAccount(false);
                    openDealAlertSetup();
                }}
                onFavoriteRemoved={flightId => {
                    setFavoriteFlights(current => {
                        const next = current.filter(id => id !== flightId);
                        try { localStorage.setItem('favoriteFlights', JSON.stringify(next)); } catch { }
                        return next;
                    });
                }}
            />

            {/* 공유/알림 토스트 */}
            {shareToast && (
                <div className={styles.shareToast}>{shareToast}</div>
            )}
            {favToast && (
                <div className={styles.shareToast}>{favToast}</div>
            )}
        </div>
    );
}
