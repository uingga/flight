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
    const params = {
        partner: 'tripcom',
        product_type: 'hotel',
        route,
        price,
        currency: 'KRW',
        transport_type: 'beacon',
        ...revenueParams(details),
    };
    // Keep the umbrella affiliate event for revenue reconciliation, while exposing
    // a dedicated event so the admin can show hotel clicks separately from flights.
    event('affiliate_click', params);
    event('hotel_compare_click', params);
};

/** Flight share */
export const trackShare = (route: string, method: string) => {
    event('share_flight', { route, share_method: method });
};

/** Price alert; entry identifies which CTA the subscription came from. */
export const trackAlertSetup = (route: string, maxPrice?: number, entry?: string) => {
    event('alert_setup', {
        route,
        ...(maxPrice ? { target_price: maxPrice } : {}),
        ...(entry ? { entry_point: entry } : {}),
    });
};

/** Departure + region + budget deal alert beta registration. */
export const trackDealAlertSetup = (departure: string, region: string, maxPrice: number) => {
    event('deal_alert_setup', {
        departure,
        region,
        target_price: maxPrice,
        alert_type: 'condition',
    });
};

/** Price-comparison link (Naver/Skyscanner) */
export const trackCompareClick = (provider: 'naver' | 'skyscanner' | 'tripcom', route: string, price: number) => {
    event('compare_click', { provider, route, price, currency: 'KRW', transport_type: 'beacon' });
};

/** Actual outbound click after the price-comparison notice has been acknowledged. */
export const trackCompareOutboundClick = (provider: 'naver' | 'skyscanner' | 'tripcom', route: string, price: number) => {
    event('compare_outbound_click', { provider, route, price, currency: 'KRW', transport_type: 'beacon' });
};

/**
 * Booking detail sheet opened — the funnel step between the card list and booking_click.
 * `entry` records which surface opened it.
 *
 * Replaces the old `card_click` event (dropped 2026-08-14): back then a click on the card
 * body did nothing, so the event only ever measured dead clicks.
 */
export const trackDetailOpen = (route: string, price: number, source: string, entry: string) => {
    event('detail_open', { route, price, source, entry_point: entry, currency: 'KRW' });
};

export const trackFilterChange = (filterType: string, value: string) => {
    event('filter_change', { filter_type: filterType, filter_value: value });
};

/**
 * Date-range filter applied. Beyond the raw range we derive the shape of demand
 * (how far ahead, how long a window) and whether the pick actually surfaced flights —
 * a zero-result pick fires an extra `date_filter_empty` so dead ends are countable.
 */
export const trackDateFilter = (
    startDate: string,
    endDate: string,
    extra?: { method?: 'calendar' | 'preset'; presetLabel?: string; resultCount?: number },
) => {
    const dayMs = 24 * 60 * 60 * 1000;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    event('date_filter', defined({
        start_date: startDate,
        end_date: endDate,
        days_from_now: start ? Math.round((start.getTime() - today.getTime()) / dayMs) : undefined,
        range_days: start && end ? Math.round((end.getTime() - start.getTime()) / dayMs) + 1 : undefined,
        method: extra?.method || 'calendar',
        preset_label: extra?.presetLabel,
        result_count: extra?.resultCount,
    }));
    if (extra?.resultCount === 0) {
        event('date_filter_empty', defined({ start_date: startDate, end_date: endDate }));
    }
};
