import assert from 'node:assert/strict';
import {diagnoseReplies,safeFailure} from './diagnose-threads-replies.mjs';
async function scenario(mode){
 const token='fixture-secret-never-print';const logs=[];let calls=0,replies=0;
 const result=await diagnoseReplies({token,report:v=>logs.push(v),fetcher:async(url,options)=>{
  calls++;assert.equal(url.origin,'https://graph.threads.net');assert.equal(url.searchParams.get('access_token'),token);assert.equal(options.cache,'no-store');assert.ok(options.signal);
  if(url.pathname.endsWith('/me/threads'))return {ok:true,status:200,json:async()=>({data:[{id:'new-post',timestamp:'2026-09-08T01:00:00Z'}]})};
  assert.ok(url.pathname.endsWith('/me/replies'));replies++;
  if(mode==='network')throw Error(token);
  if(mode==='html')return {ok:false,status:502,json:async()=>{throw Error(token)}};
  if(['permission','token','rate','invalid'].includes(mode)&&replies===1)return {ok:false,status:mode==='rate'?429:400,json:async()=>({error:{code:{permission:10,token:190,rate:4,invalid:100}[mode],error_subcode:33,message:'Tried accessing nonexisting field '+token}})};
  if(mode==='malformed')return {ok:true,status:200,json:async()=>({message:token})};
  if(mode==='invalid'){assert.equal(url.searchParams.get('fields'),'id');return {ok:true,status:200,json:async()=>({data:[]})};}
  const next=mode==='capped'||mode==='loop';
  return {ok:true,status:200,json:async()=>({data:[{id:'new-comment',root_post:{id:'new-post'},is_reply_owned_by_me:true,text:token}],...(next?{paging:{next:'https://untrusted.example/'+token,cursors:{after:mode==='loop'?'same':'cursor-'+replies}}}:{})})};
 }});
 assert.ok(!JSON.stringify(logs).includes(token));assert.ok(calls<=4);
 assert.equal(result.complete,mode==='success');
 if(mode==='success')assert.equal(logs.at(-1).matchedRoots,1);
 if(mode==='loop')assert.equal(replies,2);
 if(mode==='capped')assert.equal(replies,3);
 if(mode==='invalid')assert.equal(replies,2);else if(!['success','loop','capped'].includes(mode))assert.equal(replies,1);
}
for(const mode of ['success','permission','token','rate','invalid','network','html','malformed','capped','loop'])await scenario(mode);
assert.equal(safeFailure(403,{error:{code:100,message:'Unsupported get request'}}).kind,'unsupported-request');
assert.equal(safeFailure(400,{error:{code:100,message:'invalid since'}}).kind,'invalid-request');
assert.equal(safeFailure(500,{error:{code:1,message:'secret'}}).kind,'request-failed');
await assert.rejects(()=>diagnoseReplies({token:'',fetcher:()=>{throw Error('must not request')}}),/environment/);
console.log('PASS: bounded read-only diagnosis, success, auth/rate stops, schema comparison, partial pagination and secret-free output');
