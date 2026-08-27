import * as fs from 'fs';
import * as path from 'path';
import webpush from 'web-push';
import {
    buildAlertApprovalBatches,
    type AlertSubscriptionRecord,
} from '../src/lib/alert-approval';
import type { Flight } from '../src/types/flight';

interface AdminPreviewTarget {
    alert_key: string;
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
}

const BATCH_KEY = (process.env.ALERT_APPROVAL_BATCH_KEY || '').trim();
const TARGET_KEY = (process.env.ADMIN_TEST_ALERT_KEY || '').trim();
const VAPID_CONTACT = process.env.VAPID_CONTACT || 'https://tikitikit.kr';
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const FLIGHTS_PATH = path.join(process.cwd(), 'data', 'all-flights-cache.json');
const PRICE_HISTORY_PATH = path.join(process.cwd(), 'data', 'price-history.json');

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

function loadFlightContext() {
    const data = JSON.parse(fs.readFileSync(FLIGHTS_PATH, 'utf-8')) as {
        flights?: Flight[];
        sourceUpdatedAt?: Record<string, string>;
        priceHistory?: Record<string, Array<{ date?: string; minPrice?: number; avgPrice?: number }>>;
    } | Flight[];
    const flights = Array.isArray(data) ? data : data.flights || [];
    let priceHistory = Array.isArray(data) ? {} : data.priceHistory || {};
    if (fs.existsSync(PRICE_HISTORY_PATH)) {
        priceHistory = JSON.parse(fs.readFileSync(PRICE_HISTORY_PATH, 'utf-8')) as typeof priceHistory;
    }
    return {
        flights,
        priceHistory,
        sourceUpdatedAt: Array.isArray(data) ? {} : data.sourceUpdatedAt || {},
    };
}

async function main() {
    if (!/^[a-f0-9]{24}$/.test(BATCH_KEY) || !/^[a-f0-9]{64}$/.test(TARGET_KEY)) {
        throw new Error('Invalid admin alert preview input');
    }
    if (!VAPID_PUBLIC || !VAPID_PRIVATE || !SUPABASE_URL || !SUPABASE_KEY) {
        throw new Error('Missing admin alert preview configuration');
    }

    const [alertsResponse, targetResponse] = await Promise.all([
        supabaseRequest('price_alerts?select=*&active=eq.true&order=created_at.asc'),
        supabaseRequest(`price_alerts?select=alert_key,subscription&alert_key=eq.${TARGET_KEY}&active=eq.false&arrival_city=eq.%40admin-test&limit=1`),
    ]);
    if (!alertsResponse.ok) throw new Error(`Active alert lookup failed: ${alertsResponse.status}`);
    if (!targetResponse.ok) throw new Error(`Admin preview target lookup failed: ${targetResponse.status}`);
    const alerts = await alertsResponse.json() as AlertSubscriptionRecord[];
    const targets = await targetResponse.json() as AdminPreviewTarget[];
    if (targets.length !== 1) throw new Error('Admin preview target not found');

    const context = loadFlightContext();
    const batches = buildAlertApprovalBatches(
        alerts,
        context.flights,
        context.priceHistory,
        context.sourceUpdatedAt,
        new Date(),
    );
    const batch = batches.find(candidate => candidate.batchKey === BATCH_KEY);
    if (!batch) throw new Error('Preview candidate is no longer valid');

    webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC, VAPID_PRIVATE);
    await webpush.sendNotification(targets[0].subscription, JSON.stringify({
        title: batch.title,
        body: batch.body,
        url: batch.url,
        tag: `admin-alert-preview-${BATCH_KEY}`,
    }));
    console.log(`[알림] 관리자 시험 발송 완료: ${BATCH_KEY}`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
