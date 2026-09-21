import {timingSafeEqual,createHash} from 'node:crypto';
import {assertTripcomWriterScope} from './tripcom-writer-scope.mjs';
export const WRITER_FILES={
 daily:['all-flights-cache','price-history','crawl-log','interpark-prices'],
 tripcom:['all-flights-cache'],
 myrealtrip:['all-flights-cache','crawl-log'],onlinetour:['all-flights-cache','crawl-log'],
 'source-fallback':['all-flights-cache','crawl-log','interpark-prices'],manual:['all-flights-cache'],
 report:['all-flights-cache'],'link-health':['booking-link-health'],'today-pick':['today-pick'],admin:['today-pick'],
};
const authorized=(given,secret)=>{if(typeof secret!=='string'||!secret)return false;const a=Buffer.from(given),b=Buffer.from('Bearer '+secret);return a.length===b.length&&timingSafeEqual(a,b);};
export function createPublicationHandler({coordinator,secrets,publicationFactory,revalidate=async()=>{},clock=Date.now,approveCode=async()=>false}){
 const sessions=new Map();
 return async request=>{
  const role=Object.keys(secrets).find(r=>authorized(request.headers.get('authorization')||'',secrets[r]));
  if(!role)return new Response('{}',{status:401});
  try{
   if(request.method!=='POST')throw Error('method refused');
   const raw=await request.text();if(Buffer.byteLength(raw)>24*1024*1024)throw Error('payload too large');
   const input=JSON.parse(raw);await revalidate();
   let result;
   if(role==='deploy'){
    if(input.action!=='deploy'||input.requestId!==input.commitSha||!await approveCode(input))throw Error('code approval required');
    const lease=coordinator.writerAcquire({writer:'deploy',claim:createHash('sha256').update('deploy:'+input.requestId).digest('hex'),ttlMs:600000});
    const p=await publicationFactory();p.attachFence(()=>coordinator.writerCheck({...lease,writer:'deploy'}));
    const observed=await p.publishApprovedCode(input);await p.assertPublished();await revalidate();
    coordinator.writerObserved({...lease,writer:'deploy',observed});coordinator.writerRelease({...lease,writer:'deploy',observed});
    result={commitSha:observed};
   }else if(role==='A'||role==='C'){
    const identity=input.identity;if(identity?.worker!==role)throw Error('worker role mismatch');
    const readOnly=['readInputs','assertInput'].includes(input.action);
    if(readOnly){const p=await publicationFactory();result=input.action==='readInputs'?await p.readInputs(Boolean(input.includeSelection)):await p.assertInput(input.ref);}
    else{
     if(!['publish','assertPublished','publishTodayPick'].includes(input.action))throw Error('action refused');
     if(input.lease?.worker!==identity.worker||input.lease?.run!==identity.run||input.lease?.contract!==identity.contract)throw Error('lease identity mismatch');
     const lease={...input.lease,...identity,writer:'naver'};
     coordinator.transaction(s=>coordinator.owner(s,lease,'awaiting-readback'));coordinator.writerCheck(lease);
     const key=role+':'+identity.run+':'+lease.claim;let p=sessions.get(key);
     if(!p){if(input.action!=='publish')throw Error('publication session missing');p=await publicationFactory();p.attachFence(()=>coordinator.writerCheck(lease));sessions.set(key,p);}
     if(input.action==='publish')result=await p.publish(input);
     else if(input.action==='assertPublished')result=await p.assertPublished();
     else{if(role!=='A')throw Error('C cannot select today pick');result=await p.publishTodayPick(input.pick);}
    }
   }else{
    const allowed=WRITER_FILES[role];if(!allowed)throw Error('writer role refused');
    if(input.action==='readInputs'){result=await (await publicationFactory()).readInputs(true);}
    else{
     if(input.action!=='commit'||typeof input.expectedBase!=='string'||!/^[a-f0-9]{40,64}$/.test(input.requestId||''))throw Error('invalid commit');
     if(!Array.isArray(input.entries)||input.entries.length<1||input.entries.length>allowed.length)throw Error('invalid entries');
     const seen=new Set();for(const entry of input.entries){if(!Array.isArray(entry)||entry.length!==2||!allowed.some(f=>entry[0]===`data/${f}.json`)||seen.has(entry[0])||!entry[1]||typeof entry[1]!=='object')throw Error('path or content refused');seen.add(entry[0]);}
     if(role==='tripcom'){
      if(input.rawEntries)throw Error('tripcom raw entries refused');
      const current=await (await publicationFactory()).readInputs(true);
      if(current.ref!==input.expectedBase)throw Error('stale tripcom input');
      assertTripcomWriterScope(current.cache,input.entries[0][1]);
     }
     const lease=coordinator.writerAcquire({writer:role,claim:createHash('sha256').update(role+':'+input.requestId).digest('hex'),ttlMs:600000});
     const p=await publicationFactory();p.attachFence(()=>coordinator.writerCheck({...lease,writer:role}));
     // Strict immutable input CAS: never reconstruct an old cache on a newer parent.
     await p.assertInput(input.expectedBase);
     if(role==='today-pick'){
      const {pick}=await p.readInputs(true),next=input.entries[0][1];
      const day=new Date(clock()+9*3600000).toISOString().slice(0,10);
      if(next.date!==day||(pick?.date===day&&JSON.stringify(pick)!==JSON.stringify(next)))throw Error('daily pick already selected or wrong KST day');
     }
     const observed=await p.publishFiles(input.entries,input.expectedBase,input.rawEntries);await p.assertPublished();await revalidate();
     coordinator.writerObserved({...lease,writer:role,observed});coordinator.writerRelease({...lease,writer:role,observed});
     result={commitSha:observed};
    }
   }
   return Response.json({result:result??null});
  }catch{return new Response('{}',{status:409});}
 };
}
