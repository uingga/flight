import * as fs from 'fs';
import * as path from 'path';
import webpush from 'web-push';

interface AlertSubscription {
    id: string;
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
    conditions: {
        route?: string;
        maxPrice?: number;
        region?: string;
    };
    createdAt: string;
    lastSent?: string;
}

interface Flight {
    id: string;
    departure: { city: string };
    arrival: { city: string };
    price: number;
    airline: string;
    region?: string;
    link: string;
    source: string;
}

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const ALERTS_PATH = path.join(process.cwd(), 'data', 'alerts.json');
const FLIGHTS_PATH = path.join(process.cwd(), 'data', 'all-flights-cache.json');

function normalizeCity(city: string): string {
    return city.replace(/\(.*?\)/g, '').replace(/\s+/g, '').trim();
}

function formatPrice(price: number): string {
    return price < 1000000
        ? `${Math.floor(price / 10000)}만원`
        : `${(price / 10000).toFixed(0)}만원`;
}

async function main() {
    console.log('\n=== 가격 알림 발송 시작 ===');

    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
        console.log('VAPID 키가 설정되지 않았습니다. 알림 발송 건너뜀.');
        return;
    }

    webpush.setVapidDetails('mailto:tikit@tikit.app', VAPID_PUBLIC, VAPID_PRIVATE);

    // 알림 구독 로드
    if (!fs.existsSync(ALERTS_PATH)) {
        console.log('알림 구독이 없습니다.');
        return;
    }

    const alerts: AlertSubscription[] = JSON.parse(fs.readFileSync(ALERTS_PATH, 'utf-8'));
    if (alerts.length === 0) {
        console.log('알림 구독이 없습니다.');
        return;
    }
    console.log(`[알림] ${alerts.length}개 구독 확인`);

    // 항공편 데이터 로드
    const flightsData = JSON.parse(fs.readFileSync(FLIGHTS_PATH, 'utf-8'));
    const flights: Flight[] = flightsData.flights || flightsData;
    console.log(`[알림] ${flights.length}개 항공편 데이터`);

    let sentCount = 0;
    const now = new Date();
    const updatedAlerts = [...alerts];

    for (let i = 0; i < updatedAlerts.length; i++) {
        const alert = updatedAlerts[i];

        // 같은 날 이미 보낸 경우 스킵 (하루 1회 제한)
        if (alert.lastSent) {
            const lastSentDate = new Date(alert.lastSent).toDateString();
            if (lastSentDate === now.toDateString()) continue;
        }

        // 조건에 맞는 항공편 찾기
        const matches = flights.filter(f => {
            const { route, maxPrice, region } = alert.conditions;

            if (route) {
                const normalizedRoute = route.replace(/\s+/g, '');
                const arrCity = normalizeCity(f.arrival.city);
                const depCity = normalizeCity(f.departure.city);
                if (!arrCity.includes(normalizedRoute) && !depCity.includes(normalizedRoute) && !normalizedRoute.includes(arrCity)) {
                    return false;
                }
            }

            if (maxPrice && f.price > maxPrice) return false;
            if (region && f.region && !f.region.includes(region)) return false;

            return true;
        });

        if (matches.length === 0) continue;

        // 가장 저렴한 항공편
        const cheapest = matches.sort((a, b) => a.price - b.price)[0];
        const routeText = `${normalizeCity(cheapest.departure.city)} → ${normalizeCity(cheapest.arrival.city)}`;

        const payload = {
            title: `✈️ ${routeText} ${formatPrice(cheapest.price)}`,
            body: `${cheapest.airline} | 총 ${matches.length}건 발견! 지금 확인하세요.`,
            url: `/?search=${encodeURIComponent(normalizeCity(cheapest.arrival.city))}`,
            tag: `alert-${alert.id}`,
        };

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await webpush.sendNotification(alert.subscription as any, JSON.stringify(payload));
            updatedAlerts[i].lastSent = now.toISOString();
            sentCount++;
            console.log(`[알림] ✅ ${alert.id}: ${routeText} ${formatPrice(cheapest.price)} 발송`);
        } catch (error: unknown) {
            const statusCode = (error as { statusCode?: number })?.statusCode;
            if (statusCode === 410 || statusCode === 404) {
                console.log(`[알림] 🗑️ ${alert.id}: 구독 만료 - 삭제`);
                updatedAlerts[i] = null as unknown as AlertSubscription;
            } else {
                console.error(`[알림] ❌ ${alert.id} 발송실패:`, error);
            }
        }
    }

    // 만료된 구독 제거 후 저장
    const validAlerts = updatedAlerts.filter(Boolean);
    fs.writeFileSync(ALERTS_PATH, JSON.stringify(validAlerts, null, 2));
    console.log(`\n[알림] 총 ${sentCount}건 발송, ${validAlerts.length}개 구독 유지`);
}

main().catch(console.error);
