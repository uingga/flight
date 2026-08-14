import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
    DEAL_ALERT_REGIONS,
    decodeDealAlertRegion,
    encodeDealAlertRegion,
    type DealAlertRegion,
} from '@/lib/deal-alerts';

interface AlertConditions {
    alertType?: 'price' | 'deal';
    route?: string;
    region?: string;
    departureCity?: string;
    arrivalCity?: string;
    maxPrice?: number;
}

const MAX_ALERTS = 2000;
const MAX_ALERTS_PER_ENDPOINT = 10;
const MAX_NEW_ALERTS_PER_DAY = 3;
const NONCE_MAX_AGE_MS = 5 * 60 * 1000;
const PUSH_HOSTS = [
    'fcm.googleapis.com',
    'updates.push.services.mozilla.com',
    'web.push.apple.com',
    'webpush.apple.com',
];

function config() {
    const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase configuration is missing');
    return { url, key };
}

function cleanText(value: unknown, maxLength = 80): string | undefined {
    if (typeof value !== 'string') return undefined;
    const cleaned = value.replace(/[<>]/g, '').trim().slice(0, maxLength);
    return cleaned || undefined;
}

function normalizeConditions(input: Record<string, unknown> = {}): AlertConditions {
    const rawMaxPrice = Number(input.maxPrice);
    const region = cleanText(input.region);
    return {
        alertType: input.alertType === 'deal' ? 'deal' : 'price',
        route: cleanText(input.route),
        region: region && DEAL_ALERT_REGIONS.includes(region as DealAlertRegion) ? region : undefined,
        departureCity: cleanText(input.departureCity),
        arrivalCity: cleanText(input.arrivalCity),
        maxPrice: Number.isFinite(rawMaxPrice) && rawMaxPrice >= 10000 && rawMaxPrice <= 10000000
            ? Math.round(rawMaxPrice)
            : undefined,
    };
}

function clientIp(request: NextRequest): string {
    return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || request.headers.get('x-real-ip')
        || 'local';
}

function hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function sign(value: string): string {
    return createHmac('sha256', config().key).update(value).digest('base64url');
}

function requestHash(request: NextRequest): string {
    return createHmac('sha256', config().key).update(clientIp(request)).digest('hex').slice(0, 32);
}

function sameSiteRequest(request: NextRequest): boolean {
    const host = request.headers.get('host');
    const fetchSite = request.headers.get('sec-fetch-site');
    const source = request.headers.get('origin') || request.headers.get('referer');
    if (!source || !host || new URL(source).host !== host) return false;
    return fetchSite === 'same-origin';
}

function validNonce(request: NextRequest): boolean {
    const cookie = request.cookies.get('tikit_alert_nonce')?.value;
    if (!cookie) return false;
    const [timestamp, random, signature] = cookie.split('.');
    if (!timestamp || !random || !signature) return false;
    const age = Date.now() - Number(timestamp);
    if (!Number.isFinite(age) || age < 0 || age > NONCE_MAX_AGE_MS) return false;
    const expected = sign(`${timestamp}.${random}.${requestHash(request)}`);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function validPushEndpoint(endpoint: string): boolean {
    try {
        const url = new URL(endpoint);
        return url.protocol === 'https:' && PUSH_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
    } catch {
        return false;
    }
}

async function supabaseRequest(path: string, init: RequestInit = {}) {
    const { url, key } = config();
    return fetch(`${url}/rest/v1/${path}`, {
        ...init,
        headers: {
            apikey: key,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
        cache: 'no-store',
    });
}

async function rowCount(query: string): Promise<number> {
    const response = await supabaseRequest(`price_alerts?select=id&${query}`, {
        method: 'HEAD',
        headers: { Prefer: 'count=exact' },
    });
    if (!response.ok) throw new Error(`Supabase count failed: ${response.status}`);
    const range = response.headers.get('content-range');
    return Number(range?.split('/')[1] || 0);
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
    const response = NextResponse.json(body, { status });
    response.cookies.delete('tikit_alert_nonce');
    return response;
}

function validAlertId(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

async function queueTestNotification(alertKey: string): Promise<boolean> {
    const token = process.env.GH_PAT;
    if (!token) return false;
    const response = await fetch('https://api.github.com/repos/uingga/flight/actions/workflows/send-alert-test.yml/dispatches', {
        method: 'POST',
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main', inputs: { alert_key: alertKey } }),
        cache: 'no-store',
    });
    return response.status === 204;
}

export async function GET(request: NextRequest) {
    try {
        if (!sameSiteRequest(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const timestamp = String(Date.now());
        const random = randomBytes(16).toString('base64url');
        const value = `${timestamp}.${random}.${sign(`${timestamp}.${random}.${requestHash(request)}`)}`;
        const response = NextResponse.json({ ok: true });
        response.cookies.set('tikit_alert_nonce', value, {
            httpOnly: true,
            sameSite: 'strict',
            secure: request.nextUrl.protocol === 'https:',
            maxAge: NONCE_MAX_AGE_MS / 1000,
            path: '/api/alerts',
        });
        return response;
    } catch (error) {
        console.error('Alert nonce error:', error);
        return NextResponse.json({ error: 'internal error' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        if (!sameSiteRequest(request) || !validNonce(request)) {
            return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        }

        const { action = 'register', subscription, conditions: rawConditions, baseline, alertId, maxPrice: rawMaxPrice } = await request.json();
        if (!subscription?.endpoint || !validPushEndpoint(subscription.endpoint)) {
            return NextResponse.json({ error: 'invalid subscription' }, { status: 400 });
        }

        const endpointHash = hash(subscription.endpoint);

        if (action === 'list') {
            const listResponse = await supabaseRequest(
                `price_alerts?select=alert_key,departure_city,arrival_city,max_price,created_at,updated_at&endpoint_hash=eq.${endpointHash}&active=eq.true&order=created_at.desc`
            );
            if (!listResponse.ok) throw new Error(`Supabase list failed: ${listResponse.status}`);
            const rows = await listResponse.json() as Array<{
                alert_key: string;
                departure_city?: string;
                arrival_city?: string;
                max_price: number;
                created_at: string;
                updated_at: string;
            }>;
            return jsonResponse({
                ok: true,
                alerts: rows.map(row => {
                    const dealRegion = decodeDealAlertRegion(row.arrival_city);
                    return {
                        id: row.alert_key,
                        type: dealRegion ? 'deal' : 'price',
                        departureCity: row.departure_city,
                        arrivalCity: dealRegion ? undefined : row.arrival_city,
                        region: dealRegion || undefined,
                        maxPrice: row.max_price,
                        createdAt: row.created_at,
                        updatedAt: row.updated_at,
                    };
                }),
            });
        }

        if (action === 'delete') {
            if (!validAlertId(alertId)) return jsonResponse({ error: 'invalid alert' }, 400);
            const deleteResponse = await supabaseRequest(
                `price_alerts?alert_key=eq.${alertId}&endpoint_hash=eq.${endpointHash}`,
                {
                    method: 'PATCH',
                    headers: { Prefer: 'return=minimal' },
                    body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }),
                }
            );
            if (!deleteResponse.ok) throw new Error(`Supabase delete failed: ${deleteResponse.status}`);
            return jsonResponse({ ok: true });
        }

        if (action === 'update') {
            const maxPrice = Number(rawMaxPrice);
            if (!validAlertId(alertId) || !Number.isFinite(maxPrice) || maxPrice < 10000 || maxPrice > 10000000) {
                return jsonResponse({ error: 'invalid alert update' }, 400);
            }
            const updateResponse = await supabaseRequest(
                `price_alerts?alert_key=eq.${alertId}&endpoint_hash=eq.${endpointHash}&active=eq.true`,
                {
                    method: 'PATCH',
                    headers: { Prefer: 'return=minimal' },
                    body: JSON.stringify({ max_price: Math.round(maxPrice), updated_at: new Date().toISOString() }),
                }
            );
            if (!updateResponse.ok) throw new Error(`Supabase update failed: ${updateResponse.status}`);
            return jsonResponse({ ok: true });
        }

        if (action === 'test') {
            if (!subscription?.keys?.p256dh || !subscription?.keys?.auth) {
                return jsonResponse({ error: 'invalid subscription' }, 400);
            }
            const targetResponse = await supabaseRequest(
                `price_alerts?select=alert_key,last_test_at&endpoint_hash=eq.${endpointHash}&active=eq.true&order=created_at.desc&limit=1`
            );
            if (!targetResponse.ok) throw new Error(`Supabase test lookup failed: ${targetResponse.status}`);
            const targets = await targetResponse.json() as Array<{ alert_key: string; last_test_at?: string }>;
            if (targets.length === 0) {
                return jsonResponse({ error: 'no active alerts' }, 404);
            }
            const lastTestAt = targets[0].last_test_at ? new Date(targets[0].last_test_at).getTime() : 0;
            if (Date.now() - lastTestAt < 10 * 60 * 1000) {
                return jsonResponse({ error: 'test cooldown' }, 429);
            }
            const testQueued = await queueTestNotification(targets[0].alert_key);
            if (!testQueued) return jsonResponse({ error: 'test unavailable' }, 503);
            await supabaseRequest(`price_alerts?alert_key=eq.${targets[0].alert_key}`, {
                method: 'PATCH',
                body: JSON.stringify({ last_test_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
            });
            return jsonResponse({ ok: true, testQueued }, 202);
        }

        if (!subscription?.keys?.p256dh || !subscription?.keys?.auth) {
            return jsonResponse({ error: 'invalid subscription' }, 400);
        }

        const conditions = normalizeConditions(rawConditions);
        const isDealAlert = conditions.alertType === 'deal';
        if (!conditions.departureCity || !conditions.maxPrice
            || (isDealAlert ? !conditions.region : !conditions.arrivalCity)) {
            return jsonResponse({ error: 'alert conditions required' }, 400);
        }

        const storedArrivalCity = isDealAlert
            ? encodeDealAlertRegion(conditions.region as DealAlertRegion)
            : conditions.arrivalCity;
        const storedConditions = {
            alertType: conditions.alertType,
            departureCity: conditions.departureCity,
            arrivalCity: storedArrivalCity,
            maxPrice: conditions.maxPrice,
        };

        const alertKey = hash(`${subscription.endpoint}|${JSON.stringify(storedConditions)}`);
        const existingResponse = await supabaseRequest(`price_alerts?select=id&alert_key=eq.${alertKey}&limit=1`);
        if (!existingResponse.ok) throw new Error(`Supabase lookup failed: ${existingResponse.status}`);
        const existing = await existingResponse.json() as Array<{ id: string }>;

        if (existing.length === 0) {
            if (await rowCount('active=eq.true') >= MAX_ALERTS) {
                return NextResponse.json({ error: 'capacity reached' }, { status: 503 });
            }
            if (await rowCount(`endpoint_hash=eq.${endpointHash}&active=eq.true`) >= MAX_ALERTS_PER_ENDPOINT) {
                return NextResponse.json({ error: 'too many alerts' }, { status: 429 });
            }
            const cutoff = encodeURIComponent(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
            if (await rowCount(`request_hash=eq.${requestHash(request)}&created_at=gte.${cutoff}`) >= MAX_NEW_ALERTS_PER_DAY) {
                return NextResponse.json({ error: 'daily limit reached' }, { status: 429 });
            }
        }

        const payload = {
            alert_key: alertKey,
            endpoint_hash: endpointHash,
            subscription,
            departure_city: conditions.departureCity,
            arrival_city: storedArrivalCity,
            departure_date_from: null,
            departure_date_to: null,
            max_price: conditions.maxPrice,
            request_hash: requestHash(request),
            active: true,
            updated_at: new Date().toISOString(),
            ...(existing.length === 0 ? {
                last_notified_price: Number.isFinite(Number(baseline?.price)) ? Math.round(Number(baseline.price)) : null,
                last_notified_flight_id: cleanText(baseline?.flightId, 200) || null,
                notified_flight_ids: cleanText(baseline?.flightId, 200) ? [cleanText(baseline.flightId, 200)] : [],
            } : {}),
        };
        const saveResponse = await supabaseRequest('price_alerts?on_conflict=alert_key', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(payload),
        });
        if (!saveResponse.ok) throw new Error(`Supabase save failed: ${saveResponse.status}`);

        let testQueued = false;
        if (existing.length === 0 && !isDealAlert) {
            try {
                testQueued = await queueTestNotification(alertKey);
                if (testQueued) {
                    await supabaseRequest(`price_alerts?alert_key=eq.${alertKey}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ last_test_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
                    });
                }
            } catch (error: unknown) {
                console.error('Alert registration test failed:', error);
            }
        }

        return jsonResponse({ ok: true, id: alertKey, testQueued });
    } catch (error) {
        console.error('Alert API error:', error);
        return NextResponse.json({ error: 'internal error' }, { status: 500 });
    }
}
