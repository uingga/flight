import {requestHttp} from './naver-http-request.mjs';
import {WRITER_FILES} from './writer-broker.mjs';
import {encodeRelayWire,decodeRelayWire} from './writer-relay-wire.mjs';
// One outbound delivery. Transport loss leaves the durable relay claim unresolved.
export async function deliverPublication({relayUrl,agentToken,publicationHandler,secrets}){
 const url=new URL(relayUrl),local=['127.0.0.1','[::1]'].includes(url.hostname);
 if(url.username||url.password||!['/','/api/writer/'].includes(url.pathname)||url.search||url.hash||(!local&&url.protocol!=='https:'))throw Error('relay origin refused');
 const web=url.pathname==='/api/writer/';
 const call=async(path,body)=>{
  const raw=JSON.stringify(body);
  const response=await requestHttp(new URL(path.slice(1),url),{method:'POST',headers:{authorization:`Bearer ${agentToken}`,'content-type':'application/json'},body:web?encodeRelayWire(raw):raw,loopbackOnly:local,maxBytes:web?3*1024*1024:32*1024*1024});
  if(!response.ok)throw Error('relay communication refused');return (web?JSON.parse(decodeRelayWire(await response.text())):await response.json()).result;
 };
 const item=await call('/delivery/claim',{});if(!item)return false;
 if(![...Object.keys(WRITER_FILES),'deploy'].includes(item.role)||!secrets[item.role])throw Error('delivery role refused');
 const response=await publicationHandler(new Request('http://127.0.0.1/publication',{method:'POST',headers:{authorization:`Bearer ${secrets[item.role]}`},body:item.body}));
 await call('/delivery/complete',{role:item.role,id:item.id,claim:item.claim,response:{status:response.status===200?200:409,body:await response.text()}});
 return true;
}
