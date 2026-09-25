import { MODE_REMOTE_PROTOCOL } from './modetour-operational';
import { assertTtangWorker } from '../../scripts/ttang-worker-routing.mjs';
import { evaluatePcCollection, isRecentPrimarySnapshot } from '../../scripts/pc-collection-policy.mjs';

const validId = (value: unknown): value is string => typeof value === 'string'
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);

// A dispatch and B/C admission deliberately share one daytime routing table.
// The separate 20:30 worker continues to use agency-evening-policy.mjs.
export function validateModeWorkerRequest(request: any, { now, hostname }: { now: number; hostname: string }) {
    const age = now - Date.parse(request?.createdAt);
    if (request?.protocol !== MODE_REMOTE_PROTOCOL || !validId(request.id)
        || !Number.isFinite(age) || age < 0 || age > 900_000) throw new Error('invalid_worker_request');
    if (!['B', 'C'].includes(request.worker)) throw new Error('worker_identity_mismatch');
    const worker = assertTtangWorker(hostname, request.expectedAt, false, request.worker);
    const policy = evaluatePcCollection({ cache: request.cache, now: new Date(now) });
    if (!policy.shouldRun || !policy.sources.includes('modetour') || policy.expectedAt !== request.expectedAt)
        throw new Error('source_not_eligible');
    if (!isRecentPrimarySnapshot(request.cache, now)) throw new Error('stale_source_state');
    return worker;
}

export function modeWorkerFailure(request: any, error: unknown, phase: string) {
    const message = error instanceof Error ? error.message : '';
    const reason = (error as NodeJS.ErrnoException)?.code === 'EEXIST' ? 'worker_busy_or_slot_claimed'
        : /^[a-z_]+$/.test(message) ? message : 'worker_failed';
    return {
        protocol: MODE_REMOTE_PROTOCOL,
        id: request?.protocol === MODE_REMOTE_PROTOCOL && validId(request?.id) ? request.id : undefined,
        status: 'failed', reason, restricted: reason === 'access_restriction', phase,
    };
}

export function assertModeReplyIdentity(reply: any, id: string) {
    if (reply?.protocol !== MODE_REMOTE_PROTOCOL || reply?.id !== id) throw new Error('remote_identity_mismatch');
}
