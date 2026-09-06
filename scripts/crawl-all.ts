
import { scrapeYbtour } from '../src/lib/scrapers/ybtour';
import { scrapeHanatour } from '../src/lib/scrapers/hanatour';
import { scrapeModetour } from '../src/lib/scrapers/modetour';
import { scrapeOnlineTour } from '../src/lib/scrapers/onlinetour';
import { scrapeTtang } from '../src/lib/scrapers/ttang';
import { scrapeMyrealtrip } from '../src/lib/scrapers/myrealtrip';
import {
    scrapeInterparkBenchmark,
    resolveCityCode,
    resolveInterparkOriginCityCode,
    type InterparkRouteTarget,
} from '../src/lib/scrapers/interpark';
import {
    clearUnsupportedInterparkDiscount,
    evaluateInterparkBenchmark,
} from '../src/lib/interpark-benchmark';
import { logCrawlResults, recordCrawlAlerts } from '../src/lib/utils/crawl-logger';
import { getEffectivePrice } from '../src/lib/price-quality';
import {
    enrichVisibleTtangFlights,
    TTANG_TIME_ADAPTER_VERSION,
    type TtangTimeEnrichmentState,
} from '../src/lib/ttang-time-enrichment';
import {
    enrichVisibleYbtourFlights,
    type YbtourTimeEnrichmentState,
} from '../src/lib/ybtour-time-enrichment';
import { TtangDetailCheckpoint } from '../src/lib/ttang-detail-checkpoint';
import { getCrawlDataDir } from '../src/lib/crawl-data-dir';
import { shutdownTtangExternalBrowserSessions } from '../src/lib/ttang-browser-session';
import {
    classifySourceAccessRestriction,
    classifySourceResponseDrop,
    isLocalSourceFallbackCoolingDown,
    isSourceCircuitOpen,
    openSourceCircuit,
    pruneResolvedSourceCircuits,
    recordLocalSourceFallback,
    SOURCE_ADAPTER_VERSIONS,
    sourceCircuitLabel,
    type SourceCircuitState,
} from '../src/lib/source-circuit';
import { buildLifecycleIdentity } from './lib/flight-lifecycle';
import { preserveCrawlCacheWithSafetyState } from '../src/lib/crawl-cache-safety';
import fs from 'fs';
import path from 'path';

interface CacheData {
    timestamp: string;
    /** 일반 여행사 5곳을 모두 시도한 마지막 전체 크롤 완료 시각 */
    fullCrawlUpdatedAt?: string;
    count: number;
    flights: any[];
    sourceUpdatedAt?: Record<string, string>;
    /** 소스별 연속 실패 횟수 — 어드민이 "며칠째 고장"인지 보여주는 근거 */
    staleStreak?: Record<string, number>;
    /** 운영자가 확인한 수동 캡처 반영 상태. 자동 회차가 성공할 때까지 유지한다. */
    manualCaptureStatus?: Record<string, unknown>;
    /**
     * 여행사별 '이번에 긁어온 원본 개수'.
     *
     * 급감 판정은 반드시 원본끼리 비교해야 한다. flights는 최저가·만료·인터파크 필터를
     * 모두 통과한 뒤의 목록이라, 그 개수를 원본과 맞비교하면 기준이 어긋난다.
     * (땡처리는 원본 2,078건이 필터 후 229건이라, 발동선이 원본 137건이 되어
     *  88% 붕괴도 통과했다.)
     */
    scrapedCounts?: Record<string, number>;
    /** 이번 크롤에서 데이터를 폐기·유지한 이유 (어드민 상단 배너용) */
    integrityAlerts?: string[];
    /** 명시적 차단·요청 제한·soft block 의심 뒤 같은 여행사를 계속 두드리지 않기 위한 휴식 상태 */
    sourceCircuits?: Record<string, SourceCircuitState>;
    /** 땡처리 실시간 시간 조회의 성공값·실패 유형·다음 재시도 시각 */
    ttangTimeEnrichment?: TtangTimeEnrichmentState;
    /** 노랑풍선 상세 시간 조회의 성공값·실패 유형·다음 재시도 시각 */
    ybtourTimeEnrichment?: YbtourTimeEnrichmentState;
    sources: {

        ybtour: number;
        hanatour: number;
        modetour: number;
        onlinetour: number;
        ttang: number;
        myrealtrip: number;
    };
}

const sourceNames = ['ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang', 'myrealtrip'] as const;
type SourceKey = typeof sourceNames[number];
type CrawlableSourceKey = Exclude<SourceKey, 'myrealtrip'>;

const parsedSourceStartJitter = Number.parseInt(process.env.SOURCE_START_JITTER_MAX_MS || '', 10);
const sourceStartJitterMaxMs = Number.isFinite(parsedSourceStartJitter)
    ? Math.max(0, parsedSourceStartJitter)
    : process.env.CI
        ? 90_000
        : 0;

function nextTtangCrawlAt(expectedAt: string | undefined): string | undefined {
    const expectedTimestamp = new Date(expectedAt || '').getTime();
    if (!Number.isFinite(expectedTimestamp)) return undefined;
    const dayStart = Math.floor(expectedTimestamp / 86_400_000) * 86_400_000;
    const candidates: number[] = [];
    for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
        const day = dayStart + dayOffset * 86_400_000;
        candidates.push(day + (5 * 60 + 23) * 60_000); // 14:23 KST
        candidates.push(day + (23 * 60 + 17) * 60_000); // 다음 KST 날짜 08:17
    }
    const next = candidates.filter(timestamp => timestamp > expectedTimestamp).sort((a, b) => a - b)[0];
    return next === undefined ? undefined : new Date(next).toISOString();
}

function sourceCircuitPauseText(circuit: SourceCircuitState, localFallback = false): string {
    const nextProbe = new Date(
        localFallback
            ? circuit.localFallback?.nextProbeAt || circuit.nextProbeAt
            : circuit.nextProbeAt,
    );
    if (!Number.isFinite(nextProbe.getTime())) return '수집 방식 수정 전까지 휴식';
    return `${nextProbe.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} 이후 단일 재탐색`;
}

function recordPcFallback(
    _source: CrawlableSourceKey,
    circuit: SourceCircuitState,
    status: 'success' | 'blocked' | 'failed',
    detail: string,
): SourceCircuitState {
    return recordLocalSourceFallback(circuit, status, detail, new Date(), {
        method: 'source-default',
    });
}

/** 항공권 배열을 여행사별 개수로 집계한다. 캐시와 크롤 로그가 같은 기준을 쓰게 하는 용도. */
function countBySource(flights: any[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const f of flights) {
        if (!f?.source) continue;
        counts[f.source] = (counts[f.source] || 0) + 1;
    }
    return counts;
}

async function main() {
    const localSourceFallback = process.env.LOCAL_SOURCE_FALLBACK === '1';
    const localBrowserPilot = process.env.LOCAL_BROWSER_PILOT === '1';
    const sourceArg = process.argv.find(arg => arg.startsWith('--sources='));
    const skipSourceArg = process.argv.find(arg => arg.startsWith('--skip-sources='));
    const requestedSources = sourceArg
        ? new Set(sourceArg.slice('--sources='.length).split(',').map(value => value.trim()).filter(Boolean))
        : null;
    const scheduledSkippedSources = skipSourceArg
        ? new Set(skipSourceArg.slice('--skip-sources='.length).split(',').map(value => value.trim()).filter(Boolean))
        : new Set<string>();
    const crawlableSources = new Set<CrawlableSourceKey>(['ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang']);

    const invalidSkippedSources = [...scheduledSkippedSources].filter(source => !crawlableSources.has(source as CrawlableSourceKey));
    if (invalidSkippedSources.length > 0) {
        throw new Error(`--skip-sources에 잘못된 값이 있습니다: ${invalidSkippedSources.join(', ')}`);
    }
    if (requestedSources && scheduledSkippedSources.size > 0) {
        throw new Error('--sources와 --skip-sources는 함께 사용할 수 없습니다.');
    }
    if (requestedSources) {
        const invalidSources = [...requestedSources].filter(source => !crawlableSources.has(source as CrawlableSourceKey));
        if (requestedSources.size === 0 || invalidSources.length > 0) {
            throw new Error(`--sources에는 다음 값만 쉼표로 지정할 수 있습니다: ${[...crawlableSources].join(', ')}${invalidSources.length > 0 ? ` (잘못된 값: ${invalidSources.join(', ')})` : ''}`);
        }
        console.log(`🎯 선택 사이트 크롤링 시작: ${[...requestedSources].join(', ')}\n`);
    } else {
        if (localSourceFallback) {
            throw new Error('LOCAL_SOURCE_FALLBACK=1은 --sources와 함께 사용해야 합니다.');
        }
        console.log('🚀 전체 사이트 크롤링 시작...\n');
        if (scheduledSkippedSources.size > 0) {
            console.log(`⏭️ 예약 정책상 미실행: ${[...scheduledSkippedSources].join(', ')} (기존 운영 데이터 보존)\n`);
        }
    }

    const allFlights: any[] = [];
    const sources = {

        ybtour: 0,
        hanatour: 0,
        modetour: 0,
        onlinetour: 0,
        ttang: 0,
        myrealtrip: 0,
    };

    // 이전 캐시 로드 (시간 데이터 이어받기 위해)
    const dataDir = getCrawlDataDir();
    if (
        localBrowserPilot
        && path.resolve(dataDir) === path.resolve(process.cwd(), 'data')
    ) {
        throw new Error('LOCAL_BROWSER_PILOT은 운영 data/에서 실행할 수 없습니다. TIKITIKIT_DATA_DIR staging 경로가 필요합니다.');
    }
    const ttangDetailCheckpoint = process.env.TTANG_DETAIL_CHECKPOINT === '1'
        ? new TtangDetailCheckpoint(
            process.cwd(), dataDir, process.env.TTANG_STAGING_RUN_ID || '',
            new Date(process.env.TTANG_STAGING_STARTED_AT || ''), TTANG_TIME_ADAPTER_VERSION,
        )
        : undefined;
    const ttangAllDetails = process.argv.includes('--ttang-all-details');
    if (ttangAllDetails && (!localBrowserPilot || localSourceFallback || !ttangDetailCheckpoint
        || requestedSources?.size !== 1 || !requestedSources.has('ttang'))) {
        throw new Error('--ttang-all-details는 체크포인트가 있는 ttang 단독 staging 파일럿 전용입니다.');
    }
    const cachePath = path.join(dataDir, 'all-flights-cache.json');
    let prevCache: CacheData | null = null;
    try {
        if (fs.existsSync(cachePath)) {
            prevCache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        }
    } catch { }
    const prevFlights = prevCache?.flights || [];
    const sourceUpdatedAt: Record<string, string> = { ...(prevCache?.sourceUpdatedAt || {}) };
    const sourceCircuits = pruneResolvedSourceCircuits<CrawlableSourceKey>(
        prevCache?.sourceCircuits as Partial<Record<CrawlableSourceKey, SourceCircuitState>> | undefined,
        SOURCE_ADAPTER_VERSIONS,
    );
    let ttangTimeEnrichment = prevCache?.ttangTimeEnrichment;
    let ybtourTimeEnrichment = prevCache?.ybtourTimeEnrichment;
    // 부분 복구에서 실행하지 않은 여행사는 이전 최종본을 그대로 붙인다.
    // 이미 필터를 통과한 데이터를 다시 가격 필터에 넣으면, 실제로 다시 긁지 않았는데도
    // 항공권이 빠질 수 있어 "선택한 여행사만 복구"라는 보장이 깨진다.
    const untouchedFlights: any[] = [];

    try {
        // 전체 또는 선택한 사이트 병렬 크롤링
        const plannedSourceCount = requestedSources
            ? requestedSources.size
            : 5 - scheduledSkippedSources.size;
        console.log(`🔄 ${plannedSourceCount}개 사이트 병렬 크롤링 시작...\n`);

        const scraperTasks = [
            { name: '노랑풍선', key: 'ybtour' as const, fn: () => scrapeYbtour(prevFlights) },
            { name: '하나투어', key: 'hanatour' as const, fn: () => scrapeHanatour(prevFlights) },
            {
                name: '모두투어',
                key: 'modetour' as const,
                fn: () => scrapeModetour(prevFlights),
            },
            { name: '온라인투어', key: 'onlinetour' as const, fn: () => scrapeOnlineTour(prevFlights) },
            { name: '땡처리닷컴', key: 'ttang' as const, fn: () => scrapeTtang(prevFlights) },
            // 마이리얼트립은 별도 Playwright 워크플로우(myrealtrip-scrape.yml)에서 처리
            // Bulk API는 시간/가격 정보가 부정확하므로 여기서 실행하지 않음
        ];

        const requestedTasks = requestedSources
            ? scraperTasks.filter(task => requestedSources.has(task.key))
            : scraperTasks.filter(task => !scheduledSkippedSources.has(task.key));
        const circuitSkipped = new Map<CrawlableSourceKey, SourceCircuitState>();
        const activeTasks = requestedTasks.filter(task => {
            const circuit = sourceCircuits[task.key];
            const circuitOpen = isSourceCircuitOpen(circuit, SOURCE_ADAPTER_VERSIONS[task.key]);
            // 격리된 staging 복사본에서만 쓰는 수동 검증 모드다. 운영 캐시에는 이 플래그를
            // 사용하지 않으며 땡처리 외 다른 여행사의 회로도 우회하지 않는다.
            if (localBrowserPilot && task.key === 'ttang') {
                console.log('🧪 땡처리닷컴: 로컬 브라우저 staging 검증 실행');
                return true;
            }
            if (localSourceFallback) {
                if (task.key === 'modetour') {
                    console.warn('📷 모두투어: PC 자동 접속을 사용하지 않습니다. 일반 Chrome 수동 캡처가 필요합니다.');
                    return false;
                }
                if (!circuitOpen) {
                    console.log(`⏭️ ${task.name}: GitHub 차단 회로가 열려 있지 않아 PC 대체 수집 생략`);
                    return false;
                }
                if (isLocalSourceFallbackCoolingDown(circuit)) {
                    console.warn(`⏸️ ${task.name}: PC에서도 차단 신호가 확인돼 대체 수집 휴식 중`);
                    return false;
                }
                console.log(`🏠 ${task.name}: GitHub 휴식 기간 동안 PC 대체 수집 실행`);
                return true;
            }
            if (!circuitOpen) return true;
            circuitSkipped.set(task.key, circuit!);
            console.warn(
                `⏸️ ${task.name}: ${sourceCircuitLabel(circuit!)} 신호 뒤 휴식 중 `
                + `(${sourceCircuitPauseText(circuit!)})`,
            );
            return false;
        });
        const results = await Promise.allSettled(activeTasks.map(async task => {
            if (sourceStartJitterMaxMs > 0) {
                const delayMs = Math.floor(Math.random() * (sourceStartJitterMaxMs + 1));
                console.log(`⏳ ${task.name}: 시작 시각 ${Math.ceil(delayMs / 1000)}초 분산`);
                if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
            }
            return task.fn();
        }));

        // 채택 여부는 아래 무결성 검사에서 정하므로, 여기서는 결과만 모아 둔다
        const scraped: Partial<Record<SourceKey, any[]>> = {};
        const scrapeFailures: Partial<Record<SourceKey, string>> = {};
        const attempted = new Set<SourceKey>(
            (localSourceFallback ? activeTasks : requestedTasks).map(t => t.key),
        );
        results.forEach((result, i) => {
            const task = activeTasks[i];
            if (result.status === 'fulfilled') {
                scraped[task.key] = result.value;
                if (localSourceFallback && sourceCircuits[task.key]) {
                    sourceCircuits[task.key] = recordPcFallback(
                        task.key,
                        sourceCircuits[task.key]!,
                        'success',
                        `PC 대체 수집 ${result.value.length}건 완료`,
                    );
                } else {
                    delete sourceCircuits[task.key];
                }
                console.log(`✅ ${task.name}: ${result.value.length}개`);
            } else {
                const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
                scrapeFailures[task.key] = reason;
                const restriction = classifySourceAccessRestriction(result.reason);
                if (restriction) {
                    sourceCircuits[task.key] = localSourceFallback && sourceCircuits[task.key]
                        ? recordPcFallback(
                            task.key,
                            sourceCircuits[task.key]!,
                            'blocked',
                            restriction.detail,
                        )
                        : openSourceCircuit(
                            restriction,
                            SOURCE_ADAPTER_VERSIONS[task.key],
                        );
                    console.warn(
                        `⛔ ${task.name}: ${sourceCircuitLabel(sourceCircuits[task.key]!)} 신호 감지 — `
                        + `자동 요청 중단 (${sourceCircuitPauseText(sourceCircuits[task.key]!, localSourceFallback)})`,
                    );
                } else if (localSourceFallback && sourceCircuits[task.key]) {
                    sourceCircuits[task.key] = recordPcFallback(
                        task.key,
                        sourceCircuits[task.key]!,
                        'failed',
                        reason,
                    );
                }
                console.error(`❌ ${task.name} 실패:`, reason);
            }
        });

        // 목록 수집은 정상이어도 상세 시간 응답만 대량으로 읽지 못할 수 있다.
        // 항공권은 그대로 살리고, 운영자가 페이지 구조 변경을 알아차릴 수 있게 별도 경고로 남긴다.
        const collectionWarnings: string[] = [];
        // 소스별 무결성 검사 — 0건뿐 아니라 "급감"도 실패로 본다.
        //
        // 스크래퍼가 지역 탭 하나를 못 열면 그 지역만 통째로 빠진 채 정상 종료한다
        // (노랑풍선 아시아 탭이 실패해 250건→87건이 되는 일이 최근 8일 94회 중 7회).
        // 이때 결과가 0이 아니므로 예전 조건은 이를 잡지 못했고, 반쪽짜리 결과가
        // 멀쩡한 캐시를 덮어 동남아·중국 항공권이 사이트에서 사라졌다.
        //
        // 의심스러운 값은 시간이 지나도 자동으로 받아들이지 않는다. 고장을 시간으로
        // 덮으면 여행사가 사이트를 바꿔 스크래퍼가 죽어도 그대로 굳어버리기 때문이다.
        // 대신 이전 데이터를 지키고, 몇 회 연속 문제인지까지 경고에 담아 사람이 고치게 한다.
        const DROP_RATIO = 0.6;              // 직전의 60% 미만이면 의심
        const MIN_BASELINE = 30;             // 원래 적은 소스는 흔들림이 커서 제외
        const integrityWarnings: string[] = [];
        const staleStreak: Record<string, number> = { ...(prevCache?.staleStreak || {}) };
        const manualCaptureStatus: Record<string, unknown> = { ...(prevCache?.manualCaptureStatus || {}) };
        // 크롤 로그에 '이번에 긁어온 개수'와 '실패해서 물려받은 개수'를 구분해 남기기 위한 기록.
        // 이 둘을 한 칸에 뭉뚱그리면 보존된 숫자가 다음 크롤의 수집량과 맞비교되어
        // 일어나지도 않은 급감이 경보로 찍힌다.
        const preservedSources = new Set<SourceKey>();
        const missingDetectionSafeSources = new Set<SourceKey>();
        const scrapedCounts: Record<string, number> = {};

        for (const src of sourceNames) {
            const fresh = scraped[src];
            const srcPrevFlights = (prevCache?.flights || []).filter((f: any) => f.source === src);
            const prevCount = srcPrevFlights.length;
            const freshCount = fresh?.length ?? 0;
            if (attempted.has(src)) scrapedCounts[src] = freshCount;

            const keepPrevious = (reason: string, alertText?: string, incrementFailure = true) => {
                preservedSources.add(src);
                // 이번 결과를 버렸으므로 원본 기준선도 이전 값을 그대로 물려준다.
                // 실패한 값으로 기준선을 낮추면 다음 회차부터 같은 붕괴를 정상으로 본다.
                const carried = prevCache?.scrapedCounts?.[src];
                if (carried !== undefined) scrapedCounts[src] = carried;
                else delete scrapedCounts[src];
                if (incrementFailure) staleStreak[src] = (staleStreak[src] || 0) + 1;
                const streak = staleStreak[src] || 0;
                const suffix = incrementFailure && streak > 1 ? ` — ${streak}회 연속` : '';
                console.log(`⚠️ ${src} ${reason} → 이전 캐시 ${prevCount}개 유지${suffix}`);
                if (alertText) integrityWarnings.push(`${alertText}${suffix}`);
                allFlights.push(...srcPrevFlights);
                sources[src] = prevCount;
                // sourceUpdatedAt은 갱신하지 않는다 — 어드민에서 "며칠째 안 갱신"이 보여야 한다
            };

            const restingCircuit = circuitSkipped.get(src as CrawlableSourceKey);
            if (restingCircuit) {
                if (prevCount > 0) {
                    keepPrevious(
                        `${sourceCircuitLabel(restingCircuit)} 뒤 휴식 중`,
                        `⛔ ${src} ${sourceCircuitLabel(restingCircuit)} 뒤 자동 요청 중단 `
                        + `(${sourceCircuitPauseText(restingCircuit)}) — 이전 데이터 유지`,
                        false,
                    );
                } else {
                    integrityWarnings.push(
                        `⛔ ${src} ${sourceCircuitLabel(restingCircuit)} 뒤 자동 요청 중단 `
                        + `(${sourceCircuitPauseText(restingCircuit)}, 복구할 이전 데이터 없음)`,
                    );
                }
                continue;
            }

            // 여기서 안 돌린 소스(마이리얼트립)는 별도 워크플로우 담당이라 조용히 이어받는다
            if (!attempted.has(src)) {
                if (prevCount > 0) {
                    if (requestedSources) untouchedFlights.push(...srcPrevFlights);
                    else allFlights.push(...srcPrevFlights);
                    sources[src] = prevCount;
                }
                continue;
            }

            // 스크래퍼가 예외로 끝남 (불완전 수집 포함) — 데이터를 믿을 수 없다
            if (fresh === undefined) {
                if (prevCount > 0) {
                    keepPrevious('수집 실패', `🚨 ${src} 수집 실패로 이전 데이터 유지: ${scrapeFailures[src] || '알 수 없는 오류'}`);
                } else {
                    integrityWarnings.push(`🚨 ${src} 수집 실패 (복구할 이전 데이터 없음): ${scrapeFailures[src] || '알 수 없는 오류'}`);
                }
                continue;
            }

            // 0건은 명백한 실패 — 예전부터 이전 데이터를 지켜 왔다
            if (freshCount === 0 && prevCount > 0) {
                const restriction = classifySourceResponseDrop(freshCount, prevCount, {
                    dropRatio: DROP_RATIO,
                    minBaseline: MIN_BASELINE,
                });
                if (restriction) {
                    const circuitSource = src as CrawlableSourceKey;
                    sourceCircuits[circuitSource] = localSourceFallback && sourceCircuits[circuitSource]
                        ? recordPcFallback(
                            circuitSource,
                            sourceCircuits[circuitSource]!,
                            'blocked',
                            restriction.detail,
                        )
                        : openSourceCircuit(
                            restriction,
                            SOURCE_ADAPTER_VERSIONS[circuitSource],
                        );
                }
                keepPrevious(
                    '0건 응답을 soft block으로 판정',
                    `⛔ ${src} 0건 응답을 soft block으로 판정 — 이전 데이터 유지, `
                    + (src === 'modetour'
                        ? 'PC 자동 접속 없음, 수동 캡처 필요'
                        : '24시간 자동 요청 중단'),
                );
                continue;
            }

            // 급감은 지역 탭 하나가 빠진 반쪽 결과일 가능성이 크다.
            //
            // 비교는 원본 수집량끼리만 한다. 예전에는 이전 캐시(필터 후)와 이번 원본을
            // 맞비교해서, 땡처리 기준 발동선이 원본 137건이 되어 88% 붕괴도 통과했다.
            const prevScraped = prevCache?.scrapedCounts?.[src];
            if (
                freshCount > 0
                && prevScraped !== undefined
                && prevScraped >= MIN_BASELINE
                && freshCount < prevScraped * DROP_RATIO
            ) {
                const restriction = classifySourceResponseDrop(freshCount, prevScraped, {
                    dropRatio: DROP_RATIO,
                    minBaseline: MIN_BASELINE,
                });
                if (restriction) {
                    const circuitSource = src as CrawlableSourceKey;
                    sourceCircuits[circuitSource] = localSourceFallback && sourceCircuits[circuitSource]
                        ? recordPcFallback(
                            circuitSource,
                            sourceCircuits[circuitSource]!,
                            'blocked',
                            restriction.detail,
                        )
                        : openSourceCircuit(
                            restriction,
                            SOURCE_ADAPTER_VERSIONS[circuitSource],
                        );
                }
                keepPrevious(
                    `응답 급감을 soft block으로 판정 (수집 ${prevScraped}건 → ${freshCount}건)`,
                    `⛔ ${src} 응답 급감을 soft block으로 판정 (수집 ${prevScraped}건 → ${freshCount}건) — 이전 데이터 유지, `
                    + (src === 'modetour'
                        ? 'PC 자동 접속 없음, 수동 캡처 필요'
                        : '24시간 자동 요청 중단'),
                );
                continue;
            }

            // 비교할 원본 기준선이 아직 없으면(이 기능을 켠 직후) 이번 값을 기준선으로 삼는다.
            // 이때는 판정을 건너뛰되, 사람이 알 수 있도록 로그를 남긴다.
            if (freshCount > 0 && prevScraped === undefined) {
                console.log(`ℹ️ ${src} 원본 기준선 없음 — 이번 ${freshCount}건을 기준선으로 저장합니다`);
            }

            staleStreak[src] = 0;
            if (src === 'modetour') delete manualCaptureStatus.modetour;
            allFlights.push(...fresh);
            sources[src] = freshCount;
            // 화면 보존 기준(60%)보다 더 보수적으로 사라짐을 판정한다. 직전 원본보다
            // 15% 넘게 줄어든 회차는 관측된 가격·좌석만 기록하고, 안 보인 표를
            // 판매 종료로 세기 시작하지 않는다. 다음 정상 회차에서 다시 판단한다.
            if (
                prevScraped === undefined
                || prevScraped < MIN_BASELINE
                || freshCount >= prevScraped * 0.85
            ) {
                missingDetectionSafeSources.add(src);
            }
            if (freshCount > 0) sourceUpdatedAt[src] = new Date().toISOString();
        }

        if (integrityWarnings.length > 0) {
            console.log(`\n🚨 수집 이상 경고 ${integrityWarnings.length}건 — 스크래퍼 점검 필요`);
            integrityWarnings.forEach(w => console.log(`   ${w}`));
            recordCrawlAlerts(integrityWarnings);
        }
        if (collectionWarnings.length > 0) {
            console.log(`\n⚠️ 시간 정보 수집 경고 ${collectionWarnings.length}건`);
            collectionWarnings.forEach(w => console.log(`   ${w}`));
            recordCrawlAlerts(collectionWarnings);
        }

        // 장기 생애 기록은 사이트에 최종 노출된 최저가만이 아니라, 여행사에서 이번에
        // 정상 확인한 유효 왕복 후보를 기준으로 삼는다. 그래야 벤치마크 기준을 벗어나
        // 화면에서 숨겨진 경우와 여행사에서 실제로 사라진 경우를 나중에 구분할 수 있다.
        const todayKst = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date());
        // 노선별 최저가 필터링 (각 업체별 같은 노선에서 최저가만 유지)
        console.log('\n=== 최저가 필터링 ===');
        console.log(`필터 전: ${allFlights.length}개`);

        const routeMinPrices: Record<string, number> = {};
        allFlights.forEach((f: any) => {
            const key = `${f.source}|${f.departure?.city || ''}|${f.arrival?.city || ''}`;
            if (f.price > 0) {
                if (!routeMinPrices[key] || f.price < routeMinPrices[key]) {
                    routeMinPrices[key] = f.price;
                }
            }
        });

        const filteredFlights = allFlights.filter((f: any) => {
            if (f.price <= 0) return false;
            // 마이리얼트립은 별도 워크플로우에서 자체 필터링하므로 여기서 제외
            if (f.source === 'myrealtrip') return true;
            const key = `${f.source}|${f.departure?.city || ''}|${f.arrival?.city || ''}`;
            return f.price === routeMinPrices[key];
        });

        console.log(`필터 후: ${filteredFlights.length}개 (${allFlights.length - filteredFlights.length}개 제거)`);

        // 만료 항공권 제거 (출발일이 오늘 이전)
        console.log('\n=== 만료 항공권 정리 ===');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const beforeExpiry = filteredFlights.length;
        const activeFlights = filteredFlights.filter((f: any) => {
            if (!f.departure?.date) return true; // 날짜 없으면 유지
            const dateStr = f.departure.date.replace(/[^0-9\-\.]/g, '').replace(/\./g, '-').replace(/-+$/, '');
            const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (!match) return true; // 파싱 불가하면 유지
            const depDate = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
            return depDate >= today;
        });
        const expiredCount = beforeExpiry - activeFlights.length;
        if (expiredCount > 0) {
            console.log(`🗑️ 만료 항공권 ${expiredCount}개 제거 (${beforeExpiry} → ${activeFlights.length})`);
        } else {
            console.log('✅ 만료 항공권 없음');
        }

        // 편도 항공권 제거 (귀국일 없는 항공편)
        console.log('\n=== 편도 항공권 제거 ===');
        const beforeOneWay = activeFlights.length;
        const roundTripFlights = activeFlights.filter((f: any) => {
            return f.arrival?.date && f.arrival.date.trim() !== '';
        });
        const oneWayCount = beforeOneWay - roundTripFlights.length;
        if (oneWayCount > 0) {
            console.log(`✈️ 편도 항공권 ${oneWayCount}개 제거 (${beforeOneWay} → ${roundTripFlights.length})`);
        } else {
            console.log('✅ 편도 항공권 없음');
        }

        // 출발지 = 도착지인 깨진 항공권 제거 (스크래퍼 파싱 오류 방어)
        console.log('\n=== 출발지/도착지 검증 ===');
        const beforeSameCity = roundTripFlights.length;
        const validRouteFlights = roundTripFlights.filter((f: any) => {
            const dep = (f.departure?.city || '').trim();
            const arr = (f.arrival?.city || '').trim();
            if (!arr) return false;
            return dep !== arr;
        });
        const sameCityCount = beforeSameCity - validRouteFlights.length;
        if (sameCityCount > 0) {
            console.warn(`⚠️ 출발지=도착지 항공권 ${sameCityCount}개 제거 (${beforeSameCity} → ${validRouteFlights.length}) — 스크래퍼 파싱 점검 필요`);
        } else {
            console.log('✅ 출발지/도착지 이상 없음');
        }

        // 인터파크 벤치마크 기반 필터링
        console.log('\n=== 인터파크 가격 벤치마크 ===');
        let benchmarkedFlights = validRouteFlights;
        let activeInterparkBenchmark: any = null;
        try {
            const benchmarkPath = path.join(dataDir, 'interpark-prices.json');

            // 출발지·도착지 조합별 14일 TTL은 스크래퍼가 판정한다.
            // PC 부분 대체 수집에서는 여행사만 복구하고 인터파크에는 새 요청을 보내지 않는다.
            let benchmark: any = null;
            let cachedBenchmark: any = null;
            try {
                if (fs.existsSync(benchmarkPath)) {
                    const cached = JSON.parse(fs.readFileSync(benchmarkPath, 'utf-8'));
                    cachedBenchmark = cached;
                    const cacheAge = Date.now() - new Date(cached.timestamp).getTime();
                    if ((localSourceFallback || localBrowserPilot) && Object.keys(cached.prices || {}).length > 0) {
                        benchmark = cached;
                        console.log(`♻️ PC 브라우저 부분 수집: 인터파크 캐시 재사용 (${Math.round(cacheAge / 3600000)}시간 전 저장)`);
                    }
                }
            } catch { }

            // 캐시가 없거나 오래되었으면 새로 수집
            if (!benchmark) {
                const routeTargets = new Map<string, InterparkRouteTarget>();
                validRouteFlights.forEach((f: any) => {
                    const originCity = resolveInterparkOriginCityCode(
                        f.departure?.city,
                        f.departure?.airport,
                    );
                    const destinationCity = resolveCityCode(f.arrival?.city || '', f.arrival?.airport);
                    if (originCity && destinationCity) {
                        routeTargets.set(`${originCity}|${destinationCity}`, { originCity, destinationCity });
                    }
                });

                benchmark = await scrapeInterparkBenchmark(Array.from(routeTargets.values()), {
                    previousBenchmark: cachedBenchmark,
                    maxPairsPerRun: 5,
                });
                fs.writeFileSync(benchmarkPath, JSON.stringify(benchmark, null, 2), 'utf-8');
                console.log(`💾 인터파크 벤치마크 저장: ${benchmarkPath}`);
            }
            activeInterparkBenchmark = benchmark;

            // 출발 권역과 도착 도시가 모두 맞는 월평균만 필터·할인율 계산에 사용한다.
            // 아직 순환 수집 전인 조합은 중립 통과한다.
            const beforeBenchmark = validRouteFlights.length;
            benchmarkedFlights = validRouteFlights.filter((f: any) => {
                const evaluation = evaluateInterparkBenchmark(f, benchmark);
                f.discountRate = evaluation.discountRate;
                if (!evaluation.keep) {
                    console.log(`  ❌ 필터: ${f.arrival?.city} ${evaluation.yearMonth} ${f.price.toLocaleString()}원 > 인터파크 평균 ${evaluation.average?.toLocaleString()}원 (${f.source})`);
                    return false;
                }
                return true;
            });

            const benchmarkFiltered = beforeBenchmark - benchmarkedFlights.length;
            console.log(`📊 인터파크 기준 필터: ${benchmarkFiltered}개 제거 (${beforeBenchmark} → ${benchmarkedFlights.length})`);

        } catch (error) {
            console.error('⚠️ 인터파크 벤치마크 실패 (필터링 건너뜀):', error);
        }

        // 노랑풍선 상세 POST도 실제 노출될 표가 정해진 뒤에만 실행한다. 기존 검증 시각과
        // 성공 상태를 먼저 재사용하고, 한 번도 조회하지 않은 후보부터 최대 40건만 보강한다.
        if (attempted.has('ybtour') && !preservedSources.has('ybtour')) {
            try {
                const ybtourResult = await enrichVisibleYbtourFlights(
                    benchmarkedFlights.filter((flight: any) => flight.source === 'ybtour'),
                    ybtourTimeEnrichment,
                );
                ybtourTimeEnrichment = ybtourResult.state;

                if (ybtourResult.stats.fetch?.degraded) {
                    const fetchStats = ybtourResult.stats.fetch;
                    const warning = `⚠️ 시간 정보: 노랑풍선 상세 응답 읽기 실패 `
                        + `${fetchStats.rejected}/${fetchStats.processed}건, 남은 ${fetchStats.skipped}건 이월 `
                        + '— 항공권 목록과 기존 시간은 유지';
                    collectionWarnings.push(warning);
                    console.warn(warning);
                    recordCrawlAlerts([warning]);
                }
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                const restriction = classifySourceAccessRestriction(error);
                if (restriction) {
                    sourceCircuits.ybtour = localSourceFallback && sourceCircuits.ybtour
                        ? recordPcFallback('ybtour', sourceCircuits.ybtour, 'blocked', restriction.detail)
                        : openSourceCircuit(restriction, SOURCE_ADAPTER_VERSIONS.ybtour);
                } else if (localSourceFallback && sourceCircuits.ybtour) {
                    sourceCircuits.ybtour = recordPcFallback('ybtour', sourceCircuits.ybtour, 'failed', reason);
                }

                // 목록이 정상이어도 시간 단계에서 차단되면 그 회차의 노랑풍선 전체를 섞지
                // 않고 이전 최종본을 유지한다. 열린 ybtour 회로는 PC의 ybtour 단독 수집으로 이어진다.
                const previousYbtour = (prevCache?.flights || []).filter((flight: any) => flight.source === 'ybtour');
                benchmarkedFlights = [
                    ...benchmarkedFlights.filter((flight: any) => flight.source !== 'ybtour'),
                    ...previousYbtour,
                ];
                const nonYbtourRaw = allFlights.filter((flight: any) => flight.source !== 'ybtour');
                allFlights.splice(0, allFlights.length, ...nonYbtourRaw, ...previousYbtour);
                preservedSources.add('ybtour');
                missingDetectionSafeSources.delete('ybtour');
                staleStreak.ybtour = (staleStreak.ybtour || 0) + 1;
                sources.ybtour = previousYbtour.length;
                const previousScraped = prevCache?.scrapedCounts?.ybtour;
                if (previousScraped === undefined) delete scrapedCounts.ybtour;
                else scrapedCounts.ybtour = previousScraped;
                const previousUpdatedAt = prevCache?.sourceUpdatedAt?.ybtour;
                if (previousUpdatedAt) sourceUpdatedAt.ybtour = previousUpdatedAt;
                else delete sourceUpdatedAt.ybtour;
                ybtourTimeEnrichment = prevCache?.ybtourTimeEnrichment;

                const fallbackText = restriction
                    ? localSourceFallback
                        ? 'PC에서도 차단돼 PC ybtour 대체 수집을 24시간 중단'
                        : 'GitHub ybtour 회로 개방, 다음 정규 회차에 PC가 ybtour만 대체 수집'
                    : '이전 ybtour 데이터 유지';
                const alert = `⛔ ybtour 시간 보강 실패: ${reason} — ${fallbackText}`;
                integrityWarnings.push(alert);
                console.warn(alert);
                recordCrawlAlerts([alert]);
            }
        }

        // 땡처리 시간 조회는 실제 노출될 표가 모두 정해진 뒤에만 실행한다. 원본 1천여 건이나
        // 인터파크 필터에서 버릴 표를 위해 실시간 페이지를 열지 않는다.
        if (attempted.has('ttang') && !preservedSources.has('ttang')) {
            try {
                const ttangResult = await enrichVisibleTtangFlights(
                    benchmarkedFlights.filter((flight: any) => flight.source === 'ttang'),
                    ttangTimeEnrichment,
                    { checkpoint: ttangDetailCheckpoint, allEligible: ttangAllDetails },
                );
                ttangTimeEnrichment = ttangResult.state;
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                const restriction = classifySourceAccessRestriction(error);
                if (restriction) {
                    sourceCircuits.ttang = localSourceFallback && sourceCircuits.ttang
                        ? recordPcFallback('ttang', sourceCircuits.ttang, 'blocked', restriction.detail)
                        : openSourceCircuit(restriction, SOURCE_ADAPTER_VERSIONS.ttang);
                } else if (localSourceFallback && sourceCircuits.ttang) {
                    sourceCircuits.ttang = recordPcFallback('ttang', sourceCircuits.ttang, 'failed', reason);
                }

                // 시간 단계도 땡처리 소스의 일부다. 여기서 차단·치명 오류가 나면 목록만 새것으로
                // 섞지 않고 기존 땡처리 최종본 전체를 유지한다. 열린 ttang 회로는 기존 정책대로
                // Windows PC의 --sources=ttang 대체 수집 대상으로 이어진다.
                const previousTtang = (prevCache?.flights || []).filter((flight: any) => flight.source === 'ttang');
                benchmarkedFlights = [
                    ...benchmarkedFlights.filter((flight: any) => flight.source !== 'ttang'),
                    ...previousTtang,
                ];
                const nonTtangRaw = allFlights.filter((flight: any) => flight.source !== 'ttang');
                allFlights.splice(0, allFlights.length, ...nonTtangRaw, ...previousTtang);
                preservedSources.add('ttang');
                missingDetectionSafeSources.delete('ttang');
                staleStreak.ttang = (staleStreak.ttang || 0) + 1;
                sources.ttang = previousTtang.length;
                const previousScraped = prevCache?.scrapedCounts?.ttang;
                if (previousScraped === undefined) delete scrapedCounts.ttang;
                else scrapedCounts.ttang = previousScraped;
                const previousUpdatedAt = prevCache?.sourceUpdatedAt?.ttang;
                if (previousUpdatedAt) sourceUpdatedAt.ttang = previousUpdatedAt;
                else delete sourceUpdatedAt.ttang;
                ttangTimeEnrichment = prevCache?.ttangTimeEnrichment;

                const fallbackText = restriction
                    ? localSourceFallback
                        ? 'PC에서도 차단돼 PC ttang 대체 수집을 24시간 중단'
                        : 'GitHub ttang 회로 개방, 다음 정규 회차에 PC가 ttang만 대체 수집'
                    : '이전 ttang 데이터 유지';
                const alert = `⛔ ttang 시간 보강 실패: ${reason} — ${fallbackText}`;
                integrityWarnings.push(alert);
                console.warn(alert);
                recordCrawlAlerts([alert]);
            }
        }

        if (requestedSources && untouchedFlights.length > 0) {
            benchmarkedFlights = [...benchmarkedFlights, ...untouchedFlights];
            console.log(`🔒 부분 크롤 미실행 여행사: 이전 최종 데이터 ${untouchedFlights.length}개 그대로 유지`);
        }

        // 부분 크롤에서 이전 캐시를 그대로 붙인 경우에도 대응 기준가가 없는 과거 할인율을 남기지 않는다.
        if (activeInterparkBenchmark) {
            benchmarkedFlights.forEach((flight: any) => clearUnsupportedInterparkDiscount(
                flight,
                activeInterparkBenchmark,
            ));
        }

        const lifecycleFlights = allFlights.filter((f: any) => {
            if (!Number.isFinite(Number(f.price)) || Number(f.price) <= 0) return false;
            const departureDate = String(f.departure?.date || '').match(/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
            const normalizedDepartureDate = departureDate
                ? `${departureDate[1]}-${departureDate[2].padStart(2, '0')}-${departureDate[3].padStart(2, '0')}`
                : '';
            if (normalizedDepartureDate && normalizedDepartureDate < todayKst) return false;
            if (!String(f.arrival?.date || '').trim()) return false;
            const departureCity = String(f.departure?.city || '').trim();
            const arrivalCity = String(f.arrival?.city || '').trim();
            return !!arrivalCity && departureCity !== arrivalCity;
        });

        // 크롤 로그에 남길 '실제로 사이트에 나가는 목록'.
        // 어느 경로로 끝나든 이 변수가 최종본을 가리킨다.
        let savedFlights: any[] = benchmarkedFlights;
        let cachePreservedGlobally = false;

        // 전체 결과가 이전 캐시의 50% 미만이면 이전 캐시 유지
        if (prevCache && prevCache.count > 0 && benchmarkedFlights.length < prevCache.count * 0.5) {
            console.log(`\n⚠️ 결과가 이전 캐시(${prevCache.count}개)의 50% 미만(${benchmarkedFlights.length}개) → 이전 캐시 유지`);
            console.log('항공권은 유지하고 차단 회로·실패 상태만 저장합니다.');
            savedFlights = prevCache.flights || [];
            cachePreservedGlobally = true;
            const completedAt = new Date().toISOString();
            const preservedCache = {
                ...preserveCrawlCacheWithSafetyState({
                    previous: prevCache,
                    sourceCircuits: sourceCircuits as Record<string, unknown>,
                    staleStreak,
                    scrapedCounts,
                    integrityAlerts: integrityWarnings,
                    // 이미 실행된 예약 회차를 watchdog이 다시 보내 차단된 소스를 재요청하지 않게 한다.
                    fullCrawlCompletedAt: requestedSources ? undefined : completedAt,
                }),
                ttangTimeEnrichment,
                ybtourTimeEnrichment,
            };
            fs.writeFileSync(cachePath, JSON.stringify(preservedCache, null, 2), 'utf-8');
        } else {
            // firstSeen 필드 추가: 이전 캐시와 비교하여 새 항공편 감지
            const prevFlightMap = new Map<string, string>();
            if (prevCache?.flights) {
                prevCache.flights.forEach((f: any) => {
                    if (f.firstSeen) {
                        prevFlightMap.set(buildLifecycleIdentity(f).offerKey, f.firstSeen);
                    }
                });
            }
            const todayDate = todayKst;
            let newFlightCount = 0;
            benchmarkedFlights.forEach((f: any) => {
                // 부분 크롤에서 실행하지 않은 여행사는 기존 최종 객체를 그대로 보존한다.
                // firstSeen 같은 필드를 여기서 새로 붙이면 "선택한 소스만 교체"가 아니게 되고,
                // 별도 워크플로가 관리하는 마이리얼트립 데이터까지 조용히 바뀐다.
                if (requestedSources && !requestedSources.has(f.source)) return;
                const prevFirstSeen = prevFlightMap.get(buildLifecycleIdentity(f).offerKey);
                if (prevFirstSeen) {
                    f.firstSeen = prevFirstSeen; // 기존 항공편: firstSeen 이어받기
                } else {
                    f.firstSeen = todayDate; // 새 항공편
                    newFlightCount++;
                }
            });
            console.log(`🆕 오늘 새로 추가된 항공편: ${newFlightCount}개 / 전체 ${benchmarkedFlights.length}개`);

            // 캐시 데이터 구조 생성
            // 가격 히스토리는 중복 저장하지 않고 별도 파일만 유지한다.
            const historyPath = path.join(dataDir, 'price-history.json');
            let history: Record<string, Array<{ date: string; minPrice: number; avgPrice: number; count: number }>> = {};
            if (!requestedSources) {
                try {
                    if (fs.existsSync(historyPath)) {
                        history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
                    }
                } catch (e) {
                    console.log('가격 히스토리 파일 초기화');
                }
            }

            const cacheUpdatedAt = new Date().toISOString();
            const cacheData: CacheData = {
                timestamp: cacheUpdatedAt,
                // 부분 복구가 최신 캐시 timestamp를 바꿔도 다음 예약 전체 크롤을
                // 완료된 것으로 오인하지 않도록 독립된 완료 표식을 유지한다.
                fullCrawlUpdatedAt: requestedSources
                    ? prevCache?.fullCrawlUpdatedAt
                    : cacheUpdatedAt,
                count: benchmarkedFlights.length,
                flights: benchmarkedFlights,
                // 캐시에는 필터를 통과해 실제로 노출되는 수를 담는다.
                // (원본 수집량은 crawl-log.json의 scraped가 갖는다)
                sources: countBySource(benchmarkedFlights) as CacheData['sources'],
                sourceUpdatedAt,
                staleStreak,
                scrapedCounts: { ...(prevCache?.scrapedCounts || {}), ...scrapedCounts },
                integrityAlerts: integrityWarnings,
                sourceCircuits: sourceCircuits as Record<string, SourceCircuitState>,
                manualCaptureStatus,
                ttangTimeEnrichment,
                ybtourTimeEnrichment,
            };

            // data 디렉토리 확인 및 생성
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            // 가격 히스토리에 오늘 데이터 추가 (history는 위에서 이미 로드됨)
            const routePrices: Record<string, number[]> = {};
            if (!requestedSources) {
                const todayStr = todayKst;
                allFlights.forEach((f: any) => {
                    const route = `${f.departure?.city || ''}-${f.arrival?.city || ''}`;
                    if (f.price > 0) {
                        if (!routePrices[route]) routePrices[route] = [];
                        // 땡처리닷컴은 발권수수료 2만원을 포함한 실질 가격으로 기록한다.
                        routePrices[route].push(getEffectivePrice(f));
                    }
                });

                // 히스토리에 오늘 데이터 추가 (같은 날이면 덮어쓰기)
                Object.entries(routePrices).forEach(([route, prices]) => {
                    if (!history[route]) history[route] = [];
                    history[route] = history[route].filter(h => h.date !== todayStr);
                    history[route].push({
                        date: todayStr,
                        minPrice: Math.min(...prices),
                        avgPrice: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
                        count: prices.length,
                    });
                    // 최근 14일만 유지
                    history[route] = history[route].slice(-14);
                });
            }

            // 통합 캐시 파일 저장
            fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), 'utf-8');

            // 부분 복구는 전체 여행사를 같은 시각에 측정한 표본이 아니므로 가격 기록에 섞지 않는다.
            if (requestedSources) {
                console.log('⏭️ 부분 크롤: 가격 히스토리 갱신 건너뜀');
            } else {
                fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf-8');
                console.log(`📈 가격 히스토리 기록: ${Object.keys(routePrices).length}개 노선`);
            }

            console.log('\n\n✅ 전체 크롤링 완료!');
            console.log('='.repeat(50));
            console.log(`📊 총 수집된 항공권: ${allFlights.length}개 → 필터 후: ${benchmarkedFlights.length}개`);

            console.log(`   - 노랑풍선: ${sources.ybtour}개`);
            console.log(`   - 하나투어: ${sources.hanatour}개`);
            console.log(`   - 모두투어: ${sources.modetour}개`);
            console.log(`   - 온라인투어: ${sources.onlinetour}개`);
            console.log(`   - 마이리얼트립: ${sources.myrealtrip}개`);
            console.log(`💾 저장 위치: ${cachePath}`);
            console.log(`🕐 타임스탬프: ${cacheData.timestamp}`);
            console.log('='.repeat(50));

        }

        // GitHub Actions의 커밋 충돌 처리에서 저장소가 초기화되어도 사라지지 않도록
        // 생애 기록 입력은 /tmp 경로(환경변수로 전달)에만 남긴다. 환경변수가 없으면
        // 로컬 크롤 동작은 지금과 완전히 같다.
        const lifecycleObservationPath = process.env.LIFECYCLE_OBSERVATION_PATH;
        if (lifecycleObservationPath) {
            const visibleIds = new Set(benchmarkedFlights.map((f: any) => `${f.source}|${f.id}`));
            const sourceStatus = Object.fromEntries(sourceNames.map(src => [src, {
                status: circuitSkipped.has(src as CrawlableSourceKey)
                    ? 'skipped'
                    : cachePreservedGlobally || preservedSources.has(src)
                    ? 'preserved'
                    : attempted.has(src) ? 'success' : 'skipped',
                scraped: circuitSkipped.has(src as CrawlableSourceKey)
                    ? undefined
                    : attempted.has(src) ? scrapedCounts[src] : undefined,
                allowMissing: missingDetectionSafeSources.has(src),
            }]));
            const observation = {
                observedAt: new Date().toISOString(),
                cachePreserved: cachePreservedGlobally,
                alerts: [...integrityWarnings, ...collectionWarnings],
                sources: sourceStatus,
                observations: lifecycleFlights.map((flight: any) => ({
                    flight,
                    visible: visibleIds.has(`${flight.source}|${flight.id}`),
                })),
            };
            fs.writeFileSync(lifecycleObservationPath, JSON.stringify(observation), 'utf8');
            console.log(`🧭 생애 기록 입력 준비: ${lifecycleFlights.length}개 후보`);
        }

        // 통합 크롤링 로그 기록.
        //
        // 필터가 모두 끝난 뒤에 남긴다. 예전에는 필터 전에 기록해서 정상 수집된 여행사는
        // 원본 수집량이, 실패해서 이전 데이터를 물려받은 여행사는 필터 후 개수가 한 표에
        // 섞여 있었다(땡처리 246건과 모두투어 995건이 같은 열에 놓이는 식).
        // 이제 total은 언제나 '사이트에 실제로 나가는 수', scraped는 '이번에 긁어온 원본 수'다.
        const finalCounts = countBySource(savedFlights);

        // 직전 캐시와 견줘 표가 얼마나 갈렸는지 센다.
        //
        // 개수만 남기면 '5건이 빠지고 다른 5건이 들어온' 회차가 변동 0으로 보인다.
        // 어느 시각 크롤이 실제로 일하고 있는지 판단하려면 이 값이 필요하다.
        // 가격은 키에서 뺀다. 가격 변동은 '다른 표'가 아니다.
        const turnoverKey = (f: any) => [
            f.source, f.airline,
            f.departure?.airport || f.departure?.city,
            f.arrival?.airport || f.arrival?.city,
            f.departure?.date, f.arrival?.date,
        ].join('|');
        const previousFlights = prevCache?.flights || [];
        const previousFlightByKey = new Map(previousFlights.map((flight: any) => [turnoverKey(flight), flight]));
        const currentFlightByKey = new Map(savedFlights.map((flight: any) => [turnoverKey(flight), flight]));
        const prevKeys = new Set(previousFlightByKey.keys());
        const nowKeys = new Set(currentFlightByKey.keys());
        const turnover: Record<string, { added: number; removed: number }> = {};
        const turnoverDetails: Record<string, { added: any[]; removed: any[] }> = {};
        for (const src of sourceNames) turnover[src] = { added: 0, removed: 0 };
        for (const src of sourceNames) turnoverDetails[src] = { added: [], removed: [] };
        const summarizeTurnoverFlight = (flight: any) => ({
            id: String(flight.id || turnoverKey(flight)),
            airline: String(flight.airline || '항공사 미상'),
            route: `${flight.departure?.city || flight.departure?.airport || '출발지'} → ${flight.arrival?.city || flight.arrival?.airport || '도착지'}`,
            departureDate: String(flight.departure?.date || ''),
            returnDate: String(flight.arrival?.date || ''),
            price: Number(flight.price) || 0,
        });
        for (const k of Array.from(nowKeys)) {
            const src = String(k).split('|')[0];
            if (turnover[src] && !prevKeys.has(k)) {
                turnover[src].added++;
                if (turnoverDetails[src].added.length < 100) {
                    const flight = currentFlightByKey.get(k);
                    if (flight) turnoverDetails[src].added.push(summarizeTurnoverFlight(flight));
                }
            }
        }
        for (const k of Array.from(prevKeys)) {
            const src = String(k).split('|')[0];
            if (turnover[src] && !nowKeys.has(k)) {
                turnover[src].removed++;
                if (turnoverDetails[src].removed.length < 100) {
                    const flight = previousFlightByKey.get(k);
                    if (flight) turnoverDetails[src].removed.push(summarizeTurnoverFlight(flight));
                }
            }
        }
        let localFallbackSessionStarted = false;
        for (const src of sourceNames) {
            const srcFlights = savedFlights.filter((f: any) => f.source === src);
            if (srcFlights.length === 0 && scrapedCounts[src] === undefined) continue;

            const cityStats: { [city: string]: number } = {};
            srcFlights.forEach((f: any) => {
                const city = f.arrival?.city || '기타';
                cityStats[city] = (cityStats[city] || 0) + 1;
            });
            const isLocalFallbackAttempt = localSourceFallback && attempted.has(src);
            const scheduledSkip = scheduledSkippedSources.has(src);
            logCrawlResults(src, finalCounts[src] || 0, undefined, cityStats, {
                scraped: circuitSkipped.has(src as CrawlableSourceKey) ? undefined : scrapedCounts[src],
                preserved: preservedSources.has(src),
                // 마이리얼트립은 전체 회차에서도 이 스크립트가 실행하지 않는다.
                // 실제 시도 여부만 기준으로 삼아 일반 5개 여행사 성공 수에 끼지 않게 한다.
                skipped: !attempted.has(src) || circuitSkipped.has(src as CrawlableSourceKey),
                skippedUntil: scheduledSkip && src === 'ttang'
                    ? nextTtangCrawlAt(process.env.CRAWL_EXPECTED_AT)
                    : circuitSkipped.get(src as CrawlableSourceKey)?.nextProbeAt,
                skipReason: scheduledSkip ? 'schedule' : circuitSkipped.has(src as CrawlableSourceKey) ? 'circuit' : 'not-requested',
                localFallback: isLocalFallbackAttempt,
                // 직전 GitHub 회차와 30분 안에 이어져도 별도 PC 회차로 남긴다.
                // 첫 PC 소스가 새 엔트리를 만들고 같은 실행의 나머지 소스는 그 엔트리에 합쳐진다.
                separateSession: isLocalFallbackAttempt && !localFallbackSessionStarted,
                added: turnover[src]?.added,
                removed: turnover[src]?.removed,
                addedFlights: turnoverDetails[src]?.added,
                removedFlights: turnoverDetails[src]?.removed,
            });
            if (isLocalFallbackAttempt) localFallbackSessionStarted = true;
        }

    } catch (error) {
        console.error('\n❌ 크롤링 실패:', error);
        process.exitCode = 1;
    }
}

// 스크립트 실행
main()
    .finally(() => shutdownTtangExternalBrowserSessions())
    .catch(error => {
        console.error('\n❌ 땡처리 외부 Chrome 종료 실패:', error);
        process.exitCode = 1;
    });
