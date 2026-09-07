// Called after publishing the PC outcome. Never performs an agency request.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { evaluatePcCollection } from './pc-collection-policy.mjs';
import { assertOnlineGithubFallback } from './online-github-fallback-policy.mjs';

async function main() {
    const cache=JSON.parse(fs.readFileSync('data/all-flights-cache.json','utf8'));
    const policy=evaluatePcCollection({cache});
    if(!policy.githubFallbackDue) {console.log('OnlineTour GitHub fallback not due.');return;}
    assertOnlineGithubFallback({cache,expectedAt:policy.expectedAt});
    const remote=execFileSync('git',['remote','get-url','origin'],{encoding:'utf8'}).trim();
    const match=/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(remote);
    if(!match)throw Error('unexpected_github_remote');
    let token=process.env.GH_PAT || process.env.GITHUB_TOKEN;
    if(!token) {
        // Existing Git Credential Manager only. Never print or persist credentials.
        const credential=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',
            timeout:15000,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'}});
        token=credential.split(/\r?\n/).find(line=>line.startsWith('password='))?.slice(9);
    }
    if(!token)throw Error('github_dispatch_credentials_missing');
    const state=path.resolve('.local-crawler','github-fallback-dispatch');
    fs.mkdirSync(state,{recursive:true});
    if(fs.lstatSync(state).isSymbolicLink())throw Error('unsafe_dispatch_state');
    const marker=path.join(state,createHash('sha256').update(policy.expectedAt).digest('hex')+'.json');
    if(fs.existsSync(marker)) {console.log('OnlineTour dispatch already attempted for this slot; not repeated.');return;}
    fs.writeFileSync(marker,JSON.stringify({expectedAt:policy.expectedAt,status:'attempted'}),{flag:'wx'});
    // An uncertain response is not retried; the next slot re-evaluates the normal policy.
    const response=await fetch(`https://api.github.com/repos/${match[1]}/${match[2]}/actions/workflows/onlinetour-fallback.yml/dispatches`,{
        method:'POST',headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json',
            'X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify({ref:'main',inputs:{expected_at:policy.expectedAt}}),
        signal:AbortSignal.timeout(20000)});
    fs.writeFileSync(marker,JSON.stringify({expectedAt:policy.expectedAt,status:response.status===204?'dispatched':'failed',httpStatus:response.status}));
    if(response.status!==204)throw Error('github_dispatch_failed');
    console.log('OnlineTour GitHub fallback dispatched for '+policy.expectedAt);
}
main().catch(()=>{console.error('OnlineTour fallback dispatch failed; no retry or agency request. Check GitHub credentials/dispatch state.');process.exitCode=1;});
