import http from 'node:http';
import {requestHttp} from './naver-http-request.mjs';
export {requestHttp} from './naver-http-request.mjs';
import { createHandler } from './naver-coordinator.mjs';
import { createClient } from './naver-ac-transport.mjs';
import { assertMode } from './naver-coordination-contract.mjs';
import {requireExternalWriterControl} from './naver-writer-safety.mjs';

export function createHttpClient({url,token,loopbackOnly=true}) {
    const origin=new URL(url);
    if(origin.pathname!=='/'||origin.search||origin.hash)throw Error('coordinator origin required');
    return createClient({token,transport:async request=>requestHttp(new URL('/control',origin),{
        method:'POST',headers:Object.fromEntries(request.headers),body:await request.text(),loopbackOnly})});
}
async function listen({coordinator,secrets,host='127.0.0.1',port=0,publicationHandler,beforeControl}) {
    if(!['127.0.0.1','::1'].includes(host))throw Error('external binding refused');
    const handler=createHandler(coordinator,secrets,{beforeControl});let closing=false;
    const sockets=new Set();
    const server=http.createServer(async(req,res)=>{
        const send=(status,text)=>{if(!res.destroyed){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(text);}};
        if(closing)return send(503,'{}');
        if(!['/health','/authority','/status','/control','/publication'].includes(req.url))return send(404,'{}');
        try {
            let size=0;const chunks=[];
            for await(const chunk of req){size+=chunk.length;if(size>(req.url==='/publication'?24*1024*1024:65536)){send(413,'{}');req.destroy();return;}chunks.push(chunk);}
            if(closing)return send(503,'{}');
            if(req.url==='/publication'&&!publicationHandler)return send(404,'{}');
            const response=await (req.url==='/publication'?publicationHandler:handler)(new Request(`http://127.0.0.1${req.url}`,{method:req.method,
                headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)}));
            send(response.status,await response.text());
        } catch {send(400,'{}');}
    });
    server.requestTimeout=10000;server.headersTimeout=10000;
    server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
    let shutdown;
    return {url:`http://${host==='::1'?'[::1]':host}:${server.address().port}`,server,
        close(){return shutdown ||= new Promise(resolve=>{
            closing=true;server.close(resolve);server.closeIdleConnections?.();
            for(const socket of sockets)socket.destroy();
        });}};
}
// Explicit test-only entry; cannot bind a private/public interface, alter ready, or start a crawler.
export const startLoopbackFixtureServer = options => listen(options);
export function startCoordinatorServer(options) {
    requireExternalWriterControl(options.authority);
    if(typeof options.beforeControl!=='function')throw Error('authority revalidation required before control');
    if(!assertMode())throw Error('coordinated mode required');
    return listen(options);
}
