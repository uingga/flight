const day=t=>new Date(t+9*3600000).toISOString().slice(0,10);
export function latestAgencyRound(now=Date.now()) {
 const kst=day(now);
 const times=['06:17','10:12','13:23','16:31'].map(t=>Date.parse(kst+'T'+t+':00+09:00'));
 const found=times.filter(t=>t<=now).at(-1);
 return found===undefined?null:new Date(found).toISOString();
}
export function evaluateRoundContinuation({now,cache,state,round,totalBudget=200}) {
 const time=Date.parse(round),date=day(now),same=state?.kstDate===date?state:null;
 const deny=reason=>({shouldRun:false,shouldFinalize:false,reason,kstDate:date});
 if(!Number.isFinite(time)||latestAgencyRound(time)!==round||day(time)!==date||time>now)return deny('invalid_round');
 if(same&&['running','blocked','degraded'].includes(same.phase))return deny('unsafe_previous_round');
 if(same?.activeRound&&!same.roundPublished)return deny('previous_round_unpublished');
 if(same?.lastRoundAt&&Date.parse(same.lastRoundAt)>=time)return deny('round_already_handled');
 const used=same?Number(same.navigationsUsed):0;
 if(!Number.isSafeInteger(used)||used<0||used>=totalBudget)return deny('daily_budget_exhausted');
 if(!(Date.parse(cache.fullCrawlUpdatedAt)>=time))return deny('recovery_upstream_pending');
 const sources=['ybtour','hanatour','modetour','onlinetour','ttang','myrealtrip'].filter(source=>{
  const circuit=cache.sourceCircuits?.[source];
  if(source==='myrealtrip'&&circuit&&(!Number.isFinite(Date.parse(circuit.nextProbeAt))||Date.parse(circuit.nextProbeAt)>now))return false;
  // MRT intentionally begins earlier than the ordinary agency round.
  const cutoff=source==='myrealtrip'?time-90*60000:time;
  const stamp=Date.parse(cache.sourceUpdatedAt?.[source]);
  return Number.isFinite(stamp)&&stamp>=cutoff&&stamp<=now;
 });
 if(!sources.length)return deny('no_fresh_sources');
 const pending=['ybtour','hanatour','modetour','onlinetour','ttang','myrealtrip'].filter(s=>!sources.includes(s));
 const beforeRecovery=new Date(time+9*3600000).getUTCHours()<13;
 return {shouldRun:true,shouldFinalize:false,reason:'completed_agency_round',kstDate:date,runPhase:'round_refresh',
  sources,completedSources:same?.completedSources||[],pendingSources:pending,navigationBudget:totalBudget-used,
  navigationsUsed:used,roundId:round,skipTodayPick:same?.phase==='success',
  deferTodayPick:beforeRecovery&&(same?.phase==='partial_waiting'||(same?.phase!=='success'&&pending.length>0)),
  allowedTodayPickSources:[...new Set([...(same?.completedSources||[]),...sources])]};
}
