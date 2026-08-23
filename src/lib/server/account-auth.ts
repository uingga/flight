import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';
import { supabaseRest } from './supabase-rest';

const SESSION_DAYS = 30;
const PROD_COOKIE = '__Host-tikitikit_session';
const DEV_COOKIE = 'tikitikit_session';

export interface AccountUser {
    id: string;
    email: string;
    created_at: string;
    last_login_at: string;
}

interface SessionRow {
    id: string;
    user_id: string;
    expires_at: string;
    last_seen_at: string;
}

export function normalizeEmail(value: unknown) {
    if (typeof value !== 'string') return null;
    const email = value.trim().toLowerCase();
    if (email.length < 5 || email.length > 254) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    return email;
}

function authSecret() {
    // AUTH_SECRET을 별도로 두는 것이 권장값이다. 기존 운영 환경에서도 바로 동작하도록
    // 서버 밖으로 노출되지 않는 service role 키를 안전한 폴백으로 사용한다.
    const secret = process.env.AUTH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) throw new Error('Account authentication is not configured');
    return secret;
}

export function hashAuthValue(namespace: string, value: string) {
    return createHmac('sha256', authSecret()).update(`${namespace}:${value}`).digest('hex');
}

export function safeEqualHex(left: string, right: string) {
    if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
    return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function createSessionToken() {
    return randomBytes(32).toString('base64url');
}

function sessionCookieName() {
    return process.env.NODE_ENV === 'production' ? PROD_COOKIE : DEV_COOKIE;
}

function cookieOptions(maxAge: number) {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        path: '/',
        maxAge,
    };
}

export function setSessionCookie(response: NextResponse, token: string) {
    response.cookies.set(sessionCookieName(), token, cookieOptions(SESSION_DAYS * 24 * 60 * 60));
}

export function clearSessionCookies(response: NextResponse) {
    response.cookies.set(PROD_COOKIE, '', { ...cookieOptions(0), secure: true });
    response.cookies.set(DEV_COOKIE, '', { ...cookieOptions(0), secure: false });
}

export function getRequestSessionToken() {
    const cookieStore = cookies();
    return cookieStore.get(PROD_COOKIE)?.value || cookieStore.get(DEV_COOKIE)?.value || null;
}

export function isSameOriginRequest(request: NextRequest) {
    const fetchSite = request.headers.get('sec-fetch-site');
    if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) return false;

    const origin = request.headers.get('origin');
    if (!origin) return process.env.NODE_ENV !== 'production';
    try {
        return new URL(origin).host === request.nextUrl.host;
    } catch {
        return false;
    }
}

export function getRequestFingerprint(request: NextRequest) {
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const ip = forwarded || request.headers.get('x-real-ip') || 'unknown';
    return hashAuthValue('request', ip);
}

export async function getCurrentAccount(): Promise<{ user: AccountUser; session: SessionRow } | null> {
    const token = getRequestSessionToken();
    if (!token) return null;
    const tokenHash = hashAuthValue('session', token);
    const now = new Date().toISOString();
    const sessions = await supabaseRest<SessionRow[]>(
        `tikitikit_auth_sessions?select=id,user_id,expires_at,last_seen_at&token_hash=eq.${tokenHash}&expires_at=gt.${encodeURIComponent(now)}&limit=1`,
    );
    const session = sessions[0];
    if (!session) return null;

    const users = await supabaseRest<AccountUser[]>(
        `tikitikit_users?select=id,email,created_at,last_login_at&id=eq.${encodeURIComponent(session.user_id)}&limit=1`,
    );
    const user = users[0];
    if (!user) return null;

    // 하루에 한 번만 last_seen_at을 갱신해 읽기 요청이 DB 쓰기 폭증으로 이어지지 않게 한다.
    if (Date.now() - new Date(session.last_seen_at).getTime() > 24 * 60 * 60 * 1000) {
        void supabaseRest(
            `tikitikit_auth_sessions?id=eq.${encodeURIComponent(session.id)}`,
            {
                method: 'PATCH',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify({ last_seen_at: now }),
            },
        ).catch(() => undefined);
    }

    return { user, session };
}

export async function deleteCurrentSession() {
    const token = getRequestSessionToken();
    if (!token) return;
    const tokenHash = hashAuthValue('session', token);
    await supabaseRest(`tikitikit_auth_sessions?token_hash=eq.${tokenHash}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
    });
}
