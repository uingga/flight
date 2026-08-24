'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ko } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import Logo from '@/components/Logo';
import * as gtag from '@/lib/analytics';
import { calcFlightTiming, normalizeCity } from '@/lib/utils/flight-helpers';
import { getTripcomHotelUrl, getTripcomTrackingId } from '@/lib/utils/tripcom-helpers';
import type { Flight } from '@/types/flight';
import AccountSheet from '@/components/account/AccountSheet';
import { useAccount, type AccountSearchFilters } from '@/components/account/useAccount';
import styles from './page.module.css';

type SortMode = 'recommended' | 'price' | 'date';
type DatePeriod = 'all' | 'this-week' | 'next-week' | 'this-month' | 'next-month' | 'custom';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DatePicker: any = dynamic(() => import('react-datepicker').then((mod: any) => mod.default), { ssr: false });

interface FlightsResponse {
    success: boolean;
    count: number;
    flights: Flight[];
    lastUpdated?: string | null;
    todayPickId?: string | null;
    priceHistory?: PriceHistory;
}

interface PriceHistoryEntry {
    date: string;
    minPrice: number;
    avgPrice?: number;
    count?: number;
}

type PriceHistory = Record<string, PriceHistoryEntry[]>;

interface FeedInsight {
    id: string;
    kind: 'price' | 'stay' | 'schedule' | 'timing' | 'airport' | 'discovery' | 'new' | 'opportunity';
    editorial?: boolean;
    eyebrow: string;
    title: string;
    flight: Flight;
    destination: string;
    currentPrice: number;
    previousPrice?: number;
    meta: string;
    badge?: string;
    description?: string;
}

const SOURCE_NAMES: Record<Flight['source'], string> = {
    ybtour: '노랑풍선',
    modetour: '모두투어',
    hanatour: '하나투어',
    onlinetour: '온라인투어',
    ttang: '땡처리닷컴',
    myrealtrip: '마이리얼트립',
};

const TTANG_TICKETING_FEE = 20_000;

const REGION_OPTIONS = ['전체', '일본', '동남아', '중화권', '남태평양', '유럽', '미주', '기타'];
const QUICK_REGION_OPTIONS = REGION_OPTIONS.slice(0, 4);
const MORE_REGION_OPTIONS = REGION_OPTIONS.slice(4);
const DEPARTURE_OPTIONS = ['전체', '인천/김포', '부산/김해', '대구', '청주', '제주'];
const DATE_PERIOD_OPTIONS: Array<{ label: string; value: DatePeriod }> = [
    { label: '전체', value: 'all' },
    { label: '이번 주', value: 'this-week' },
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

const effectivePrice = (flight: Flight) => flight.price + (flight.source === 'ttang' ? TTANG_TICKETING_FEE : 0);

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

const shortDateWithOffset = (value: string, offset: number) => {
    const date = parseDate(value);
    if (!date) return shortDate(value);
    date.setDate(date.getDate() + offset);
    return new Intl.DateTimeFormat('ko-KR', {
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
    }).format(date).replace(/\.$/, '');
};

const cardDate = (value: string) => {
    const date = parseDate(value);
    if (!date) return value || '날짜 확인';
    const weekday = new Intl.DateTimeFormat('ko-KR', { weekday: 'short' }).format(date);
    return `${date.getMonth() + 1}월 ${date.getDate()}일(${weekday})`;
};

const tripLength = (flight: Flight) => {
    const departure = parseDate(flight.departure.date);
    const arrival = parseDate(flight.arrival.date);
    if (!departure || !arrival) return null;
    const days = Math.round((arrival.getTime() - departure.getTime()) / 86_400_000) + 1;
    if (days === 1) return '당일';
    return days > 1 ? `${days - 1}박 ${days}일` : null;
};

const fallbackArrivalDayOffset = (departureTime?: string, arrivalTime?: string) => {
    const parseMinutes = (value?: string) => {
        const match = value?.match(/(\d{1,2}):(\d{2})/);
        if (!match) return null;
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        if (hours > 23 || minutes > 59) return null;
        return hours * 60 + minutes;
    };
    const departureMinutes = parseMinutes(departureTime);
    const arrivalMinutes = parseMinutes(arrivalTime);
    if (departureMinutes === null || arrivalMinutes === null) return 0;
    return arrivalMinutes < departureMinutes ? 1 : 0;
};

const departureCountdownText = (flight: Flight, referenceDate: Date) => {
    const departure = parseDate(flight.departure.date);
    if (!departure) return '출발일 확인';
    const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate(), 12);
    const daysUntilDeparture = Math.ceil((departure.getTime() - today.getTime()) / 86_400_000);
    if (daysUntilDeparture <= 0) return '오늘 출발';
    return `출발 D-${daysUntilDeparture}`;
};

const priceText = (price: number) => `${new Intl.NumberFormat('ko-KR').format(price)}원`;

const compactWon = (price: number) => {
    const tenThousands = price / 10_000;
    const value = Number.isInteger(tenThousands) ? tenThousands.toFixed(0) : tenThousands.toFixed(1);
    return `${value}만원`;
};

const normalizedRoute = (flight: Flight) => `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`;

const normalizedHistory = (history: PriceHistory) => {
    const result: PriceHistory = {};
    Object.entries(history).forEach(([route, entries]) => {
        const separator = route.indexOf('-');
        if (separator < 1) return;
        const key = `${normalizeCity(route.slice(0, separator))}-${normalizeCity(route.slice(separator + 1))}`;
        const byDate = new Map<string, PriceHistoryEntry>();
        [...(result[key] || []), ...entries].forEach(entry => {
            const existing = byDate.get(entry.date);
            if (!existing) {
                byDate.set(entry.date, { ...entry });
                return;
            }
            byDate.set(entry.date, {
                date: entry.date,
                minPrice: Math.min(existing.minPrice, entry.minPrice),
                avgPrice: existing.avgPrice && entry.avgPrice
                    ? Math.round((existing.avgPrice + entry.avgPrice) / 2)
                    : existing.avgPrice || entry.avgPrice,
                count: (existing.count || 0) + (entry.count || 0) || undefined,
            });
        });
        result[key] = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    });
    return result;
};

const diversifyFlights = (items: Flight[], topWindow = 24, maxPerDestination = 2, maxConsecutive = 2) => {
    if (items.length <= maxConsecutive) return items;
    const remaining = [...items];
    const result: Flight[] = [];
    const topCounts = new Map<string, number>();

    const breaksConsecutiveRun = (flight: Flight) => {
        if (result.length < maxConsecutive) return true;
        const destination = normalizeCity(flight.arrival.city);
        return result.slice(-maxConsecutive).some(item => normalizeCity(item.arrival.city) !== destination);
    };

    while (remaining.length > 0) {
        const protectTopMix = result.length < topWindow;
        let candidateIndex = remaining.findIndex(flight => {
            const destination = normalizeCity(flight.arrival.city);
            return breaksConsecutiveRun(flight)
                && (!protectTopMix || (topCounts.get(destination) || 0) < maxPerDestination);
        });
        if (candidateIndex < 0) candidateIndex = remaining.findIndex(breaksConsecutiveRun);
        if (candidateIndex < 0) candidateIndex = 0;

        const [next] = remaining.splice(candidateIndex, 1);
        result.push(next);
        if (result.length <= topWindow) {
            const destination = normalizeCity(next.arrival.city);
            topCounts.set(destination, (topCounts.get(destination) || 0) + 1);
        }
    }
    return result;
};

const airportLabel = (city: string, airport?: string) => (
    airport ? `${city}(${airport})` : city
);

const agencyFlightDuration = (value?: string) => {
    const parsed = value?.match(/^(\d{1,2}):(\d{2})/);
    if (!parsed) return null;
    const hours = Number(parsed[1]);
    const minutes = Number(parsed[2]);
    return `${hours}시간${minutes > 0 ? ` ${minutes}분` : ''}`;
};

const legDetails = (flight: Flight, leg: 'outbound' | 'return') => {
    const detail = flight.modetourDetail;
    const departureCity = departureName(flight);
    const arrivalCity = stripAirport(flight.arrival.city);

    if (leg === 'outbound') {
        const arrivalTime = detail?.departureArrivalTime || flight.departure.arrivalTime || '';
        const timing = calcFlightTiming(departureCity, flight.departure.time, flight.departure.date, arrivalCity, arrivalTime);
        const fallbackDayOffset = fallbackArrivalDayOffset(flight.departure.time, arrivalTime);
        return {
            origin: airportLabel(departureCity, flight.departure.airport),
            destination: airportLabel(arrivalCity, flight.arrival.airport),
            departureTime: flight.departure.time || '시간 확인',
            arrivalTime: arrivalTime || '시간 확인',
            departureDate: shortDate(flight.departure.date),
            arrivalDate: shortDateWithOffset(flight.departure.date, timing?.arrivalDayOffset ?? fallbackDayOffset),
            duration: timing?.duration || agencyFlightDuration(detail?.flyingTime),
        };
    }

    const departureTime = detail?.returnDepartureTime || flight.arrival.time || '';
    const arrivalTime = detail?.returnArrivalTime || flight.arrival.arrivalTime || '';
    const timing = calcFlightTiming(arrivalCity, departureTime, flight.arrival.date, departureCity, arrivalTime);
    const fallbackDayOffset = fallbackArrivalDayOffset(departureTime, arrivalTime);
    return {
        origin: airportLabel(arrivalCity, detail?.returnDepartureAirport || flight.arrival.airport),
        destination: airportLabel(departureCity, detail?.returnArrivalAirport || flight.departure.airport),
        departureTime: departureTime || '시간 확인',
        arrivalTime: arrivalTime || '시간 확인',
        departureDate: shortDate(flight.arrival.date),
        arrivalDate: shortDateWithOffset(flight.arrival.date, timing?.arrivalDayOffset ?? fallbackDayOffset),
        duration: timing?.duration || agencyFlightDuration(detail?.returnFlyingTime),
    };
};

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

const dateKey = (date: Date) => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
].join('-');

const datePeriodMatches = (
    flight: Flight,
    period: DatePeriod,
    referenceDate: Date,
    customStartDate: Date | null,
    customEndDate: Date | null,
) => {
    if (period === 'all') return true;
    const departureDate = parseDate(flight.departure.date);
    if (!departureDate) return false;

    if (period === 'custom') {
        const departureKey = dateKey(departureDate);
        return (!customStartDate || departureKey >= dateKey(customStartDate))
            && (!customEndDate || departureKey <= dateKey(customEndDate));
    }

    const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
    const mondayOffset = (today.getDay() + 6) % 7;
    const thisMonday = addDays(today, -mondayOffset);
    let start: Date;
    let end: Date;

    if (period === 'this-week') {
        start = thisMonday;
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

const clockMinutes = (value?: string) => {
    const match = value?.match(/(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
};

const daysBetweenDates = (start?: string, end?: string) => {
    const startDate = start ? parseDate(start) : null;
    const endDate = end ? parseDate(end) : null;
    if (!startDate || !endDate) return null;
    return Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000);
};

const outboundArrivalTime = (flight: Flight) => (
    flight.modetourDetail?.departureArrivalTime || flight.departure.arrivalTime || ''
);

const returnDepartureTime = (flight: Flight) => (
    flight.modetourDetail?.returnDepartureTime || flight.arrival.time || ''
);

const returnArrivalTime = (flight: Flight) => (
    flight.modetourDetail?.returnArrivalTime || flight.arrival.arrivalTime || ''
);

const onsiteStayMinutes = (flight: Flight) => {
    const tripDays = daysBetweenDates(flight.departure.date, flight.arrival.date);
    const arrivalTime = outboundArrivalTime(flight);
    const returnTime = returnDepartureTime(flight);
    const arrivalMinutes = clockMinutes(arrivalTime);
    const returnMinutes = clockMinutes(returnTime);
    if (tripDays === null || arrivalMinutes === null || returnMinutes === null) return null;

    const timing = calcFlightTiming(
        departureName(flight),
        flight.departure.time,
        flight.departure.date,
        stripAirport(flight.arrival.city),
        arrivalTime,
    );
    const arrivalDayOffset = timing?.arrivalDayOffset
        ?? fallbackArrivalDayOffset(flight.departure.time, arrivalTime);
    const minutes = (tripDays - arrivalDayOffset) * 1_440 + returnMinutes - arrivalMinutes;
    return minutes >= 12 * 60 && minutes <= 10 * 24 * 60 ? minutes : null;
};

const returnArrivalDate = (flight: Flight) => {
    const returnDate = parseDate(flight.arrival.date);
    const departureTime = returnDepartureTime(flight);
    const arrivalTime = returnArrivalTime(flight);
    if (!returnDate || clockMinutes(departureTime) === null || clockMinutes(arrivalTime) === null) return null;
    const timing = calcFlightTiming(
        stripAirport(flight.arrival.city),
        departureTime,
        flight.arrival.date,
        departureName(flight),
        arrivalTime,
    );
    return addDays(returnDate, timing?.arrivalDayOffset ?? fallbackArrivalDayOffset(departureTime, arrivalTime));
};

const isZeroPtoSchedule = (flight: Flight) => {
    const departureDate = parseDate(flight.departure.date);
    const departureMinutes = clockMinutes(flight.departure.time);
    const homeArrivalDate = returnArrivalDate(flight);
    return !!departureDate
        && departureDate.getDay() === 5
        && departureMinutes !== null
        && departureMinutes >= 18 * 60
        && !!homeArrivalDate
        && homeArrivalDate.getDay() === 0;
};

const harshScheduleDetail = (flight: Flight) => {
    const outboundDeparture = clockMinutes(flight.departure.time);
    const outboundArrival = clockMinutes(outboundArrivalTime(flight));
    const inboundDeparture = clockMinutes(returnDepartureTime(flight));
    const inboundArrival = clockMinutes(returnArrivalTime(flight));
    if (outboundDeparture !== null && outboundDeparture < 7 * 60) return `가는 편 ${flight.departure.time} 출발`;
    if (outboundArrival !== null && (outboundArrival < 5 * 60 || outboundArrival >= 23 * 60)) return `가는 편 ${outboundArrivalTime(flight)} 도착`;
    if (inboundDeparture !== null && inboundDeparture < 7 * 60) return `오는 편 ${returnDepartureTime(flight)} 출발`;
    if (inboundArrival !== null && (inboundArrival < 5 * 60 || inboundArrival >= 23 * 60)) return `오는 편 ${returnArrivalTime(flight)} 도착`;
    return null;
};

// 상단 경보는 평범한 오늘의 표가 아니라, 가격과 할인폭이 함께 드문 경우에만 켠다.
const isTickerWorthyDrop = (flight: Flight) => {
    const price = effectivePrice(flight);
    const discount = Math.max(0, flight.discountRate || 0);
    return price <= 140_000 || (price <= 180_000 && discount >= 25);
};

const describeTodayPick = (flight: Flight) => {
    const localAirports: Record<string, string> = { PUS: '부산', TAE: '대구', CJJ: '청주', CJU: '제주' };
    const localCity = localAirports[flight.departure.airport || ''];
    if (localCity) return `${localCity}에서 바로 떠나는 표예요`;
    const duration = tripLength(flight);
    if (duration && effectivePrice(flight) < 300_000) return `${duration}을 30만원 아래로 다녀와요`;
    if (effectivePrice(flight) < 200_000) return '20만원 아래로 다녀올 수 있어요';
    return '오늘 가장 먼저 살펴볼 항공권이에요';
};

function Icon({ name }: { name: 'sliders' | 'search' | 'star' | 'share' | 'close' | 'arrow' | 'plane' | 'up' }) {
    const paths = {
        sliders: <><line x1="4" y1="7" x2="20" y2="7" /><circle cx="9" cy="7" r="2" /><line x1="4" y1="17" x2="20" y2="17" /><circle cx="15" cy="17" r="2" /></>,
        search: <><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></>,
        star: <polygon points="12 2.8 14.8 8.5 21.1 9.4 16.5 13.9 17.6 20.2 12 17.2 6.4 20.2 7.5 13.9 2.9 9.4 9.2 8.5 12 2.8" />,
        share: <><path d="M4 12v8h16v-8" /><polyline points="8 7 12 3 16 7" /><line x1="12" y1="3" x2="12" y2="15" /></>,
        close: <><line x1="5" y1="5" x2="19" y2="19" /><line x1="19" y1="5" x2="5" y2="19" /></>,
        arrow: <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="14 7 19 12 14 17" /></>,
        plane: <path d="M22 12c0-.6-.5-1.1-1.1-1.2l-6.4-.9-3.8-6.2C10.4 3.3 10 3 9.4 3H8.1l2.2 7.3-4.8.7-1.8-2H2.2l1 3-1 3h1.5l1.8-2 4.8.7L8.1 21h1.3c.6 0 1-.3 1.3-.7l3.8-6.2 6.4-.9c.6-.1 1.1-.6 1.1-1.2Z" />,
        up: <><line x1="12" y1="19" x2="12" y2="5" /><polyline points="6.5 10.5 12 5 17.5 10.5" /></>,
    };
    return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function MobileRedesignPreview() {
    const account = useAccount();
    const [flights, setFlights] = useState<Flight[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [todayPickId, setTodayPickId] = useState<string | null>(null);
    const [priceHistory, setPriceHistory] = useState<PriceHistory>({});
    const [region, setRegion] = useState('전체');
    const [departure, setDeparture] = useState('전체');
    const [datePeriod, setDatePeriod] = useState<DatePeriod>('all');
    const [customStartDate, setCustomStartDate] = useState<Date | null>(null);
    const [customEndDate, setCustomEndDate] = useState<Date | null>(null);
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [maxPrice, setMaxPrice] = useState(0);
    const [sort, setSort] = useState<SortMode>('recommended');
    const [query, setQuery] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [filterOpen, setFilterOpen] = useState(false);
    const [regionMoreOpen, setRegionMoreOpen] = useState(false);
    const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    const [visibleCount, setVisibleCount] = useState(16);
    const [toast, setToast] = useState('');
    const [showScrollTop, setShowScrollTop] = useState(false);
    const [showAccount, setShowAccount] = useState(false);
    const mergedAccountRef = useRef<string | null>(null);

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
                setTodayPickId(typeof data.todayPickId === 'string' ? data.todayPickId : null);
                setPriceHistory(data.priceHistory || {});
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
        document.body.style.overflow = selectedFlight || filterOpen || showAccount ? 'hidden' : '';
        return () => { document.body.style.overflow = ''; };
    }, [selectedFlight, filterOpen, showAccount]);

    useEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('favoriteFlights') || '[]');
            if (Array.isArray(saved)) setFavorites(new Set(saved.filter(id => typeof id === 'string')));
        } catch { }
    }, []);

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
        setFavorites(new Set(combined));
        try { localStorage.setItem('favoriteFlights', JSON.stringify(combined)); } catch { }
        if (localIds.length) void account.mergeLocalFavorites(localIds).catch(() => undefined);
    }, [account, account.email, account.status]);

    useEffect(() => setVisibleCount(16), [region, departure, datePeriod, customStartDate, customEndDate, maxPrice, sort, query]);

    useEffect(() => {
        if (!toast) return;
        const timer = window.setTimeout(() => setToast(''), 2400);
        return () => window.clearTimeout(timer);
    }, [toast]);

    useEffect(() => {
        const updateScrollTopVisibility = () => {
            setShowScrollTop(window.scrollY > Math.max(900, window.innerHeight * 1.25));
        };
        updateScrollTopVisibility();
        window.addEventListener('scroll', updateScrollTopVisibility, { passive: true });
        return () => window.removeEventListener('scroll', updateScrollTopVisibility);
    }, []);

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
                && datePeriodMatches(flight, datePeriod, referenceDate, customStartDate, customEndDate)
                && (!maxPrice || effectivePrice(flight) <= maxPrice);
        });

        return result.sort((a, b) => {
            if (sort === 'price') return effectivePrice(a) - effectivePrice(b);
            if (sort === 'date') return (parseDate(a.departure.date)?.getTime() || 0) - (parseDate(b.departure.date)?.getTime() || 0);
            return recommendedScore(a) - recommendedScore(b);
        });
    }, [customEndDate, customStartDate, datePeriod, departure, flights, maxPrice, query, region, sort]);

    const isDefaultView = region === '전체'
        && departure === '전체'
        && datePeriod === 'all'
        && !maxPrice
        && !query.trim()
        && sort === 'recommended';
    const todayPick = useMemo(() => {
        const flight = flights.find(item => item.id === todayPickId)
            || flights.slice().sort((a, b) => recommendedScore(a) - recommendedScore(b))[0];
        return flight ? { flight, reason: describeTodayPick(flight) } : null;
    }, [flights, todayPickId]);
    const dropAlertFlight = useMemo(() => (
        flights
            .filter(isTickerWorthyDrop)
            .sort((a, b) => recommendedScore(a) - recommendedScore(b))[0] || null
    ), [flights]);
    const featuredPick = useMemo(() => (
        dropAlertFlight
            ? { flight: dropAlertFlight, reason: '지금 가격이 유난히 크게 내려온 표예요' }
            : todayPick
    ), [dropAlertFlight, todayPick]);
    const displayedFlights = useMemo(() => {
        const base = isDefaultView && featuredPick
            ? [featuredPick.flight, ...filteredFlights.filter(flight => flight.id !== featuredPick.flight.id)]
            : filteredFlights;
        return sort === 'recommended' && !query.trim() ? diversifyFlights(base) : base;
    }, [featuredPick, filteredFlights, isDefaultView, query, sort]);
    const feedInsights = useMemo<FeedInsight[]>(() => {
        if (sort !== 'recommended' || query.trim()) return [];

        type PriceDropCandidate = {
            flight: Flight;
            drop: number;
            previousPrice: number;
            currentPrice: number;
            score: number;
        };
        const insights: FeedInsight[] = [];
        let bestPriceDrop: PriceDropCandidate | null = null;
        const routeHistory = normalizedHistory(priceHistory);
        const historyDates = Array.from(new Set(
            Object.values(routeHistory).flatMap(entries => entries.map(entry => entry.date)),
        )).sort();
        const latestHistoryDate = historyDates.at(-1);
        const previousHistoryDate = historyDates.at(-2);

        if (latestHistoryDate && previousHistoryDate) {
            const cheapestByRoute = new Map<string, Flight>();
            displayedFlights.forEach(flight => {
                const key = normalizedRoute(flight);
                const current = cheapestByRoute.get(key);
                if (!current || effectivePrice(flight) < effectivePrice(current)) cheapestByRoute.set(key, flight);
            });

            const displayRank = new Map(displayedFlights.map((flight, index) => [flight.id, index]));
            const drops = Array.from(cheapestByRoute.entries()).flatMap(([route, flight]) => {
                const entries = routeHistory[route] || [];
                const latest = entries.find(entry => entry.date === latestHistoryDate);
                const previous = entries.find(entry => entry.date === previousHistoryDate);
                if (!latest || !previous || previous.minPrice <= latest.minPrice) return [];

                const drop = previous.minPrice - latest.minPrice;
                const dropRate = drop / previous.minPrice;
                if (drop < 10_000 || dropRate < 0.05 || dropRate > 0.35) return [];
                if (effectivePrice(flight) > 500_000) return [];
                if (latest.count && previous.count) {
                    const countRatio = latest.count / previous.count;
                    if (countRatio < 0.45 || countRatio > 2.2) return [];
                }
                if (Math.abs(effectivePrice(flight) - latest.minPrice) > 1_000) return [];
                const rankPenalty = Math.min(displayRank.get(flight.id) || 0, 30) * 0.12;
                const score = dropRate * 100 + Math.min(drop / 20_000, 5) - rankPenalty;
                return [{ flight, drop, previousPrice: previous.minPrice, currentPrice: latest.minPrice, score }];
            }).sort((a, b) => b.score - a.score);

            const bestDrop = drops[0];
            bestPriceDrop = bestDrop || null;
            if (bestDrop) {
                insights.push({
                    id: 'price-drop',
                    kind: 'price',
                    eyebrow: '가격 변화',
                    title: `${compactWon(bestDrop.drop)} 내림`,
                    flight: bestDrop.flight,
                    destination: stripAirport(bestDrop.flight.arrival.city),
                    previousPrice: bestDrop.previousPrice,
                    currentPrice: bestDrop.currentPrice,
                    meta: `${departureName(bestDrop.flight)} 출발 · ${cardDate(bestDrop.flight.departure.date)}`,
                });
            }
        }

        const usedDestinations = new Set(
            insights.map(insight => normalizeCity(insight.flight.arrival.city)),
        );

        const stayCandidates = displayedFlights.flatMap(flight => {
            const minutes = onsiteStayMinutes(flight);
            const nights = daysBetweenDates(flight.departure.date, flight.arrival.date);
            if (minutes === null || nights !== 3 || effectivePrice(flight) > 350_000) return [];
            const hours = Math.round(minutes / 60);
            if (hours < 48) return [];
            return [{ flight, hours, score: hours - effectivePrice(flight) / 20_000 }];
        }).sort((a, b) => b.score - a.score);

        const zeroPtoCandidates = displayedFlights
            .filter(flight => isZeroPtoSchedule(flight) && effectivePrice(flight) <= 350_000)
            .sort((a, b) => effectivePrice(a) - effectivePrice(b));

        const harshCandidates = displayedFlights.flatMap(flight => {
            const detail = harshScheduleDetail(flight);
            const attractive = effectivePrice(flight) <= 220_000 || Math.max(0, flight.discountRate || 0) >= 20;
            return detail && attractive ? [{ flight, detail }] : [];
        }).sort((a, b) => recommendedScore(a.flight) - recommendedScore(b.flight));

        const airportComparisons: Array<{
            cheaper: Flight;
            expensive: Flight;
            saving: number;
            savingRate: number;
        }> = [];
        const cheapestByDestinationAndAirport = new Map<string, Map<string, Flight>>();
        displayedFlights.forEach(flight => {
            const destination = normalizeCity(flight.arrival.city);
            const origin = departureName(flight);
            const byAirport = cheapestByDestinationAndAirport.get(destination) || new Map<string, Flight>();
            const current = byAirport.get(origin);
            if (!current || effectivePrice(flight) < effectivePrice(current)) {
                byAirport.set(origin, flight);
            }
            cheapestByDestinationAndAirport.set(destination, byAirport);
        });

        cheapestByDestinationAndAirport.forEach(byAirport => {
            const originMinimums = Array.from(byAirport.values());
            for (let leftIndex = 0; leftIndex < originMinimums.length; leftIndex += 1) {
                for (let rightIndex = leftIndex + 1; rightIndex < originMinimums.length; rightIndex += 1) {
                    const left = originMinimums[leftIndex];
                    const right = originMinimums[rightIndex];
                    const cheaper = effectivePrice(left) <= effectivePrice(right) ? left : right;
                    const expensive = cheaper === left ? right : left;
                    const saving = effectivePrice(expensive) - effectivePrice(cheaper);
                    const savingRate = saving / effectivePrice(expensive);
                    if (effectivePrice(cheaper) > 500_000 || (saving < 10_000 && savingRate < 0.05)) continue;
                    airportComparisons.push({ cheaper, expensive, saving, savingRate });
                }
            }
        });
        airportComparisons.sort((a, b) => b.savingRate - a.savingRate || b.saving - a.saving);

        const factStay = stayCandidates.find(candidate => (
            !usedDestinations.has(normalizeCity(candidate.flight.arrival.city))
        ));
        if (factStay) {
            insights.push({
                id: 'stay-time',
                kind: 'stay',
                eyebrow: '여행 시간',
                title: `현지 체류 ${factStay.hours}시간`,
                description: `${outboundArrivalTime(factStay.flight)} 도착 · ${returnDepartureTime(factStay.flight)} 출발`,
                flight: factStay.flight,
                destination: stripAirport(factStay.flight.arrival.city),
                currentPrice: effectivePrice(factStay.flight),
                meta: `${departureName(factStay.flight)} 출발 · ${tripLength(factStay.flight)}`,
            });
            usedDestinations.add(normalizeCity(factStay.flight.arrival.city));
        }

        const factAirport = airportComparisons.find(candidate => (
            !usedDestinations.has(normalizeCity(candidate.cheaper.arrival.city))
        ));
        if (factAirport) {
            insights.push({
                id: 'airport-price-gap',
                kind: 'airport',
                eyebrow: '출발지 차이',
                title: `${compactWon(factAirport.saving)} 낮음`,
                description: `${departureName(factAirport.expensive)} 최저가보다 ${departureName(factAirport.cheaper)} 최저가가 낮아요`,
                flight: factAirport.cheaper,
                destination: stripAirport(factAirport.cheaper.arrival.city),
                currentPrice: effectivePrice(factAirport.cheaper),
                meta: `${departureName(factAirport.cheaper)} ${cardDate(factAirport.cheaper.departure.date)} · ${departureName(factAirport.expensive)} ${cardDate(factAirport.expensive.departure.date)}`,
            });
            usedDestinations.add(normalizeCity(factAirport.cheaper.arrival.city));
        }

        const factTiming = harshCandidates.find(candidate => (
            !usedDestinations.has(normalizeCity(candidate.flight.arrival.city))
        ));
        if (factTiming) {
            insights.push({
                id: 'awkward-time',
                kind: 'timing',
                eyebrow: '시간 확인',
                title: factTiming.detail,
                flight: factTiming.flight,
                destination: stripAirport(factTiming.flight.arrival.city),
                currentPrice: effectivePrice(factTiming.flight),
                meta: `${departureName(factTiming.flight)} 출발 · ${cardDate(factTiming.flight.departure.date)}`,
            });
            usedDestinations.add(normalizeCity(factTiming.flight.arrival.city));
        }

        const latestDataDate = latestHistoryDate || lastUpdated?.slice(0, 10);
        let verifiedNewFlight: Flight | null = null;
        if (latestDataDate) {
            const latestDate = parseDate(latestDataDate);
            const newSince = latestDate ? dateKey(addDays(latestDate, -2)) : latestDataDate;
            verifiedNewFlight = displayedFlights.filter(flight => {
                if (!flight.firstSeen || flight.firstSeen < newSince) return false;
                const earlierRouteRecord = (routeHistory[normalizedRoute(flight)] || [])
                    .some(entry => entry.date < flight.firstSeen!);
                return !earlierRouteRecord;
            }).sort((a, b) => effectivePrice(a) - effectivePrice(b))[0] || null;
        }

        const editorialCandidates: Array<{ score: number; insight: FeedInsight }> = [];
        if (bestPriceDrop) {
            const dropRate = bestPriceDrop.drop / bestPriceDrop.previousPrice;
            if (bestPriceDrop.drop >= 30_000 && dropRate >= 0.12) {
                editorialCandidates.push({
                    score: 100 + dropRate * 100,
                    insight: {
                        id: 'editorial-price-drop',
                        kind: 'price',
                        editorial: true,
                        eyebrow: '가격 변화',
                        title: '가격이 도망쳤습니다',
                        description: `${priceText(bestPriceDrop.previousPrice)}에서 ${priceText(bestPriceDrop.currentPrice)}으로 내려왔어요`,
                        flight: bestPriceDrop.flight,
                        destination: stripAirport(bestPriceDrop.flight.arrival.city),
                        previousPrice: bestPriceDrop.previousPrice,
                        currentPrice: bestPriceDrop.currentPrice,
                        meta: `${departureName(bestPriceDrop.flight)} 출발 · ${cardDate(bestPriceDrop.flight.departure.date)}`,
                        badge: `${compactWon(bestPriceDrop.drop)} 내림`,
                    },
                });
            }
        }

        const airportComparison = airportComparisons[0];
        if (airportComparison) {
            editorialCandidates.push({
                score: 92 + airportComparison.savingRate * 100,
                insight: {
                    id: 'editorial-airport',
                    kind: 'airport',
                    editorial: true,
                    eyebrow: '출발지 비교',
                    title: `오늘은 ${departureName(airportComparison.expensive)}보다 ${departureName(airportComparison.cheaper)}입니다`,
                    description: `현재 ${stripAirport(airportComparison.cheaper.arrival.city)}행은 ${departureName(airportComparison.cheaper)} 출발이 ${compactWon(airportComparison.saving)} 더 쌉니다`,
                    flight: airportComparison.cheaper,
                    destination: stripAirport(airportComparison.cheaper.arrival.city),
                    currentPrice: effectivePrice(airportComparison.cheaper),
                    meta: `${departureName(airportComparison.cheaper)} ${cardDate(airportComparison.cheaper.departure.date)} · ${departureName(airportComparison.expensive)} ${cardDate(airportComparison.expensive.departure.date)}`,
                    badge: `${compactWon(airportComparison.saving)} 차이`,
                },
            });
        }

        const zeroPtoFlight = zeroPtoCandidates[0];
        if (zeroPtoFlight) {
            editorialCandidates.push({
                score: 88 + Math.max(0, 350_000 - effectivePrice(zeroPtoFlight)) / 10_000,
                insight: {
                    id: 'editorial-zero-pto',
                    kind: 'schedule',
                    editorial: true,
                    eyebrow: '일정 분석',
                    title: '연차 0일 탈출',
                    description: `금요일 ${zeroPtoFlight.departure.time} 출발 · 일요일 ${returnArrivalTime(zeroPtoFlight)} 도착`,
                    flight: zeroPtoFlight,
                    destination: stripAirport(zeroPtoFlight.arrival.city),
                    currentPrice: effectivePrice(zeroPtoFlight),
                    meta: `${departureName(zeroPtoFlight)} 출발 · ${tripLength(zeroPtoFlight) || '주말 일정'}`,
                    badge: '연차 0일',
                },
            });
        }

        const stayCandidate = stayCandidates[0];
        if (stayCandidate) {
            editorialCandidates.push({
                score: 80 + Math.max(0, stayCandidate.hours - 60) / 2,
                insight: {
                    id: 'editorial-stay-time',
                    kind: 'stay',
                    editorial: true,
                    eyebrow: '여행시간 분석',
                    title: '3박 4일이라고 다 같은 3박 4일이 아닙니다',
                    description: `${stripAirport(stayCandidate.flight.arrival.city)}에서 실제로 쓸 수 있는 시간`,
                    flight: stayCandidate.flight,
                    destination: stripAirport(stayCandidate.flight.arrival.city),
                    currentPrice: effectivePrice(stayCandidate.flight),
                    meta: `${outboundArrivalTime(stayCandidate.flight)} 도착 · ${returnDepartureTime(stayCandidate.flight)} 출발`,
                    badge: `현지 ${stayCandidate.hours}시간`,
                },
            });
        }

        const harshCandidate = harshCandidates[0];
        if (harshCandidate) {
            editorialCandidates.push({
                score: 76 + Math.max(0, harshCandidate.flight.discountRate || 0),
                insight: {
                    id: 'editorial-harsh-time',
                    kind: 'timing',
                    editorial: true,
                    eyebrow: '시간 확인',
                    title: '가격은 좋고, 시간은 잔인합니다',
                    description: `${harshCandidate.detail} · 싸다고 단점까지 숨기지는 않겠습니다`,
                    flight: harshCandidate.flight,
                    destination: stripAirport(harshCandidate.flight.arrival.city),
                    currentPrice: effectivePrice(harshCandidate.flight),
                    meta: `${departureName(harshCandidate.flight)} 출발 · ${cardDate(harshCandidate.flight.departure.date)}`,
                },
            });
        }

        if (verifiedNewFlight && effectivePrice(verifiedNewFlight) <= 250_000) {
            editorialCandidates.push({
                score: 70 + Math.max(0, 250_000 - effectivePrice(verifiedNewFlight)) / 10_000,
                insight: {
                    id: 'editorial-new',
                    kind: 'new',
                    editorial: true,
                    eyebrow: '새로 등장',
                    title: `${compactWon(effectivePrice(verifiedNewFlight))} ${stripAirport(verifiedNewFlight.arrival.city)}가 떴어요`,
                    description: '이전 기록에는 없던 일정이에요',
                    flight: verifiedNewFlight,
                    destination: stripAirport(verifiedNewFlight.arrival.city),
                    currentPrice: effectivePrice(verifiedNewFlight),
                    meta: `${departureName(verifiedNewFlight)} 출발 · ${cardDate(verifiedNewFlight.departure.date)}`,
                    badge: 'NEW',
                },
            });
        }

        editorialCandidates.sort((a, b) => b.score - a.score);
        const editorialInsight = editorialCandidates[0]?.insight || null;
        if (!editorialInsight) return insights;

        const editorialDestination = normalizeCity(editorialInsight.flight.arrival.city);
        const facts = insights.filter(insight => normalizeCity(insight.flight.arrival.city) !== editorialDestination);
        return facts.length > 0
            ? [facts[0], editorialInsight, ...facts.slice(1)]
            : [editorialInsight];
    }, [displayedFlights, lastUpdated, priceHistory, query, sort]);

    const filterCount = [departure !== '전체', datePeriod !== 'all', maxPrice > 0].filter(Boolean).length;
    const updatedLabel = lastUpdated
        ? `${new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' }).format(new Date(lastUpdated))} 기준`
        : '최근 기준';
    const selectedHotelTrackingId = selectedFlight
        ? getTripcomTrackingId(
            selectedFlight.arrival.city,
            selectedFlight.departure.date,
            selectedFlight.arrival.date,
            selectedFlight.arrival.airport,
            selectedFlight.departure.city,
            selectedFlight.departure.airport,
        )
        : '';
    const selectedHotelUrl = selectedFlight
        ? getTripcomHotelUrl(
            selectedFlight.arrival.city,
            selectedFlight.departure.date,
            selectedFlight.arrival.date,
            selectedFlight.arrival.airport,
            selectedFlight.departure.city,
            selectedFlight.departure.airport,
        )
        : null;

    const toggleFavorite = (id: string) => {
        setFavorites(current => {
            const next = new Set(current);
            const willFavorite = !next.has(id);
            if (!willFavorite) next.delete(id);
            else next.add(id);
            try { localStorage.setItem('favoriteFlights', JSON.stringify(Array.from(next))); } catch { }
            void account.setFavorite(id, willFavorite).catch(() => setToast('계정에는 저장하지 못했어요.'));
            return next;
        });
    };

    const openFlight = (flight: Flight, entry = 'card_body') => {
        gtag.trackDetailOpen(
            `${normalizeCity(flight.departure.city)}-${normalizeCity(flight.arrival.city)}`,
            effectivePrice(flight),
            flight.source,
            entry,
        );
        account.recordRecent(flight.id);
        setSelectedFlight(flight);
    };

    const openInsight = (insight: FeedInsight) => {
        gtag.event('insight_click', {
            insight_type: insight.kind,
            insight_format: insight.editorial ? 'editorial' : 'fact',
            destination: normalizeCity(insight.flight.arrival.city),
            flight_id: insight.flight.id,
        });
        openFlight(insight.flight, `insight_${insight.kind}`);
    };

    const currentAccountSearch: AccountSearchFilters = {
        searchTerm: query,
        sortBy: sort === 'price' ? 'price' : sort === 'date' ? 'date' : 'discount',
        sortOrder: 'asc',
        sourceFilter: 'all',
        regionFilter: region === '전체' ? 'all' : region,
        startDate: datePeriod === 'custom' && customStartDate ? dateKey(customStartDate) : '',
        endDate: datePeriod === 'custom' && customEndDate ? dateKey(customEndDate) : '',
        departureFilter: departure === '전체' ? 'all' : departure.replace('/김포', '').replace('/김해', ''),
        airlineFilter: 'all',
        ...(maxPrice ? { maxPrice } : {}),
        datePeriod,
    };

    const applyAccountSearch = (filters: AccountSearchFilters) => {
        setQuery(filters.searchTerm);
        setSort(filters.sortBy === 'price' ? 'price' : filters.sortBy === 'date' ? 'date' : 'recommended');
        setRegion(filters.regionFilter === 'all' ? '전체' : filters.regionFilter);
        setDeparture(filters.departureFilter === 'all' ? '전체'
            : filters.departureFilter === '인천' ? '인천/김포'
                : filters.departureFilter === '부산' ? '부산/김해'
                    : filters.departureFilter);
        setMaxPrice(filters.maxPrice || 0);
        if (filters.startDate) {
            setDatePeriod('custom');
            setCustomStartDate(parseDate(filters.startDate));
            setCustomEndDate(filters.endDate ? parseDate(filters.endDate) : null);
        } else {
            setDatePeriod((filters.datePeriod || 'all') as DatePeriod);
            setCustomStartDate(null);
            setCustomEndDate(null);
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const openAccountFlight = (flightId: string) => {
        const flight = flights.find(item => item.id === flightId);
        if (!flight) {
            setToast('이 표는 현재 목록에서 내려갔어요.');
            return;
        }
        setShowAccount(false);
        openFlight(flight);
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
        setCustomStartDate(null);
        setCustomEndDate(null);
        setCalendarOpen(false);
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
                        <button type="button" className={styles.accountIconButton} onClick={() => { gtag.trackAccountAction('open', 'preview'); setShowAccount(true); }} aria-label={account.status === 'authenticated' ? '내 여행 열기' : '로그인'}>
                            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5.5 19c.6-3.5 3-5.4 6.5-5.4s5.9 1.9 6.5 5.4" /></svg>
                            {account.status === 'authenticated' && <span />}
                        </button>
                    </div>
                </header>

                {isDefaultView && dropAlertFlight && (
                    <div
                        className={styles.dropTicker}
                        role="status"
                        aria-label={`특가 경보. ${stripAirport(dropAlertFlight.arrival.city)} 왕복 ${priceText(effectivePrice(dropAlertFlight))}`}
                    >
                        <span>🚨 TIKIT DROP 발생</span>
                        <span>{stripAirport(dropAlertFlight.arrival.city)} 왕복 {priceText(effectivePrice(dropAlertFlight))}</span>
                        <span>가격이 도망쳤습니다</span>
                        <span>담당자가 눈치채기 전에 보세요</span>
                    </div>
                )}

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
                        <p>좋은 표 하나가, 주말을 여행으로.</p>
                        <h1>지금 나온 땡처리 항공권</h1>
                    </div>
                </section>

                <div className={styles.quickFilterRow}>
                    <button type="button" className={`${styles.filterButton} ${filterCount ? styles.filterHasValue : ''}`} onClick={() => setFilterOpen(true)}>
                        <Icon name="sliders" />
                        필터{filterCount ? ` ${filterCount}` : ''}
                    </button>
                    <nav className={`${styles.quickFilters} ${styles.regionChipRail}`} aria-label="도착 지역 빠른 선택">
                        {QUICK_REGION_OPTIONS.map(item => (
                            <button
                                type="button"
                                key={item}
                                className={region === item ? styles.activeFilter : ''}
                                aria-label={`도착 지역 ${item}`}
                                onClick={() => {
                                    setRegion(item);
                                    setRegionMoreOpen(false);
                                }}
                            >
                                {item}
                            </button>
                        ))}
                        <button
                            type="button"
                            className={`${styles.moreRegionButton} ${MORE_REGION_OPTIONS.includes(region) ? styles.activeFilter : ''}`}
                            aria-label="다른 도착 지역 선택"
                            aria-expanded={regionMoreOpen}
                            onClick={() => setRegionMoreOpen(open => !open)}
                        >
                            {MORE_REGION_OPTIONS.includes(region) ? region : '···'}
                        </button>
                    </nav>
                    {regionMoreOpen && (
                        <nav className={styles.moreRegionInline} aria-label="추가 도착 지역">
                            {MORE_REGION_OPTIONS.map(item => (
                                <button
                                    type="button"
                                    key={item}
                                    className={region === item ? styles.moreRegionActive : ''}
                                    onClick={() => {
                                        setRegion(item);
                                        setRegionMoreOpen(false);
                                    }}
                                >
                                    {item}
                                </button>
                            ))}
                        </nav>
                    )}
                </div>

                <section className={styles.feedSection}>
                    <div className={styles.feedHeading}>
                        <div>
                            <h2>{query ? `'${query}' 검색 결과` : region === '전체' ? '전체 항공권' : `${region} 항공권`}</h2>
                            <span>{filteredFlights.length.toLocaleString('ko-KR')}개 · {updatedLabel}</span>
                        </div>
                        <label className={styles.sortSelect}>
                            <select
                                className={sort === 'recommended' ? styles.sortRecommended : styles.sortLong}
                                value={sort}
                                onChange={event => setSort(event.target.value as SortMode)}
                                aria-label="항공권 정렬"
                            >
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
                        {displayedFlights.slice(0, visibleCount).map((flight, index) => {
                            const seats = flight.availableSeats || Number.parseInt(flight.seats || '', 10) || 0;
                            const duration = tripLength(flight);
                            const destination = stripAirport(flight.arrival.city);
                            const price = effectivePrice(flight);
                            const discountRate = Math.round(Math.max(0, flight.discountRate || 0));
                            const isTodayPick = isDefaultView && featuredPick?.flight.id === flight.id;
                            const cardNumber = index + 1;
                            const insightIndex = cardNumber >= 4 && (cardNumber - 4) % 8 === 0
                                ? Math.floor((cardNumber - 4) / 8)
                                : -1;
                            const insight = insightIndex >= 0 ? feedInsights[insightIndex] : null;
                            return (
                                <Fragment key={flight.id}>
                                    <div className={styles.cardEntry}>
                                        <article className={`${styles.flightCard} ${isTodayPick ? styles.todayPickCard : ''}`}>
                                            <button type="button" className={styles.cardBody} onClick={() => openFlight(flight)}>
                                                {isTodayPick && (
                                                    <span className={styles.todayPickStrip}>
                                                        <strong>TIKIT DROP</strong>
                                                        <span>오늘 발견</span>
                                                    </span>
                                                )}
                                                <div className={styles.cardTopline}>
                                                    <div>
                                                        <span className={`${styles.sourceBadge} ${styles[flight.source]}`}>{SOURCE_NAMES[flight.source]}</span>
                                                        <span className={styles.airline}>{flight.airline || '항공사 확인'}</span>
                                                    </div>
                                                </div>

                                                <div className={styles.routeGrid}>
                                                    <div className={styles.routeEndpoint}>
                                                        <strong>{departureName(flight)}</strong>
                                                        <div className={styles.routeTiming}>
                                                            <b>{cardDate(flight.departure.date)}</b>
                                                            <em>{flight.departure.time || '시간 확인'}</em>
                                                        </div>
                                                    </div>
                                                    <div className={styles.routeConnector} aria-hidden="true">
                                                        <Icon name="plane" />
                                                        {duration && <span>{duration}</span>}
                                                    </div>
                                                    <div className={`${styles.routeEndpoint} ${styles.routeEndpointArrival}`}>
                                                        <strong>{destination}</strong>
                                                        <div className={styles.routeTiming}>
                                                            <b>{cardDate(flight.arrival.date)}</b>
                                                            <em>{flight.arrival.time || '시간 확인'}</em>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className={styles.ticketDivider} aria-hidden="true" />

                                                <div className={styles.cardFooter}>
                                                    <div className={styles.availabilityGroup}>
                                                        {seats > 0 && (
                                                            <span className={`${styles.footerStatus} ${seats <= 4 && !isTodayPick ? styles.footerStatusLow : ''} ${seats <= 4 && isTodayPick ? styles.footerStatusUrgent : ''}`}>
                                                                {seats}석 남음
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className={styles.priceBlock}>
                                                        <div className={styles.priceLine}>
                                                            {discountRate >= 5 && <span className={styles.priceDiscountBadge}>-{discountRate}%</span>}
                                                            <strong>{priceText(flight.source === 'ttang' ? flight.price : price)}</strong>
                                                        </div>
                                                        {flight.source === 'ttang' && <span className={styles.feeNotice}>발권수수료가 추가될 수 있어요</span>}
                                                    </div>
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
                                    </div>
                                    {insight && (
                                        <button
                                            type="button"
                                            className={`${styles.insightBar} ${insight.editorial ? styles.insightEditorial : styles.insightFact} ${styles[`insight${insight.kind[0].toUpperCase()}${insight.kind.slice(1)}`] || ''}`}
                                            onClick={() => openInsight(insight)}
                                            aria-label={`${insight.title}: ${insight.destination} ${priceText(insight.currentPrice)}`}
                                        >
                                            <span className={styles.insightTopline}>
                                                <span className={styles.insightEyebrow}>{insight.eyebrow}</span>
                                                <Icon name="arrow" />
                                            </span>
                                            {insight.editorial ? (
                                                <>
                                                    <strong className={styles.insightTitle}>{insight.title}</strong>
                                                    {insight.description && <span className={styles.insightDescription}>{insight.description}</span>}
                                                    <span className={styles.insightMetric}>
                                                        <strong className={styles.insightDestination}>{insight.destination}</strong>
                                                        <span className={styles.insightPriceTrail}>
                                                            {insight.previousPrice && (
                                                                <>
                                                                    <span className={styles.insightPreviousPrice}>{priceText(insight.previousPrice)}</span>
                                                                    <span className={styles.insightPriceArrow}>→</span>
                                                                </>
                                                            )}
                                                            <strong className={styles.insightCurrentPrice}>{priceText(insight.currentPrice)}</strong>
                                                        </span>
                                                    </span>
                                                    <span className={styles.insightFooter}>
                                                        <span>{insight.meta}</span>
                                                        {insight.badge && <em>{insight.badge}</em>}
                                                    </span>
                                                </>
                                            ) : (
                                                <>
                                                    <span className={styles.insightFactHeadline}>
                                                        <strong>{insight.title}</strong>
                                                        <span>{insight.destination}</span>
                                                    </span>
                                                    {insight.description && <span className={styles.insightDescription}>{insight.description}</span>}
                                                    <span className={styles.insightFactFooter}>
                                                        <span>{insight.meta}</span>
                                                        <span className={styles.insightPriceTrail}>
                                                            {insight.previousPrice && (
                                                                <>
                                                                    <span className={styles.insightPreviousPrice}>{priceText(insight.previousPrice)}</span>
                                                                    <span className={styles.insightPriceArrow}>→</span>
                                                                </>
                                                            )}
                                                            <strong className={styles.insightCurrentPrice}>{priceText(insight.currentPrice)}</strong>
                                                        </span>
                                                    </span>
                                                </>
                                            )}
                                        </button>
                                    )}
                                </Fragment>
                            );
                        })}
                    </div>

                    {visibleCount < displayedFlights.length && (
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

            {showScrollTop && !filterOpen && !selectedFlight && (
                <div className={styles.floatingActions}>
                    <button type="button" className={styles.floatingFilterButton} onClick={() => setFilterOpen(true)}>
                        <Icon name="sliders" />
                        <span>필터{filterCount ? ` ${filterCount}` : ''}</span>
                    </button>
                    <button
                        type="button"
                        className={styles.scrollTopButton}
                        aria-label="맨 위로 이동"
                        title="맨 위로"
                        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                    >
                        <Icon name="up" />
                    </button>
                </div>
            )}

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
                            <h3>가격</h3>
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
                                    <button
                                        type="button"
                                        key={item.value}
                                        className={datePeriod === item.value ? styles.optionActive : ''}
                                        onClick={() => {
                                            setDatePeriod(item.value);
                                            setCustomStartDate(null);
                                            setCustomEndDate(null);
                                            setCalendarOpen(false);
                                        }}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                            <button
                                type="button"
                                className={`${styles.dateDirectButton} ${datePeriod === 'custom' ? styles.dateDirectActive : ''}`}
                                onClick={() => setCalendarOpen(open => !open)}
                            >
                                <span>📅</span>
                                <strong>
                                    {customStartDate
                                        ? `${customStartDate.getMonth() + 1}.${customStartDate.getDate()}.${customEndDate ? ` ~ ${customEndDate.getMonth() + 1}.${customEndDate.getDate()}.` : ' 부터'}`
                                        : '날짜 직접 선택'}
                                </strong>
                            </button>
                            {calendarOpen && (
                                <div className={styles.dateCalendarWrap}>
                                    <DatePicker
                                        selectsRange
                                        startDate={customStartDate}
                                        endDate={customEndDate}
                                        onChange={(update: [Date | null, Date | null]) => {
                                            const [start, end] = update;
                                            setCustomStartDate(start);
                                            setCustomEndDate(end);
                                            setDatePeriod(start ? 'custom' : 'all');
                                            if (end) window.setTimeout(() => setCalendarOpen(false), 250);
                                        }}
                                        locale={ko}
                                        inline
                                        minDate={new Date()}
                                        calendarClassName={styles.dateCalendar}
                                    />
                                    <p>출발일 범위를 선택하세요.</p>
                                </div>
                            )}
                        </div>

                        <button type="button" className={`${styles.applyButton} ${calendarOpen ? styles.applyButtonCalendarOpen : ''}`} onClick={() => setFilterOpen(false)}>
                            {filteredFlights.length.toLocaleString('ko-KR')}개 항공권 보기
                        </button>
                    </section>
                </div>
            )}

            {selectedFlight && (() => {
                const outbound = legDetails(selectedFlight, 'outbound');
                const inbound = legDetails(selectedFlight, 'return');
                const stay = tripLength(selectedFlight);
                const detailSeats = selectedFlight.availableSeats || Number.parseInt(selectedFlight.seats || '', 10) || 0;
                return (
                <div className={styles.sheetOverlay} onClick={() => setSelectedFlight(null)}>
                    <section className={`${styles.bottomSheet} ${styles.detailSheet}`} onClick={event => event.stopPropagation()} aria-label="항공권 상세">
                        <div className={styles.sheetHandle} />
                        <div className={styles.detailHeader}>
                            <div className={styles.detailAgencyLine}>
                                <span className={`${styles.sourceBadge} ${styles[selectedFlight.source]}`}>{SOURCE_NAMES[selectedFlight.source]}</span>
                                <span className={styles.detailAirline}>{selectedFlight.airline || '항공사 확인'}</span>
                                {detailSeats > 0 && <span className={styles.detailSeatCount}>{detailSeats}석 남음</span>}
                            </div>
                            <button type="button" onClick={() => setSelectedFlight(null)} aria-label="닫기"><Icon name="close" /></button>
                        </div>

                        <div className={styles.detailTitle}>
                            <div>
                                <h2>{departureName(selectedFlight)} ↔ {stripAirport(selectedFlight.arrival.city)}</h2>
                            </div>
                            <div>
                                <strong>{priceText(selectedFlight.source === 'ttang' ? selectedFlight.price : effectivePrice(selectedFlight))}</strong>
                                <span>(유류/제세공과금 포함)</span>
                                {selectedFlight.minPax && selectedFlight.minPax > 1 && (
                                    <small className={styles.detailAvailabilityText}>{selectedFlight.minPax}인부터 예약</small>
                                )}
                            </div>
                        </div>

                        <div className={styles.detailSchedule}>
                            <section className={styles.detailFlightLeg}>
                                <header className={styles.detailLegHeader}>
                                    <div>
                                        <strong>가는 항공편</strong>
                                    </div>
                                    <small>{outbound.duration ? `비행시간 ${outbound.duration}` : '비행시간 확인 필요'}</small>
                                </header>
                                <div className={styles.detailVerticalRoute}>
                                    <div className={styles.detailRouteStop}>
                                        <span aria-hidden="true" />
                                        <div>
                                            <div className={`${styles.detailRouteTime} ${outbound.departureTime === '시간 확인' ? styles.detailRouteTimeUnknown : ''}`}>
                                                <em>{outbound.departureTime}</em>
                                                <span>{outbound.departureDate}</span>
                                            </div>
                                            <strong>{outbound.origin}</strong>
                                        </div>
                                    </div>
                                    <div className={styles.detailRouteStop}>
                                        <span aria-hidden="true" />
                                        <div>
                                            <div className={`${styles.detailRouteTime} ${outbound.arrivalTime === '시간 확인' ? styles.detailRouteTimeUnknown : ''}`}>
                                                <em>{outbound.arrivalTime}</em>
                                                <span>{outbound.arrivalDate}</span>
                                            </div>
                                            <strong>{outbound.destination}</strong>
                                        </div>
                                    </div>
                                </div>
                            </section>
                            {stay && <div className={styles.detailStayDivider}><span>{stay}</span></div>}
                            <section className={styles.detailFlightLeg}>
                                <header className={styles.detailLegHeader}>
                                    <div>
                                        <strong>오는 항공편</strong>
                                    </div>
                                    <small>{inbound.duration ? `비행시간 ${inbound.duration}` : '비행시간 확인 필요'}</small>
                                </header>
                                <div className={styles.detailVerticalRoute}>
                                    <div className={styles.detailRouteStop}>
                                        <span aria-hidden="true" />
                                        <div>
                                            <div className={`${styles.detailRouteTime} ${inbound.departureTime === '시간 확인' ? styles.detailRouteTimeUnknown : ''}`}>
                                                <em>{inbound.departureTime}</em>
                                                <span>{inbound.departureDate}</span>
                                            </div>
                                            <strong>{inbound.origin}</strong>
                                        </div>
                                    </div>
                                    <div className={styles.detailRouteStop}>
                                        <span aria-hidden="true" />
                                        <div>
                                            <div className={`${styles.detailRouteTime} ${inbound.arrivalTime === '시간 확인' ? styles.detailRouteTimeUnknown : ''}`}>
                                                <em>{inbound.arrivalTime}</em>
                                                <span>{inbound.arrivalDate}</span>
                                            </div>
                                            <strong>{inbound.destination}</strong>
                                        </div>
                                    </div>
                                </div>
                            </section>
                        </div>

                        <div className={styles.priceNotice}>
                            <span>
                                {selectedFlight.source === 'ttang' ? (
                                    <>
                                        땡처리닷컴에서는 예약·결제 단계에서 발권수수료
                                        <strong> {priceText(TTANG_TICKETING_FEE)}</strong>이 추가될 수 있어요.
                                    </>
                                ) : (
                                    <>가격과 좌석은 바뀔 수 있어요. 예약 전에 여행사에서 한 번 더 확인해주세요.</>
                                )}
                            </span>
                            <div className={styles.reportTools}>
                                <button type="button" onClick={() => setToast('미리보기에서는 실제 신고를 저장하지 않아요.')}>가격이 달라요</button>
                                <span aria-hidden="true">·</span>
                                <button type="button" onClick={() => setToast('미리보기에서는 실제 신고를 저장하지 않아요.')}>예약이 안 돼요</button>
                            </div>
                        </div>

                        <a className={styles.bookingButton} href={selectedFlight.link} target="_blank" rel="noopener noreferrer">
                            {SOURCE_NAMES[selectedFlight.source]}에서 확인하기 <Icon name="arrow" />
                        </a>
                        <div className={styles.detailSecondaryActions}>
                            {selectedHotelUrl && (
                                <a
                                    className={styles.hotelCompareButton}
                                    href={selectedHotelUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="트립닷컴에서 호텔 검색"
                                    onClick={() => gtag.trackHotelAffiliateClick(
                                        `${departureName(selectedFlight)}-${stripAirport(selectedFlight.arrival.city)}`,
                                        selectedFlight.price,
                                        {
                                            departureDate: selectedFlight.departure.date,
                                            returnDate: selectedFlight.arrival.date,
                                            departureAirport: selectedFlight.departure.airport,
                                            arrivalAirport: selectedFlight.arrival.airport,
                                            airline: selectedFlight.airline,
                                            destination: stripAirport(selectedFlight.arrival.city),
                                            trackingId: selectedHotelTrackingId,
                                        },
                                    )}
                                >
                                    <span className={styles.hotelIcon}>🏨</span>
                                    <span className={styles.hotelButtonText}>
                                        <strong>{stripAirport(selectedFlight.arrival.city)} 호텔도 비교</strong>
                                        <small>트립닷컴 · 제휴</small>
                                    </span>
                                    <Icon name="arrow" />
                                </a>
                            )}
                            <button className={styles.detailShareButton} type="button" onClick={() => shareFlight(selectedFlight)}>
                                <Icon name="share" />
                                <span>공유</span>
                            </button>
                        </div>
                    </section>
                </div>
                );
            })()}

            <AccountSheet
                open={showAccount}
                onClose={() => setShowAccount(false)}
                account={account}
                currentSearch={currentAccountSearch}
                onApplySearch={applyAccountSearch}
                onOpenFlight={openAccountFlight}
                onFavoriteRemoved={flightId => {
                    setFavorites(current => {
                        const next = new Set(current);
                        next.delete(flightId);
                        try { localStorage.setItem('favoriteFlights', JSON.stringify(Array.from(next))); } catch { }
                        return next;
                    });
                }}
            />

            {toast && <div className={styles.toast} role="status">{toast}</div>}
        </main>
    );
}
