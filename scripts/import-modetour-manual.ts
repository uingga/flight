import fs from 'node:fs';
import path from 'node:path';
import { Flight } from '../src/types/flight';
import {
    ModetourManualCapture,
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

    const review: ModetourManualImportReport['review'] = [];
    const filteredByBenchmark: ModetourManualImportReport['filteredByBenchmark'] = [];
    const acceptedByKey = new Map<string, Flight>();
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
            const benchmarkResult = benchmarkFlight(validation.flight, benchmark);
            if (!benchmarkResult.keep) {
                filteredByBenchmark.push({
                    route,
                    price: validation.flight.price,
                    average: benchmarkResult.average || 0,
                });
                return;
            }
            validation.flight.discountRate = benchmarkResult.discountRate;
            validation.flight.priceCheckedAt = capturedAt.toISOString();
            const key = modetourManualMatchKey(validation.flight);
            const duplicate = acceptedByKey.get(key);
            if (duplicate) {
                duplicateCards += 1;
                if (validation.flight.price < duplicate.price) acceptedByKey.set(key, validation.flight);
            } else {
                acceptedByKey.set(key, validation.flight);
            }
        });
    });

    const flights = cache.flights.map(flight => ({ ...flight }));
    const existingByKey = new Map<string, number>();
    flights.forEach((flight, index) => {
        if (flight.source === 'modetour' && !existingByKey.has(modetourManualMatchKey(flight))) {
            existingByKey.set(modetourManualMatchKey(flight), index);
        }
    });

    let inserted = 0;
    let updated = 0;
    for (const [key, incoming] of acceptedByKey) {
        const existingIndex = existingByKey.get(key);
        if (existingIndex === undefined) {
            flights.push({ ...incoming, firstSeen: kstDateKey(capturedAt) });
            inserted += 1;
            continue;
        }
        const previous = flights[existingIndex];
        flights[existingIndex] = {
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
        };
        updated += 1;
    }

    const importedAt = now.toISOString();
    const nextCache: CacheData = acceptedByKey.size === 0
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
                },
            },
            integrityAlerts: [
                ...(cache.integrityAlerts || []).filter(alert => !alert.includes('모두투어 수동 캡처')),
                `📷 모두투어 수동 캡처 ${acceptedByKey.size}건 반영 · 기존 데이터 삭제 없음`
                + (review.length > 0 ? ` · 확인 필요 ${review.length}건` : ''),
            ],
        };

    return {
        cache: nextCache,
        report: {
            accepted: acceptedByKey.size,
            inserted,
            updated,
            review,
            filteredByBenchmark,
            duplicateCards,
            applied: apply && acceptedByKey.size > 0,
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
    const cachePath = argValue('--cache') || path.join(process.cwd(), 'data', 'all-flights-cache.json');
    const benchmarkPath = argValue('--benchmark') || path.join(process.cwd(), 'data', 'interpark-prices.json');
    const apply = process.argv.includes('--apply');

    const input = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as ModetourManualCapture;
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as CacheData;
    const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8')) as InterparkBenchmark;
    const result = importModetourManualCapture({ input, cache, benchmark, apply });

    if (apply && result.report.accepted > 0) {
        fs.writeFileSync(cachePath, `${JSON.stringify(result.cache, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(result.report, null, 2));
    if (!apply) console.log('검토만 완료했습니다. 실제 반영에는 --apply가 필요합니다.');
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/scripts/import-modetour-manual.ts')) {
    main();
}
