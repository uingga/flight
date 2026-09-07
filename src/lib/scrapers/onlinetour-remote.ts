import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { getCrawlDataDir } from '../crawl-data-dir';
import { ONLINE_REMOTE_PROTOCOL,validateOperationalCatalogue } from '../onlinetour-operational';
import { SourceResponseError } from './source-response';
import { evaluatePcCollection } from '../../../scripts/pc-collection-policy.mjs';

export async function scrapeOnlineTourRemote() {
    let remoteStarted=false, remoteStopped=false;
    try {
    if(process.env.LOCAL_SOURCE_FALLBACK!=='1' || process.env.ONLINETOUR_BROWSER_REMOTE!=='1') throw Error('remote_source_not_enabled');
    const config=JSON.parse(fs.readFileSync(path.join(process.cwd(),'.local-crawler','onlinetour-remote.json'),'utf8'));
    if(config.protocol!==ONLINE_REMOTE_PROTOCOL || config.enabled!==true || config.host!=='tikitikit-pc-b'
        || config.workerRoot!=='C:/Users/ynal/AppData/Local/Tikitikit/crawler-validation-20260907') throw Error('invalid_remote_source_config');
    const cache=JSON.parse(fs.readFileSync(path.join(getCrawlDataDir(),'all-flights-cache.json'),'utf8'));
    const policy=evaluatePcCollection({cache});
    if(!policy.shouldRun || !policy.sources.includes('onlinetour')) throw Error('source_not_eligible');
    const id=randomUUID();
    const payload={protocol:ONLINE_REMOTE_PROTOCOL,id,createdAt:new Date().toISOString(),expectedAt:policy.expectedAt,
        cache:{fullCrawlUpdatedAt:cache.fullCrawlUpdatedAt,sourceCircuits:{onlinetour:cache.sourceCircuits?.onlinetour},
            scrapedCounts:{onlinetour:cache.scrapedCounts?.onlinetour},onlinePrimary:cache.onlinePrimary}};
    remoteStarted=true;
    const reply:any=await new Promise((resolve,reject)=> {
        const child=spawn('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=15',config.host,'node',
            config.workerRoot+'/node_modules/tsx/dist/cli.mjs','--tsconfig',config.workerRoot+'/tsconfig.json',config.workerRoot+'/scripts/onlinetour-remote-worker.ts','--scheduled'],{windowsHide:true});
        let output='',size=0,finished=false;
        const fail=()=>{if(!finished){finished=true;clearTimeout(timer);child.kill();reject(Error('remote_worker_transport_failed'));}};
        const timer=setTimeout(fail,45*60_000);
        child.on('error',fail); child.stdin.on('error',fail);
        child.stdout.on('data',chunk=>{size+=chunk.length;if(size>2000000){fail();return;}output+=chunk.toString('utf8');});
        // Drain progress, but never surface raw SSH/profile errors or unbounded output.
        child.stderr.on('data',()=>{});
        child.on('close',()=>{if(finished)return;finished=true;clearTimeout(timer);try{resolve(JSON.parse(output));}catch{reject(Error('remote_worker_invalid_result'));}});
        child.stdin.end(JSON.stringify(payload));
    });
    if(reply.protocol!==ONLINE_REMOTE_PROTOCOL || reply.id!==id) throw Error('remote_worker_identity_mismatch');
    remoteStopped=reply.status==='verified' ? reply.summary?.cleanupConfirmed===true : reply.githubFallbackSafe===true;
    if(reply.status!=='verified') {
        if(reply.restricted)throw new SourceResponseError('soft-block','온라인투어 B PC 접근 제한 — 이전 데이터 보존');
        throw Error('온라인투어 B PC 수집 실패: '+(/^[a-z_]{1,80}$/.test(reply.reason)?reply.reason:'invalid_result'));
    }
    return validateOperationalCatalogue(reply.summary,reply.raw,reply.flights,Date.now(),cache.scrapedCounts?.onlinetour);
    } catch(error) {
        // SSH timeout/disconnect does not prove that B has stopped. Do not start a second collector.
        if(error instanceof Error)Object.assign(error,{githubFallbackSafe:!remoteStarted || remoteStopped});
        throw error;
    }
}
