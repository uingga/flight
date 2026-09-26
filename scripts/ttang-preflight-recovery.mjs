import {createHash} from 'node:crypto';

export const REVIEWED_TTANG_FAILURE = 'a338bd4b-c1d9-4bc3-a3ad-f4ae073cb965';
const reviewedWorker = '8a2139fe2639085700fcf3070483020e7c838e8edc928b20b6dd24750093a5fa';
const reviewedOwner = '3d53d43c46156536e569bea68ac15b1377968d6cbaac9108099d4149a93271b7';

// Deliberate operator recovery of ONE audited legacy reply, not a relaxation of
// automatic failure policy. The reviewed worker discovers Chrome before it
// creates staging or starts any site request, and releases its own lock on exit.
export function reviewLegacyTtangPreflight({cache,request,reply,sharedCooldown,observation}, now=Date.now()) {
    const id=REVIEWED_TTANG_FAILURE, primary=cache?.ttangPrimary;
    if (!cache?.flights || request?.id!==id || request.manual!==false
        || request.expectedAt!=='2026-09-25T21:17:00.000Z'
        || reply?.protocol!=='ttang-20260907.1' || reply.id!==id || reply.status!=='failed'
        || reply.reason!=='dedicated_chrome_owner_unverified' || reply.uncertain!==false
        || reply.observedCount!==0 || reply.cooldown!=null || reply.bundle!=null
        || primary?.runId!==id || primary.status!=='failed'
        || !primary.detail?.includes('(dedicated_chrome_owner_unverified)')
        || sharedCooldown?.id!==id || sharedCooldown.nextProbeAt!==primary.nextProbeAt
        || !Number.isFinite(Date.parse(primary.nextProbeAt))
        || observation?.workerSha?.toLowerCase()!==reviewedWorker
        || observation?.ownerSha?.toLowerCase()!==reviewedOwner
        || observation.fenceExists!==true || observation.stageExists!==false
        || observation.sharedLockExists!==false || observation.cooldownExists!==false
        || observation.claims?.length!==1 || observation.claims[0].data?.id!==id
        || observation.claims[0].data?.at!==request.createdAt)
        throw Error('legacy_preflight_review_not_proven');
    for (const value of [cache.sourceCircuits?.ttang?.nextProbeAt,cache.sourceCircuits?.ttang?.localFallback?.nextProbeAt]) {
        if (value!=null && (!Number.isFinite(Date.parse(value)) || Date.parse(value)>now))
            throw Error('separate_site_circuit_preserved');
    }
    const proofSha=createHash('sha256').update(JSON.stringify({request,reply,sharedCooldown,observation})).digest('hex');
    const recovered=structuredClone(cache);
    delete recovered.ttangPrimary.nextProbeAt;
    recovered.ttangPrimary.failureKind='preflight';
    recovered.ttangPrimary.recovery={failedRunId:id,kind:'audited_legacy_preflight',proofSha,reviewedAt:new Date(now).toISOString()};
    return {cache:recovered,proofSha,failedRunId:id};
}
