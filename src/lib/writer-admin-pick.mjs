import {createHash} from 'node:crypto';
import {createBrokerClient} from './writer-broker-client.mjs';
export async function publishAdminPick({flight,buildPick,env=process.env,invoke=undefined}) {
 if(env.NAVER_COORDINATION!=='1')throw Error('coordinated admin publication requires explicit mode');
 const call=invoke||createBrokerClient({url:env.TIKIT_WRITER_URL,token:env.TIKIT_WRITER_ADMIN_TOKEN});
 const snapshot=await call('readInputs');
 if(!/^[a-f0-9]{40}$/.test(snapshot?.ref||'')||!Array.isArray(snapshot.cache?.flights))throw Error('invalid admin snapshot');
 const current=snapshot.cache.flights.find(item=>item.id===flight.id);
 if(!current)throw Error('selected flight no longer available');
 const pick=buildPick(snapshot.pick,current);
 if(snapshot.pick?.date===pick.date&&snapshot.pick?.flightId===pick.flightId)return {pick,commitSha:null,alreadySelected:true};
 const requestId=createHash('sha256').update(JSON.stringify({ref:snapshot.ref,pick})).digest('hex');
 const result=await call('commit',{expectedBase:snapshot.ref,requestId,entries:[['data/today-pick.json',pick]]});
 if(!/^[a-f0-9]{40}$/.test(result?.commitSha||''))throw Error('invalid admin publication response');
 return {pick,commitSha:result.commitSha,alreadySelected:false};
}
