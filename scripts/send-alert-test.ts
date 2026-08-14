import webpush from 'web-push';

interface AlertSubscription {
    alert_key: string;
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
    departure_city?: string;
    arrival_city?: string;
}

const ALERT_KEY = process.env.ALERT_KEY || '';
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
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
    webpush.setVapidDetails('mailto:tikitikit.kr@gmail.com', VAPID_PUBLIC, VAPID_PRIVATE);
    try {
        await webpush.sendNotification(alert.subscription, JSON.stringify({
            title: '✅ 테스트 알림이 도착했어요',
            body: `${alert.departure_city || '등록 노선'} → ${alert.arrival_city || '목적지'} 가격 알림이 정상적으로 연결되었습니다.`,
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
