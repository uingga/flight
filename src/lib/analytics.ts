// GA4 Analytics utilities
// Revenue-related clicks are measured in GA4 and reconciled with partner dashboards.

declare global {
    interface Window {
        gtag?: (...args: unknown[]) => void;
    }
}

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID || '';
export const ANALYTICS_EXCLUSION_KEY = 'tikitikit_analytics_excluded';

export const isAnalyticsExcluded = () => {
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem(ANALYTICS_EXCLUSION_KEY) === 'true';
    } catch {
        return false;
    }
};

/** Exclude the current browser from GA4 (intended for the site owner). */
export const setAnalyticsExcluded = (excluded: boolean) => {
    if (typeof window === 'undefined') return;
    try {
        if (excluded) {
            window.localStorage.setItem(ANALYTICS_EXCLUSION_KEY, 'true');
        } else {
            window.localStorage.removeItem(ANALYTICS_EXCLUSION_KEY);
        }
    } catch {
        // GA's disable flag still works for the current page if storage is unavailable.
    }
    if (GA_ID) {
        (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`] = excluded;
    }
};

export interface RevenueClickDetails {
    departureDate?: string;
    returnDate?: string;
    departureAirport?: string;
    arrivalAirport?: string;
    airline?: string;
    destination?: string;
    trackingId?: string;
}

const defined = (params: Record<string, string | number | boolean | undefined>) =>
    Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== '')) as Record<string, string | number | boolean>;

/** GA4 page view */
export const pageview = (url: string) => {
    if (!GA_ID || !window.gtag || isAnalyticsExcluded()) return;
    window.gtag('config', GA_ID, { page_path: url });
};

/** GA4 custom event */
export const event = (action: string, params?: Record<string, string | number | boolean>) => {
    if (!GA_ID || !window.gtag || isAnalyticsExcluded()) return;
    window.gtag('event', action, params);
};

const revenueParams = (details: RevenueClickDetails) => defined({
    departure_date: details.departureDate,
    return_date: details.returnDate,
    departure_airport: details.departureAirport,
    arrival_airport: details.arrivalAirport,
    airline: details.airline,
    destination: details.destination,
    tracking_id: details.trackingId,
});

/** Booking click for every agency; MyRealTrip also emits an affiliate_click event. */
export const trackBookingClick = (
    source: string,
    route: string,
    price: number,
    details: RevenueClickDetails = {},
) => {
    const common = {
        partner: source,
        product_type: 'flight',
        route,
        price,
        currency: 'KRW',
        is_affiliate: source === 'myrealtrip',
        transport_type: 'beacon',
        ...revenueParams(details),
    };
    event('booking_click', { travel_agency: source, ...common });
    if (source === 'myrealtrip') event('affiliate_click', common);
};

/** Hotel affiliate click; trackingId is also sent to Trip.com as trip_sub1. */
export const trackHotelAffiliateClick = (
    route: string,
    price: number,
    details: RevenueClickDetails,
) => {
    event('affiliate_click', {
        partner: 'tripcom',
        product_type: 'hotel',
        route,
        price,
        currency: 'KRW',
        transport_type: 'beacon',
        ...revenueParams(details),
    });
};

/** Flight share */
export const trackShare = (route: string, method: string) => {
    event('share_flight', { route, share_method: method });
};

/** Price alert */
export const trackAlertSetup = (route: string, maxPrice?: number) => {
    event('alert_setup', { route, ...(maxPrice ? { target_price: maxPrice } : {}) });
};

/** Price-comparison link (Naver/Skyscanner) */
export const trackCompareClick = (provider: 'naver' | 'skyscanner' | 'tripcom', route: string, price: number) => {
    event('compare_click', { provider, route, price, currency: 'KRW', transport_type: 'beacon' });
};

/** Flight card click */
export const trackCardClick = (route: string, price: number, airline: string, source: string) => {
    event('card_click', { route, price, airline, source, currency: 'KRW' });
};

export const trackFilterChange = (filterType: string, value: string) => {
    event('filter_change', { filter_type: filterType, filter_value: value });
};

export const trackDateFilter = (startDate: string, endDate: string) => {
    event('date_filter', { start_date: startDate, end_date: endDate });
};
