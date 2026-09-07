import test from 'node:test';
import assert from 'node:assert/strict';
import { createOnlineTourRegionDiscovery } from '../src/lib/onlinetour-region-discovery';
import { createOnlineTourBrowserAdapter, type CdpClient } from '../src/lib/onlinetour-browser-adapter';
import fs from 'node:fs';
const LIST='https://www.onlinetour.co.kr/flight/w/international/dcair/dcairList';
function fake(count:number): CdpClient & {calls:{method:string;params:any}[]} {
    const calls:{method:string;params:any}[]=[];
    return {calls,close:async()=>{},onEvent:()=>()=>{},send:async(method,params:any={})=>{
        calls.push({method,params});
        if(method==='Target.getTargets') return {targetInfos:Array.from({length:count},(_,i)=>({type:'page',targetId:'tab'+i,url:LIST}))};
        if(method==='Target.createTarget') return {targetId:'owned'};
        if(method==='Target.attachToTarget') return {sessionId:'session'};
        return {};
    }};
}
for(const count of [0,1,2]) test(`initial entry creates one owned blank tab with ${count} existing list tabs`,async()=>{
    const client=fake(count);
    const region=await createOnlineTourRegionDiscovery(client,{maxNavigations:1,maxProductRequests:1},true);
    assert.equal(region.targetId,'owned');
    assert.deepEqual(client.calls.find(c=>c.method==='Target.createTarget')?.params,{url:'about:blank',background:true});
    assert.equal(client.calls.find(c=>c.method==='Target.attachToTarget')?.params.targetId,'owned');
    assert.ok(!client.calls.some(c=>c.method==='Page.navigate'));
    await region.close();
});
test('regional and list adapters attach only to explicit owned target among duplicate pages',async()=>{
    const c=fake(2), d=fake(2);
    const region=await createOnlineTourRegionDiscovery(c,{maxNavigations:0,maxProductRequests:0},false,'tab1');
    const lists=await createOnlineTourBrowserAdapter(d,{targetId:'tab1'});
    for(const client of [c,d]) assert.equal(client.calls.find(x=>x.method==='Target.attachToTarget')?.params.targetId,'tab1');
    await region.close(); await lists.close();
    await assert.rejects(createOnlineTourRegionDiscovery(fake(2),{maxNavigations:0,maxProductRequests:0},false,'missing'));
    await assert.rejects(createOnlineTourBrowserAdapter(fake(2),{targetId:'missing'}));
});
test('manual run is explicit, daily one-shot and keeps cooldown and lock checks',()=>{
    const worker=fs.readFileSync('scripts/onlinetour-remote-worker.ts','utf8');
    assert.match(worker,/request\.manualOnce!==true/);
    assert.match(worker,/'manual-once-'\+new Date/);
    assert.match(worker,/flag:'wx'/);
    assert.match(worker,/checkValidationCooldown/);
    assert.match(worker,/fs\.openSync\(lock,'wx'\)/);
    const runner=fs.readFileSync('scripts/run-source-fallback-crawl.ps1','utf8');
    assert.doesNotMatch(runner,/ONLINETOUR_MANUAL_ONCE/);
    assert.match(fs.readFileSync('scripts/crawl-all.ts','utf8'),/scraped: circuitSkipped\.has\(src as CrawlableSourceKey\) \? undefined : observedCounts\[src\]/);
});
