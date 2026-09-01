'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import Logo from '@/components/Logo';
import OverlayDialog from '@/components/ui/OverlayDialog';
import type { Flight } from '@/types/flight';
import styles from './page.module.css';

type FlightCard = {
    source: string;
    airline: string;
    departure: string;
    arrival: string;
    departDate: string;
    returnDate: string;
    duration: string;
    seats: string;
    price: string;
};

export type Discovery = {
    city: string;
    location: string;
    summary: string;
    detail: string;
    story?: string[];
    latitude: number;
    longitude: number;
    image: string;
};

const FLIGHTS: FlightCard[] = [
    { source: '노랑풍선', airline: '에어로케이', departure: '청주', arrival: '클락', departDate: '9.19(토)', returnDate: '9.24(목)', duration: '5박 6일', seats: '15석 남음', price: '222,000원' },
    { source: '노랑풍선', airline: '제주항공', departure: '인천', arrival: '오이타', departDate: '9.8(화)', returnDate: '9.10(목)', duration: '2박 3일', seats: '4석 남음', price: '199,000원' },
    { source: '온라인투어', airline: '에어서울', departure: '인천', arrival: '다카마츠', departDate: '9.16(수)', returnDate: '9.18(금)', duration: '2박 3일', seats: '8석 남음', price: '157,900원' },
    { source: '온라인투어', airline: '에어서울', departure: '인천', arrival: '요나고', departDate: '9.4(금)', returnDate: '9.7(월)', duration: '3박 4일', seats: '6석 남음', price: '179,000원' },
    { source: '노랑풍선', airline: '진에어', departure: '부산', arrival: '기타큐슈', departDate: '9.11(금)', returnDate: '9.14(월)', duration: '3박 4일', seats: '9석 남음', price: '204,000원' },
    { source: '모두투어', airline: '이스타항공', departure: '인천', arrival: '푸꾸옥', departDate: '9.20(일)', returnDate: '9.24(목)', duration: '4박 5일', seats: '5석 남음', price: '289,000원' },
];

const DISCOVERIES: Discovery[] = [
    { city: '리장', location: '중국 윈난', summary: '골목 끝에 설산이 나오는 곳.', detail: '해발 2,400m의 오래된 도시 사이로 물길이 흐릅니다.', story: ['리장은 사진 한 장 안에 오래된 골목과 설산이 함께 들어오는 도시입니다. 해발 2,400m의 고성 사이로 설산에서 시작된 물길이 흐르고, 집과 골목, 작은 다리가 그 물길을 따라 이어집니다. 12세기부터 차마고도의 교역지였고, 지금도 나시족의 문화와 오래된 목조 건물이 도시 곳곳에 남아 있습니다.', '보통 오래된 도시와 큰 자연을 보려면 일정을 따로 잡아야 합니다. 리장에서는 골목을 걷던 여행이 그대로 설산으로 이어집니다. 처음에는 ‘리장이 어디지?’ 하고 눌렀다가, 나갈 때는 항공권 날짜를 확인하게 되는 곳. 티키티킷이 이번 주 이 도시를 꺼내놓은 이유입니다.'], latitude: 26.855, longitude: 100.227, image: '/images/cities/lijiang.png' },
    { city: '옌타이', location: '중국 산둥', summary: '해안 산책과 와이너리를 함께 즐기기 좋아 짧은 일정에도 여유가 있어요.', detail: '도시와 바다가 가깝고 이동 동선이 단순해 천천히 둘러보기 좋아요.', latitude: 37.4645, longitude: 121.4479, image: '/images/cities/yantai.png' },
    { city: '웨이하이', location: '중국 산둥', summary: '붐비지 않는 해변과 산책로가 많아 조용히 쉬어 가기 좋은 도시예요.', detail: '유명 관광지를 빠르게 도는 여행보다 바닷가에 머물며 쉬는 일정에 잘 맞아요.', latitude: 37.5131, longitude: 122.1204, image: '/images/cities/weihai.png' },
    { city: '마쓰야마', location: '일본 시코쿠', summary: '도고온천과 오래된 전차가 이어져 차 없이도 천천히 둘러보기 좋아요.', detail: '온천과 성, 오래된 상점가가 가까워 짧은 일정에도 소도시의 분위기를 충분히 느낄 수 있어요.', latitude: 33.8392, longitude: 132.7657, image: '/images/cities/matsuyama.png' },
    { city: '구마모토', location: '일본 규슈', summary: '성과 정원이 도심에 모여 있고, 근교 온천까지 함께 묶기 좋아요.', detail: '후쿠오카와는 다른 차분한 규슈 여행을 원할 때 고르기 좋은 목적지예요.', latitude: 32.8031, longitude: 130.7079, image: '/images/cities/kumamoto.png' },
    { city: '타이중', location: '대만 중부', summary: '시장과 카페를 즐기고 근교 호수와 산지까지 하루 코스로 다녀오기 좋아요.', detail: '도심에서 먹고 쉬는 날과 근교 풍경을 보는 날을 나누기 좋은 도시예요.', latitude: 24.1477, longitude: 120.6736, image: '/images/cities/taichung.png' },
];

export const WEEKLY_DISCOVERY = DISCOVERIES[0];

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MAP_ZOOM_DELAY_MS = 500;
const MAP_ZOOM_DURATION_MS = 2_200;
const SOURCE_LABELS: Partial<Record<Flight['source'], string>> = {
    ybtour: '노랑풍선',
    hanatour: '하나투어',
    modetour: '모두투어',
    onlinetour: '온라인투어',
    ttang: '땡처리닷컴',
    myrealtrip: '마이리얼트립',
};

function formatFlightDate(date: string) {
    const [year, month, day] = date.split('-').map(Number);
    if (!year || !month || !day) return date;
    const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
    return `${month}.${day}(${weekday})`;
}

function formatTripDuration(departDate: string, returnDate: string) {
    const departAt = Date.parse(`${departDate}T00:00:00Z`);
    const returnAt = Date.parse(`${returnDate}T00:00:00Z`);
    if (!Number.isFinite(departAt) || !Number.isFinite(returnAt)) return '';
    const nights = Math.max(1, Math.round((returnAt - departAt) / 86_400_000));
    return `${nights}박 ${nights + 1}일`;
}

function displayDeparture(city: string) {
    if (city.includes('인천')) return '인천';
    if (city.includes('김포')) return '김포';
    if (city.includes('김해')) return '부산';
    return city.replace(/\([^)]+\)/g, '').trim();
}

function flightCopy(flight: Flight) {
    return {
        departure: displayDeparture(flight.departure.city),
        dates: `${formatFlightDate(flight.departure.date)} — ${formatFlightDate(flight.arrival.date)}`,
        duration: formatTripDuration(flight.departure.date, flight.arrival.date),
        price: `${flight.price.toLocaleString('ko-KR')}원`,
    };
}

function flightScheduleKey(flight: Flight) {
    return [
        flight.departure.city,
        flight.departure.date,
        flight.departure.time,
        flight.arrival.city,
        flight.arrival.date,
        flight.arrival.time,
    ].join('|');
}

function TicketCard({ flight }: { flight: FlightCard }) {
    return (
        <article className={styles.flightCard}>
            <div className={styles.cardTopline}>
                <span className={styles.source}>{flight.source}</span>
                <span className={styles.airline}>{flight.airline}</span>
                <span className={styles.bookmark} aria-hidden="true">♡</span>
            </div>
            <div className={styles.route}>
                <div>
                    <strong>{flight.departure}</strong>
                    <span>{flight.departDate}</span>
                </div>
                <div className={styles.routeMiddle}>
                    <span aria-hidden="true">✈</span>
                    <small>{flight.duration}</small>
                </div>
                <div>
                    <strong>{flight.arrival}</strong>
                    <span>{flight.returnDate}</span>
                </div>
            </div>
            <div className={styles.cardBottom}>
                <span>{flight.seats}</span>
                <strong>{flight.price}</strong>
            </div>
        </article>
    );
}

function DiscoveryTicket({ item, flight, onSelect }: { item: Discovery; flight: Flight; onSelect: (item: Discovery) => void }) {
    const copy = flightCopy(flight);
    return (
        <button type="button" className={styles.discoveryTicket} aria-label={`${item.city} 항공권 자세히 보기`} onClick={() => onSelect(item)}>
            <span className={styles.discoveryTopline}>
                <span>
                    <small>{item.location}</small>
                    <strong>{item.city}</strong>
                </span>
                <span className={styles.discoveryPrice}>
                    <small>{copy.departure} 출발 · 왕복 총액</small>
                    <strong>{copy.price}</strong>
                </span>
            </span>
            <span className={styles.discoverySummary}>{item.summary} {item.detail}</span>
            <span className={styles.discoverySchedule}>
                <span>{copy.dates} · {copy.duration}</span>
            </span>
        </button>
    );
}

function DiscoveryBar({ flight, onSelect }: { flight: Flight | null; onSelect: (item: Discovery) => void }) {
    if (!flight) return null;

    return (
        <section className={styles.discoveryBar} aria-label="지금 갈 수 있는 낯선 도시">
            <div className={styles.discoveryIntro}>
                <span className={styles.eyebrow}>이번 주 여행지</span>
                <h2>지금 갈 수 있는 낯선 도시</h2>
            </div>

            <div className={styles.weeklyDiscovery}>
                <DiscoveryTicket item={WEEKLY_DISCOVERY} flight={flight} onSelect={onSelect} />
            </div>
        </section>
    );
}

type GoogleMapsRuntime = {
    maps: {
        Map: new (element: HTMLElement, options: Record<string, unknown>) => {
            moveCamera: (options: { center: { lat: number; lng: number }; zoom: number }) => void;
        };
        Marker: new (options: Record<string, unknown>) => unknown;
        event: {
            addListenerOnce: (instance: unknown, eventName: string, handler: () => void) => { remove: () => void };
        };
    };
};

declare global {
    interface Window {
        google?: GoogleMapsRuntime;
        __tikitikitGoogleMapsReady?: () => void;
    }
}

let googleMapsPromise: Promise<GoogleMapsRuntime> | null = null;

function loadGoogleMaps(apiKey: string) {
    if (window.google?.maps) return Promise.resolve(window.google);
    if (googleMapsPromise) return googleMapsPromise;

    googleMapsPromise = new Promise<GoogleMapsRuntime>((resolve, reject) => {
        window.__tikitikitGoogleMapsReady = () => {
            if (window.google?.maps) resolve(window.google);
            else reject(new Error('Google Maps did not initialize.'));
        };
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=__tikitikitGoogleMapsReady&v=weekly`;
        script.async = true;
        script.onerror = () => reject(new Error('Google Maps failed to load.'));
        document.head.appendChild(script);
    });

    return googleMapsPromise;
}

function CityMap({ item }: { item: Discovery }) {
    const mapElementRef = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

    useEffect(() => {
        if (!apiKey || !mapElementRef.current) {
            setStatus('fallback');
            return;
        }

        let cancelled = false;
        let animationFrame = 0;
        let zoomDelayTimer = 0;
        let tilesListener: { remove: () => void } | null = null;

        loadGoogleMaps(apiKey)
            .then(google => {
                if (cancelled || !mapElementRef.current) return;
                const target = { lat: item.latitude, lng: item.longitude };
                const map = new google.maps.Map(mapElementRef.current, {
                    center: target,
                    zoom: 2,
                    disableDefaultUI: true,
                    gestureHandling: 'none',
                    clickableIcons: false,
                    keyboardShortcuts: false,
                    mapTypeControl: false,
                    streetViewControl: false,
                    fullscreenControl: false,
                    styles: [
                        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
                        { featureType: 'transit', stylers: [{ visibility: 'off' }] },
                    ],
                });

                new google.maps.Marker({ map, position: target, title: `${item.city} · ${item.location}` });
                tilesListener = google.maps.event.addListenerOnce(map, 'tilesloaded', () => {
                    if (cancelled) return;
                    zoomDelayTimer = window.setTimeout(() => {
                        if (cancelled) return;
                        const startedAt = performance.now();
                        const animate = (now: number) => {
                            if (cancelled) return;
                            const raw = Math.min(1, (now - startedAt) / MAP_ZOOM_DURATION_MS);
                            const eased = 1 - Math.pow(1 - raw, 3);
                            map.moveCamera({ center: target, zoom: 2 + 5 * eased });
                            if (raw < 1) animationFrame = requestAnimationFrame(animate);
                            else setStatus('ready');
                        };
                        animationFrame = requestAnimationFrame(animate);
                    }, MAP_ZOOM_DELAY_MS);
                });
            })
            .catch(() => {
                if (!cancelled) setStatus('fallback');
            });

        return () => {
            cancelled = true;
            tilesListener?.remove();
            if (zoomDelayTimer) window.clearTimeout(zoomDelayTimer);
            if (animationFrame) cancelAnimationFrame(animationFrame);
        };
    }, [apiKey, item]);

    if (status === 'fallback') {
        return (
            <div className={styles.mapFallback} aria-label={`${item.city} 위치 지도 미리보기`}>
                <div className={styles.mapFallbackWorld} aria-hidden="true">
                    <span className={styles.mapLandOne} />
                    <span className={styles.mapLandTwo} />
                    <span className={styles.mapLandThree} />
                    <span className={styles.mapPin} />
                </div>
                <span className={styles.mapFallbackLabel}>{item.city} · {item.location}</span>
                <small>Google 지도 데모 키 연결 후 실제 지도로 전환됩니다.</small>
            </div>
        );
    }

    return (
        <div className={styles.googleMapWrap}>
            <div ref={mapElementRef} className={styles.googleMap} aria-label={`${item.city} Google 지도`} />
            {status === 'loading' && <span className={styles.mapLoading}>핀을 중심으로 지도 확대 중</span>}
        </div>
    );
}

export function DiscoveryDetail({ item, flight, flights = [flight], onClose }: { item: Discovery; flight: Flight; flights?: Flight[]; onClose: () => void }) {
    const dialogRef = useRef<HTMLElement>(null);
    const titleId = `discovery-detail-${item.city}`;
    const availableFlights = [...(flights.length > 0 ? flights : [flight])]
        .sort((a, b) => a.price - b.price);
    const availableScheduleCount = new Set(availableFlights.map(flightScheduleKey)).size;

    return (
        <OverlayDialog
            open
            dialogRef={dialogRef}
            onClose={onClose}
            overlayClassName={styles.detailOverlay}
            dialogClassName={styles.detailPanel}
            ariaLabelledBy={titleId}
        >
            <header className={styles.detailHeader}>
                <div>
                    <span>여행지 발견</span>
                    <h2 id={titleId}>{item.city}<small>{item.location}</small></h2>
                </div>
                <button type="button" onClick={onClose} aria-label="닫기">×</button>
            </header>

            <div className={styles.detailScroll}>
                <CityMap item={item} />

                <figure className={styles.cityImage}>
                    <Image src={item.image} alt={`${item.city} 여행지 풍경`} fill sizes="(max-width: 680px) 100vw, 520px" priority />
                </figure>

                <section className={styles.cityStory}>
                    <h3>{item.city}, 이런 곳이에요</h3>
                    {(item.story || [`${item.summary} ${item.detail}`]).map(paragraph => (
                        <p key={paragraph}>{paragraph}</p>
                    ))}
                </section>

                <section className={styles.availableFlights}>
                    <div className={styles.availableHeading}>
                        <h3>지금 가능한 항공권</h3>
                        <span>가능한 일정 {availableScheduleCount}개</span>
                    </div>
                    {availableFlights.map(availableFlight => {
                        const availableCopy = flightCopy(availableFlight);
                        const params = new URLSearchParams({
                            flight: availableFlight.id,
                            schedule: [
                                availableFlight.departure.date,
                                availableFlight.departure.time,
                                availableFlight.arrival.date,
                                availableFlight.arrival.time,
                            ].join('|'),
                            dep: availableCopy.departure,
                            arr: item.city,
                            q: item.city,
                            date: availableFlight.departure.date,
                        });
                        return (
                            <a className={styles.availableFlightCard} href={`/?${params.toString()}`} key={availableFlight.id}>
                                <span className={styles.availableRoute}>
                                    <strong>{availableCopy.departure} → {item.city}</strong>
                                    <small>
                                        {availableCopy.dates} · {availableCopy.duration}
                                        {' · '}{SOURCE_LABELS[availableFlight.source] || availableFlight.source}
                                        {availableFlight.airline ? ` · ${availableFlight.airline}` : ''}
                                    </small>
                                </span>
                                <strong>{availableCopy.price}</strong>
                            </a>
                        );
                    })}
                </section>
            </div>
        </OverlayDialog>
    );
}

export default function UnknownCityInsightPreview({ weeklyFlight }: { weeklyFlight: Flight | null }) {
    const [selectedDiscovery, setSelectedDiscovery] = useState<Discovery | null>(null);

    return (
        <div className={styles.previewPage}>
            <header className={styles.header}>
                <a href="/preview/unknown-city-insight" aria-label="티키티킷 미리보기 홈">
                    <Logo size={0.84} />
                </a>
                <span>미리보기 전용 · 운영 미반영</span>
            </header>

            <main className={styles.main}>
                <div className={styles.filterRow} aria-label="필터 모양 미리보기">
                    <button type="button">출발지</button>
                    <button type="button">지역</button>
                    <button type="button">여행 기간</button>
                    <button type="button">가격 낮은 순</button>
                </div>

                <div className={styles.feed}>
                    {FLIGHTS.slice(0, 3).map((flight) => <TicketCard flight={flight} key={`${flight.departure}-${flight.arrival}`} />)}
                    <DiscoveryBar flight={weeklyFlight} onSelect={setSelectedDiscovery} />
                    {FLIGHTS.slice(3).map((flight) => <TicketCard flight={flight} key={`${flight.departure}-${flight.arrival}`} />)}
                </div>
            </main>

            {selectedDiscovery && weeklyFlight && <DiscoveryDetail item={selectedDiscovery} flight={weeklyFlight} onClose={() => setSelectedDiscovery(null)} />}
        </div>
    );
}
