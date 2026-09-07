// Explicit single full-inventory validation, never scheduled or published by this command.
import {spawnSync,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const statusFix=process.argv.length===4 && process.argv[3]==='--status-fix';
const continuation=process.argv.length===4 && process.argv[3]==='--continue-total-30';
const monthFix=process.argv.length===4 && process.argv[3]==='--month-fix';
if((process.argv.length!==3 && !statusFix && !continuation && !monthFix) || process.argv[2]!=='--consent-confirmed')throw Error('explicit_validation_consent_required');
const cache=JSON.parse(execFileSync('git',['show','origin/main:data/all-flights-cache.json'],{cwd:root,encoding:'utf8',maxBuffer:20000000}));
const request={protocol:'20260907.1',id:randomUUID(),createdAt:new Date().toISOString(),cache:{fullCrawlUpdatedAt:cache.fullCrawlUpdatedAt,
    sourceCircuits:{onlinetour:cache.sourceCircuits?.onlinetour},onlinePrimary:cache.onlinePrimary,scrapedCounts:{onlinetour:cache.scrapedCounts?.onlinetour}}};
const worker='C:/Users/ynal/AppData/Local/Tikitikit/crawler-validation-20260907';
const result=spawnSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=15','tikitikit-pc-b','node',worker+'/node_modules/tsx/dist/cli.mjs','--tsconfig',worker+'/tsconfig.json',worker+'/scripts/onlinetour-remote-worker.ts',monthFix?'--validate-month-fix':continuation?'--continue-validation-30':statusFix?'--validate-status-fix':'--validate'],
    {input:JSON.stringify(request),encoding:'utf8',stdio:['pipe','pipe','inherit'],maxBuffer:2000000,timeout:45*60_000,windowsHide:true});
if(result.error)throw Error('validation_transport_failed');
let response;try{response=JSON.parse(result.stdout);}catch{throw Error('validation_worker_preflight_failed');}
fs.writeFileSync(path.join(root,'.local-crawler','primary-validation-'+request.id+'.json'),JSON.stringify(response,null,2),{flag:'wx'});
console.log(JSON.stringify({id:response.id,status:response.status,reason:response.reason,restricted:response.restricted,
    runId:response.runId || response.summary?.runId,summary:response.summary,rawCount:response.raw?.length}));
process.exitCode=result.status || 0;
