import http from 'node:http';
import https from 'node:https';
const isLoopback=u=>['127.0.0.1','[::1]','::1'].includes(u.hostname);
// Client-only module: workflow writers do not load the SQLite coordinator.
export function requestHttp(url,{method='GET',headers={},body,timeoutMs=10000,maxBytes=16*1024*1024,loopbackOnly=false}={}) {
 const target=new URL(url);
 if(target.username||target.password||!['http:','https:'].includes(target.protocol)||(loopbackOnly&&!isLoopback(target)))throw Error('HTTP target refused');
 return new Promise((resolve,reject)=>{
  const request=(target.protocol==='https:'?https:http).request(target,{method,headers,agent:false},response=>{
   let bytes=0;const chunks=[];
   response.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes)response.destroy(Error('response too large'));else chunks.push(chunk);});
   response.on('error',()=>reject(Error('HTTP response failed')));
   response.on('end',()=>{
    if(response.statusCode>=300&&response.statusCode<400)return reject(Error('redirect refused'));
    resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers}));
   });
  });
  request.setTimeout(timeoutMs,()=>request.destroy(Error('HTTP timeout')));
  request.on('error',()=>reject(Error('HTTP request failed')));
  if(body!==undefined)request.write(body);
  request.end();
 });
}
