import * as fs from 'fs';
import * as path from 'path';
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
const GITHUB_REPOSITORY = 'uingga/flight';

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

async function dispatchApprovedBatch(batchKey: string): Promise<boolean> {
    const token = process.env.GH_PAT;
    if (!token) return false;
    const response = await fetch(
        `https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/workflows/${APPROVAL_WORKFLOW}/dispatches`,
        {
            method: 'POST',
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28',
            },
            body: JSON.stringify({ ref: 'main', inputs: { batch_key: batchKey } }),
            cache: 'no-store',
        },
    );
    return response.status === 204;
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

        return NextResponse.json({
            available: true,
            approvalMode: 'manual',
            deliveryAvailable: Boolean(process.env.GH_PAT),
            generatedAt: now.toISOString(),
            scoreThreshold: DEAL_ALERT_SCORE_THRESHOLD,
            subscriptions: rows.length,
            qualifiedCandidates: batches.length,
            pendingRecipients: batches.reduce((sum, batch) => sum + batch.recipients.length, 0),
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
        if (!await dispatchApprovedBatch(batchKey)) {
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
