import {MRT_ALIGNED_ROUNDS,mrtRoundForGeneralSlot} from './mrt-round-readiness.mjs';
const suffix=slot=>slot.replace(/[-:.]/g,'');
const stamp=value=>Date.parse(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);

// Read-only recovery of a skipped GitHub slot. Never writes a synthetic done tag.
export async function inspectNaverMrtCompletion({api,round,cache,now=Date.now()}) {
 const expected=mrtRoundForGeneralSlot(round);
 const read=async route=>{const r=await api(route);if(![200,404].includes(r.status))throw Error('MRT evidence unavailable');return r;};
 const exact=await read('git/ref/tags/mrt-done/'+suffix(expected.expectedAt));
 if(exact.status===200)return {ready:true,reason:'exact_round_done'};
 const hold=reason=>({ready:false,reason});
 if(expected.host!=='github')return hold('exact_round_pending');
 const sourceTime=stamp(cache?.sourceUpdatedAt?.myrealtrip);
 const circuit=cache?.sourceCircuits?.myrealtrip;
 if(!Number.isFinite(sourceTime)||sourceTime<stamp(expected.expectedAt)||sourceTime>now
  ||!cache?.flights?.some(f=>f.source==='myrealtrip')
  ||(circuit&&(!Number.isFinite(stamp(circuit.nextProbeAt))||stamp(circuit.nextProbeAt)>now)))return hold('fresh_published_source_missing');
 if((await read('git/ref/tags/mrt-active-v1')).status!==404)return hold('collector_active');
 // A claim would also explain should_run=false; do not mislabel that as overlap.
 if((await read('git/ref/tags/mrt-slot/'+suffix(expected.expectedAt))).status!==404)return hold('expected_slot_claimed');
 const index=MRT_ALIGNED_ROUNDS.findIndex(r=>r.generalMinute===new Date(stamp(round)+9*3600000).getUTCHours()*60+new Date(stamp(round)+9*3600000).getUTCMinutes());
 if(index<1)return hold('no_previous_same_day_slot');
 const previousSlot=new Date(stamp(expected.expectedAt)+(MRT_ALIGNED_ROUNDS[index-1].startMinute-MRT_ALIGNED_ROUNDS[index].startMinute)*60000).toISOString();
 const done=await read('git/ref/tags/mrt-done/'+suffix(previousSlot));
 if(done.status!==200||!sha(done.data?.object?.sha))return hold('previous_done_missing');
 const owner=done.data.object.sha;
 const claim=await read('git/ref/tags/mrt-slot/'+suffix(previousSlot));
 if(claim.data?.object?.sha!==owner)return hold('previous_claim_mismatch');
 const commit=await read('git/commits/'+owner);
 let identity;try{identity=JSON.parse(commit.data?.message);}catch{return hold('owner_invalid');}
 if(identity.kind!=='mrt-owner-v1'||identity.slot!==previousSlot||identity.host!==MRT_ALIGNED_ROUNDS[index-1].host)return hold('owner_mismatch');
 const acquiredAt=stamp(commit.data?.committer?.date);
 if(!Number.isFinite(acquiredAt))return hold('owner_time_missing');
 const runs=await read('actions/workflows/myrealtrip-scrape.yml/runs?branch=main&per_page=100');
 if(!Array.isArray(runs.data?.workflow_runs))return hold('runs_unavailable');
 const matching=runs.data.workflow_runs.filter(r=>String(r.display_title||'').includes(expected.expectedAt));
 if(matching.some(r=>r.status!=='completed'))return hold('workflow_active');
 for(const run of matching){
  if(run.conclusion!=='success'||!Number.isSafeInteger(run.id)||acquiredAt>stamp(run.created_at)
   ||!(stamp(run.created_at)>=stamp(expected.expectedAt)&&stamp(run.updated_at)<=sourceTime))continue;
  const jobs=await read(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
  if(!Array.isArray(jobs.data?.jobs)||jobs.data.total_count>jobs.data.jobs.length)continue;
  const job=jobs.data.jobs.find(j=>j.steps?.some(s=>s.name==='Run MyRealTrip price scraping'));
  const step=name=>job?.steps?.find(s=>s.name===name)?.conclusion;
  if(job?.conclusion!=='success'||step('Reserve MyRealTrip slot')!=='success'
   ||step('Run MyRealTrip price scraping')!=='skipped'||step('Commit cache or circuit changes')!=='skipped')continue;
  // Recheck the mutex after gathering evidence; existing round/API barriers still apply.
  if((await read('git/ref/tags/mrt-active-v1')).status!==404)return hold('collector_active');
  return {ready:true,reason:'published_overlap_recovery',expectedAt:expected.expectedAt,completedSlot:previousSlot,sourceUpdatedAt:cache.sourceUpdatedAt.myrealtrip,skippedRunId:run.id};
 }
 return hold('verified_overlap_missing');
}
