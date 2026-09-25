import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { MODE_REMOTE_PROTOCOL, validateModeBundle } from '../modetour-operational';
import { evaluatePcCollection } from '../../../scripts/pc-collection-policy.mjs';
import { getCrawlDataDir } from '../crawl-data-dir';
import { SourceResponseError } from './source-response';
import { ttangWorkerForSlot } from '../../../scripts/ttang-worker-routing.mjs';
import { assertModeReplyIdentity } from '../modetour-remote-contract';

export async function scrapeModetourRemote(cache: any) {
    // Explicit offline import feeds the identical filters; never permit this switch on production data/.
    if (process.env.MODETOUR_SAVED_EVIDENCE) {
        if (path.resolve(getCrawlDataDir()) === path.resolve('data')) throw new Error('saved_evidence_requires_staging');
        return validateModeBundle(JSON.parse(fs.readFileSync(process.env.MODETOUR_SAVED_EVIDENCE,'utf8')),
            cache?.flights || [], cache?.modetourPrimary?.scopeCounts);
    }
    if (process.env.LOCAL_SOURCE_FALLBACK !== '1' || process.env.MODETOUR_BROWSER_REMOTE !== '1') throw new Error('remote_source_not_enabled');
    const config = JSON.parse(fs.readFileSync(path.resolve('.local-crawler/modetour-remote.json'),'utf8'));
    if (config.protocol !== MODE_REMOTE_PROTOCOL || config.enabled !== true || config.host !== 'tikitikit-pc-b'
        || config.workerRoot !== 'C:/Users/ynal/AppData/Local/Tikitikit/crawler-validation-20260907') throw new Error('invalid_remote_source_config');
    const policy = evaluatePcCollection({cache});
    if (!policy.shouldRun || !policy.sources.includes('modetour')) throw new Error('source_not_eligible');
    // Both browser collectors use the same approved daytime B/C slot assignment.
    const worker = ttangWorkerForSlot(policy.expectedAt);
    const id = randomUUID();
    const request = { protocol: MODE_REMOTE_PROTOCOL, id, createdAt: new Date().toISOString(), expectedAt: policy.expectedAt, worker,
        cache: { flights:[], fullCrawlUpdatedAt:cache.fullCrawlUpdatedAt, sourceCircuits:{modetour:cache.sourceCircuits?.modetour}, modetourPrimary:cache.modetourPrimary } };
    const reply: any = await new Promise((resolve,reject) => {
        const workerRoot = worker === 'C' ? 'C:/Users/ynal/AppData/Local/Tikitikit/ac-staged-20260916' : config.workerRoot;
        const ssh = worker === 'C'
            ? ['-F','NUL','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','GlobalKnownHostsFile=NUL','-o','UserKnownHostsFile=C:/Users/ynal/AppData/Local/Temp/tikitikit-ssh-setup-20260915/known_hosts_c','-o','ConnectTimeout=15','-i','C:/Users/ynal/.ssh/tikitikit_a_to_c_ed25519','ynal@100.87.173.95','C:/Users/ynal/AppData/Local/hermes/node/node.exe']
            : ['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15',config.host,'node'];
        const child = spawn('ssh', [...ssh,
            workerRoot+'/node_modules/tsx/dist/cli.mjs','--tsconfig',workerRoot+'/tsconfig.json',
            workerRoot+'/scripts/modetour-remote-worker.ts','--scheduled'], {windowsHide:true});
        const output: Buffer[] = []; let size=0, finished=false;
        const fail=()=>{if(!finished){finished=true;clearTimeout(timer);child.kill();reject(new Error('remote_transport_failed'));}};
        const timer=setTimeout(fail,15*60000);
        child.on('error',fail); child.stdin.on('error',fail); child.stderr.on('data',()=>{});
        child.stdout.on('data',chunk=>{size+=chunk.length;if(size>8000000){fail();return;}output.push(Buffer.from(chunk));});
        child.on('close',()=>{if(finished)return;finished=true;clearTimeout(timer);try{resolve(JSON.parse(Buffer.concat(output).toString('utf8')));}catch{reject(new Error('invalid_remote_reply'));}});
        child.stdin.end(JSON.stringify(request));
    });
    assertModeReplyIdentity(reply, id);
    if (reply.status !== 'verified') {
        if (reply.restricted) throw new SourceResponseError('soft-block',`모두투어 ${worker} PC 접근 제한 — 이전 데이터 보존`);
        const reason = typeof reply.reason === 'string' && /^[a-z_]+$/.test(reply.reason) ? reply.reason : 'unknown_failure';
        throw new Error(`모두투어 ${worker} PC 수집 실패 (${reason}) — 이전 데이터 보존`);
    }
    return validateModeBundle(reply.bundle, cache?.flights || [], cache?.modetourPrimary?.scopeCounts);
}
