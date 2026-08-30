'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import Logo from '@/components/Logo';
import OverlayDialog from '@/components/ui/OverlayDialog';
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

type Discovery = {
    city: string;
    location: string;
    summary: string;
    detail: string;
    departure: string;
    price: string;
    dates: string;
    duration: string;
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
    { city: '리장', location: '중국 윈난', summary: '오래된 골목을 걷고, 가까운 설산까지 하루에 이어 볼 수 있어요.', detail: '익숙한 대도시보다 풍경의 변화가 크고, 4박 5일 일정으로 고성과 자연을 함께 보기 좋아요.', departure: '인천', price: '240,000원', dates: '9.28(월) — 10.2(금)', duration: '4박 5일', latitude: 26.855, longitude: 100.227, image: '/images/cities/lijiang.png' },
    { city: '옌타이', location: '중국 산둥', summary: '해안 산책과 와이너리를 함께 즐기기 좋아 짧은 일정에도 여유가 있어요.', detail: '도시와 바다가 가깝고 이동 동선이 단순해 3박 4일로 천천히 둘러보기 좋아요.', departure: '인천', price: '218,000원', dates: '9.10(목) — 9.13(일)', duration: '3박 4일', latitude: 37.4645, longitude: 121.4479, image: '/images/cities/yantai.png' },
    { city: '웨이하이', location: '중국 산둥', summary: '붐비지 않는 해변과 산책로가 많아 조용히 쉬어 가기 좋은 도시예요.', detail: '유명 관광지를 빠르게 도는 여행보다 바닷가에 머물며 쉬는 일정에 잘 맞아요.', departure: '인천', price: '198,000원', dates: '9.17(목) — 9.20(일)', duration: '3박 4일', latitude: 37.5131, longitude: 122.1204, image: '/images/cities/weihai.png' },
    { city: '마쓰야마', location: '일본 시코쿠', summary: '도고온천과 오래된 전차가 이어져 차 없이도 천천히 둘러보기 좋아요.', detail: '온천과 성, 오래된 상점가가 가까워 짧은 일정에도 소도시의 분위기를 충분히 느낄 수 있어요.', departure: '인천', price: '229,000원', dates: '9.21(월) — 9.24(목)', duration: '3박 4일', latitude: 33.8392, longitude: 132.7657, image: '/images/cities/matsuyama.png' },
    { city: '구마모토', location: '일본 규슈', summary: '성과 정원이 도심에 모여 있고, 근교 온천까지 함께 묶기 좋아요.', detail: '후쿠오카와는 다른 차분한 규슈 여행을 원할 때 고르기 좋은 목적지예요.', departure: '인천', price: '209,000원', dates: '9.14(월) — 9.17(목)', duration: '3박 4일', latitude: 32.8031, longitude: 130.7079, image: '/images/cities/kumamoto.png' },
    { city: '타이중', location: '대만 중부', summary: '시장과 카페를 즐기고 근교 호수와 산지까지 하루 코스로 다녀오기 좋아요.', detail: '도심에서 먹고 쉬는 날과 근교 풍경을 보는 날을 나누기 좋아 4박 5일 일정이 잘 맞아요.', departure: '인천', price: '265,000원', dates: '9.23(수) — 9.27(일)', duration: '4박 5일', latitude: 24.1477, longitude: 120.6736, image: '/images/cities/taichung.png' },
];

const WEEKLY_DISCOVERY = DISCOVERIES[0];

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

function DiscoveryTicket({ item, onSelect }: { item: Discovery; onSelect: (item: Discovery) => void }) {
    return (
        <button type="button" className={styles.discoveryTicket} aria-label={`${item.city} 항공권 자세히 보기`} onClick={() => onSelect(item)}>
            <span className={styles.discoveryTopline}>
                <span>
                    <small>{item.location}</small>
                    <strong>{item.city}</strong>
                </span>
                <span className={styles.discoveryPrice}>
                    <small>{item.departure} 출발 · 왕복 총액</small>
                    <strong>{item.price}</strong>
                </span>
            </span>
            <span className={styles.discoverySummary}>{item.summary} {item.detail}</span>
            <span className={styles.discoverySchedule}>
                <span>{item.dates} · {item.duration}</span>
            </span>
        </button>
    );
}

function DiscoveryBar({ onSelect }: { onSelect: (item: Discovery) => void }) {
    return (
        <section className={styles.discoveryBar} aria-label="지금 갈 수 있는 낯선 도시">
            <div className={styles.discoveryIntro}>
                <span className={styles.eyebrow}>이번 주 여행지</span>
                <h2>지금 갈 수 있는 낯선 도시</h2>
            </div>

            <div className={styles.weeklyDiscovery}>
                <DiscoveryTicket item={WEEKLY_DISCOVERY} onSelect={onSelect} />
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

        loadGoogleMaps(apiKey)
            .then(google => {
                if (cancelled || !mapElementRef.current) return;
                const worldCenter = { lat: 20, lng: 35 };
                const target = { lat: item.latitude, lng: item.longitude };
                const map = new google.maps.Map(mapElementRef.current, {
                    center: worldCenter,
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
                const startedAt = performance.now();
                const duration = 1350;
                const animate = (now: number) => {
                    if (cancelled) return;
                    const raw = Math.min(1, (now - startedAt) / duration);
                    const eased = 1 - Math.pow(1 - raw, 3);
                    map.moveCamera({
                        center: {
                            lat: worldCenter.lat + (target.lat - worldCenter.lat) * eased,
                            lng: worldCenter.lng + (target.lng - worldCenter.lng) * eased,
                        },
                        zoom: 2 + 5 * eased,
                    });
                    if (raw < 1) animationFrame = requestAnimationFrame(animate);
                    else setStatus('ready');
                };
                animationFrame = requestAnimationFrame(animate);
            })
            .catch(() => {
                if (!cancelled) setStatus('fallback');
            });

        return () => {
            cancelled = true;
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
            {status === 'loading' && <span className={styles.mapLoading}>세계지도에서 {item.city}로 이동 중</span>}
        </div>
    );
}

function DiscoveryDetail({ item, onClose }: { item: Discovery; onClose: () => void }) {
    const dialogRef = useRef<HTMLElement>(null);
    const titleId = `discovery-detail-${item.city}`;

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
                    <p>{item.summary} {item.detail}</p>
                </section>

                <section className={styles.availableFlights}>
                    <div className={styles.availableHeading}>
                        <h3>지금 가능한 항공권</h3>
                        <span>왕복 총액</span>
                    </div>
                    <button type="button" className={styles.availableFlightCard}>
                        <span className={styles.availableRoute}>
                            <strong>{item.departure} → {item.city}</strong>
                            <small>{item.dates} · {item.duration}</small>
                        </span>
                        <strong>{item.price}</strong>
                    </button>
                </section>
            </div>
        </OverlayDialog>
    );
}

export default function UnknownCityInsightPreview() {
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
                    <DiscoveryBar onSelect={setSelectedDiscovery} />
                    {FLIGHTS.slice(3).map((flight) => <TicketCard flight={flight} key={`${flight.departure}-${flight.arrival}`} />)}
                </div>
            </main>

            {selectedDiscovery && <DiscoveryDetail item={selectedDiscovery} onClose={() => setSelectedDiscovery(null)} />}
        </div>
    );
}
