// Never infer completion from elapsed time or from an artifact alone.
export function mrtFinalization({collector,publisher,artifactId,cache,slot,now=Date.now()}) {
 const circuit=cache?.sourceCircuits?.myrealtrip;
 const open=circuit&&(!Number.isFinite(Date.parse(circuit.nextProbeAt))||Date.parse(circuit.nextProbeAt)>now);
 if(publisher==='success'&&(collector==='success'||(collector==='failure'&&Date.parse(circuit?.nextProbeAt)>now)))return {release:true,completed:true,reason:'published'};
 const fresh=Number.isFinite(Date.parse(slot))&&Date.parse(cache?.sourceUpdatedAt?.myrealtrip)>=Date.parse(slot);
 if(collector==='success'&&publisher==='failure'&&/^[1-9]\d*$/.test(String(artifactId||''))&&fresh&&!open)
  return {release:true,completed:false,reason:'successful_collection_archived_publication_failed'};
 return {release:false,reason:'unresolved_collection_or_publication'};
}
