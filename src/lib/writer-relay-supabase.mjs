import {requestHttp} from './naver-http-request.mjs';
export function createSupabasePublicationQueue({url,serviceKey,fixture=false}){
 const origin=new URL(url);
 if(origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||!serviceKey
  ||(fixture?!['127.0.0.1','[::1]'].includes(origin.hostname):origin.protocol!=='https:'))throw Error('queue configuration refused');
 const rpc=async(action,input={})=>{
  const response=await requestHttp(new URL('/rest/v1/rpc/tikit_writer_queue',origin),{
   method:'POST',headers:{apikey:serviceKey,...(serviceKey.startsWith('sb_secret_')?{}:{authorization:`Bearer ${serviceKey}`}), 'content-type':'application/json'},
   body:JSON.stringify({p_action:action,p_input:input}),loopbackOnly:fixture,maxBytes:64*1024*1024,
  });
  if(!response.ok)throw Error('queue transaction refused');
  return response.json();
 };
 return {submit:(role,id,body)=>rpc('submit',{role,id,body}),claim:()=>rpc('claim'),complete:input=>rpc('complete',input)};
}
