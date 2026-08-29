import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page, type Response } from 'playwright';
import {
    DEFAULT_TTANG_EVIDENCE_MAX_AGE_HOURS,
    verifyTtangBookingEvidence,
    type BookingLinkProbeOutcome,
} from '@/lib/booking-link-health';
import { getFlightBookingUrl } from '@/lib/utils/booking-url';
import type { Flight } from '@/types/flight';

const CACHE_PATH = path.join(process.cwd(), 'data', 'all-flights-cache.json');
const OUTPUT_PATH = process.env.BOOKING_LINK_HEALTH_PATH
    || path.join(process.cwd(), 'data', 'booking-link-health.json');
const SOURCE_ORDER: Flight['source'][] = ['ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang', 'myrealtrip'];
const SOURCE_NAMES: Record<Flight['source'], string> = {
    ybtour: '노랑풍선',
    hanatour: '하나투어',
    modetour: '모두투어',
    onlinetour: '온라인투어',
    ttang: '땡처리닷컴',
    myrealtrip: '마이리얼트립',
};
const EXPECTED_HOSTS: Record<Flight['source'], string[]> = {
    ybtour: ['mfly.ybtour.co.kr', 'fly.ybtour.co.kr'],
    hanatour: ['m.hanatour.com', 'www.hanatour.com', 'hope.hanatour.com'],
    modetour: ['m.modetour.com', 'www.modetour.com'],
    onlinetour: ['m.onlinetour.co.kr', 'www.onlinetour.co.kr'],
    ttang: ['mm.ttang.com', 'www.ttang.com', 'm.ttang.com'],
    myrealtrip: ['air-web.myrealtrip.com'],
};

type ProbeStage = 'initial' | 'retry' | 'confirmation';

interface ProbeResult {
    source: Flight['source'];
    flightId: string;
    route: string;
    departureDate: string;
    checkedAt: string;
    stage: ProbeStage;
    outcome: BookingLinkProbeOutcome;
    success: boolean;
    statusCode: number | null;
    finalUrl: string;
    reason: string | null;
    durationMs: number;
    verificationMethod: 'browser_navigation' | 'crawl_evidence';
    evidenceAt: string | null;
}

interface SourceResult {
    source: Flight['source'];
    status: 'healthy' | 'recovered' | 'isolated_failure' | 'systemic_suspected' | 'evidence_unavailable' | 'not_checked';
    availableFlights: number;
    checks: ProbeResult[];
}

interface HealthEntry {
    date: string;
    checkedAt: string;
    summary: {
        scheduled: number;
        passed: number;
        failed: number;
        unavailable: number;
        recovered: number;
        systemicSources: number;
        checkedSources: number;
    };
    sources: SourceResult[];
}

interface HealthFile {
    version: 1;
    updatedAt: string;
    entries: HealthEntry[];
}

function koreaDateKey(value: Date | string = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(value));
}

function stableHash(value: string): number {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function orderedCandidates(flights: Flight[], source: Flight['source'], dateKey: string): Flight[] {
    const unique = Array.from(new Map(flights.map(flight => [flight.id, flight])).values());
    if (unique.length <= 1) return unique;

    const newest = [...unique].sort((a, b) => {
        const firstSeenDiff = String(b.firstSeen || '').localeCompare(String(a.firstSeen || ''));
        return firstSeenDiff || a.id.localeCompare(b.id);
    })[0];
    const rest = unique.filter(flight => flight.id !== newest.id).sort((a, b) => a.id.localeCompare(b.id));
    const start = stableHash(`${dateKey}:${source}`) % rest.length;
    const rotated = [...rest.slice(start), ...rest.slice(0, start)];
    const newestRoute = `${newest.departure.airport}:${newest.arrival.airport}`;
    const otherRoutes = rotated.filter(flight => `${flight.departure.airport}:${flight.arrival.airport}` !== newestRoute);
    const sameRoute = rotated.filter(flight => `${flight.departure.airport}:${flight.arrival.airport}` === newestRoute);
    return [newest, ...otherRoutes, ...sameRoute];
}

function routeLabel(flight: Flight): string {
    return `${flight.departure.city} → ${flight.arrival.city}`;
}

function expectedMyRealTripTrip(flight: Flight): string | null {
    const airports = flight.routeAirports;
    if (!airports) return null;
    return `A.${airports.outboundDeparture}.A.${airports.outboundArrival}.${flight.departure.date}`
        + `/A.${airports.returnDeparture}.A.${airports.returnArrival}.${flight.arrival.date}`;
}

function failureReason(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (/Timeout|timeout|timed out/i.test(message)) return '30초 안에 예약 화면이 열리지 않음';
    if (/net::ERR_/i.test(message)) return `여행사 연결 오류 (${message.match(/net::ERR_[A-Z_]+/i)?.[0] || '네트워크 오류'})`;
    return message.slice(0, 180);
}

async function probeFlight(page: Page, flight: Flight, stage: ProbeStage): Promise<ProbeResult> {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();
    let statusCode: number | null = null;
    let finalUrl = '';

    try {
        const userBookingUrl = getFlightBookingUrl(flight, { adult: 1, child: 0, infant: 0 }, true);
        if (!userBookingUrl) throw new Error('예약 주소가 비어 있음');
        const targetUrl = new URL(userBookingUrl, 'https://www.tikitikit.kr').toString();
        let lastNavigationResponse: Response | null = null;
        page.on('response', response => {
            if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
                lastNavigationResponse = response;
            }
        });

        const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        statusCode = response?.status() ?? null;

        if (flight.source === 'myrealtrip') {
            await page.waitForURL(url => url.hostname === 'air-web.myrealtrip.com', { timeout: 20_000 });
        } else {
            await page.waitForTimeout(1_200);
        }

        finalUrl = page.url();
        statusCode = lastNavigationResponse?.status() ?? statusCode;
        const parsedFinalUrl = new URL(finalUrl);
        if (!EXPECTED_HOSTS[flight.source].includes(parsedFinalUrl.hostname)) {
            throw new Error(`예상과 다른 사이트로 이동 (${parsedFinalUrl.hostname})`);
        }
        if (statusCode !== null && statusCode >= 400) {
            throw new Error(`여행사 오류 응답 (${statusCode})`);
        }
        if (/\/(404|error)(?:\/|$)/i.test(parsedFinalUrl.pathname)) {
            throw new Error('여행사 오류 화면으로 이동');
        }

        const pageTitle = await page.title().catch(() => '');
        if (/access denied|페이지를 찾을 수 없|존재하지 않는 페이지|service unavailable/i.test(pageTitle)) {
            throw new Error(`여행사 오류 화면 (${pageTitle.slice(0, 80)})`);
        }

        if (flight.source === 'myrealtrip') {
            const expectedTrip = expectedMyRealTripTrip(flight);
            const landedTrip = parsedFinalUrl.searchParams.get('trip');
            if (expectedTrip && landedTrip !== expectedTrip) {
                throw new Error('마이리얼트립 검색 결과의 공항 또는 날짜가 다름');
            }
        }

        return {
            source: flight.source,
            flightId: flight.id,
            route: routeLabel(flight),
            departureDate: flight.departure.date,
            checkedAt,
            stage,
            success: true,
            outcome: 'passed',
            statusCode,
            // 정상 링크의 긴 쿼리 주소는 장기 기록에 남길 필요가 없다.
            // 실패한 주소만 아래 catch에서 보관해 어드민의 직접 확인에 사용한다.
            finalUrl: '',
            reason: null,
            durationMs: Date.now() - startedAt,
            verificationMethod: 'browser_navigation',
            evidenceAt: null,
        };
    } catch (error) {
        finalUrl = page.url() === 'about:blank' ? finalUrl : page.url();
        return {
            source: flight.source,
            flightId: flight.id,
            route: routeLabel(flight),
            departureDate: flight.departure.date,
            checkedAt,
            stage,
            success: false,
            outcome: 'failed',
            statusCode,
            finalUrl,
            reason: failureReason(error),
            durationMs: Date.now() - startedAt,
            verificationMethod: 'browser_navigation',
            evidenceAt: null,
        };
    }
}

async function runProbe(
    browser: Awaited<ReturnType<typeof chromium.launch>>,
    flight: Flight,
    stage: ProbeStage,
): Promise<ProbeResult> {
    // 땡처리닷컴은 GitHub 데이터센터 요청을 403으로 차단한다. 이 가드는 향후
    // 분기 실수로도 예약 링크 점검에서 외부 요청이 나가지 않게 막는다.
    if (flight.source === 'ttang') {
        throw new Error('땡처리닷컴은 브라우저 탐색 대신 크롤 증거로만 검증해야 합니다.');
    }
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
        locale: 'ko-KR',
    });
    const page = await context.newPage();
    try {
        return await probeFlight(page, flight, stage);
    } finally {
        await context.close();
    }
}

function loadHealthFile(): HealthFile {
    try {
        const parsed = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8')) as Partial<HealthFile>;
        return {
            version: 1,
            updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
            entries: Array.isArray(parsed.entries) ? parsed.entries : [],
        };
    } catch {
        return { version: 1, updatedAt: new Date(0).toISOString(), entries: [] };
    }
}

async function main(): Promise<void> {
    const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) as {
        flights?: Flight[];
        sourceUpdatedAt?: Record<string, string>;
    };
    const flights = Array.isArray(cache.flights) ? cache.flights : [];
    const dateKey = koreaDateKey();
    const checkedAt = new Date().toISOString();
    const browser = await chromium.launch({ headless: true });
    const sources: SourceResult[] = [];

    try {
        for (const source of SOURCE_ORDER) {
            const sourceFlights = flights.filter(flight => flight.source === source);
            const candidates = orderedCandidates(sourceFlights, source, dateKey);
            const initial = candidates.slice(0, 2);
            const checks: ProbeResult[] = [];
            let recovered = false;

            console.log(`\n[${SOURCE_NAMES[source]}] ${initial.length}개 표본 확인`);
            if (source === 'ttang') {
                const configuredMaxAge = Number(process.env.TTANG_EVIDENCE_MAX_AGE_HOURS);
                const maxAgeHours = Number.isFinite(configuredMaxAge) && configuredMaxAge > 0
                    ? configuredMaxAge
                    : DEFAULT_TTANG_EVIDENCE_MAX_AGE_HOURS;
                console.log(`  외부 접속 없이 ${maxAgeHours}시간 이내 정상 크롤 증거와 URL 구조만 확인`);
                for (const flight of initial) {
                    const startedAt = Date.now();
                    const evidence = verifyTtangBookingEvidence(flight, cache.sourceUpdatedAt?.ttang, {
                        now: new Date(checkedAt),
                        maxAgeHours,
                    });
                    const check: ProbeResult = {
                        source,
                        flightId: flight.id,
                        route: routeLabel(flight),
                        departureDate: flight.departure.date,
                        checkedAt: new Date().toISOString(),
                        stage: 'initial',
                        outcome: evidence.outcome,
                        success: evidence.outcome === 'passed',
                        statusCode: null,
                        finalUrl: evidence.outcome === 'failed' ? evidence.bookingUrl : '',
                        reason: evidence.reason,
                        durationMs: Date.now() - startedAt,
                        verificationMethod: 'crawl_evidence',
                        evidenceAt: evidence.evidenceAt,
                    };
                    checks.push(check);
                    const marker = check.outcome === 'passed' ? '✓' : check.outcome === 'unavailable' ? '–' : '✗';
                    console.log(`  ${marker} ${check.route} ${check.reason || '최신 크롤 증거 확인'}`);
                }

                const failedCount = checks.filter(check => check.outcome === 'failed').length;
                const unavailableCount = checks.filter(check => check.outcome === 'unavailable').length;
                const status: SourceResult['status'] = initial.length === 0
                    ? 'not_checked'
                    : failedCount >= 2
                        ? 'systemic_suspected'
                        : failedCount === 1
                            ? 'isolated_failure'
                            : unavailableCount > 0
                                ? 'evidence_unavailable'
                                : 'healthy';
                sources.push({ source, status, availableFlights: sourceFlights.length, checks });
                continue;
            }

            for (const flight of initial) {
                const first = await runProbe(browser, flight, 'initial');
                checks.push(first);
                console.log(`  ${first.success ? '✓' : '✗'} ${first.route} ${first.reason || ''}`);
                if (!first.success) {
                    await new Promise(resolve => setTimeout(resolve, 1_500));
                    const retry = await runProbe(browser, flight, 'retry');
                    checks.push(retry);
                    recovered ||= retry.success;
                    console.log(`  ${retry.success ? '↻ 정상' : '↻ 실패'} ${retry.route} ${retry.reason || ''}`);
                }
            }

            const unresolvedIds = new Set(checks
                .filter(check => check.stage === 'retry' && !check.success)
                .map(check => check.flightId));
            if (unresolvedIds.size > 0) {
                const extras = candidates.filter(flight => !initial.some(item => item.id === flight.id)).slice(0, 2);
                console.log(`  추가 표본 ${extras.length}개 확인`);
                for (const flight of extras) {
                    const confirmation = await runProbe(browser, flight, 'confirmation');
                    checks.push(confirmation);
                    console.log(`  ${confirmation.success ? '✓' : '✗'} ${confirmation.route} ${confirmation.reason || ''}`);
                }
            }

            const distinctFailedFlights = new Set(checks.filter(check => check.outcome === 'failed').map(check => check.flightId));
            const latestResultByFlight = new Map<string, ProbeResult>();
            for (const check of checks) latestResultByFlight.set(check.flightId, check);
            const unresolvedDistinct = Array.from(latestResultByFlight.values()).filter(check => check.outcome === 'failed').length;
            const status: SourceResult['status'] = initial.length === 0
                ? 'not_checked'
                : unresolvedDistinct >= 2
                    ? 'systemic_suspected'
                    : unresolvedDistinct === 1
                        ? 'isolated_failure'
                        : recovered || distinctFailedFlights.size > 0
                            ? 'recovered'
                            : 'healthy';
            sources.push({ source, status, availableFlights: sourceFlights.length, checks });
        }
    } finally {
        await browser.close();
    }

    // 같은 링크의 첫 실패와 재시도를 중복 집계하지 않고 마지막 결과만 센다.
    const finalChecks = sources.flatMap(source => {
        const latestByFlight = new Map<string, ProbeResult>();
        source.checks.forEach(check => latestByFlight.set(check.flightId, check));
        return Array.from(latestByFlight.values());
    });
    const entry: HealthEntry = {
        date: dateKey,
        checkedAt,
        summary: {
            scheduled: sources.reduce((sum, source) => sum + Math.min(2, source.availableFlights), 0),
            passed: finalChecks.filter(check => check.success).length,
            failed: finalChecks.filter(check => check.outcome === 'failed').length,
            unavailable: finalChecks.filter(check => check.outcome === 'unavailable').length,
            recovered: sources.filter(source => source.status === 'recovered').length,
            systemicSources: sources.filter(source => source.status === 'systemic_suspected').length,
            checkedSources: sources.filter(source => source.status !== 'not_checked').length,
        },
        sources,
    };
    const healthFile = loadHealthFile();
    const entries = healthFile.entries.filter(item => item.date !== dateKey);
    entries.push(entry);
    const nextFile: HealthFile = {
        version: 1,
        updatedAt: new Date().toISOString(),
        entries: entries.slice(-60),
    };
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(nextFile, null, 2)}\n`, 'utf8');
    console.log(`\n예약 링크 점검 완료: 성공 ${entry.summary.passed}, 실패 ${entry.summary.failed}, 확인 보류 ${entry.summary.unavailable}, 전체 문제 의심 ${entry.summary.systemicSources}곳`);
    console.log(`기록: ${OUTPUT_PATH}`);
}

main().catch(error => {
    console.error('예약 링크 점검 실행 실패:', error);
    process.exitCode = 1;
});
