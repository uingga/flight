import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

interface AlertConditions {
    route?: string;
    region?: string;
    departureCity?: string;
    arrivalCity?: string;
    departureDateFrom?: string;
    departureDateTo?: string;
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
    return {
        route: cleanText(input.route),
        region: cleanText(input.region),
        departureCity: cleanText(input.departureCity),
        arrivalCity: cleanText(input.arrivalCity),
        departureDateFrom: cleanText(input.departureDateFrom, 20),
        departureDateTo: cleanText(input.departureDateTo, 20),
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

        const { subscription, conditions: rawConditions, baseline } = await request.json();
        if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth || !validPushEndpoint(subscription.endpoint)) {
            return NextResponse.json({ error: 'invalid subscription' }, { status: 400 });
        }

        const conditions = normalizeConditions(rawConditions);
        if (!conditions.arrivalCity || !conditions.departureCity || !conditions.maxPrice) {
            return NextResponse.json({ error: 'alert conditions required' }, { status: 400 });
        }

        const endpointHash = hash(subscription.endpoint);
        const alertKey = hash(`${subscription.endpoint}|${JSON.stringify(conditions)}`);
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
            arrival_city: conditions.arrivalCity,
            departure_date_from: conditions.departureDateFrom || null,
            departure_date_to: conditions.departureDateTo || null,
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

        const response = NextResponse.json({ ok: true, id: alertKey.slice(0, 24) });
        response.cookies.delete('tikit_alert_nonce');
        return response;
    } catch (error) {
        console.error('Alert API error:', error);
        return NextResponse.json({ error: 'internal error' }, { status: 500 });
    }
}
