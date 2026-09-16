import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {assertMode} from '../src/lib/naver-coordination-contract.mjs';
import {requestHttp} from '../src/lib/naver-http-request.mjs';
import {kstDay} from '../src/lib/naver-coordinator.mjs';
import {runHostHandoff} from './lib/naver-host-handoff.mjs';

function execute(file,args,options){
 return new Promise((resolve,reject)=>{
  const child=spawn(file,args,{...options,windowsHide:true,stdio:'ignore'});
  child.once('error',()=>reject(Error('worker start failed')));
  child.once('close',code=>code===0?resolve():reject(Error('worker outcome unsuccessful or unknown')));
 });
}
export function pinnedRemoteArguments(config,day){
 const safe=value=>typeof value==='string'&&/^[A-Za-z0-9_./:\\-]+$/.test(value);
 if(config.ssh?.target!=='ynal@100.87.173.95'||!safe(config.ssh.key)||!safe(config.ssh.knownHosts)
   ||!safe(config.remoteNode)||!safe(config.remoteRoot)||!safe(config.remoteConfig))throw Error('pinned C configuration required');
 const port=Number(config.tunnelPort),url=new URL(config.env.NAVER_COORDINATION_URL);
 if(!Number.isInteger(port)||port<1024||port>65535||url.hostname!=='127.0.0.1'||url.protocol!=='http:'||!url.port)throw Error('loopback tunnel required');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('invalid day');
 return ['-F','NUL','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes',
  '-o','GlobalKnownHostsFile=NUL','-o',`UserKnownHostsFile=${config.ssh.knownHosts}`,
  '-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3',
  '-i',config.ssh.key,'-R',`127.0.0.1:${port}:127.0.0.1:${url.port}`,config.ssh.target,
  `${config.remoteNode} ${config.remoteRoot}/scripts/run-naver-host.mjs --config ${config.remoteConfig} --worker-c ${day}`];
}
export async function runConfiguredHost(config,{workerDay,executeProcess=execute,clock=Date.now}={}){
 const env={...process.env,...config.env};
 if(!assertMode(env))throw Error('coordinated mode required');
 const worker=workerDay?'C':'A';
 if(os.hostname().toLowerCase()!==(worker==='C'?'desktop-1ppfur3':'office-omen'))throw Error('host identity mismatch');
 if(workerDay&&workerDay!==kstDay(clock()))throw Error('remote day mismatch');
 if(env.NAVER_COORDINATION_WORKER!==worker)throw Error('host role mismatch');
 const root=fs.realpathSync(config.root);
 const runWorker=({run,resume=false})=>executeProcess(process.execPath,
  ['--import',pathToFileURL(path.join(root,'node_modules/tsx/dist/loader.mjs')).href,path.join(root,'scripts/run-naver-ac.ts'),'--scheduled',
   ...(worker==='A'&&env.NAVER_COORDINATION_APPROVED_RECOVERY_SOURCES?['--approved-recovery-sources',env.NAVER_COORDINATION_APPROVED_RECOVERY_SOURCES]:[])],
  {cwd:root,env:{...env,NAVER_COORDINATION_RUN_ID:run,NAVER_COORDINATION_RESUME:resume?'1':'0'}});
 if(worker==='C')return runWorker({run:`${workerDay}-C`});
 const token=fs.readFileSync(env.NAVER_COORDINATION_A_TOKEN_FILE,'utf8').trim();
 const readStatus=async()=>{
  const response=await requestHttp(new URL('/status',env.NAVER_COORDINATION_URL),{loopbackOnly:true,headers:{authorization:`Bearer ${token}`}});
  if(!response.ok)throw Error('coordinator status refused');
  const value=await response.json();if(value.ok!==true)throw Error('invalid coordinator status');return value.state;
 };
 return runHostHandoff({activateAt:config.activateAt,clock,readStatus,completedRound:env.NAVER_COMPLETED_ROUND,
  readLegacy:async()=>fs.existsSync(env.NAVER_COORDINATION_A_STATE_FILE)?JSON.parse(fs.readFileSync(env.NAVER_COORDINATION_A_STATE_FILE,'utf8')):null,
  runA:runWorker,runC:async()=>executeProcess('ssh.exe',pinnedRemoteArguments(config,kstDay(clock())),{cwd:root,env})});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=process.argv.slice(2);
 if(args[0]!=='--config'||![2,4].includes(args.length)||(args.length===4&&args[2]!=='--worker-c')){
  console.error('invalid host arguments');process.exitCode=1;
 }else Promise.resolve().then(()=>runConfiguredHost(JSON.parse(fs.readFileSync(args[1],'utf8')),{workerDay:args[3]}))
  .then(()=>console.log('host invocation ended; coordinator ledger is authoritative'))
  .catch(()=>{console.error('host handoff stopped; preserve ledger and inspect before retry');process.exitCode=1;});
}
