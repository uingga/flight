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
    flightId?: string;
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
    flight_id: details.flightId,
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
    if (details.destination) event('city_booking_click', { travel_agency: source, ...common });
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
export const trackShare = (
    route: string,
    method: string,
    details: Pick<RevenueClickDetails, 'flightId' | 'destination'> = {},
) => {
    event('share_flight', {
        route,
        share_method: method,
        ...revenueParams(details),
    });
    if (details.destination) {
        event('city_share', {
            route,
            share_method: method,
            ...revenueParams(details),
        });
    }
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

/** Successful arrivals from a tracked Naver Blog link. Link position is retained for later analysis. */
export const trackBlogLinkOpen = (
    type: 'flight' | 'alert' | 'article',
    campaign: string,
    linkPosition?: string,
) => {
    const params = {
        campaign_name: campaign,
        content_source: 'naver_blog',
        link_type: type,
        ...(linkPosition ? { link_position: linkPosition } : {}),
    };
    event('blog_link_open', params);
    // Keep the two original events so historical DROP reports remain continuous.
    if (type === 'flight') event('blog_flight_link_open', params);
    if (type === 'alert') event('blog_alert_link_open', params);
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
export const trackDetailOpen = (
    route: string,
    price: number,
    source: string,
    entry: string,
    details: Pick<RevenueClickDetails, 'flightId' | 'destination'> = {},
) => {
    event('detail_open', {
        route,
        price,
        source,
        entry_point: entry,
        currency: 'KRW',
        ...revenueParams(details),
    });
    if (details.destination) {
        event('city_detail_open', {
            route,
            price,
            source,
            entry_point: entry,
            currency: 'KRW',
            ...revenueParams(details),
        });
    }
};

export interface FlightImpressionDetails {
    flightId: string;
    route: string;
    destination: string;
    source: string;
    price: number;
    position: number;
    surface: 'recommendation' | 'filtered_results' | 'search_results' | 'saved_flights' | 'shared_flight';
}

/** Card was actually visible, rather than merely fetched into the page. */
export const trackFlightImpression = (details: FlightImpressionDetails) => {
    event('flight_impression', {
        flight_id: details.flightId,
        route: details.route,
        destination: details.destination,
        travel_agency: details.source,
        price: details.price,
        currency: 'KRW',
        list_position: details.position,
        position_group: details.position <= 3 ? '1-3' : details.position <= 9 ? '4-9' : '10+',
        surface: details.surface,
    });
};

/** Saving and sharing mean different things, so favorites get their own event. */
export const trackFavoriteChange = (
    action: 'add' | 'remove',
    details: Pick<FlightImpressionDetails, 'flightId' | 'route' | 'destination' | 'source' | 'price'>,
) => {
    event(action === 'add' ? 'favorite_add' : 'favorite_remove', {
        flight_id: details.flightId,
        route: details.route,
        destination: details.destination,
        travel_agency: details.source,
        price: details.price,
        currency: 'KRW',
    });
};

/** Deliberate city selection from search, not every intermediate keystroke. */
export const trackDestinationSearch = (destination: string, resultCount: number) => {
    event('destination_search', {
        destination,
        result_count: resultCount,
    });
};

export const trackFilterChange = (filterType: string, value: string) => {
    event('filter_change', { filter_type: filterType, filter_value: value });
};

/** Account funnel events never include an email address or another user identifier. */
export const trackAccountAction = (
    action: 'open' | 'code_requested' | 'login' | 'save_search' | 'apply_search' | 'logout' | 'delete',
    surface: 'main' | 'preview' | 'account_sheet' = 'account_sheet',
) => {
    const eventName = ({
        open: 'account_open',
        code_requested: 'login_code_requested',
        login: 'account_login',
        save_search: 'saved_search_create',
        apply_search: 'saved_search_apply',
        logout: 'account_logout',
        delete: 'account_delete',
    } as const)[action];
    event(eventName, { surface });
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
        // GA4 표준 이벤트(share/login)도 `method`를 쓰므로 이름을 구분한다
        filter_method: extra?.method || 'calendar',
        preset_label: extra?.presetLabel,
        result_count: extra?.resultCount,
    }));
    if (extra?.resultCount === 0) {
        event('date_filter_empty', defined({ start_date: startDate, end_date: endDate }));
    }
};
