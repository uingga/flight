import { SourceResponseError } from './scrapers/source-response';

export type SourceCircuitReason = 'blocked' | 'rate_limited';

export const SOURCE_CIRCUIT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * 여행사별 수집 구현 버전. 차단 회로가 열려 있어도 수집 방식을 실제로 수정한 경우에는
 * 24시간을 기다리지 않고 새 구현으로 한 번 검증할 수 있다.
 */
export const SOURCE_ADAPTER_VERSIONS = {
    ybtour: '2026-08-30.2',
    hanatour: '2026-08-30.2',
    modetour: '2026-08-30.2',
    onlinetour: '2026-08-30.2',
    ttang: '2026-08-30.3',
    myrealtrip: '2026-08-30.2',
} as const;

export interface SourceCircuitState {
    reason: SourceCircuitReason;
    openedAt: string;
    nextProbeAt: string;
    resumePolicy: 'cooldown_or_adapter_change';
    adapterVersion: string;
    status?: number;
    detail: string;
    localFallback?: {
        status: 'success' | 'blocked' | 'failed';
        lastAttemptAt: string;
        nextProbeAt?: string;
        detail: string;
    };
}

export interface SourceAccessRestriction {
    reason: SourceCircuitReason;
    status?: number;
    detail: string;
}

export interface SourceResponseDropOptions {
    dropRatio?: number;
    minBaseline?: number;
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error || '알 수 없는 접근 제한');
}

/**
 * 여행사 서버가 명시적으로 자동 접근을 제한한 경우만 분류한다.
 * 네트워크 오류나 페이지 구조 변경은 차단으로 단정하지 않는다.
 */
export function classifySourceAccessRestriction(error: unknown): SourceAccessRestriction | null {
    const message = errorMessage(error);
    const normalized = message.toLowerCase();
    const status = error instanceof SourceResponseError ? error.status : undefined;

    const rateLimited = status === 429
        || /(?:http\s*)?429\b|too many requests|rate[ -]?limit|요청\s*(?:제한|초과)/i.test(message);
    if (rateLimited) {
        return {
            reason: 'rate_limited',
            status: status || 429,
            detail: message,
        };
    }

    const blocked = status === 401
        || status === 403
        || (error instanceof SourceResponseError && (error.kind === 'html-response' || error.kind === 'soft-block'))
        || /(?:http\s*)?(?:401|403)\b|captcha|access denied|forbidden|접근\s*제한|차단/i.test(normalized);
    if (blocked) {
        return {
            reason: 'blocked',
            status: status || undefined,
            detail: message,
        };
    }

    return null;
}

/**
 * HTTP 200이어도 목록이 사라지거나 급감하면 soft block일 수 있다.
 * 작은 소스의 자연 변동은 제외하고, 이전 정상 원본 수량이 충분할 때만 급감으로 판정한다.
 */
export function classifySourceResponseDrop(
    currentCount: number,
    previousCount: number | null | undefined,
    options: SourceResponseDropOptions = {},
): SourceAccessRestriction | null {
    const dropRatio = options.dropRatio ?? 0.6;
    const minBaseline = options.minBaseline ?? 30;
    if (
        !Number.isFinite(currentCount)
        || currentCount < 0
        || previousCount === null
        || previousCount === undefined
        || !Number.isFinite(previousCount)
        || previousCount <= 0
    ) {
        return null;
    }

    if (currentCount === 0) {
        return {
            reason: 'blocked',
            detail: `soft block 의심: 응답 수량 ${previousCount}건에서 0건으로 감소`,
        };
    }

    if (previousCount >= minBaseline && currentCount < previousCount * dropRatio) {
        return {
            reason: 'blocked',
            detail: `soft block 의심: 응답 수량 ${previousCount}건에서 ${currentCount}건으로 급감`,
        };
    }

    return null;
}

export function openSourceCircuit(
    restriction: SourceAccessRestriction,
    adapterVersion: string,
    now = new Date(),
    cooldownMs = SOURCE_CIRCUIT_COOLDOWN_MS,
): SourceCircuitState {
    return {
        reason: restriction.reason,
        openedAt: now.toISOString(),
        nextProbeAt: new Date(now.getTime() + cooldownMs).toISOString(),
        resumePolicy: 'cooldown_or_adapter_change',
        adapterVersion,
        status: restriction.status,
        detail: restriction.detail.slice(0, 500),
    };
}

export function isSourceCircuitOpen(
    circuit: SourceCircuitState | null | undefined,
    currentAdapterVersion: string | undefined,
    now: Date | number = new Date(),
): boolean {
    if (!circuit) return false;
    if (currentAdapterVersion && circuit.adapterVersion !== currentAdapterVersion) return false;

    const nowTimestamp = now instanceof Date ? now.getTime() : now;
    const nextProbeTimestamp = new Date(circuit.nextProbeAt).getTime();
    // 손상된 상태를 보고 자동 요청을 재개하지 않는다. 구현 버전을 올리면 명시적으로 해제된다.
    if (!Number.isFinite(nowTimestamp) || !Number.isFinite(nextProbeTimestamp)) return true;
    return nowTimestamp < nextProbeTimestamp;
}

export function isLocalSourceFallbackCoolingDown(
    circuit: SourceCircuitState | null | undefined,
    now: Date | number = new Date(),
): boolean {
    if (!circuit?.localFallback?.nextProbeAt) return false;
    const nowTimestamp = now instanceof Date ? now.getTime() : now;
    const nextProbeTimestamp = new Date(circuit.localFallback.nextProbeAt).getTime();
    if (!Number.isFinite(nowTimestamp) || !Number.isFinite(nextProbeTimestamp)) return true;
    return nowTimestamp < nextProbeTimestamp;
}

export function recordLocalSourceFallback(
    circuit: SourceCircuitState,
    status: 'success' | 'blocked' | 'failed',
    detail: string,
    now = new Date(),
    cooldownMs = SOURCE_CIRCUIT_COOLDOWN_MS,
): SourceCircuitState {
    const lastAttemptAt = now.toISOString();
    return {
        ...circuit,
        localFallback: {
            status,
            lastAttemptAt,
            ...(status === 'blocked'
                ? { nextProbeAt: new Date(now.getTime() + cooldownMs).toISOString() }
                : {}),
            detail: detail.slice(0, 500),
        },
    };
}

export function pruneResolvedSourceCircuits<T extends string>(
    circuits: Partial<Record<T, SourceCircuitState>> | undefined,
    adapterVersions: Partial<Record<T, string>>,
    now: Date | number = new Date(),
): Partial<Record<T, SourceCircuitState>> {
    const active: Partial<Record<T, SourceCircuitState>> = {};
    for (const [source, circuit] of Object.entries(circuits || {}) as Array<[T, SourceCircuitState]>) {
        if (isSourceCircuitOpen(circuit, adapterVersions[source], now)) active[source] = circuit;
    }
    return active;
}

export function sourceCircuitLabel(circuit: SourceCircuitState): string {
    return circuit.reason === 'rate_limited' ? '요청 제한' : '접근 차단';
}
