// GA4 Data API client.
// 서비스 계정 JWT를 Node 내장 crypto로 직접 서명한다 (googleapis 의존성 없음).

import * as crypto from 'crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const DATA_API = 'https://analyticsdata.googleapis.com/v1beta';

export interface Ga4Config {
    propertyId: string;
    clientEmail: string;
    privateKey: string;
}

/** 환경변수 3개가 모두 있어야 GA4 조회가 가능하다. 없으면 호출부에서 안내 문구로 폴백. */
export function ga4Config(): Ga4Config | null {
    const propertyId = process.env.GA4_PROPERTY_ID?.trim();
    const clientEmail = process.env.GA4_CLIENT_EMAIL?.trim();
    // Vercel 환경변수에 줄바꿈이 \n 문자열로 들어가는 경우가 흔하다
    const privateKey = process.env.GA4_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
    if (!propertyId || !clientEmail || !privateKey) return null;
    return { propertyId, clientEmail, privateKey };
}

const base64url = (input: Buffer | string) =>
    Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let cachedToken: { token: string; expiresAt: number } | null = null;

async function accessToken(config: Ga4Config): Promise<string> {
    // 토큰은 1시간짜리라 람다 인스턴스가 살아있는 동안 재사용한다
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = base64url(JSON.stringify({
        iss: config.clientEmail,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
    }));

    let signature: string;
    try {
        signature = base64url(crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claim}`), config.privateKey));
    } catch {
        throw new Error('GA4_PRIVATE_KEY 형식이 올바르지 않습니다. JSON의 private_key 값을 줄바꿈까지 그대로 넣어주세요.');
    }

    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: `${header}.${claim}.${signature}`,
        }),
        cache: 'no-store',
    });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`GA4 토큰 발급 실패 (${response.status}): ${detail.slice(0, 200)}`);
    }

    const json = await response.json() as { access_token: string; expires_in: number };
    cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
}

export interface ReportRequest {
    dateRanges: Array<{ startDate: string; endDate: string }>;
    dimensions?: Array<{ name: string }>;
    metrics: Array<{ name: string }>;
    dimensionFilter?: unknown;
    orderBys?: unknown[];
    limit?: number;
    metricAggregations?: string[];
    keepEmptyRows?: boolean;
}

export interface ReportRow {
    dimensionValues?: Array<{ value: string }>;
    metricValues?: Array<{ value: string }>;
}

export interface ReportResponse {
    rows?: ReportRow[];
    totals?: ReportRow[];
    metadata?: {
        timeZone?: string;
    };
}

export async function runReport(config: Ga4Config, request: ReportRequest): Promise<ReportResponse> {
    const token = await accessToken(config);
    const response = await fetch(`${DATA_API}/properties/${config.propertyId}:runReport`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        cache: 'no-store',
    });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`GA4 리포트 실패 (${response.status}): ${detail.slice(0, 300)}`);
    }
    return await response.json() as ReportResponse;
}

/** eventName == value 필터 */
export const eventNameFilter = (eventName: string) => ({
    filter: { fieldName: 'eventName', stringFilter: { value: eventName, matchType: 'EXACT' } },
});

export const dim = (row: ReportRow, index = 0) => row.dimensionValues?.[index]?.value ?? '';
export const num = (row: ReportRow | undefined, index = 0) => Number(row?.metricValues?.[index]?.value ?? 0) || 0;
