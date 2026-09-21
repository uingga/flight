import http from 'node:http';
import https from 'node:https';
const isLoopback=u=>['127.0.0.1','[::1]','::1'].includes(u.hostname);
const transportError=(message,code)=>Object.assign(Error(message),{code});
const safeCode=(error,fallback)=>['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','EPIPE','ENOBUFS','HTTP_TIMEOUT','HTTP_RESPONSE_TOO_LARGE'].includes(error?.code)?error.code:fallback;
// Client-only module: workflow writers do not load the SQLite coordinator.
export function requestHttp(url,{method='GET',headers={},body,timeoutMs=10000,maxBytes=16*1024*1024,loopbackOnly=false}={}) {
 const target=new URL(url);
 if(target.username||target.password||!['http:','https:'].includes(target.protocol)||(loopbackOnly&&!isLoopback(target)))throw Error('HTTP target refused');
 return new Promise((resolve,reject)=>{
  const request=(target.protocol==='https:'?https:http).request(target,{method,headers,agent:false},response=>{
   let bytes=0;const chunks=[];
   response.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes)response.destroy(transportError('response too large','HTTP_RESPONSE_TOO_LARGE'));else chunks.push(chunk);});
   response.on('error',error=>reject(transportError('HTTP response failed',safeCode(error,'HTTP_RESPONSE_FAILED'))));
   response.on('end',()=>{
    if(response.statusCode>=300&&response.statusCode<400)return reject(transportError('redirect refused','HTTP_REDIRECT_REFUSED'));
    resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers}));
   });
  });
  request.setTimeout(timeoutMs,()=>request.destroy(transportError('HTTP timeout','HTTP_TIMEOUT')));
  request.on('error',error=>reject(transportError('HTTP request failed',safeCode(error,'HTTP_REQUEST_FAILED'))));
  if(body!==undefined)request.write(body);
  request.end();
 });
}
