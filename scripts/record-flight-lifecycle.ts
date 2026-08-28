import fs from 'node:fs';
import path from 'node:path';
import type { Flight } from '../src/types/flight';
import { safeIso, toLifecycleSnapshot, type LifecycleSnapshot } from './lib/flight-lifecycle';
import { groupRowsByShape } from './lib/postgrest-batch';

type Source = Flight['source'];
type RunStatus = 'success' | 'preserved' | 'skipped' | 'warning';
type OfferStatus = 'active' | 'missing_once' | 'paused_estimated' | 'ended_estimated';

interface ObservationFile {
    observedAt?: string;
    mode?: 'agency' | 'comparison';
    cachePreserved?: boolean;
    alerts?: string[];
    sources?: Partial<Record<Source, { status: RunStatus; scraped?: number; allowMissing?: boolean }>>;
    observations?: Array<{ flight: Flight; visible?: boolean }>;
}

interface CacheFile {
    timestamp?: string;
    flights?: Flight[];
    sourceUpdatedAt?: Partial<Record<Source, string>>;
}

interface CurrentOfferRow {
    offer_key: string;
    itinerary_key: string;
    identity_version: number;
    source: Source;
    source_product_ref: string | null;
    source_flight_id: string;
    departure_city: string;
    departure_airport: string | null;
    arrival_city: string;
    arrival_airport: string | null;
    departure_date: string | null;
    return_date: string | null;
    outbound_time: string | null;
    outbound_arrival_time: string | null;
    return_time: string | null;
    return_arrival_time: string | null;
    airline: string | null;
    flight_number: string | null;
    return_flight_number: string | null;
    listed_price: number;
    effective_price: number;
    available_seats: number | null;
    seat_count_kind: LifecycleSnapshot['seatCountKind'];
    region: string | null;
    booking_url: string | null;
    is_visible: boolean;
    status: OfferStatus;
    missing_streak: number;
    missing_since: string | null;
    first_seen_at: string;
    last_seen_at: string;
    last_changed_at: string;
    last_run_key: string | null;
    price_checked_at: string | null;
    comparison_price: number | null;
    comparison_checked_at: string | null;
    updated_at: string;
}

interface OfferEventRow {
    offer_key: string;
    itinerary_key: string;
    source: Source;
    event_type:
        | 'first_seen'
        | 'price_changed'
        | 'seats_changed'
        | 'visibility_changed'
        | 'comparison_changed'
        | 'schedule_changed'
        | 'missing'
        | 'paused_estimated'
        | 'reappeared'
        | 'ended_estimated';
    observed_at: string;
    run_key: string;
    previous_price: number | null;
    current_price: number | null;
    previous_seats: number | null;
    current_seats: number | null;
    previous_visible: boolean | null;
    current_visible: boolean | null;
    previous_comparison_price: number | null;
    current_comparison_price: number | null;
    details: Record<string, unknown>;
}

const ROOT = process.cwd();
const CACHE_PATH = path.join(ROOT, 'data', 'all-flights-cache.json');
const DRY_RUN = process.argv.includes('--dry-run');
const SOURCE_ARG = process.argv.find(arg => arg.startsWith('--source='))?.split('=')[1] as Source | undefined;
const OBSERVATION_PATH = process.env.LIFECYCLE_OBSERVATION_PATH || '';
const BATCH_SIZE = 250;
const PAGE_SIZE = 1000;
const PAUSE_AFTER_MISSES = 3;
const END_AFTER_HOURS = 72;
const SOURCES: Source[] = ['ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang', 'myrealtrip'];

function readJson<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function loadInput(): { input: ObservationFile; observedAt: string } {
    if (OBSERVATION_PATH && fs.existsSync(OBSERVATION_PATH)) {
        const input = readJson<ObservationFile>(OBSERVATION_PATH);
        const observedAt = safeIso(input.observedAt) || new Date().toISOString();
        return { input, observedAt };
    }

    const cache = readJson<CacheFile>(CACHE_PATH);
    const observedAt = safeIso(cache.timestamp) || new Date().toISOString();
    const selectedSources = SOURCE_ARG ? [SOURCE_ARG] : SOURCES;
    const sources = Object.fromEntries(selectedSources.map(source => [source, { status: 'success' as const }]));
    const observations = (cache.flights || [])
        .filter(flight => selectedSources.includes(flight.source))
        .map(flight => ({ flight, visible: true }));
    return { input: { observedAt, sources, observations }, observedAt };
}

function uniqueSnapshots(input: ObservationFile): { snapshots: LifecycleSnapshot[]; collisions: number } {
    const byOffer = new Map<string, LifecycleSnapshot>();
    let collisions = 0;
    for (const observation of input.observations || []) {
        if (!observation?.flight || !Number.isFinite(Number(observation.flight.price)) || Number(observation.flight.price) <= 0) continue;
        const snapshot = toLifecycleSnapshot(observation.flight, observation.visible !== false);
        const current = byOffer.get(snapshot.offerKey);
        if (current) {
            collisions++;
            // 같은 식별자로 합쳐진 후보가 여러 개면 실제 노출 판단에 가까운 낮은 가격을 보존한다.
            if (snapshot.effectivePrice >= current.effectivePrice) continue;
        }
        byOffer.set(snapshot.offerKey, snapshot);
    }
    return { snapshots: [...byOffer.values()], collisions };
}

function runKey(observedAt: string, source: Source): string {
    return `${observedAt}|${source}`;
}

function baseEvent(
    snapshot: LifecycleSnapshot | CurrentOfferRow,
    eventType: OfferEventRow['event_type'],
    observedAt: string,
    key: string,
): OfferEventRow {
    const isSnapshot = 'offerKey' in snapshot;
    return {
        offer_key: isSnapshot ? snapshot.offerKey : snapshot.offer_key,
        itinerary_key: isSnapshot ? snapshot.itineraryKey : snapshot.itinerary_key,
        source: snapshot.source,
        event_type: eventType,
        observed_at: observedAt,
        run_key: key,
        previous_price: null,
        current_price: null,
        previous_seats: null,
        current_seats: null,
        previous_visible: null,
        current_visible: null,
        previous_comparison_price: null,
        current_comparison_price: null,
        details: {},
    };
}

function currentRow(
    snapshot: LifecycleSnapshot,
    previous: CurrentOfferRow | undefined,
    observedAt: string,
    key: string,
    changed: boolean,
): CurrentOfferRow {
    return {
        offer_key: snapshot.offerKey,
        itinerary_key: snapshot.itineraryKey,
        identity_version: snapshot.identityVersion,
        source: snapshot.source,
        source_product_ref: snapshot.sourceProductRef,
        source_flight_id: snapshot.sourceFlightId,
        departure_city: snapshot.departureCity,
        departure_airport: snapshot.departureAirport,
        arrival_city: snapshot.arrivalCity,
        arrival_airport: snapshot.arrivalAirport,
        departure_date: snapshot.departureDate,
        return_date: snapshot.returnDate,
        outbound_time: snapshot.outboundTime,
        outbound_arrival_time: snapshot.outboundArrivalTime,
        return_time: snapshot.returnTime,
        return_arrival_time: snapshot.returnArrivalTime,
        airline: snapshot.airline,
        flight_number: snapshot.flightNumber,
        return_flight_number: snapshot.returnFlightNumber,
        listed_price: snapshot.listedPrice,
        effective_price: snapshot.effectivePrice,
        available_seats: snapshot.availableSeats,
        seat_count_kind: snapshot.seatCountKind,
        region: snapshot.region,
        booking_url: snapshot.bookingUrl,
        is_visible: snapshot.isVisible,
        status: 'active',
        missing_streak: 0,
        missing_since: null,
        first_seen_at: previous?.first_seen_at || observedAt,
        last_seen_at: observedAt,
        last_changed_at: changed ? observedAt : previous?.last_changed_at || observedAt,
        last_run_key: key,
        price_checked_at: snapshot.priceCheckedAt || observedAt,
        // 네이버 비교는 전체 항공권을 매번 확인하지 않는 희소 데이터다. 이번
        // 관측에 값이 없다고 과거에 확인한 비교가를 지우지 않는다.
        comparison_price: snapshot.comparisonPrice ?? previous?.comparison_price ?? null,
        comparison_checked_at: snapshot.comparisonCheckedAt ?? previous?.comparison_checked_at ?? null,
        updated_at: observedAt,
    };
}

function scheduleChanged(previous: CurrentOfferRow, snapshot: LifecycleSnapshot): boolean {
    return previous.outbound_time !== snapshot.outboundTime
        || previous.outbound_arrival_time !== snapshot.outboundArrivalTime
        || previous.return_time !== snapshot.returnTime
        || previous.return_arrival_time !== snapshot.returnArrivalTime
        || previous.flight_number !== snapshot.flightNumber
        || previous.return_flight_number !== snapshot.returnFlightNumber;
}

function kstDateKey(value: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(value);
}

function processState(
    snapshots: LifecycleSnapshot[],
    existingRows: CurrentOfferRow[],
    processedSources: Source[],
    missingSafeSources: Source[],
    observedAt: string,
): { current: CurrentOfferRow[]; events: OfferEventRow[] } {
    const existing = new Map(existingRows.map(row => [row.offer_key, row]));
    const observed = new Set<string>();
    const current: CurrentOfferRow[] = [];
    const events: OfferEventRow[] = [];

    for (const snapshot of snapshots.filter(item => processedSources.includes(item.source))) {
        const previous = existing.get(snapshot.offerKey);
        const key = runKey(observedAt, snapshot.source);
        observed.add(snapshot.offerKey);
        let changed = false;

        if (!previous) {
            const event = baseEvent(snapshot, 'first_seen', observedAt, key);
            event.current_price = snapshot.effectivePrice;
            event.current_seats = snapshot.availableSeats;
            event.current_visible = snapshot.isVisible;
            event.current_comparison_price = snapshot.comparisonPrice;
            event.details = {
                seat_count_kind: snapshot.seatCountKind,
                comparison_checked_at: snapshot.comparisonCheckedAt,
            };
            events.push(event);
            changed = true;
        } else {
            if (previous.missing_streak > 0 || previous.status !== 'active') {
                const event = baseEvent(snapshot, 'reappeared', observedAt, key);
                event.previous_price = previous.effective_price;
                event.current_price = snapshot.effectivePrice;
                event.previous_seats = previous.available_seats;
                event.current_seats = snapshot.availableSeats;
                event.details = {
                    previous_status: previous.status,
                    missing_since: previous.missing_since,
                    missing_streak: previous.missing_streak,
                };
                events.push(event);
                changed = true;
            }

            if (previous.listed_price !== snapshot.listedPrice || previous.effective_price !== snapshot.effectivePrice) {
                const event = baseEvent(snapshot, 'price_changed', observedAt, key);
                event.previous_price = previous.effective_price;
                event.current_price = snapshot.effectivePrice;
                event.details = {
                    previous_listed_price: previous.listed_price,
                    current_listed_price: snapshot.listedPrice,
                };
                events.push(event);
                changed = true;
            }

            if (previous.available_seats !== snapshot.availableSeats || previous.seat_count_kind !== snapshot.seatCountKind) {
                const event = baseEvent(snapshot, 'seats_changed', observedAt, key);
                event.previous_seats = previous.available_seats;
                event.current_seats = snapshot.availableSeats;
                event.details = {
                    previous_kind: previous.seat_count_kind,
                    current_kind: snapshot.seatCountKind,
                };
                events.push(event);
                changed = true;
            }

            if (previous.is_visible !== snapshot.isVisible) {
                const event = baseEvent(snapshot, 'visibility_changed', observedAt, key);
                event.previous_visible = previous.is_visible;
                event.current_visible = snapshot.isVisible;
                events.push(event);
                changed = true;
            }

            if (
                snapshot.comparisonPrice !== null
                && previous.comparison_price !== snapshot.comparisonPrice
            ) {
                const event = baseEvent(snapshot, 'comparison_changed', observedAt, key);
                event.previous_comparison_price = previous.comparison_price;
                event.current_comparison_price = snapshot.comparisonPrice;
                event.details = {
                    comparison_checked_at: snapshot.comparisonCheckedAt,
                    comparison_scope: 'same_airports_and_dates',
                };
                events.push(event);
                changed = true;
            }

            if (scheduleChanged(previous, snapshot)) {
                const event = baseEvent(snapshot, 'schedule_changed', observedAt, key);
                event.details = {
                    previous: {
                        outbound_time: previous.outbound_time,
                        outbound_arrival_time: previous.outbound_arrival_time,
                        return_time: previous.return_time,
                        return_arrival_time: previous.return_arrival_time,
                    },
                    current: {
                        outbound_time: snapshot.outboundTime,
                        outbound_arrival_time: snapshot.outboundArrivalTime,
                        return_time: snapshot.returnTime,
                        return_arrival_time: snapshot.returnArrivalTime,
                    },
                };
                events.push(event);
                changed = true;
            }
        }

        current.push(currentRow(snapshot, previous, observedAt, key, changed));
    }

    const observedTime = new Date(observedAt).getTime();
    const todayKst = kstDateKey(new Date(observedAt));
    for (const previous of existingRows) {
        if (!missingSafeSources.includes(previous.source) || observed.has(previous.offer_key)) continue;
        if (previous.status === 'ended_estimated') continue;

        const key = runKey(observedAt, previous.source);
        const missingStreak = (previous.missing_streak || 0) + 1;
        const missingSince = previous.missing_since || observedAt;
        const missingHours = Math.max(0, (observedTime - new Date(missingSince).getTime()) / 3_600_000);
        const departurePassed = !!previous.departure_date && previous.departure_date < todayKst;
        let status: OfferStatus = missingStreak >= PAUSE_AFTER_MISSES ? 'paused_estimated' : 'missing_once';
        if (departurePassed || missingHours >= END_AFTER_HOURS) status = 'ended_estimated';

        let eventType: OfferEventRow['event_type'] | null = null;
        if (missingStreak === 1) eventType = 'missing';
        if (status === 'paused_estimated' && previous.status !== 'paused_estimated') eventType = 'paused_estimated';
        if (status === 'ended_estimated' && previous.status !== 'ended_estimated') eventType = 'ended_estimated';
        if (eventType) {
            const event = baseEvent(previous, eventType, observedAt, key);
            event.previous_price = previous.effective_price;
            event.previous_seats = previous.available_seats;
            event.previous_visible = previous.is_visible;
            event.details = {
                missing_streak: missingStreak,
                missing_since: missingSince,
                departure_passed: departurePassed,
                reason: 'not_observed_in_successful_source_run',
            };
            events.push(event);
        }

        current.push({
            ...previous,
            status,
            missing_streak: missingStreak,
            missing_since: missingSince,
            last_changed_at: eventType ? observedAt : previous.last_changed_at,
            last_run_key: key,
            updated_at: observedAt,
        });
    }

    return { current, events };
}

function processComparisonState(
    snapshots: LifecycleSnapshot[],
    existingRows: CurrentOfferRow[],
    processedSources: Source[],
    observedAt: string,
): { current: CurrentOfferRow[]; events: OfferEventRow[] } {
    const existing = new Map(existingRows.map(row => [row.offer_key, row]));
    const current: CurrentOfferRow[] = [];
    const events: OfferEventRow[] = [];

    for (const snapshot of snapshots.filter(item => processedSources.includes(item.source))) {
        const previous = existing.get(snapshot.offerKey);
        // 비교가 갱신은 여행사 상품을 새로 발견한 관측이 아니다. 여행사 크롤이
        // 먼저 만든 판매 회차에만 비교 정보와 노출 결과를 덧붙인다.
        if (!previous) continue;

        const key = runKey(observedAt, snapshot.source);
        let changed = false;
        if (
            snapshot.comparisonPrice !== null
            && previous.comparison_price !== snapshot.comparisonPrice
        ) {
            const event = baseEvent(snapshot, 'comparison_changed', observedAt, key);
            event.previous_comparison_price = previous.comparison_price;
            event.current_comparison_price = snapshot.comparisonPrice;
            event.details = {
                comparison_checked_at: snapshot.comparisonCheckedAt,
                comparison_scope: 'same_airports_and_dates',
            };
            events.push(event);
            changed = true;
        }

        if (previous.is_visible !== snapshot.isVisible) {
            const event = baseEvent(snapshot, 'visibility_changed', observedAt, key);
            event.previous_visible = previous.is_visible;
            event.current_visible = snapshot.isVisible;
            event.details = { reason: 'comparison_filter' };
            events.push(event);
            changed = true;
        }

        current.push({
            ...previous,
            comparison_price: snapshot.comparisonPrice ?? previous.comparison_price,
            comparison_checked_at: snapshot.comparisonCheckedAt ?? previous.comparison_checked_at,
            is_visible: snapshot.isVisible,
            last_changed_at: changed ? observedAt : previous.last_changed_at,
            last_run_key: key,
            updated_at: observedAt,
        });
    }

    return { current, events };
}

function supabaseConfig(): { url: string; key: string } {
    const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!url || !key) throw new Error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다.');
    return { url, key };
}

async function fetchCurrentRows(sources: Source[]): Promise<CurrentOfferRow[]> {
    if (sources.length === 0) return [];
    const { url, key } = supabaseConfig();
    const rows: CurrentOfferRow[] = [];
    const sourceFilter = `source=in.(${sources.join(',')})`;

    for (let start = 0; ; start += PAGE_SIZE) {
        const response = await fetch(`${url}/rest/v1/flight_offer_current?select=*&${sourceFilter}`, {
            headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                Range: `${start}-${start + PAGE_SIZE - 1}`,
            },
        });
        if (!response.ok) {
            const detail = (await response.text()).slice(0, 500);
            throw new Error(`flight_offer_current 조회 실패 (${response.status}): ${detail}`);
        }
        const page = await response.json() as CurrentOfferRow[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
    }
    return rows;
}

async function upsertRows(table: string, conflict: string, rows: unknown[], ignoreDuplicates = false): Promise<void> {
    if (rows.length === 0) return;
    const { url, key } = supabaseConfig();
    const shapeGroups = groupRowsByShape(rows);
    if (shapeGroups.length > 1) {
        console.log(`  ${table}: 서로 다른 열 구조 ${shapeGroups.length}개를 분리 저장`);
    }
    for (const shapedRows of shapeGroups) {
        for (let start = 0; start < shapedRows.length; start += BATCH_SIZE) {
            const batch = shapedRows.slice(start, start + BATCH_SIZE);
            const response = await fetch(`${url}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`, {
                method: 'POST',
                headers: {
                    apikey: key,
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/json',
                    Prefer: `${ignoreDuplicates ? 'resolution=ignore-duplicates' : 'resolution=merge-duplicates'},return=minimal`,
                },
                body: JSON.stringify(batch),
            });
            if (!response.ok) {
                const detail = (await response.text()).slice(0, 500);
                throw new Error(`${table} 저장 실패 (${response.status}): ${detail}`);
            }
        }
    }
}

async function main(): Promise<void> {
    const { input, observedAt } = loadInput();
    const { snapshots, collisions } = uniqueSnapshots(input);
    const requestedSources = SOURCE_ARG ? [SOURCE_ARG] : SOURCES;
    const runSources = requestedSources.filter(source => input.sources?.[source]);
    const processedSources = runSources.filter(source => {
        const status = input.sources?.[source]?.status;
        return !input.cachePreserved && (status === 'success' || status === 'warning');
    });
    const missingSafeSources = processedSources.filter(source => input.sources?.[source]?.allowMissing !== false);

    const runRows = runSources.map(source => {
        const sourceSnapshots = snapshots.filter(snapshot => snapshot.source === source);
        const meta = input.sources?.[source];
        return {
            run_key: runKey(observedAt, source),
            observed_at: observedAt,
            source,
            status: input.cachePreserved ? 'preserved' : meta?.status || 'skipped',
            scraped_count: meta?.scraped ?? null,
            observed_count: sourceSnapshots.length,
            visible_count: sourceSnapshots.filter(snapshot => snapshot.isVisible).length,
            alerts: input.alerts || [],
        };
    });

    console.log(`항공권 생애 기록: ${observedAt}`);
    console.log(`  관측 ${snapshots.length}개 / 처리 여행사 ${processedSources.join(', ') || '없음'}`);
    if (collisions > 0) console.log(`  식별자 중복 ${collisions}건은 낮은 가격 한 건으로 합쳤습니다.`);

    if (DRY_RUN) {
        const counts = Object.fromEntries(SOURCES.map(source => [
            source,
            snapshots.filter(snapshot => snapshot.source === source).length,
        ]));
        console.log(`  DRY_RUN: ${JSON.stringify(counts)}`);
        return;
    }

    await upsertRows('flight_crawl_runs', 'run_key', runRows);
    if (processedSources.length === 0) {
        console.log('  정상 관측 여행사가 없어 현재 상태는 변경하지 않았습니다.');
        return;
    }

    const existing = await fetchCurrentRows(processedSources);
    const state = input.mode === 'comparison'
        ? processComparisonState(snapshots, existing, processedSources, observedAt)
        : processState(snapshots, existing, processedSources, missingSafeSources, observedAt);
    // 변화 기록을 먼저 남긴다. 기록 저장이 실패하면 현재 상태도 전진시키지 않아
    // 다음 실행에서 같은 변화를 다시 감지할 수 있다.
    await upsertRows('flight_offer_events', 'offer_key,event_type,run_key', state.events, true);
    await upsertRows('flight_offer_current', 'offer_key', state.current);

    const eventCounts = state.events.reduce<Record<string, number>>((acc, event) => {
        acc[event.event_type] = (acc[event.event_type] || 0) + 1;
        return acc;
    }, {});
    console.log(`  현재 상태 ${state.current.length}건 / 변화 ${state.events.length}건`);
    console.log(`  변화 종류: ${JSON.stringify(eventCounts)}`);
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
