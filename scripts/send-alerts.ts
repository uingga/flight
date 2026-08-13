import * as fs from 'fs';
import * as path from 'path';
import webpush from 'web-push';

interface AlertSubscription {
    id: string;
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
    departure_city?: string;
    arrival_city?: string;
    departure_date_from?: string;
    departure_date_to?: string;
    max_price: number;
    last_notified_price?: number;
    last_notified_flight_id?: string;
    notified_flight_ids?: string[];
    last_sent_at?: string;
}

interface Flight {
    id: string;
    departure: { city: string; date?: string };
    arrival: { city: string; date?: string };
    price: number;
    airline: string;
    source: string;
}

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const FLIGHTS_PATH = path.join(process.cwd(), 'data', 'all-flights-cache.json');

function normalizeCity(city = ''): string {
    return city.replace(/\(.*?\)/g, '').replace(/\s+/g, '').trim();
}

function normalizeDate(date = ''): string {
    const match = date.match(/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
    if (!match) return date.slice(0, 10);
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function formatPrice(price: number): string {
    return `${Math.floor(price / 10000)}만${price % 10000 ? `${Math.floor((price % 10000) / 1000)}천` : ''}원`;
}

function todayInKorea(date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
}

async function supabaseRequest(pathname: string, init: RequestInit = {}) {
    return fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
        ...init,
        headers: {
            apikey: SUPABASE_KEY,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
    });
}

async function main() {
    console.log('\n=== 가격 알림 발송 시작 ===');
    if (!VAPID_PUBLIC || !VAPID_PRIVATE || !SUPABASE_URL || !SUPABASE_KEY) {
        console.log('VAPID 또는 Supabase 설정이 없어 알림 발송을 건너뜁니다.');
        return;
    }

    webpush.setVapidDetails('mailto:tikitikit.kr@gmail.com', VAPID_PUBLIC, VAPID_PRIVATE);
    const alertResponse = await supabaseRequest('price_alerts?select=*&active=eq.true');
    if (!alertResponse.ok) throw new Error(`알림 구독 조회 실패: ${alertResponse.status}`);
    const alerts = await alertResponse.json() as AlertSubscription[];
    if (alerts.length === 0) {
        console.log('활성 가격 알림이 없습니다.');
        return;
    }

    const flightsData = JSON.parse(fs.readFileSync(FLIGHTS_PATH, 'utf-8'));
    const flights: Flight[] = flightsData.flights || flightsData;
    const today = todayInKorea();
    let sentCount = 0;

    for (const alert of alerts) {
        if (alert.last_sent_at && todayInKorea(new Date(alert.last_sent_at)) === today) continue;

        const matches = flights.filter(flight => {
            if (normalizeCity(flight.departure.city) !== normalizeCity(alert.departure_city)) return false;
            if (normalizeCity(flight.arrival.city) !== normalizeCity(alert.arrival_city)) return false;
            if (flight.price > alert.max_price) return false;
            const date = normalizeDate(flight.departure.date);
            if (alert.departure_date_from && date < alert.departure_date_from) return false;
            if (alert.departure_date_to && date > alert.departure_date_to) return false;
            return true;
        }).sort((a, b) => a.price - b.price);

        if (matches.length === 0) continue;
        const cheapest = matches[0];
        const notifiedIds = Array.isArray(alert.notified_flight_ids) ? alert.notified_flight_ids : [];
        const priceDrop = alert.last_notified_price ? alert.last_notified_price - cheapest.price : Infinity;
        const priceDropRate = alert.last_notified_price ? priceDrop / alert.last_notified_price : Infinity;
        const meaningfulDrop = priceDrop >= 5000 || priceDropRate >= 0.03;
        const newFlight = !notifiedIds.includes(cheapest.id);
        if (alert.last_notified_price && !meaningfulDrop && !newFlight) continue;

        const dep = normalizeCity(cheapest.departure.city);
        const arr = normalizeCity(cheapest.arrival.city);
        const date = normalizeDate(cheapest.departure.date);
        const payload = {
            title: `✈️ ${dep} → ${arr} ${formatPrice(cheapest.price)}`,
            body: meaningfulDrop && Number.isFinite(priceDrop)
                ? `이전보다 ${formatPrice(priceDrop)} 내려갔어요 · ${cheapest.airline}`
                : `새로운 목표가 이하 항공권이 나왔어요 · ${cheapest.airline}`,
            url: `/share/${encodeURIComponent(cheapest.id)}?dep=${encodeURIComponent(dep)}&arr=${encodeURIComponent(arr)}&date=${encodeURIComponent(date)}`,
            tag: `price-alert-${alert.id}`,
        };

        try {
            await webpush.sendNotification(alert.subscription, JSON.stringify(payload));
            const updatedIds = [...new Set([...notifiedIds, cheapest.id])].slice(-20);
            const updateResponse = await supabaseRequest(`price_alerts?id=eq.${alert.id}`, {
                method: 'PATCH',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify({
                    last_notified_price: cheapest.price,
                    last_notified_flight_id: cheapest.id,
                    notified_flight_ids: updatedIds,
                    last_sent_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                }),
            });
            if (!updateResponse.ok) throw new Error(`발송 이력 저장 실패: ${updateResponse.status}`);
            sentCount++;
            console.log(`[알림] ✅ ${dep} → ${arr} ${formatPrice(cheapest.price)}`);
        } catch (error: unknown) {
            const statusCode = (error as { statusCode?: number })?.statusCode;
            if (statusCode === 404 || statusCode === 410) {
                await supabaseRequest(`price_alerts?id=eq.${alert.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }),
                });
                console.log(`[알림] 만료된 구독 비활성화: ${alert.id}`);
            } else {
                console.error(`[알림] 발송 실패: ${alert.id}`, error);
            }
        }
    }

    console.log(`\n[알림] 총 ${sentCount}건 발송, 활성 구독 ${alerts.length}건`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
