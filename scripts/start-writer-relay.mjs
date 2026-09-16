import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertMode} from '../src/lib/naver-coordination-contract.mjs';
import {PublicationQueue,createRelayHandler} from '../src/lib/writer-relay.mjs';
// Bind only behind an independently approved TLS ingress. No public binding or TLS setup here.
export async function listenRelay({handler,port=0}){
 const server=http.createServer(async(req,res)=>{
  try{
   let length=0;const chunks=[];
   for await(const chunk of req){length+=chunk.length;if(length>24*1024*1024)throw Error('payload limit');chunks.push(chunk);}
   const response=await handler(new Request(`http://127.0.0.1${req.url}`,{method:req.method,headers:req.headers,body:req.method==='POST'?Buffer.concat(chunks):undefined}));
   res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text());
  }catch{res.writeHead(409);res.end('{}');}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}
export async function startConfiguredRelay(env=process.env){
 if(!assertMode(env))throw Error('coordinated mode required');
 const file=env.TIKIT_WRITER_RELAY_DB_PATH;
 if(!file||!fs.existsSync(file))throw Error('existing explicitly provisioned relay DB required');
 const secrets=JSON.parse(fs.readFileSync(env.TIKIT_WRITER_RELAY_SECRETS_FILE,'utf8'));
 const agentToken=fs.readFileSync(env.TIKIT_WRITER_RELAY_AGENT_TOKEN_FILE,'utf8').trim();
 const queue=new PublicationQueue(file);
 try{
  const handler=createRelayHandler({queue,secrets,agentToken});
  const port=Number(env.TIKIT_WRITER_RELAY_PORT);if(!Number.isInteger(port)||port<1||port>65535)throw Error('explicit relay port required');
  const server=await listenRelay({handler,port});
  return {...server,close:async()=>{await server.close();queue.close();}};
 }catch(e){queue.close();throw e;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 startConfiguredRelay().then(server=>{
  console.log('publication relay listening on loopback');
  const stop=()=>server.close().catch(()=>{process.exitCode=1;});
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
 }).catch(()=>{console.error('publication relay startup refused');process.exitCode=1;});
}
