import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
    buildAlertApprovalBatches,
    toPublicApprovalBatch,
    type AlertSubscriptionRecord,
} from '@/lib/alert-approval';
import {
    DEAL_ALERT_SCORE_THRESHOLD,
    decodeDealAlertRegion,
    evaluateDealAlert,
    type DealAlertCondition,
} from '@/lib/deal-alerts';
import { getSupabaseServerHeaders } from '@/lib/server/supabase-rest';
import type { Flight } from '@/types/flight';

export const runtime = 'nodejs';

const CACHE_FILE_PATH = path.join(process.cwd(), 'data', 'all-flights-cache.json');
const PRICE_HISTORY_PATH = path.join(process.cwd(), 'data', 'price-history.json');
const ADMIN_KEY = process.env.ADMIN_KEY;
const APPROVAL_WORKFLOW = 'send-approved-alert.yml';
const PREVIEW_WORKFLOW = 'send-alert-preview.yml';
const GITHUB_REPOSITORY = 'uingga/flight';
const ADMIN_PREVIEW_DESTINATION = '@admin-test';
const PREVIEW_COOLDOWN_MS = 60_000;
const PUSH_HOSTS = [
    'fcm.googleapis.com',
    'updates.push.services.mozilla.com',
    'web.push.apple.com',
    'webpush.apple.com',
];

interface PushSubscriptionInput {
    endpoint: string;
    keys: { p256dh: string; auth: string };
}

function supabaseConfig() {
    const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    return url && key ? { url, key } : null;
}

function readJson(filePath: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
}

function authorized(request: NextRequest, bodyKey?: unknown): boolean {
    const supplied = request.nextUrl.searchParams.get('key') || (typeof bodyKey === 'string' ? bodyKey : '');
    return Boolean(ADMIN_KEY && supplied === ADMIN_KEY);
}

async function loadAlertRows(config: { url: string; key: string }): Promise<AlertSubscriptionRecord[]> {
    const response = await fetch(
        `${config.url}/rest/v1/price_alerts?select=*&active=eq.true&order=created_at.asc`,
        { headers: getSupabaseServerHeaders(config.key), cache: 'no-store' },
    );
    if (!response.ok) throw new Error(`Supabase alert lookup failed: ${response.status}`);
    return await response.json() as AlertSubscriptionRecord[];
}

function loadFlightContext() {
    if (!fs.existsSync(CACHE_FILE_PATH)) throw new Error('Cache file not found');
    const cache = readJson(CACHE_FILE_PATH);
    const flights = (Array.isArray(cache.flights) ? cache.flights : []) as Flight[];
    let priceHistory = (cache.priceHistory || {}) as Record<string, Array<{ date?: string; minPrice?: number; avgPrice?: number }>>;
    if (fs.existsSync(PRICE_HISTORY_PATH)) {
        priceHistory = readJson(PRICE_HISTORY_PATH) as typeof priceHistory;
    }
    const sourceUpdatedAt = (cache.sourceUpdatedAt || {}) as Record<string, string>;
    return { flights, priceHistory, sourceUpdatedAt };
}

function buildReviews(
    rows: AlertSubscriptionRecord[],
    context: ReturnType<typeof loadFlightContext>,
    now: Date,
) {
    const conditions = rows.flatMap((row): DealAlertCondition[] => {
        const region = decodeDealAlertRegion(row.arrival_city);
        const maxPrice = Number(row.max_price);
        if (!region || !row.departure_city || !Number.isFinite(maxPrice)) return [];
        return [{
            id: row.alert_key || row.id,
            departureCity: row.departure_city,
            region,
            maxPrice,
            createdAt: row.created_at,
        }];
    });
    return conditions.map(condition => evaluateDealAlert(
        condition,
        context.flights,
        context.priceHistory,
        context.sourceUpdatedAt,
        now,
    ));
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function validPushSubscription(value: unknown): value is PushSubscriptionInput {
    if (!value || typeof value !== 'object') return false;
    const subscription = value as Partial<PushSubscriptionInput>;
    if (typeof subscription.endpoint !== 'string'
        || typeof subscription.keys?.p256dh !== 'string'
        || typeof subscription.keys?.auth !== 'string'
        || subscription.endpoint.length > 2_000
        || subscription.keys.p256dh.length > 1_000
        || subscription.keys.auth.length > 1_000) return false;
    try {
        const url = new URL(subscription.endpoint);
        return url.protocol === 'https:'
            && PUSH_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
    } catch {
        return false;
    }
}

async function dispatchWorkflow(workflow: string, inputs: Record<string, string>): Promise<boolean> {
    const token = process.env.GH_PAT;
    if (!token) return false;
    const response = await fetch(
        `https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/workflows/${workflow}/dispatches`,
        {
            method: 'POST',
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28',
            },
            body: JSON.stringify({ ref: 'main', inputs }),
            cache: 'no-store',
        },
    );
    return response.status === 204;
}

async function saveAdminPreviewTarget(
    config: { url: string; key: string },
    subscription: PushSubscriptionInput,
): Promise<{ targetKey: string; lastTestAt?: string }> {
    const targetKey = sha256(`admin-preview:${subscription.endpoint}`);
    const lookup = await fetch(
        `${config.url}/rest/v1/price_alerts?select=last_test_at&alert_key=eq.${targetKey}&limit=1`,
        { headers: getSupabaseServerHeaders(config.key), cache: 'no-store' },
    );
    if (!lookup.ok) throw new Error(`Admin preview lookup failed: ${lookup.status}`);
    const existing = await lookup.json() as Array<{ last_test_at?: string }>;
    const now = new Date().toISOString();
    const save = await fetch(`${config.url}/rest/v1/price_alerts?on_conflict=alert_key`, {
        method: 'POST',
        headers: {
            ...getSupabaseServerHeaders(config.key),
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
            alert_key: targetKey,
            endpoint_hash: sha256(subscription.endpoint),
            subscription,
            departure_city: '관리자',
            arrival_city: ADMIN_PREVIEW_DESTINATION,
            max_price: 10_000,
            request_hash: sha256('admin-alert-preview').slice(0, 32),
            active: false,
            notified_flight_ids: [],
            updated_at: now,
        }),
        cache: 'no-store',
    });
    if (!save.ok) throw new Error(`Admin preview save failed: ${save.status}`);
    return { targetKey, lastTestAt: existing[0]?.last_test_at };
}

async function recordAdminPreviewQueued(
    config: { url: string; key: string },
    targetKey: string,
): Promise<void> {
    const response = await fetch(`${config.url}/rest/v1/price_alerts?alert_key=eq.${targetKey}`, {
        method: 'PATCH',
        headers: {
            ...getSupabaseServerHeaders(config.key),
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
        },
        body: JSON.stringify({ last_test_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
        cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Admin preview timestamp failed: ${response.status}`);
}

export async function GET(request: NextRequest) {
    if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const config = supabaseConfig();
        if (!config) {
            return NextResponse.json({
                available: false,
                approvalMode: 'manual',
                deliveryAvailable: false,
                message: 'Supabase 설정이 없어 알림 후보를 불러올 수 없습니다.',
                generatedAt: new Date().toISOString(),
                scoreThreshold: DEAL_ALERT_SCORE_THRESHOLD,
                subscriptions: 0,
                qualifiedCandidates: 0,
                pendingRecipients: 0,
                approvalBatches: [],
                reviews: [],
            });
        }

        const [rows, context] = await Promise.all([
            loadAlertRows(config),
            Promise.resolve(loadFlightContext()),
        ]);
        const now = new Date();
        const reviews = buildReviews(rows, context, now);
        const batches = buildAlertApprovalBatches(
            rows,
            context.flights,
            context.priceHistory,
            context.sourceUpdatedAt,
            now,
        );
        const uniqueRecipients = new Set(
            batches.flatMap(batch => batch.recipients.map(recipient => (
                recipient.alert.endpoint_hash
                || recipient.alert.subscription?.endpoint
                || recipient.alert.id
            ))),
        );

        return NextResponse.json({
            available: true,
            approvalMode: 'manual',
            deliveryAvailable: Boolean(process.env.GH_PAT),
            generatedAt: now.toISOString(),
            scoreThreshold: DEAL_ALERT_SCORE_THRESHOLD,
            subscriptions: rows.length,
            qualifiedCandidates: batches.length,
            pendingRecipients: uniqueRecipients.size,
            approvalBatches: batches.map(toPublicApprovalBatch),
            reviews,
        });
    } catch (error) {
        console.error('Alert candidate review failed:', error);
        return NextResponse.json({ error: 'Failed to evaluate alert candidates' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    let body: Record<string, unknown> = {};
    try {
        body = await request.json() as Record<string, unknown>;
    } catch {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    if (!authorized(request, body.key)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const batchKey = typeof body.batchKey === 'string' ? body.batchKey.trim() : '';
    const action = body.action === 'test' ? 'test' : 'send';
    if (!/^[a-f0-9]{24}$/.test(batchKey)) {
        return NextResponse.json({ error: 'Invalid approval candidate' }, { status: 400 });
    }

    try {
        const config = supabaseConfig();
        if (!config) return NextResponse.json({ error: 'Alert storage is unavailable' }, { status: 503 });
        const [rows, context] = await Promise.all([
            loadAlertRows(config),
            Promise.resolve(loadFlightContext()),
        ]);
        const batches = buildAlertApprovalBatches(
            rows,
            context.flights,
            context.priceHistory,
            context.sourceUpdatedAt,
            new Date(),
        );
        const approved = batches.find(batch => batch.batchKey === batchKey);
        if (!approved) {
            return NextResponse.json({ error: '이 후보는 가격 변경이나 중복 방지로 더 이상 발송할 수 없습니다.' }, { status: 409 });
        }

        if (action === 'test') {
            if (!validPushSubscription(body.subscription)) {
                return NextResponse.json({ error: '이 브라우저의 알림 수신 정보를 확인하지 못했습니다.' }, { status: 400 });
            }
            const target = await saveAdminPreviewTarget(config, body.subscription);
            const lastTest = target.lastTestAt ? new Date(target.lastTestAt).getTime() : 0;
            if (lastTest && Date.now() - lastTest < PREVIEW_COOLDOWN_MS) {
                return NextResponse.json({ error: '같은 기기로 방금 시험 발송했습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 });
            }
            const queued = await dispatchWorkflow(PREVIEW_WORKFLOW, {
                batch_key: batchKey,
                target_key: target.targetKey,
            });
            if (!queued) {
                return NextResponse.json({ error: '시험 발송 작업을 시작하지 못했습니다. GitHub 연결 설정을 확인해주세요.' }, { status: 503 });
            }
            await recordAdminPreviewQueued(config, target.targetKey);
            return NextResponse.json({
                ok: true,
                queued: true,
                preview: true,
                batchKey,
                title: approved.title,
                body: approved.body,
                message: '내 기기로 시험 알림을 보냈습니다. 도착한 문구를 확인한 뒤 전체 발송을 눌러주세요.',
            }, { status: 202 });
        }

        if (!await dispatchWorkflow(APPROVAL_WORKFLOW, { batch_key: batchKey })) {
            return NextResponse.json({ error: '발송 작업을 시작하지 못했습니다. GitHub 연결 설정을 확인해주세요.' }, { status: 503 });
        }
        return NextResponse.json({
            ok: true,
            queued: true,
            batchKey,
            recipientCount: approved.recipients.length,
            message: '승인한 알림의 발송 작업을 시작했습니다.',
        }, { status: 202 });
    } catch (error) {
        console.error('Approved alert dispatch failed:', error);
        return NextResponse.json({ error: 'Failed to dispatch approved alert' }, { status: 500 });
    }
}
