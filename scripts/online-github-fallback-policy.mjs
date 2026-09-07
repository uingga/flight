import assert from 'node:assert/strict';
import { evaluatePcCollection } from './pc-collection-policy.mjs';
import { ONLINE_BROWSER_PRIMARY } from '../src/lib/browser-primary-config.mjs';

/** Offline policy shared by the dispatcher, GitHub claim and last pre-request guard. */
export function assertOnlineGithubFallback({cache,expectedAt,now=new Date(),config=ONLINE_BROWSER_PRIMARY}) {
    assert.equal(config.enabled,true,'primary_not_enabled');
    assert.equal(typeof expectedAt,'string','slot_required');
    const policy=evaluatePcCollection({cache,now,config});
    assert.equal(policy.expectedAt,expectedAt,'stale_fallback_slot');
    assert.equal(policy.githubFallbackDue,true,'github_fallback_not_due');
    return policy;
}

export function claimOnlineGithubFallback({cache,expectedAt,runId,runAttempt,now=new Date(),config=ONLINE_BROWSER_PRIMARY}) {
    assert.equal(String(runAttempt),'1','workflow_rerun_forbidden');
    assert.match(String(runId),/^\d+$/,'invalid_workflow_run');
    assertOnlineGithubFallback({cache,expectedAt,now,config});
    return {...cache,onlinePrimary:{...cache.onlinePrimary,githubAttemptAt:new Date(now).toISOString(),
        githubClaim:{runId:String(runId),expectedAt}}};
}

export function assertOnlineGithubClaim({cache,expectedAt,runId,runAttempt,now=new Date(),config=ONLINE_BROWSER_PRIMARY}) {
    assert.equal(String(runAttempt),'1','workflow_rerun_forbidden');
    assert.ok(runId && expectedAt,'missing_workflow_identity');
    assert.deepEqual(cache?.onlinePrimary?.githubClaim,{runId:String(runId),expectedAt},'unclaimed_workflow');
    const age=new Date(now).getTime()-Date.parse(cache.onlinePrimary.githubAttemptAt);
    assert.ok(Number.isFinite(age) && age>=0 && age<=30*60_000,'expired_workflow_claim');
    // The durable claim intentionally blocks a second dispatcher; only this run may consume it.
    assertOnlineGithubFallback({cache:{...cache,onlinePrimary:{...cache.onlinePrimary,githubAttemptAt:undefined}},expectedAt,now,config});
}
