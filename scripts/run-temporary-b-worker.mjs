import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyAgencyEveningRelease } from './agency-evening-release.mjs';
import { verifyDependencies } from './lib/collector-dependencies.mjs';
import { readReplacement, replacementFor } from '../src/lib/temporary-b-replacement.mjs';
import {ensureTtangDebugChrome} from './start-ttang-debug-chrome.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPORARY_ENTRIES = Object.freeze({
    modetour:'scripts/modetour-remote-worker.ts', ttang:'scripts/ttang-remote-worker.ts',
    onlinetour:'scripts/onlinetour-remote-worker.ts', myrealtrip:'scripts/mrt-c-worker.mjs',
    ybtour:'scripts/agency-evening-runtime.mjs', hanatour:'scripts/agency-evening-runtime.mjs',
    evening:'scripts/agency-evening-runtime.mjs',
});
export async function main() {
    const [source, mode] = process.argv.slice(2);
    if (process.argv.length !== 4 || mode !== '--scheduled' || !TEMPORARY_ENTRIES[source])
        throw Error('temporary_scheduled_entry_required');
    const config = readReplacement();
    if (!config || config.status !== 'active' || path.resolve(config.root, 'release') !== root)
        throw Error('temporary_release_not_active');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release-manifest.json'), 'utf8'));
    verifyAgencyEveningRelease(root, manifest, config.releaseVersion);
    verifyDependencies(root);
    const chunks=[]; let size=0;
    for await (const chunk of process.stdin) { size+=chunk.length; if(size>30000000)throw Error('temporary_input_too_large');chunks.push(chunk); }
    const input=Buffer.concat(chunks), request=JSON.parse(input.toString('utf8'));
    const slot=request.expectedAt || request.slot;
    for (const item of source==='evening'?request.sources:[source]) replacementFor(item,slot);
    const script=path.join(root,TEMPORARY_ENTRIES[source]);
    const args=script.endsWith('.ts')?[path.join(root,'node_modules/tsx/dist/cli.mjs'),'--tsconfig',path.join(root,'tsconfig.json'),script,mode]:[script,mode];
    // Only the three shared dedicated-Chrome collectors queue here. Each
    // worker still owns its imported source lock/claim and normal slot checks.
    const shared=['modetour','ttang','onlinetour'].includes(source);
    const lock=path.join(config.root,'state/temporary-browser-entry.lock');
    let descriptor,retain=false;
    if(shared){
        // Keep the original request freshness window and outer transport
        // deadline; never refresh createdAt or steal a stale lock.
        const deadline=Date.now()+3*60_000;
        while(descriptor===undefined){
            try{descriptor=fs.openSync(lock,'wx');}
            catch(error){
                if(error.code!=='EEXIST'||Date.now()>=deadline)throw Error('temporary_browser_busy');
                await new Promise(resolve=>setTimeout(resolve,1000));
            }
        }
        fs.writeFileSync(descriptor,JSON.stringify({pid:process.pid,source,slot,at:new Date().toISOString()}));
    }
    try{
        replacementFor(source==='evening'?request.sources[0]:source,slot);
        if(shared||source==='evening')await ensureTtangDebugChrome({port:9223,
            profileDir:'C:/Users/ynal/tmp/chrome-debug',blank:true,
            log:line=>process.stderr.write(line+'\n')});
        const result=spawnSync(process.execPath,args,{cwd:root,input,stdio:['pipe','inherit','inherit'],windowsHide:true,
            env:{...process.env,TIKITIKIT_TEMP_B_EXECUTION:'1',TIKITIKIT_TEMP_B_VERSION:config.releaseVersion}});
        if(result.error||result.signal||!Number.isInteger(result.status)){
            retain=true;throw Error('temporary_worker_completion_unknown');
        }
        process.exitCode=result.status;
    }finally{if(descriptor!==undefined){fs.closeSync(descriptor);if(!retain)fs.unlinkSync(lock);}}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
    main().catch(()=>{console.error('Temporary A worker refused; preserve slot and protection records');process.exitCode=1;});
