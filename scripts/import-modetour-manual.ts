import fs from 'node:fs';
import path from 'node:path';
import { Flight } from '../src/types/flight';
import { getRegionByCity } from '../src/lib/utils/region-mapper';
import { logCrawlResults } from '../src/lib/utils/crawl-logger';
import {
    MODETOUR_CONTINENT_CODES,
    ModetourManualCapture,
    ModetourContinentCode,
    modetourManualMatchKey,
    validateModetourManualCard,
} from '../src/lib/scrapers/modetour-manual';

interface CacheData {
    timestamp: string;
    fullCrawlUpdatedAt?: string;
    count: number;
    flights: Flight[];
    sources?: Record<string, number>;
    sourceUpdatedAt?: Record<string, string>;
    staleStreak?: Record<string, number>;
    scrapedCounts?: Record<string, number>;
    integrityAlerts?: string[];
    sourceCircuits?: Record<string, unknown>;
    manualCaptureStatus?: Record<string, {
        capturedAt: string;
        lastImportedAt: string;
        accepted: number;
        review: number;
        filtered: number;
        completeRegions?: ModetourContinentCode[];
        emptyRegions?: ModetourContinentCode[];
        excludedRegions?: ModetourContinentCode[];
        naverPending?: boolean;
        naverPendingAt?: string;
        naverLastAttemptAt?: string;
        naverProcessedAt?: string;
        naverDeferred?: number;
    }>;
    [key: string]: unknown;
}

interface InterparkBenchmark {
    prices?: Record<string, Record<string, { lowest?: number; avg?: number }>>;
}

export interface ModetourManualImportReport {
    accepted: number;
    inserted: number;
    updated: number;
    removedByCompleteRegion: number;
    expiredRemoved: number;
    duplicatesRemoved: number;
    completeRegionsApplied: ModetourContinentCode[];
    completeRegionsSkipped: Array<{ region: ModetourContinentCode; review: number }>;
    review: Array<{ region: string; index: number; route: string; reasons: string[] }>;
    filteredByBenchmark: Array<{ route: string; price: number; average: number }>;
    duplicateCards: number;
    applied: boolean;
}

function kstDateKey(value: Date): string {
    return new Date(value.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function sourceCounts(flights: Flight[]): Record<string, number> {
    return flights.reduce<Record<string, number>>((counts, flight) => {
        counts[flight.source] = (counts[flight.source] || 0) + 1;
        return counts;
    }, {});
}

function benchmarkFlight(
    flight: Flight,
    benchmark: InterparkBenchmark,
): { keep: boolean; average?: number; discountRate: number } {
    const cityCode = flight.arrival.airport;
    const yearMonth = flight.departure.date.slice(0, 7);
    const month = benchmark.prices?.[cityCode]?.[yearMonth];
    if (!month || !Number.isFinite(month.avg)) return { keep: true, discountRate: 0 };

    const average = Number(month.avg);
    if (flight.price > average) return { keep: false, average, discountRate: 0 };
    const lowest = Number(month.lowest || 0);
    return {
        keep: true,
        average,
        discountRate: lowest > 0 ? Math.round((1 - flight.price / lowest) * 100) : 0,
    };
}

const REGIONS_BY_CONTINENT: Record<ModetourContinentCode, string[]> = {
    ASIA: ['동남아', '기타'],
    JPN: ['일본'],
    SOPA: ['남태평양'],
    EUR: ['유럽'],
    CHI: ['중국'],
    AMCA: ['미주'],
};

function isExpiredFlight(flight: Flight, todayKst: string): boolean {
    const match = String(flight.departure?.date || '').match(/^(\d{4})[-./](\d{2})[-./](\d{2})/);
    if (!match) return false;
    return `${match[1]}-${match[2]}-${match[3]}` < todayKst;
}

function routeKey(flight: Flight): string {
    return `${flight.source}|${flight.departure?.city || ''}|${flight.arrival?.city || ''}`;
}

export function importModetourManualCapture({
    input,
    cache,
    benchmark,
    now = new Date(),
    apply = false,
}: {
    input: ModetourManualCapture;
    cache: CacheData;
    benchmark: InterparkBenchmark;
    now?: Date;
    apply?: boolean;
}): { cache: CacheData; report: ModetourManualImportReport } {
    const capturedAt = new Date(input.capturedAt);
    if (!Number.isFinite(capturedAt.getTime())) throw new Error('capturedAt이 올바른 ISO 시각이 아닙니다.');
    const captureAgeMs = now.getTime() - capturedAt.getTime();
    if (captureAgeMs < -10 * 60_000) throw new Error('캡처 시각이 현재보다 10분 이상 미래입니다.');
    if (captureAgeMs > 36 * 60 * 60_000) throw new Error('36시간이 지난 캡처는 가격 자료로 반영할 수 없습니다.');
    if (!Array.isArray(input.regions) || input.regions.length === 0) throw new Error('regions가 비어 있습니다.');

    const regionCodes = new Set(input.regions.map(region => region.continentCode));
    const completeRegions = [...new Set(input.completeRegions || [])];
    const excludedRegions = [...new Set(input.excludedRegions || [])];
    completeRegions.forEach(region => {
        if (!MODETOUR_CONTINENT_CODES.includes(region)) throw new Error(`완전 캡처 지역 코드가 올바르지 않습니다: ${region}`);
        if (!regionCodes.has(region)) throw new Error(`완전 캡처 지역 ${region}의 regions 항목이 없습니다.`);
    });
    excludedRegions.forEach(region => {
        if (!MODETOUR_CONTINENT_CODES.includes(region)) throw new Error(`제외 지역 코드가 올바르지 않습니다: ${region}`);
        if (completeRegions.includes(region)) throw new Error(`${region}은 완전 캡처와 제외 지역에 동시에 지정할 수 없습니다.`);
    });

    const review: ModetourManualImportReport['review'] = [];
    const filteredByBenchmark: ModetourManualImportReport['filteredByBenchmark'] = [];
    const validatedByRegion = new Map<string, Flight[]>();
    let duplicateCards = 0;

    input.regions.forEach(region => {
        if (!Array.isArray(region.cards)) throw new Error(`${region.continentCode} cards가 배열이 아닙니다.`);
        region.cards.forEach((card, index) => {
            const validation = validateModetourManualCard(card, region.continentCode, capturedAt);
            const route = `${card.departureCity || '?'}-${card.arrivalCity || '?'} ${card.departureMonthDay || '?'}`;
            if (validation.status === 'review') {
                review.push({ region: region.continentCode, index: index + 1, route, reasons: validation.reasons });
                return;
            }
            const validated = validatedByRegion.get(region.continentCode) || [];
            validated.push(validation.flight);
            validatedByRegion.set(region.continentCode, validated);
        });
    });

    // 정규 크롤과 동일하게 업체·출발지·도착지별 최저가만 남긴 뒤 벤치마크를 적용한다.
    const routeMinPrices = new Map<string, number>();
    for (const flights of validatedByRegion.values()) {
        for (const flight of flights) {
            const key = routeKey(flight);
            const current = routeMinPrices.get(key);
            if (current === undefined || flight.price < current) routeMinPrices.set(key, flight.price);
        }
    }

    const acceptedByKey = new Map<string, Flight>();
    const acceptedRegionByKey = new Map<string, string>();
    input.regions.forEach(region => {
        for (const flight of validatedByRegion.get(region.continentCode) || []) {
            if (flight.price !== routeMinPrices.get(routeKey(flight))) continue;
            const route = `${flight.departure.city}-${flight.arrival.city} ${flight.departure.date.slice(5).replace('-', '/')}`;
            const benchmarkResult = benchmarkFlight(flight, benchmark);
            if (!benchmarkResult.keep) {
                filteredByBenchmark.push({
                    route,
                    price: flight.price,
                    average: benchmarkResult.average || 0,
                });
                continue;
            }
            flight.discountRate = benchmarkResult.discountRate;
            flight.priceCheckedAt = capturedAt.toISOString();
            const key = modetourManualMatchKey(flight);
            const duplicate = acceptedByKey.get(key);
            if (duplicate) {
                duplicateCards += 1;
                if (flight.price < duplicate.price) acceptedByKey.set(key, flight);
            } else {
                acceptedByKey.set(key, flight);
                acceptedRegionByKey.set(key, region.continentCode);
            }
        }
    });

    const existingByKey = new Map<string, Flight>();
    cache.flights.forEach(flight => {
        if (flight.source === 'modetour' && !existingByKey.has(modetourManualMatchKey(flight))) {
            existingByKey.set(modetourManualMatchKey(flight), flight);
        }
    });

    let inserted = 0;
    let updated = 0;
    const incomingFlights: Flight[] = [];
    for (const [key, incoming] of acceptedByKey) {
        const previous = existingByKey.get(key);
        if (!previous) {
            incomingFlights.push({ ...incoming, firstSeen: kstDateKey(capturedAt) });
            inserted += 1;
            continue;
        }
        incomingFlights.push({
            ...previous,
            ...incoming,
            id: previous.id,
            firstSeen: previous.firstSeen || kstDateKey(capturedAt),
            naverLowest: previous.naverLowest,
            naverCheckedAt: previous.naverCheckedAt,
            routeAirports: previous.routeAirports,
            modetourDetail: {
                ...previous.modetourDetail,
                ...incoming.modetourDetail,
            },
        });
        updated += 1;
    }

    const reviewCounts = new Map<ModetourContinentCode, number>();
    review.forEach(item => {
        const code = item.region as ModetourContinentCode;
        reviewCounts.set(code, (reviewCounts.get(code) || 0) + 1);
    });
    const completeRegionsApplied = completeRegions.filter(region => !reviewCounts.get(region));
    const completeRegionsSkipped = completeRegions
        .filter(region => Boolean(reviewCounts.get(region)))
        .map(region => ({ region, review: reviewCounts.get(region) || 0 }));
    const acceptedRegionCounts = new Map<ModetourContinentCode, number>();
    for (const region of acceptedRegionByKey.values()) {
        const code = region as ModetourContinentCode;
        acceptedRegionCounts.set(code, (acceptedRegionCounts.get(code) || 0) + 1);
    }
    const emptyRegions = completeRegionsApplied.filter(region => (acceptedRegionCounts.get(region) || 0) === 0);
    const replacingSiteRegions = new Set(completeRegionsApplied.flatMap(region => REGIONS_BY_CONTINENT[region]));
    const todayKst = kstDateKey(now);
    let removedByCompleteRegion = 0;
    let expiredRemoved = 0;
    let duplicatesRemoved = 0;
    const retainedFlights: Flight[] = [];
    const retainedModetourKeys = new Set<string>();

    for (const flight of cache.flights) {
        if (flight.source !== 'modetour') {
            retainedFlights.push({ ...flight });
            continue;
        }
        const flightRegion = flight.region || getRegionByCity(flight.arrival?.city || '');
        if (replacingSiteRegions.has(flightRegion)) {
            removedByCompleteRegion += 1;
            continue;
        }
        if (isExpiredFlight(flight, todayKst)) {
            expiredRemoved += 1;
            continue;
        }
        const key = modetourManualMatchKey(flight);
        if (retainedModetourKeys.has(key)) {
            duplicatesRemoved += 1;
            continue;
        }
        retainedModetourKeys.add(key);
        retainedFlights.push({ ...flight });
    }

    for (const [index, incoming] of incomingFlights.entries()) {
        const key = modetourManualMatchKey(incoming);
        const incomingRegion = acceptedRegionByKey.get(key) as ModetourContinentCode | undefined;
        // 완전 캡처 지역은 전체 교체분을 넣고, 그 외 지역은 기존 키가 없을 때만 추가한다.
        if (!incomingRegion || !completeRegionsApplied.includes(incomingRegion)) {
            const existingIndex = retainedFlights.findIndex(flight => (
                flight.source === 'modetour' && modetourManualMatchKey(flight) === key
            ));
            if (existingIndex >= 0) {
                retainedFlights[existingIndex] = incoming;
                continue;
            }
        }
        retainedFlights.push(incomingFlights[index]);
    }

    const flights = retainedFlights;
    // 결과가 0건인 완전 캡처도 기존 지역을 비우고 검수 사실을 기록하는 유효한 반영이다.
    const hasMutation = completeRegionsApplied.length > 0
        || acceptedByKey.size > 0
        || removedByCompleteRegion > 0
        || expiredRemoved > 0
        || duplicatesRemoved > 0;

    const importedAt = now.toISOString();
    const previousManualStatus = cache.manualCaptureStatus?.modetour;
    const nextCache: CacheData = !hasMutation
        ? cache
        : {
            ...cache,
            timestamp: importedAt,
            count: flights.length,
            flights,
            sources: sourceCounts(flights),
            // 수동 캡처는 부분 자료이므로 전체 소스의 성공 시각·원본 기준선·실패 횟수는 건드리지 않는다.
            sourceUpdatedAt: cache.sourceUpdatedAt,
            staleStreak: cache.staleStreak,
            scrapedCounts: cache.scrapedCounts,
            sourceCircuits: cache.sourceCircuits,
            manualCaptureStatus: {
                ...(cache.manualCaptureStatus || {}),
                modetour: {
                    capturedAt: capturedAt.toISOString(),
                    lastImportedAt: importedAt,
                    accepted: acceptedByKey.size,
                    review: review.length,
                    filtered: filteredByBenchmark.length,
                    completeRegions: completeRegionsApplied,
                    emptyRegions,
                    excludedRegions,
                    naverPending: acceptedByKey.size > 0 ? true : previousManualStatus?.naverPending,
                    naverPendingAt: acceptedByKey.size > 0 ? importedAt : previousManualStatus?.naverPendingAt,
                    naverLastAttemptAt: previousManualStatus?.naverLastAttemptAt,
                    naverProcessedAt: previousManualStatus?.naverProcessedAt,
                    naverDeferred: previousManualStatus?.naverDeferred,
                },
            },
            integrityAlerts: [
                ...(cache.integrityAlerts || []).filter(alert => !alert.includes('모두투어 수동 캡처')),
                `📷 모두투어 수동 캡처 ${acceptedByKey.size}건 반영`
                + (completeRegionsApplied.length > 0 ? ` · 완전 캡처 ${completeRegionsApplied.join('/')} 교체` : '')
                + (emptyRegions.length > 0 ? ` · 빈 결과 ${emptyRegions.join('/')}` : '')
                + (excludedRegions.length > 0 ? ` · 검수 제외 ${excludedRegions.join('/')}` : '')
                + (removedByCompleteRegion > 0 ? ` · 기존 ${removedByCompleteRegion}건 정리` : '')
                + (review.length > 0 ? ` · 확인 필요 ${review.length}건` : ''),
            ],
        };

    return {
        cache: nextCache,
        report: {
            accepted: acceptedByKey.size,
            inserted,
            updated,
            removedByCompleteRegion,
            expiredRemoved,
            duplicatesRemoved,
            completeRegionsApplied,
            completeRegionsSkipped,
            review,
            filteredByBenchmark,
            duplicateCards,
            applied: apply && hasMutation,
        },
    };
}

function argValue(name: string): string | null {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] || null : null;
}

function main(): void {
    const inputPath = argValue('--input');
    if (!inputPath) throw new Error('사용법: tsx scripts/import-modetour-manual.ts --input <capture.json> [--apply]');
    const defaultCachePath = path.join(process.cwd(), 'data', 'all-flights-cache.json');
    const cachePath = argValue('--cache') || defaultCachePath;
    const benchmarkPath = argValue('--benchmark') || path.join(process.cwd(), 'data', 'interpark-prices.json');
    const apply = process.argv.includes('--apply');

    const input = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as ModetourManualCapture;
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as CacheData;
    const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8')) as InterparkBenchmark;
    const result = importModetourManualCapture({ input, cache, benchmark, apply });

    if (apply && result.report.applied) {
        fs.writeFileSync(cachePath, `${JSON.stringify(result.cache, null, 2)}\n`, 'utf8');
        if (path.resolve(cachePath) === path.resolve(defaultCachePath)) {
            const modetourFlights = result.cache.flights.filter(flight => flight.source === 'modetour');
            const byCity = modetourFlights.reduce<Record<string, number>>((counts, flight) => {
                const city = flight.arrival?.city || '기타';
                counts[city] = (counts[city] || 0) + 1;
                return counts;
            }, {});
            logCrawlResults('modetour', modetourFlights.length, undefined, byCity, {
                scraped: result.report.accepted,
                manual: true,
                separateSession: true,
            });
        }
    }
    console.log(JSON.stringify(result.report, null, 2));
    if (!apply) console.log('검토만 완료했습니다. 실제 반영에는 --apply가 필요합니다.');
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/scripts/import-modetour-manual.ts')) {
    main();
}
