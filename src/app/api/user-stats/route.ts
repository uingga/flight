import * as fs from 'fs';
import * as path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { decodeDealAlertRegion, dealAlertRegionLabel } from '@/lib/deal-alerts';
import { getSupabaseServerHeaders } from '@/lib/server/supabase-rest';
import { normalizeCity } from '@/lib/utils/flight-helpers';
import type { Flight } from '@/types/flight';

const CACHE_FILE_PATH = path.join(process.cwd(), 'data', 'all-flights-cache.json');
// 저장소가 공개라 코드에 박아 둔 기본값은 그대로 공개 열쇠가 된다.
// 환경변수가 없으면 조용히 열리는 대신 인증을 전부 거부한다.
const ADMIN_KEY = process.env.ADMIN_KEY;
const TREND_DAYS = 30;

interface AlertRow {
    alert_key: string;
    endpoint_hash?: string;
    departure_city?: string;
    arrival_city?: string;
    max_price?: number;
    created_at?: string;
    active?: boolean;
    last_sent_at?: string;
    last_notified_price?: number;
}

function supabaseConfig() {
    const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    return url && key ? { url, key } : null;
}

async function countSupabaseRows(
    config: { url: string; key: string },
    table: string,
    selectColumn: string,
    filter = '',
) {
    const response = await fetch(
        `${config.url}/rest/v1/${table}?select=${selectColumn}${filter}`,
        {
            method: 'HEAD',
            headers: {
                ...getSupabaseServerHeaders(config.key),
                Prefer: 'count=exact',
            },
            cache: 'no-store',
        },
    );
    if (!response.ok) throw new Error(`Account metric failed: ${response.status}`);
    const range = response.headers.get('content-range') || '';
    const total = Number(range.split('/')[1]);
    return Number.isFinite(total) ? total : 0;
}

function dayInKorea(iso?: string): string | null {
    if (!iso) return null;
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
}

function koreaDayStartIso(daysAgo = 0): string {
    const koreaNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return new Date(Date.UTC(
        koreaNow.getUTCFullYear(),
        koreaNow.getUTCMonth(),
        koreaNow.getUTCDate() - daysAgo,
    ) - 9 * 60 * 60 * 1000).toISOString();
}

/** 알림 매칭과 같은 기준으로 도시를 맞춰야 현재 최저가를 제대로 찾는다 */
const cityKey = (city = '') =>
    normalizeCity(city).replace(/\(.*?\)/g, '').replace(/\s+/g, '').trim();

export async function GET(request: NextRequest) {
    if (!ADMIN_KEY || request.nextUrl.searchParams.get('key') !== ADMIN_KEY) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = supabaseConfig();
    if (!config) {
        return NextResponse.json({
            available: false,
            message: '회원·알림 통계 연결 설정이 없어 정보를 불러올 수 없습니다.',
            generatedAt: new Date().toISOString(),
        });
    }

    try {
        // 해지된 구독도 이탈률 계산에 필요하므로 active 필터 없이 전부 가져온다
        const response = await fetch(
            `${config.url}/rest/v1/price_alerts?select=alert_key,endpoint_hash,departure_city,arrival_city,max_price,created_at,active,last_sent_at,last_notified_price`,
            { headers: getSupabaseServerHeaders(config.key), cache: 'no-store' },
        );
        if (!response.ok) throw new Error(`Supabase lookup failed: ${response.status}`);
        const storedRows = await response.json() as AlertRow[];
        // 관리자 시험 발송용 비활성 기기는 실제 가입·해지·알림 수요 통계에 포함하지 않는다.
        const rows = storedRows.filter(row => row.arrival_city !== '@admin-test');

        const todayStart = koreaDayStartIso();
        const sevenDaysAgo = koreaDayStartIso(7);
        const thirtyDaysAgo = koreaDayStartIso(30);
        const nowIso = new Date().toISOString();
        let accountMetrics = {
            accountAvailable: true,
            accounts: 0,
            accountsToday: 0,
            accountsLast7Days: 0,
            accountsLast30Days: 0,
            activeSessions: 0,
            favorites: 0,
            recentFlights: 0,
            savedSearches: 0,
        };
        try {
            const [accounts, accountsToday, accountsLast7Days, accountsLast30Days, activeSessions, favorites, recentFlights, savedSearches] = await Promise.all([
                countSupabaseRows(config, 'tikitikit_users', 'id'),
                countSupabaseRows(config, 'tikitikit_users', 'id', `&created_at=gte.${encodeURIComponent(todayStart)}`),
                countSupabaseRows(config, 'tikitikit_users', 'id', `&created_at=gte.${encodeURIComponent(sevenDaysAgo)}&created_at=lt.${encodeURIComponent(todayStart)}`),
                countSupabaseRows(config, 'tikitikit_users', 'id', `&created_at=gte.${encodeURIComponent(thirtyDaysAgo)}&created_at=lt.${encodeURIComponent(todayStart)}`),
                countSupabaseRows(config, 'tikitikit_auth_sessions', 'id', `&expires_at=gt.${encodeURIComponent(nowIso)}`),
                countSupabaseRows(config, 'tikitikit_user_favorites', 'flight_id'),
                countSupabaseRows(config, 'tikitikit_user_recent_flights', 'flight_id'),
                countSupabaseRows(config, 'tikitikit_user_saved_searches', 'id'),
            ]);
            accountMetrics = {
                accountAvailable: true,
                accounts,
                accountsToday,
                accountsLast7Days,
                accountsLast30Days,
                activeSessions,
                favorites,
                recentFlights,
                savedSearches,
            };
        } catch (error) {
            console.error('Account stats unavailable:', error instanceof Error ? error.message : 'unknown');
            accountMetrics.accountAvailable = false;
        }

        const active = rows.filter(row => row.active !== false);
        const cancelled = rows.length - active.length;
        const createdBetween = (row: AlertRow, threshold: string, before?: string) => {
            if (!row.created_at) return false;
            const createdAt = new Date(row.created_at).getTime();
            return Number.isFinite(createdAt)
                && createdAt >= new Date(threshold).getTime()
                && (!before || createdAt < new Date(before).getTime());
        };
        const registrationsToday = rows.filter(row => createdBetween(row, todayStart)).length;
        const registrationsLast7Days = rows.filter(row => createdBetween(row, sevenDaysAgo, todayStart)).length;
        const registrationsLast30Days = rows.filter(row => createdBetween(row, thirtyDaysAgo, todayStart)).length;

        // 구독자 = 고유 기기(푸시 endpoint). 한 사람이 여러 노선을 걸 수 있다.
        const devices = new Set(active.map(row => row.endpoint_hash).filter(Boolean));
        const allDevices = new Set(rows.map(row => row.endpoint_hash).filter(Boolean));

        // 현재 항공권으로 "지금 목표가에 닿는지"를 같이 본다
        let flights: Flight[] = [];
        if (fs.existsSync(CACHE_FILE_PATH)) {
            const cache = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf-8'));
            flights = (Array.isArray(cache.flights) ? cache.flights : []) as Flight[];
        }
        const lowestByRoute = new Map<string, number>();
        for (const flight of flights) {
            const key = `${cityKey(flight.departure.city)}-${cityKey(flight.arrival.city)}`;
            const current = lowestByRoute.get(key);
            if (flight.price > 0 && (current === undefined || flight.price < current)) {
                lowestByRoute.set(key, flight.price);
            }
        }

        const routes = new Map<string, {
            departureCity: string; arrivalCity: string;
            count: number; devices: Set<string>; targets: number[];
        }>();
        const regions = new Map<string, { count: number; devices: Set<string>; targets: number[] }>();
        const trend = new Map<string, number>();
        let routeAlerts = 0;
        let dealAlerts = 0;
        let notified = 0;

        for (const row of active) {
            if (row.last_sent_at) notified++;

            const region = decodeDealAlertRegion(row.arrival_city);
            const target = Number(row.max_price);
            if (region) {
                dealAlerts++;
                const label = `${row.departure_city || '?'} · ${dealAlertRegionLabel(region)}`;
                const entry = regions.get(label) || { count: 0, devices: new Set<string>(), targets: [] };
                entry.count++;
                if (row.endpoint_hash) entry.devices.add(row.endpoint_hash);
                if (Number.isFinite(target)) entry.targets.push(target);
                regions.set(label, entry);
            } else if (row.departure_city && row.arrival_city) {
                routeAlerts++;
                const key = `${cityKey(row.departure_city)}-${cityKey(row.arrival_city)}`;
                const entry = routes.get(key) || {
                    departureCity: normalizeCity(row.departure_city),
                    arrivalCity: normalizeCity(row.arrival_city),
                    count: 0, devices: new Set<string>(), targets: [],
                };
                entry.count++;
                if (row.endpoint_hash) entry.devices.add(row.endpoint_hash);
                if (Number.isFinite(target)) entry.targets.push(target);
                routes.set(key, entry);
            }
        }

        // 최근 14일 신규 등록 (해지된 것도 등록 시점 기준으로는 유입이므로 전체를 센다)
        const today = new Date();
        for (let i = TREND_DAYS - 1; i >= 0; i--) {
            const day = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
            }).format(new Date(today.getTime() - i * 86400000));
            trend.set(day, 0);
        }
        for (const row of rows) {
            const day = dayInKorea(row.created_at);
            if (day && trend.has(day)) trend.set(day, trend.get(day)! + 1);
        }

        const avg = (values: number[]) =>
            values.length ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length) : null;

        const topRoutes = Array.from(routes.entries())
            .map(([key, entry]) => {
                const lowest = lowestByRoute.get(key) ?? null;
                const target = avg(entry.targets);
                return {
                    route: `${entry.departureCity} → ${entry.arrivalCity}`,
                    count: entry.count,
                    devices: entry.devices.size,
                    avgTarget: target,
                    currentLowest: lowest,
                    // 지금 이 노선에 목표가 이하 항공권이 있는지 — 없으면 알림이 안 나간다
                    reachable: lowest !== null && target !== null ? lowest <= target : null,
                    gap: lowest !== null && target !== null ? lowest - target : null,
                };
            })
            .sort((a, b) => b.count - a.count);

        const topRegions = Array.from(regions.entries())
            .map(([label, entry]) => ({
                label, count: entry.count, devices: entry.devices.size, avgTarget: avg(entry.targets),
            }))
            .sort((a, b) => b.count - a.count);

        return NextResponse.json({
            available: true,
            generatedAt: new Date().toISOString(),
            summary: {
                subscribers: devices.size,
                everSubscribed: allDevices.size,
                activeAlerts: active.length,
                cancelledAlerts: cancelled,
                alertsPerSubscriber: devices.size ? Number((active.length / devices.size).toFixed(1)) : 0,
                routeAlerts,
                dealAlerts,
                notified,
                neverNotified: active.length - notified,
                registrationsToday,
                registrationsLast7Days,
                registrationsLast30Days,
                // 목표가 이하 항공권이 지금 존재하는 노선 알림 수
                reachableNow: topRoutes.filter(r => r.reachable === true).reduce((sum, r) => sum + r.count, 0),
                ...accountMetrics,
            },
            topRoutes: topRoutes.slice(0, 20),
            topRegions,
            trend: Array.from(trend.entries()).map(([date, count]) => ({ date, count })),
        });
    } catch (error) {
        console.error('User stats failed:', error);
        return NextResponse.json({ error: '유저 통계를 불러오지 못했습니다.' }, { status: 500 });
    }
}
