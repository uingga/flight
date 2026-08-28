import * as fs from 'fs';
import * as path from 'path';
import webpush from 'web-push';
import {
    revalidateAlertApprovalBatch,
    type AlertApprovalRecipient,
    type AlertSubscriptionRecord,
} from '../src/lib/alert-approval';
import { expiredSubscriptionUpdate } from '../src/lib/alert-delivery-policy';
import type { Flight } from '../src/types/flight';
import { normalizeVapidKey } from './lib/vapid';

type DeliveryResult = 'sent' | 'expired' | 'failed';

const APPROVED_BATCH_KEY = (process.env.ALERT_APPROVAL_BATCH_KEY || '').trim();
const VAPID_CONTACT = process.env.VAPID_CONTACT || 'https://tikitikit.kr';
const VAPID_PUBLIC = normalizeVapidKey(process.env.VAPID_PUBLIC_KEY || '');
const VAPID_PRIVATE = normalizeVapidKey(process.env.VAPID_PRIVATE_KEY || '');
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

async function claimDelivery(alert: AlertSubscriptionRecord): Promise<boolean> {
    const response = await supabaseRequest('rpc/claim_price_alert_delivery', {
        method: 'POST',
        body: JSON.stringify({ p_alert_id: String(alert.id) }),
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`발송 중복 방지 잠금 실패: ${response.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`);
    }
    return await response.json() === true;
}

async function releaseDeliveryClaim(alert: AlertSubscriptionRecord): Promise<boolean> {
    const response = await supabaseRequest(`price_alerts?id=eq.${encodeURIComponent(String(alert.id))}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ delivery_claimed_at: null, updated_at: new Date().toISOString() }),
    });
    return response.ok;
}

async function sendAndRecord(
    recipient: AlertApprovalRecipient,
    payload: Record<string, unknown>,
): Promise<DeliveryResult> {
    const { alert, updates } = recipient;
    if (!alert.subscription?.endpoint || !alert.subscription.keys?.p256dh || !alert.subscription.keys?.auth) {
        return 'failed';
    }
    try {
        await webpush.sendNotification(alert.subscription, JSON.stringify(payload));
        const now = new Date().toISOString();
        const response = await supabaseRequest(`price_alerts?id=eq.${encodeURIComponent(String(alert.id))}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
                ...updates,
                last_sent_at: now,
                delivery_claimed_at: null,
                updated_at: now,
            }),
        });
        if (!response.ok) throw new Error(`발송 이력 저장 실패: ${response.status}`);
        return 'sent';
    } catch (error: unknown) {
        const statusCode = (error as { statusCode?: number })?.statusCode;
        const expiredUpdate = expiredSubscriptionUpdate(statusCode, new Date().toISOString());
        if (expiredUpdate) {
            const response = await supabaseRequest(`price_alerts?id=eq.${encodeURIComponent(String(alert.id))}`, {
                method: 'PATCH',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify(expiredUpdate),
            });
            return response.ok ? 'expired' : 'failed';
        }
        console.error(`[알림] 발송 실패${statusCode ? ` (응답 ${statusCode})` : ''}`);
        try {
            await releaseDeliveryClaim(alert);
        } catch {
            console.error('[알림] 발송 잠금 해제 실패');
        }
        return 'failed';
    }
}

function loadFlightContext() {
    const flightsData = JSON.parse(fs.readFileSync(FLIGHTS_PATH, 'utf-8')) as {
        flights?: Flight[];
        sourceUpdatedAt?: Record<string, string>;
        priceHistory?: Record<string, Array<{ date?: string; minPrice?: number; avgPrice?: number }>>;
    } | Flight[];
    const flights: Flight[] = Array.isArray(flightsData) ? flightsData : flightsData.flights || [];
    let priceHistory = Array.isArray(flightsData) ? {} : flightsData.priceHistory || {};
    if (fs.existsSync(PRICE_HISTORY_PATH)) {
        priceHistory = JSON.parse(fs.readFileSync(PRICE_HISTORY_PATH, 'utf-8')) as typeof priceHistory;
    }
    return {
        flights,
        priceHistory,
        sourceUpdatedAt: Array.isArray(flightsData) ? {} : flightsData.sourceUpdatedAt || {},
    };
}

async function main() {
    console.log('\n=== 승인된 가격 알림 발송 ===');
    // 사람이 어드민에서 승인한 배치 키 없이는 노선형·조건형 모두 절대 발송하지 않는다.
    if (!/^[a-f0-9]{24}$/.test(APPROVED_BATCH_KEY)) {
        console.log('[알림] 승인된 배치 키가 없어 아무 알림도 보내지 않습니다.');
        return;
    }
    if (!VAPID_PUBLIC || !VAPID_PRIVATE || !SUPABASE_URL || !SUPABASE_KEY) {
        throw new Error('VAPID 또는 Supabase 설정이 없어 알림을 발송할 수 없습니다.');
    }

    const response = await supabaseRequest('price_alerts?select=*&active=eq.true&order=created_at.asc');
    if (!response.ok) throw new Error(`알림 구독 조회 실패: ${response.status}`);
    const alerts = await response.json() as AlertSubscriptionRecord[];
    const context = loadFlightContext();
    const approved = revalidateAlertApprovalBatch(
        APPROVED_BATCH_KEY,
        alerts,
        context.flights,
        context.priceHistory,
        context.sourceUpdatedAt,
        new Date(),
    );
    if (!approved) {
        throw new Error('승인된 후보가 가격 변경, 발송 이력 또는 최신성 기준 때문에 더 이상 유효하지 않습니다.');
    }

    webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC, VAPID_PRIVATE);
    let sent = 0;
    let expired = 0;
    let failed = 0;
    for (const recipient of approved.recipients) {
        let claimed = false;
        try {
            claimed = await claimDelivery(recipient.alert);
        } catch {
            console.error('[알림] 발송 준비 실패');
            failed++;
            continue;
        }
        if (!claimed) continue;
        const result = await sendAndRecord(recipient, {
            title: approved.title,
            body: approved.body,
            url: approved.url,
            tag: `${approved.kind}-alert-${recipient.alert.id}`,
        });
        if (result === 'sent') sent++;
        else if (result === 'expired') expired++;
        else failed++;
    }

    console.log(`[알림] 승인 배치 ${APPROVED_BATCH_KEY}: 발송 ${sent}건 · 만료 ${expired}건 · 실패 ${failed}건`);
    if (failed > 0) throw new Error(`승인 알림 ${failed}건 발송에 실패했습니다.`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
