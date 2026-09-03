import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import type { Flight } from '@/types/flight';
import {
    effectivePrice,
    loadActiveFlights,
    loadStaticInterparkPrices,
    loadStaticRecommendationPriceHistory,
} from '@/lib/flight-static';
import {
    buildRecommendationScoreState,
    compareRecommendedFlights,
} from '@/lib/flight-recommendation';
import { getRecommendationComparisonFreshness } from '@/lib/price-quality';
import {
    buildManualTodayPick,
    kstDateKey,
    type StoredTodayPick,
} from '@/lib/manual-today-pick';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_KEY = process.env.ADMIN_KEY;
const GITHUB_TOKEN = process.env.GH_PAT;
const GITHUB_REPOSITORY = 'uingga/flight';
const TODAY_PICK_PATH = 'data/today-pick.json';
const FLIGHT_CACHE_PATH = 'data/all-flights-cache.json';

interface GitHubContentResponse {
    content?: string;
    encoding?: string;
    sha?: string;
}

function authorized(request: NextRequest, bodyKey?: unknown): boolean {
    const supplied = request.nextUrl.searchParams.get('key')
        || (typeof bodyKey === 'string' ? bodyKey : '');
    return Boolean(ADMIN_KEY && supplied === ADMIN_KEY);
}

function sameSiteRequest(request: NextRequest): boolean {
    const host = request.headers.get('host');
    const source = request.headers.get('origin') || request.headers.get('referer');
    if (!host || !source) return false;
    try {
        return new URL(source).host === host;
    } catch {
        return false;
    }
}

function githubHeaders(token: string, accept = 'application/vnd.github+json'): HeadersInit {
    return {
        Accept: accept,
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
    };
}

function githubContentUrl(filePath: string): string {
    return `https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/${filePath}`;
}

function readLocalTodayPick(): StoredTodayPick {
    try {
        return JSON.parse(fs.readFileSync(
            path.join(process.cwd(), TODAY_PICK_PATH),
            'utf8',
        )) as StoredTodayPick;
    } catch {
        return {};
    }
}

async function readRemoteTodayPick(token: string): Promise<{ pick: StoredTodayPick; sha: string }> {
    const response = await fetch(`${githubContentUrl(TODAY_PICK_PATH)}?ref=main`, {
        headers: githubHeaders(token),
        cache: 'no-store',
    });
    if (!response.ok) throw new Error(`GitHub today-pick read failed: ${response.status}`);
    const payload = await response.json() as GitHubContentResponse;
    if (!payload.sha || !payload.content || payload.encoding !== 'base64') {
        throw new Error('GitHub today-pick response is incomplete');
    }
    const decoded = Buffer.from(payload.content.replace(/\s/g, ''), 'base64').toString('utf8');
    return { pick: JSON.parse(decoded) as StoredTodayPick, sha: payload.sha };
}

async function readRemoteFlights(token: string): Promise<Flight[]> {
    const response = await fetch(`${githubContentUrl(FLIGHT_CACHE_PATH)}?ref=main`, {
        headers: githubHeaders(token, 'application/vnd.github.raw+json'),
        cache: 'no-store',
    });
    if (!response.ok) throw new Error(`GitHub flight cache read failed: ${response.status}`);
    const payload = await response.json() as { flights?: Flight[] } | Flight[];
    return Array.isArray(payload) ? payload : Array.isArray(payload.flights) ? payload.flights : [];
}

function isSelectableFlight(flight: Flight, today = kstDateKey()): boolean {
    const departureDate = String(flight.departure?.date || '').slice(0, 10);
    const returnDate = String(flight.arrival?.date || '').slice(0, 10);
    return Number(flight.price) > 0
        && departureDate >= today
        && returnDate > departureDate;
}

async function commitTodayPick(
    token: string,
    flight: Flight,
): Promise<{ pick: ReturnType<typeof buildManualTodayPick>; commitSha: string | null; alreadySelected: boolean }> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const remote = await readRemoteTodayPick(token);
        const pick = buildManualTodayPick(remote.pick, flight);
        if (remote.pick.date === pick.date && remote.pick.flightId === pick.flightId) {
            return { pick, commitSha: null, alreadySelected: true };
        }

        const response = await fetch(githubContentUrl(TODAY_PICK_PATH), {
            method: 'PUT',
            headers: {
                ...githubHeaders(token),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: `chore(data): manually select TIKIT DROP for ${pick.date}`,
                content: Buffer.from(`${JSON.stringify(pick, null, 2)}\n`, 'utf8').toString('base64'),
                sha: remote.sha,
                branch: 'main',
            }),
            cache: 'no-store',
        });
        if (response.ok) {
            const result = await response.json() as { commit?: { sha?: string } };
            return { pick, commitSha: result.commit?.sha || null, alreadySelected: false };
        }
        if (response.status !== 409 || attempt === 1) {
            throw new Error(`GitHub today-pick update failed: ${response.status}`);
        }
    }
    throw new Error('GitHub today-pick update conflict');
}

function candidatePayload(flights: Flight[], currentPick: StoredTodayPick) {
    const now = Date.now();
    const state = buildRecommendationScoreState(
        flights,
        loadStaticInterparkPrices(flights),
        now,
        loadStaticRecommendationPriceHistory(),
    );
    const ranked = flights.slice().sort((left, right) => compareRecommendedFlights(
        left,
        right,
        state.scores,
        now,
        state.explanations,
    ));

    return ranked.map((flight, index) => {
        const naverLowest = Number(flight.naverLowest);
        const naverUsable = Number.isFinite(naverLowest)
            && naverLowest > 0
            && getRecommendationComparisonFreshness(flight.naverCheckedAt, now).usable;
        const price = effectivePrice(flight);
        return {
            id: flight.id,
            rank: index + 1,
            departureCity: flight.departure.city,
            arrivalCity: flight.arrival.city,
            departureDate: flight.departure.date,
            returnDate: flight.arrival.date,
            effectivePrice: price,
            naverLowest: naverUsable ? naverLowest : null,
            naverDifference: naverUsable ? price - naverLowest : null,
            recommendationTier: state.explanations.get(flight.id)?.topRecommendationTier ?? 3,
            selected: currentPick.date === kstDateKey(now) && currentPick.flightId === flight.id,
        };
    });
}

export async function GET(request: NextRequest) {
    if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const currentPick = readLocalTodayPick();
    const flights = loadActiveFlights();
    const currentFlight = flights.find(flight => (
        currentPick.date === kstDateKey()
        && currentPick.flightId === flight.id
    ));
    return NextResponse.json({
        available: Boolean(GITHUB_TOKEN),
        message: GITHUB_TOKEN ? null : 'GitHub 저장 키가 없어 수동 선정을 저장할 수 없습니다.',
        current: currentFlight ? {
            id: currentFlight.id,
            departureCity: currentFlight.departure.city,
            arrivalCity: currentFlight.arrival.city,
            departureDate: currentFlight.departure.date,
            returnDate: currentFlight.arrival.date,
            effectivePrice: effectivePrice(currentFlight),
            selectedAt: currentPick.selectedAt || null,
            selectionMode: currentPick.selectionMode || null,
        } : null,
        candidates: candidatePayload(flights, currentPick),
    });
}

export async function POST(request: NextRequest) {
    try {
        if (!sameSiteRequest(request)) {
            return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
        }
        const body = await request.json() as { key?: unknown; flightId?: unknown };
        if (!authorized(request, body.key)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (!GITHUB_TOKEN) {
            return NextResponse.json({ error: 'GitHub 저장 키가 설정되지 않았습니다.' }, { status: 503 });
        }
        const flightId = typeof body.flightId === 'string' ? body.flightId.trim() : '';
        if (!flightId || flightId.length > 300) {
            return NextResponse.json({ error: '선정할 항공권이 올바르지 않습니다.' }, { status: 400 });
        }

        // 배포본보다 main의 크롤 데이터가 앞서 있을 수 있으므로 실제 커밋 직전에 원격 데이터를 다시 확인한다.
        const remoteFlights = await readRemoteFlights(GITHUB_TOKEN);
        const flight = remoteFlights.find(candidate => candidate.id === flightId);
        if (!flight || !isSelectableFlight(flight)) {
            return NextResponse.json({
                error: '이 항공권은 최신 목록에서 사라졌거나 출발이 지나 선정할 수 없습니다. 목록을 새로고침해주세요.',
            }, { status: 409 });
        }

        const result = await commitTodayPick(GITHUB_TOKEN, flight);
        return NextResponse.json({
            success: true,
            alreadySelected: result.alreadySelected,
            commitSha: result.commitSha,
            current: {
                id: flight.id,
                departureCity: flight.departure.city,
                arrivalCity: flight.arrival.city,
                departureDate: flight.departure.date,
                returnDate: flight.arrival.date,
                effectivePrice: effectivePrice(flight),
                selectedAt: result.pick.selectedAt,
                selectionMode: result.pick.selectionMode,
            },
            message: result.alreadySelected
                ? '이미 오늘의 TIKIT DROP으로 선정된 항공권입니다.'
                : '선정을 저장했습니다. 자동 배포가 끝나면 메인과 공유 이미지에 반영됩니다.',
        });
    } catch (error) {
        console.error('TIKIT DROP 수동 선정 실패:', error);
        return NextResponse.json({ error: 'TIKIT DROP 선정을 저장하지 못했습니다. 잠시 뒤 다시 시도해주세요.' }, { status: 500 });
    }
}
