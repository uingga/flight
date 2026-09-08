import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { discoverDedicatedChromeEndpoint } from '../src/lib/onlinetour-dedicated-chrome';
import { TTANG_PROTOCOL, TTANG_INPUT_FILES, assertTtangAllowed, validateTtangEvidence } from './ttang-primary-policy.mjs';
import { readTtangPartialSummary } from './ttang-staging-validation.mjs';

async function main() {
    const manual=process.argv[2]==='--manual-once';
    if (process.argv.length!==3 || (!manual && process.argv[2]!=='--scheduled') || os.hostname().toUpperCase()!=='DESKTOP-OFFICE') throw Error('invalid_worker_mode');
    const chunks:Buffer[]=[]; let size=0;
    for await(const chunk of process.stdin){size+=chunk.length;if(size>12000000)throw Error('request_too_large');chunks.push(Buffer.from(chunk));}
    const r=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(r.protocol!==TTANG_PROTOCOL || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(r.id || '')
        || r.manual!==manual || Date.now()-Date.parse(r.createdAt)<0 || Date.now()-Date.parse(r.createdAt)>900000
        || !Number.isFinite(Date.parse(r.createdAt)) || !r.files || Object.keys(r.files).some(f=>!TTANG_INPUT_FILES.includes(f))) throw Error('invalid_worker_request');
    const root=path.resolve(__dirname,'..'), input=r.files['all-flights-cache.json'];
    const base=path.join(os.homedir(),'AppData/Local/Tikitikit');
    const state=path.join(base,'ttang-browser'), shared=path.join(base,'onlinetour-validation');
    fs.mkdirSync(state,{recursive:true});fs.mkdirSync(shared,{recursive:true});
    if([state,shared].some(p=>fs.lstatSync(p).isSymbolicLink()))throw Error('unsafe_state_directory');
    const cooldown=path.join(state,'cooldown.json');
    const check=()=>assertTtangAllowed(input,{manual,cooldown:fs.existsSync(cooldown)?JSON.parse(fs.readFileSync(cooldown,'utf8')):undefined});
    if(check()!==r.expectedAt)throw Error('slot_mismatch');
    const lock=path.join(shared,'run.lock'), fd=fs.openSync(lock,'wx');
    let uncertain=false;
    const dir=path.join(root,'.local-crawler/staging','ttang-'+r.id);
    try {
        check();
        const slot=manual?'manual-'+new Date(Date.now()+9*3600000).toISOString().slice(0,10)
            :'scheduled-'+createHash('sha256').update(r.expectedAt).digest('hex');
        fs.writeFileSync(path.join(state,slot+'.json'),JSON.stringify({id:r.id,at:r.createdAt}),{flag:'wx'});
        await discoverDedicatedChromeEndpoint(); // Existing headed, dedicated profile only; never launch in SSH session 0.
        fs.mkdirSync(dir,{recursive:true});
        for(const file of TTANG_INPUT_FILES)if(r.files[file])fs.writeFileSync(path.join(dir,file),JSON.stringify(r.files[file]));
        const startedAt=new Date().toISOString();
        const log=fs.openSync(path.join(dir,'worker.log'),'wx');
        let result;
        try { result=spawnSync(process.execPath,[path.join(root,'node_modules/tsx/dist/cli.mjs'),'scripts/crawl-all.ts','--sources=ttang'],{
            cwd:root,stdio:['ignore',log,log],timeout:30*60000,windowsHide:true,
            env:{...process.env,LOCAL_SOURCE_FALLBACK:'0',LOCAL_BROWSER_PILOT:'1',TTANG_BROWSER_WORKER:'1',
                TIKITIKIT_DATA_DIR:dir,TTANG_DETAIL_CHECKPOINT:'1',TTANG_STAGING_RUN_ID:r.id,TTANG_STAGING_STARTED_AT:startedAt,
                TTANG_BROWSER_CDP_URL:'http://127.0.0.1:9222',SOURCE_START_JITTER_MAX_MS:'0'}
        }); } finally {fs.closeSync(log);}
        if(result.error || result.signal){uncertain=true;throw Error('worker_interrupted');}
        const cache=JSON.parse(fs.readFileSync(path.join(dir,'all-flights-cache.json'),'utf8'));
        const partial=readTtangPartialSummary(dir,r.id);
        const manifestPath=path.join(dir,'ttang-list-evidence.json');
        const manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):null;
        if(result.status!==0){uncertain=true;throw Error('worker_failed');}
        if(cache.sourceCircuits?.ttang?.nextProbeAt && Date.parse(cache.sourceCircuits.ttang.nextProbeAt)>Date.now()) {
            fs.writeFileSync(cooldown,JSON.stringify(cache.sourceCircuits.ttang));throw Error('source_cooldown');
        }
        if (manifest?.coverage !== 'verified') throw Error('unverified_list_coverage');
        const bundle={protocol:TTANG_PROTOCOL,id:r.id,startedAt,completedAt:new Date().toISOString(),cleanupConfirmed:true,cache,partial,manifest};
        validateTtangEvidence(bundle,r.id);
        fs.writeFileSync(path.join(dir,'bundle.json'),JSON.stringify(bundle));
        process.stdout.write(JSON.stringify({protocol:TTANG_PROTOCOL,id:r.id,status:'verified',bundle}));
    } catch(e) {
        const reason=/^[a-z_]+$/.test((e as Error).message)?(e as Error).message:'worker_preflight_failed';
        // An uncertain child exit never permits another crawler to reuse this browser automatically.
        if(uncertain)fs.writeFileSync(cooldown,JSON.stringify({nextProbeAt:new Date(Date.now()+86400000).toISOString(),reason}));
        if(fs.existsSync(dir))fs.writeFileSync(path.join(dir,'failure.json'),JSON.stringify({reason,uncertain}));
        let observedCount=0;
        try { observedCount=JSON.parse(fs.readFileSync(path.join(dir,'ttang-list-evidence.json'),'utf8')).rawCount; } catch {}
        process.stdout.write(JSON.stringify({protocol:TTANG_PROTOCOL,id:r.id,status:'failed',reason,uncertain,
            observedCount,
            cooldown:fs.existsSync(cooldown)?JSON.parse(fs.readFileSync(cooldown,'utf8')):undefined}));
        process.exitCode=1;
    } finally {fs.closeSync(fd);if(!uncertain)fs.unlinkSync(lock);}
}
void main().catch(()=>{process.stdout.write(JSON.stringify({status:'failed',reason:'worker_preflight_failed'}));process.exitCode=1;});
