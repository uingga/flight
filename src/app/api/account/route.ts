import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookies, getCurrentAccount, isSameOriginRequest } from '@/lib/server/account-auth';
import { getAccountFlightSnapshot } from '@/lib/server/account-flights';
import { SupabaseRestError, supabaseRest } from '@/lib/server/supabase-rest';

export const dynamic = 'force-dynamic';

interface FavoriteRow {
    flight_id: string;
    flight_snapshot: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

interface RecentRow {
    flight_id: string;
    flight_snapshot: Record<string, unknown>;
    viewed_at: string;
}

interface SavedSearchRow {
    id: string;
    name: string;
    filters: SavedSearchFilters;
    created_at: string;
    updated_at: string;
}

interface SavedSearchFilters {
    searchTerm: string;
    sortBy: 'price' | 'date' | 'airline' | 'discount' | 'discountRate';
    sortOrder: 'asc' | 'desc';
    sourceFilter: string;
    regionFilter: string;
    startDate: string;
    endDate: string;
    departureFilter: string;
    airlineFilter: string;
    maxPrice?: number;
    datePeriod?: 'all' | 'this-week' | 'next-week' | 'this-month' | 'next-month' | 'custom';
}

function json(body: Record<string, unknown>, status = 200) {
    return NextResponse.json(body, {
        status,
        headers: { 'Cache-Control': 'no-store, private' },
    });
}

function cleanText(value: unknown, maxLength: number) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function cleanFilters(value: unknown): SavedSearchFilters | null {
    if (!value || typeof value !== 'object') return null;
    const input = value as Record<string, unknown>;
    const sortBy = input.sortBy;
    const sortOrder = input.sortOrder;
    if (!['price', 'date', 'airline', 'discount', 'discountRate'].includes(String(sortBy))) return null;
    if (!['asc', 'desc'].includes(String(sortOrder))) return null;

    const date = (item: unknown) => {
        const text = cleanText(item, 10);
        return !text || /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
    };
    const startDate = date(input.startDate);
    const endDate = date(input.endDate);
    if (startDate === null || endDate === null) return null;

    const rawMaxPrice = Number(input.maxPrice || 0);
    const maxPrice = Number.isFinite(rawMaxPrice) && rawMaxPrice >= 0 && rawMaxPrice <= 10_000_000
        ? Math.round(rawMaxPrice)
        : 0;
    const rawDatePeriod = cleanText(input.datePeriod, 20);
    const datePeriod = ['all', 'this-week', 'next-week', 'this-month', 'next-month', 'custom'].includes(rawDatePeriod)
        ? rawDatePeriod as SavedSearchFilters['datePeriod']
        : undefined;
    return {
        searchTerm: cleanText(input.searchTerm, 40),
        sortBy: sortBy as SavedSearchFilters['sortBy'],
        sortOrder: sortOrder as SavedSearchFilters['sortOrder'],
        sourceFilter: cleanText(input.sourceFilter, 40) || 'all',
        regionFilter: cleanText(input.regionFilter, 40) || 'all',
        startDate,
        endDate,
        departureFilter: cleanText(input.departureFilter, 40) || 'all',
        airlineFilter: cleanText(input.airlineFilter, 60) || 'all',
        ...(maxPrice > 0 ? { maxPrice } : {}),
        ...(datePeriod ? { datePeriod } : {}),
    };
}

async function requireAccount() {
    const account = await getCurrentAccount();
    return account?.user || null;
}

async function readAllFavoriteIds(userId: string) {
    const flightIds: string[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
        const rows = await supabaseRest<Array<{ flight_id: string }>>(
            `tikitikit_user_favorites?select=flight_id&user_id=eq.${userId}&order=updated_at.desc&limit=${pageSize}&offset=${offset}`,
        );
        flightIds.push(...rows.map(row => row.flight_id));
        if (rows.length < pageSize) return flightIds;
    }
}

export async function GET() {
    try {
        const user = await requireAccount();
        if (!user) return json({ authenticated: false });
        const userId = encodeURIComponent(user.id);
        const [favoriteIdRows, favorites, recent, savedSearches] = await Promise.all([
            readAllFavoriteIds(userId),
            supabaseRest<FavoriteRow[]>(`tikitikit_user_favorites?select=flight_id,flight_snapshot,created_at,updated_at&user_id=eq.${userId}&order=updated_at.desc&limit=100`),
            supabaseRest<RecentRow[]>(`tikitikit_user_recent_flights?select=flight_id,flight_snapshot,viewed_at&user_id=eq.${userId}&order=viewed_at.desc&limit=30`),
            supabaseRest<SavedSearchRow[]>(`tikitikit_user_saved_searches?select=id,name,filters,created_at,updated_at&user_id=eq.${userId}&order=updated_at.desc&limit=10`),
        ]);
        return json({
            authenticated: true,
            user: { email: user.email },
            favoriteIds: favoriteIdRows,
            favorites: favorites.map(row => {
                const currentSnapshot = getAccountFlightSnapshot(row.flight_id);
                return {
                    flightId: row.flight_id,
                    snapshot: currentSnapshot || row.flight_snapshot,
                    savedPrice: Number(row.flight_snapshot.price) || 0,
                    availableNow: Boolean(currentSnapshot),
                    updatedAt: row.updated_at,
                };
            }),
            recent: recent.map(row => {
                const currentSnapshot = getAccountFlightSnapshot(row.flight_id);
                return {
                    flightId: row.flight_id,
                    snapshot: currentSnapshot || row.flight_snapshot,
                    availableNow: Boolean(currentSnapshot),
                    viewedAt: row.viewed_at,
                };
            }),
            savedSearches: savedSearches.map(row => ({
                id: row.id,
                name: row.name,
                filters: row.filters,
                updatedAt: row.updated_at,
            })),
        });
    } catch (error) {
        const unavailable = error instanceof SupabaseRestError && error.status === 503;
        console.error('계정 조회 실패:', error instanceof Error ? error.message : 'unknown');
        return json({ authenticated: false, unavailable, error: unavailable ? '로그인 저장소를 준비 중이에요.' : '계정 정보를 불러오지 못했어요.' }, 503);
    }
}

export async function POST(request: NextRequest) {
    if (!isSameOriginRequest(request)) return json({ error: '잘못된 요청이에요.' }, 403);
    if (Number(request.headers.get('content-length') || 0) > 64_000) return json({ error: '요청이 너무 커요.' }, 413);
    let input: Record<string, unknown>;
    try { input = await request.json(); } catch { return json({ error: '잘못된 요청이에요.' }, 400); }

    try {
        const user = await requireAccount();
        if (!user) return json({ error: '로그인이 필요해요.' }, 401);
        const expectedAccountEmail = cleanText(input.expectedAccountEmail, 320).trim().toLowerCase();
        if (!expectedAccountEmail || expectedAccountEmail !== user.email.trim().toLowerCase()) {
            return json({ error: '다른 탭에서 로그인 계정이 바뀌었어요. 화면을 새로고침해 주세요.' }, 409);
        }
        const userId = user.id;
        const action = input.action;

        if (action === 'merge_favorites') {
            const flightIds = Array.isArray(input.flightIds)
                ? Array.from(new Set(input.flightIds.filter(id => typeof id === 'string').slice(0, 100))) as string[]
                : [];
            const rows = flightIds.map(getAccountFlightSnapshot).filter(Boolean).map(snapshot => ({
                user_id: userId,
                flight_id: snapshot!.id,
                flight_snapshot: snapshot,
                updated_at: new Date().toISOString(),
            }));
            if (rows.length) {
                await supabaseRest('tikitikit_user_favorites?on_conflict=user_id,flight_id', {
                    method: 'POST',
                    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
                    body: JSON.stringify(rows),
                });
            }
            return json({ ok: true, mergedFlightIds: rows.map(row => row.flight_id) });
        }

        if (action === 'set_favorite') {
            const flightId = cleanText(input.flightId, 300);
            const favorite = input.favorite === true;
            if (!flightId) return json({ error: '항공권을 확인해 주세요.' }, 400);
            if (!favorite) {
                await supabaseRest(`tikitikit_user_favorites?user_id=eq.${encodeURIComponent(userId)}&flight_id=eq.${encodeURIComponent(flightId)}`, {
                    method: 'DELETE', headers: { Prefer: 'return=minimal' },
                });
            } else {
                const snapshot = getAccountFlightSnapshot(flightId);
                if (!snapshot) return json({ error: '지금 목록에서 찾을 수 없는 항공권이에요.' }, 404);
                await supabaseRest('tikitikit_user_favorites?on_conflict=user_id,flight_id', {
                    method: 'POST',
                    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
                    body: JSON.stringify({
                        user_id: userId,
                        flight_id: flightId,
                        flight_snapshot: snapshot,
                        updated_at: new Date().toISOString(),
                    }),
                });
            }
            return json({ ok: true });
        }

        if (action === 'record_recent') {
            const flightId = cleanText(input.flightId, 300);
            const snapshot = getAccountFlightSnapshot(flightId);
            if (!snapshot) return json({ ok: true });
            await supabaseRest('tikitikit_user_recent_flights?on_conflict=user_id,flight_id', {
                method: 'POST',
                headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
                body: JSON.stringify({
                    user_id: userId,
                    flight_id: flightId,
                    flight_snapshot: snapshot,
                    viewed_at: new Date().toISOString(),
                }),
            });
            const rows = await supabaseRest<Array<{ flight_id: string }>>(
                `tikitikit_user_recent_flights?select=flight_id&user_id=eq.${encodeURIComponent(userId)}&order=viewed_at.desc&offset=30&limit=20`,
            );
            await Promise.all(rows.map(row => supabaseRest(
                `tikitikit_user_recent_flights?user_id=eq.${encodeURIComponent(userId)}&flight_id=eq.${encodeURIComponent(row.flight_id)}`,
                { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
            )));
            return json({ ok: true });
        }

        if (action === 'clear_recent') {
            await supabaseRest(`tikitikit_user_recent_flights?user_id=eq.${encodeURIComponent(userId)}`, {
                method: 'DELETE', headers: { Prefer: 'return=minimal' },
            });
            return json({ ok: true });
        }

        if (action === 'save_search') {
            const filters = cleanFilters(input.filters);
            const name = cleanText(input.name, 40);
            if (!filters || !name) return json({ error: '저장할 검색 조건을 확인해 주세요.' }, 400);
            const existing = await supabaseRest<Array<{ id: string }>>(
                `tikitikit_user_saved_searches?select=id&user_id=eq.${encodeURIComponent(userId)}&limit=11`,
            );
            if (existing.length >= 10) return json({ error: '검색 조건은 10개까지 저장할 수 있어요.' }, 400);
            await supabaseRest('tikitikit_user_saved_searches', {
                method: 'POST',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify({ user_id: userId, name, filters }),
            });
            return json({ ok: true });
        }

        if (action === 'delete_search') {
            const id = cleanText(input.id, 36);
            if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: '저장 조건을 확인해 주세요.' }, 400);
            await supabaseRest(`tikitikit_user_saved_searches?id=eq.${id}&user_id=eq.${encodeURIComponent(userId)}`, {
                method: 'DELETE', headers: { Prefer: 'return=minimal' },
            });
            return json({ ok: true });
        }

        if (action === 'delete_account') {
            await supabaseRest(`tikitikit_users?id=eq.${encodeURIComponent(userId)}`, {
                method: 'DELETE', headers: { Prefer: 'return=minimal' },
            });
            const response = json({ ok: true });
            clearSessionCookies(response);
            return response;
        }

        return json({ error: '지원하지 않는 요청이에요.' }, 400);
    } catch (error) {
        console.error('계정 변경 실패:', error instanceof Error ? error.message : 'unknown');
        return json({ error: '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.' }, 500);
    }
}
