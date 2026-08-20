import * as fs from 'fs';
import * as path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import {
    DEAL_ALERT_SCORE_THRESHOLD,
    decodeDealAlertRegion,
    evaluateDealAlert,
    type DealAlertCondition,
} from '@/lib/deal-alerts';
import type { Flight } from '@/types/flight';

const CACHE_FILE_PATH = path.join(process.cwd(), 'data', 'all-flights-cache.json');
const PRICE_HISTORY_PATH = path.join(process.cwd(), 'data', 'price-history.json');
// 저장소가 공개라 코드에 박아 둔 기본값은 그대로 공개 열쇠가 된다.
// 환경변수가 없으면 조용히 열리는 대신 인증을 전부 거부한다.
const ADMIN_KEY = process.env.ADMIN_KEY;

interface AlertRow {
    alert_key: string;
    departure_city?: string;
    arrival_city?: string;
    max_price?: number;
    created_at?: string;
}

function supabaseConfig() {
    const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    return url && key ? { url, key } : null;
}

function readJson(filePath: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
}

export async function GET(request: NextRequest) {
    if (!ADMIN_KEY || request.nextUrl.searchParams.get('key') !== ADMIN_KEY) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        if (!fs.existsSync(CACHE_FILE_PATH)) {
            return NextResponse.json({ error: 'Cache file not found' }, { status: 404 });
        }

        const config = supabaseConfig();
        if (!config) {
            return NextResponse.json({
                available: false,
                dryRun: true,
                message: 'Supabase 설정이 없어 조건형 알림 후보를 불러올 수 없습니다.',
                generatedAt: new Date().toISOString(),
                scoreThreshold: DEAL_ALERT_SCORE_THRESHOLD,
                subscriptions: 0,
                qualifiedCandidates: 0,
                reviews: [],
            });
        }

        const alertResponse = await fetch(
            `${config.url}/rest/v1/price_alerts?select=alert_key,departure_city,arrival_city,max_price,created_at&active=eq.true`,
            {
                headers: {
                    apikey: config.key,
                    Authorization: `Bearer ${config.key}`,
                },
                cache: 'no-store',
            },
        );
        if (!alertResponse.ok) {
            throw new Error(`Supabase alert lookup failed: ${alertResponse.status}`);
        }

        const rows = await alertResponse.json() as AlertRow[];
        const conditions = rows.flatMap((row): DealAlertCondition[] => {
            const region = decodeDealAlertRegion(row.arrival_city);
            const maxPrice = Number(row.max_price);
            if (!region || !row.departure_city || !Number.isFinite(maxPrice)) return [];
            return [{
                id: row.alert_key,
                departureCity: row.departure_city,
                region,
                maxPrice,
                createdAt: row.created_at,
            }];
        });

        const cache = readJson(CACHE_FILE_PATH);
        const flights = (Array.isArray(cache.flights) ? cache.flights : []) as Flight[];
        let priceHistory = (cache.priceHistory || {}) as Record<string, Array<{ date?: string; minPrice?: number; avgPrice?: number }>>;
        if (fs.existsSync(PRICE_HISTORY_PATH)) {
            priceHistory = readJson(PRICE_HISTORY_PATH) as typeof priceHistory;
        }
        const sourceUpdatedAt = (cache.sourceUpdatedAt || {}) as Record<string, string>;
        const now = new Date();
        const reviews = conditions.map(condition => evaluateDealAlert(
            condition,
            flights,
            priceHistory,
            sourceUpdatedAt,
            now,
        ));

        return NextResponse.json({
            available: true,
            dryRun: true,
            generatedAt: now.toISOString(),
            scoreThreshold: DEAL_ALERT_SCORE_THRESHOLD,
            subscriptions: reviews.length,
            qualifiedCandidates: reviews.reduce((sum, review) => sum + review.qualifiedCount, 0),
            reviews,
        });
    } catch (error) {
        console.error('Deal alert candidate review failed:', error);
        return NextResponse.json({ error: 'Failed to evaluate deal alert candidates' }, { status: 500 });
    }
}
