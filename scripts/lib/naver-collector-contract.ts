import fs from 'node:fs';
import path from 'node:path';

// Read literals only; never execute PowerShell. Keep the existing PS1 policy authoritative.
export function collectorEnvironment(codeRoot:string,workRoot:string,policy:any,worker:string) {
 const script=fs.readFileSync(path.join(codeRoot,'scripts/run-naver-crawl.ps1'),'utf8');
 const begin=script.indexOf("$env:HIDE_WINDOW = '1'"),end=script.indexOf('$CrawlerAttempt =',begin);
 if(begin<0||end<0)throw Error('collector policy contract missing');
 const env:Record<string,string>={};
 for(const match of script.slice(begin,end).matchAll(/\$env:(\w+)\s*=\s*'([^']*)'/g))env[match[1]]=match[2];
 const budget=worker==='A'?policy.navigationBudget:(worker==='C'?250:200);
 if(!Number.isInteger(budget)||budget<0||budget>(worker==='C'?250:200))throw Error('invalid collector budget');
 Object.assign(env,{SOURCE_FILTER:(policy.sources||[]).join(',')||'all',MAX_FLIGHTS:String(budget),MAX_NAVIGATIONS:String(budget),NAVER_RUN_STATUS_FILE:path.join(workRoot,'run-status.json')});
 if(worker==='C')env.NAVER_BROWSER_CHANNEL='chrome'; // Existing installed Chrome; no browser download on C.
 if(env.NAVER_LIVE_RUN!=='1'||env.STANDARD_REFRESH_DAYS!=='2')throw Error('invalid collector policy');
 return env;
}
