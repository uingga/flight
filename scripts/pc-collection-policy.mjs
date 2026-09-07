import { evaluateLocalSourceFallback, scheduledSlotDistance, surroundingSlots } from './local-source-fallback-policy.mjs';
import { isTtangCrawlSlot } from '../src/lib/crawl-schedule-health.mjs';
import { ONLINE_BROWSER_PRIMARY } from '../src/lib/browser-primary-config.mjs';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * @param {{cache?: any, now?: Date|string, config?: {enabled:boolean,slotsPerDay:number}}} options
 * @returns {{sources:string[],shouldRun:boolean,reason:string,expectedAt:string|null,nextExpectedAt:string|null,githubFallbackDue?:boolean}}
 */
export function evaluatePcCollection({cache,now=new Date(),config=ONLINE_BROWSER_PRIMARY}={}) {
    const base={expectedAt:null,nextExpectedAt:null,...evaluateLocalSourceFallback({cache,now})};
    if(!config.enabled)return base;
    const sources=base.sources.filter(s=>s!=='onlinetour');
    const ms=new Date(now).getTime(), expectedAt='expectedAt' in base?base.expectedAt:null, slot=Date.parse(expectedAt || '');
    const future=value=>value!=null && (!Number.isFinite(Date.parse(value)) || Date.parse(value)>ms);
    const online=cache?.onlinePrimary?.circuit;
    const eligible=Number.isFinite(ms) && Number.isFinite(slot) && Date.parse(cache?.fullCrawlUpdatedAt)>=slot
        && (config.slotsPerDay===4 || isTtangCrawlSlot(slot))
        && !future(online?.nextProbeAt) && !future(online?.localFallback?.nextProbeAt)
        && !(Date.parse(cache?.onlinePrimary?.lastAttemptAt)>=slot);
    if(eligible)sources.push('onlinetour');
    const failureAnchor=Date.parse(cache?.onlinePrimary?.failureOpenedAt);
    // Failures finish after the scheduled start. Anchor to that slot, not the finish time.
    const distance=Number.isFinite(failureAnchor) && failureAnchor<=ms && Number.isFinite(slot)
        ?scheduledSlotDistance(surroundingSlots(failureAnchor).expectedAt,slot):null;
    const github=cache?.sourceCircuits?.onlinetour;
    const pcFinished=Date.parse(cache?.onlinePrimary?.lastAttemptAt)>=slot || future(online?.nextProbeAt) || future(online?.localFallback?.nextProbeAt);
    const githubFallbackDue=cache?.onlinePrimary?.status==='failed' && cache?.onlinePrimary?.githubFallbackSafe===true
        && pcFinished && Number.isFinite(slot)
        && distance!==null && distance%2===0 && Date.parse(cache?.fullCrawlUpdatedAt)>=slot
        && !future(github?.nextProbeAt) && !(Date.parse(cache?.onlinePrimary?.githubAttemptAt)>=slot);
    return {...base,expectedAt,sources,shouldRun:sources.length>0,githubFallbackDue,
        reason:sources.length?'pc_collection_due':base.reason==='upstream_pending'?base.reason:'primary_not_due'};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
    if(process.argv.length!==5 || process.argv[2]!=='check' || process.argv[3]!=='--cache')throw Error('cache_required');
    console.log(JSON.stringify(evaluatePcCollection({cache:JSON.parse(fs.readFileSync(process.argv[4],'utf8'))})));
}
