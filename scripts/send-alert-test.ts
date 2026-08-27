import webpush from 'web-push';
import { normalizeVapidKey } from './lib/vapid';
import { dealAlertRegionLabel, decodeDealAlertRegion } from '../src/lib/deal-alerts';

interface AlertSubscription {
    alert_key: string;
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
    departure_city?: string;
    arrival_city?: string;
}

const ALERT_KEY = process.env.ALERT_KEY || '';
/**
 * 웹 푸시 발송자 연락처(VAPID subject).
 *
 * 푸시 서비스가 문제를 발견했을 때 발송자에게 연락하는 통로라 실재해야 한다.
 * 예전에는 만든 적 없는 주소가 적혀 있어서, 연락이 와도 아무도 받지 못했다.
 * RFC 8292는 mailto: 외에 https: URL도 허용하므로, 공개 저장소에 개인 메일
 * 주소를 남기지 않도록 사이트 주소를 기본값으로 쓴다. 실제로 받을 수 있는
 * 주소를 쓰고 싶으면 VAPID_CONTACT 환경변수로 덮어쓴다.
 */
const VAPID_CONTACT = process.env.VAPID_CONTACT || 'https://tikitikit.kr';

const VAPID_PUBLIC = normalizeVapidKey(process.env.VAPID_PUBLIC_KEY || '');
const VAPID_PRIVATE = normalizeVapidKey(process.env.VAPID_PRIVATE_KEY || '');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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
    if (!/^[a-f0-9]{64}$/.test(ALERT_KEY)) throw new Error('Invalid alert key');
    if (!VAPID_PUBLIC || !VAPID_PRIVATE || !SUPABASE_URL || !SUPABASE_KEY) {
        throw new Error('Missing alert test configuration');
    }

    const response = await supabaseRequest(
        `price_alerts?select=alert_key,subscription,departure_city,arrival_city&alert_key=eq.${ALERT_KEY}&active=eq.true&limit=1`
    );
    if (!response.ok) throw new Error(`Alert lookup failed: ${response.status}`);
    const alerts = await response.json() as AlertSubscription[];
    if (alerts.length === 0) throw new Error('Active alert not found');

    const alert = alerts[0];
    const dealRegion = decodeDealAlertRegion(alert.arrival_city);
    const destination = dealRegion ? dealAlertRegionLabel(dealRegion) : (alert.arrival_city || '목적지');
    webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC, VAPID_PRIVATE);
    try {
        await webpush.sendNotification(alert.subscription, JSON.stringify({
            title: '✅ 테스트 알림이 도착했어요',
            body: dealRegion
                ? `${alert.departure_city || '등록 출발지'} 출발 · ${destination} 특가 알림이 정상적으로 연결되었습니다.`
                : `${alert.departure_city || '등록 노선'} → ${destination} 가격 알림이 정상적으로 연결되었습니다.`,
            url: '/',
            tag: 'price-alert-test',
        }));
        console.log('✅ 테스트 가격 알림 발송 완료');
    } catch (error: unknown) {
        const statusCode = (error as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
            await supabaseRequest(`price_alerts?alert_key=eq.${ALERT_KEY}`, {
                method: 'PATCH',
                body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }),
            });
        }
        throw error;
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
