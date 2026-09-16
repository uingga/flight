import {kstDay} from '../../src/lib/naver-coordinator.mjs';

// Status is only a dispatch hint. begin/reserve still enforce ownership and fences atomically.
export function hostAction({now=Date.now(),activateAt,state,legacy,completedRound}){
 if(!Number.isFinite(Date.parse(activateAt)))throw Error('activation boundary missing');
 if(now<Date.parse(activateAt))return 'wait';
 const day=kstDay(now);
 if(state?.day&&state.day!==day){
  if(state.owner||state.pending||state.blocked)throw Error('previous day requires reconciliation');
  state=null;
 }
 if(!state){
  if(legacy?.kstDate===day&&(legacy.navigationsUsed>0||legacy.phase==='running'))throw Error('legacy ledger migration required');
  return 'A';
 }
 if(state.blocked||state.pending||(state.owner&&!(state.phase==='paused-A'&&state.owner==='A')))throw Error('unsafe or active coordinator state');
 if(!Number.isSafeInteger(state.used?.A)||!Number.isSafeInteger(state.used?.C)||state.used.A<0||state.used.C<0||state.used.A>200||state.used.C>200)throw Error('invalid budget state');
 if(state.phase==='new'){
  if(state.used.A||state.used.C||legacy?.kstDate===day&&(legacy.navigationsUsed>0||legacy.phase==='running'))throw Error('unreconciled new ledger');
  return 'A';
 }
 if(state.phase==='paused-A'){
  if(state.owner!=='A')throw Error('paused owner missing');
  return 'resume-A';
 }
 if(state.phase==='ready-C'){
  if(!state.verifiedVersion||(!state.round&&state.used.C))throw Error('unverified or repeated handoff');
  return 'C';
 }
 if(state.phase==='done')return completedRound&&state.round&&Date.parse(completedRound)>Date.parse(state.round)&&state.used.A+state.used.C<400?'A':'done';
 throw Error('unknown coordinator phase');
}

export async function runHostHandoff({activateAt,readStatus,readLegacy,runA,runC,clock=Date.now,completedRound}){
 const day=kstDay(clock());
 const decide=async()=>hostAction({activateAt,now:clock(),state:await readStatus(),legacy:await readLegacy(),completedRound});
 let action=await decide();
 if(action==='A'||action==='resume-A'){
  await runA({run:`${day}-A`,resume:action==='resume-A'});
  if(kstDay(clock())!==day)throw Error('day changed; no remote dispatch');
  action=await decide();
 }
 if(action==='C'){
  await runC({run:`${day}-C`});
  if(kstDay(clock())!==day)throw Error('remote outcome crosses day boundary');
  const final=await readStatus();
  if(final?.day!==day||final.phase!=='done'||final.owner||final.blocked||final.pending||!final.verifiedVersion)throw Error('remote completion not verified');
  return {status:'complete',day,used:final.used};
 }
 return {status:action,day};
}
