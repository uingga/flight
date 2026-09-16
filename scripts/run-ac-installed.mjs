import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export function installedTask(role,base,read=file=>JSON.parse(fs.readFileSync(file,'utf8'))){
 const config=base+'/publisher-auth/ac-config';
 const runtime=base+'/naver-ac-runtime';
 const targets={coordinator:{root:runtime,file:'scripts/start-naver-coordinator.mjs',config:'server',args:[]},naver:{root:runtime,file:'scripts/run-naver-round-bridge.mjs',config:'A',args:['--scheduled']},myrealtrip:{root:base+'/mrt-dispatch-runtime',file:'scripts/run-mrt-c.mjs',config:'myrealtrip',args:['--scheduled']},'source-fallback':{root:'C:/Users/ynal/Tikitikit/source-fallback-crawler',file:'scripts/run-source-fallback-crawl.ps1',config:'source-fallback',args:['-Scheduled']}};
 const target=targets[role];if(!target)throw Error('Unknown installed task');
 const value=read(config+'/'+target.config+'.json'),env=value.env||value;
 if(env.NAVER_COORDINATION!=='1')throw Error('Installed task not activated');
 if(role==='naver'&&env.NAVER_COORDINATION_EXTERNAL_ATTESTED!=='1')throw Error('Entry points not verified');
 return {...target,env};
}
export async function runInstalled(role){
 if(os.hostname().toLowerCase()!=='office-omen')throw Error('A host required');
 const base='C:/Users/ynal/AppData/Local/Tikitikit',target=installedTask(role,base);
 const directory=base+'/naver-coordinator/logs';fs.mkdirSync(directory,{recursive:true});
 const log=fs.openSync(path.join(directory,role+'.log'),'a');
 const powershell=role==='source-fallback';
 const program=powershell?path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):process.execPath;
 const args=[...(powershell?['-NoProfile','-NonInteractive','-File']:[]),path.join(target.root,target.file),...target.args];
 try{return await new Promise((resolve,reject)=>{
  const child=spawn(program,args,{cwd:target.root,env:{...process.env,...target.env},windowsHide:true,stdio:['ignore',log,log]});
  child.once('error',()=>reject(Error('Installed task failed to start')));
  child.once('close',code=>code===0?resolve(0):reject(Error('Installed task stopped; inspect local log')));
 });}finally{fs.closeSync(log);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 if(process.argv.length!==3)throw Error('Explicit role required');
 runInstalled(process.argv[2]).catch(()=>{console.error('Installed task refused or failed; preserve state');process.exitCode=1;});
}
